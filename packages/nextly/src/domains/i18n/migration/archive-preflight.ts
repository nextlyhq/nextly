/**
 * Before a schema change makes a translated field shared, refuse what cannot move and archive what
 * will.
 *
 * A field that stops being translated keeps its other languages' values only because they are
 * written to `nextly_i18n_archive` before its companion column is dropped. That write happens here,
 * before the change alters anything: no main-table ALTER, no registry write, no companion DDL. An
 * archive that refuses the real values (a missing table, a drifted column) therefore stops the
 * change while nothing has moved, and the refusal says so.
 *
 * @module domains/i18n/migration/archive-preflight
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../../errors/nextly-error";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import type { ColumnOrigin } from "../../schema/services/field-column-descriptor";
import { isFieldLocalized } from "../classify-fields";
import { companionColumnNames } from "../runtime/companion-io";

import { ensureI18nArchive } from "./ensure-archive";
import { fieldsJoiningTranslation } from "./field-joins-translation";
import {
  type LeavingFieldLike,
  refusalsForFieldsJoiningTranslation,
  refusalsForFieldsLeavingTranslation,
  refusalsForTranslatedFieldRenamedAndReshaped,
  refusalsForTranslatedFieldRenamedAsTranslationEnds,
  storageDiffers,
} from "./field-leaves-translation-rules";
import { fieldToLocalizedColumnSpec } from "./field-to-column-spec";
import {
  buildLeavingFieldsArchiveStatements,
  type FieldRename,
  fieldsLeavingTranslation,
} from "./reconcile-companion";
import type { I18nTransitionKind } from "./transition-state";

/**
 * Creates the archive table when it is missing, then runs the given archive writes.
 *
 * @throws NextlyError `NEXTLY_MIGRATION_APPLY_FAILED` when the table cannot be created or a write
 *   is refused, before anything else has changed
 */
async function writeArchiveFirst(
  adapter: DrizzleAdapter,
  entity: string,
  writes: readonly string[]
): Promise<void> {
  const dialect = adapter.getCapabilities().dialect;
  try {
    await ensureI18nArchive(adapter, dialect);
    for (const statement of writes) {
      await adapter.executeQuery(statement);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new NextlyError({
      code: "NEXTLY_MIGRATION_APPLY_FAILED",
      publicMessage:
        "The localization archive could not be written, so nothing was changed. " +
        "A field that stops being translated keeps its other languages' values there.",
      logMessage: `localization archive not writable: ${reason}`,
      logContext: { entity },
      cause: error instanceof Error ? error : undefined,
    });
  }
}

/**
 * The first step of every schema change that can make a translated field shared, taken before the
 * change alters anything. It is one call so the collection save, the collection, Single and
 * field-group schema dialogs and the Single save cannot answer it differently.
 *
 * What cannot leave translation in one change is refused first
 * (`refusalsForFieldsLeavingTranslation`, the rule `migrate:create` applies too):
 * - A field whose storage changes in the same edit: its type (text becoming a number) or its
 *   bounds (a shorter maximum length, a smaller precision). Its values are copied into the shared
 *   column as they are, without the conversion and confirmation such a change goes through on its
 *   own, so one the new column cannot hold would fail part-way, be truncated, or be kept against
 *   the field's new rules.
 * - A required or unique field. Its shared column is created, and its constraints checked, before
 *   the default language's values are copied into it, so at that moment every existing row holds
 *   the same placeholder or none. A required column then has nothing valid to hold (each dialect
 *   and path fails differently), and a unique one fails its check part-way through the change.
 *
 * A shared field that becomes translated while its storage changes is refused here too
 * (`refusalsForFieldsJoiningTranslation`): its value would be copied as it is into a companion
 * column of the new shape.
 *
 * Then every non-default language's value of each leaving field is written to the archive. The
 * writes are safe to repeat, so the companion transition that later drops the column, and a
 * migration file replayed elsewhere, can make them again without adding rows. Should a later step
 * of the change be refused, the rows written here are copies of values that are still in place.
 *
 * Nothing is asked when no field leaves translation, or when the entity is not translated before
 * and after the change (turning translation off for the whole entity archives by its own path).
 *
 * @throws NextlyError `VALIDATION_ERROR` naming each reshaped or constrained field and the order
 *   that works, leaving or joining, or `NEXTLY_MIGRATION_APPLY_FAILED` when the archive refuses the values
 */
export async function archiveFieldsLeavingTranslation(args: {
  adapter: DrizzleAdapter;
  /** The collection, Single or field group being changed. */
  entity: string;
  /** Which of the three it is, recorded with its archive rows. */
  kind: I18nTransitionKind;
  /** Its main table; the companion is `<tableName>_locales`. */
  tableName: string;
  /** Which builder made the entity's table, which decides a column's bounds. */
  builtBy: ColumnOrigin;
  /** The language whose value becomes the shared one, and is therefore not archived. */
  defaultLocale: string;
  oldFields: readonly LeavingFieldLike[];
  newFields: readonly LeavingFieldLike[];
  wasLocalized: boolean;
  isLocalized: boolean;
  /**
   * The rename the schema dialog's answer decided (`resolveCompanionRename`): a field renamed,
   * or `null` when the admin chose to drop and add. Left out by a save with no dialog, which
   * decides by the main table's rule (`detectFieldRename`) instead.
   */
  renamed?: FieldRename | null;
}): Promise<void> {
  if (!args.wasLocalized) return;
  if (!args.isLocalized) {
    await refuseRenameAsTranslationEnds(args);
    return;
  }
  // A translated field renamed in this change is judged under its new name, as the companion
  // transition will move it: renamed and made shared, it leaves translation, and its archive,
  // its refusals and its settings are asked for here, before the main table changes.
  const rename = await renameInChange(args);
  const oldFields = rename
    ? args.oldFields.map(f =>
        f === rename.from ? { ...f, name: rename.to.name } : f
      )
    : args.oldFields;
  const leaving = new Set(fieldsLeavingTranslation(oldFields, args.newFields));
  const joining = fieldsJoiningTranslation(oldFields, args.newFields);
  // Nothing to judge or archive when no field changes whether it is translated, or its name.
  if (leaving.size === 0 && joining.length === 0 && !rename) {
    return;
  }
  const dialect = args.adapter.getCapabilities().dialect;

  const refusals = [
    ...refusalsForFieldsLeavingTranslation({
      leaving,
      newFields: args.newFields,
      oldFields,
      dialect,
      builtBy: args.builtBy,
      surface: "builder",
    }),
    ...refusalsForFieldsJoiningTranslation({
      reshaped: reshapedJoiningFields(joining, { ...args, oldFields }, dialect),
      surface: "builder",
    }),
    ...refusalsForTranslatedFieldRenamedAndReshaped({
      reshaped: rename && reshaped(rename, args.builtBy, dialect),
    }),
  ];
  if (refusals.length > 0) {
    throw NextlyError.validation({
      errors: refusals,
      logContext: {
        entity: args.entity,
        fields: refusals.map(r => r.path),
      },
    });
  }
  if (leaving.size === 0) return;

  // Where a renamed field's values are now: in the column it had, until an earlier apply renamed
  // it; and nowhere on the companion once an earlier apply finished moving them and stopped before
  // the registry recorded it, so its archive rows are already written.
  const source = await renamedSource(
    args.adapter,
    args.tableName,
    renamedColumn(rename, args.builtBy, dialect)
  );
  await writeArchiveFirst(
    args.adapter,
    args.entity,
    buildLeavingFieldsArchiveStatements({
      slug: args.entity,
      kind: args.kind,
      tableName: args.tableName,
      dialect,
      builtBy: args.builtBy,
      defaultLocale: args.defaultLocale,
      oldFields: source.moved
        ? oldFields.filter(f => f.name !== rename?.to.name)
        : oldFields,
      newFields: args.newFields,
      renamedFrom: source.renamedFrom,
    })
  );
}

/**
 * Refuses a translated field renamed in the change that turns translation off
 * (`refusalsForTranslatedFieldRenamedAsTranslationEnds`), before anything runs.
 *
 * @throws NextlyError `VALIDATION_ERROR` naming the field and the two saves that work
 */
async function refuseRenameAsTranslationEnds(
  args: Parameters<typeof archiveFieldsLeavingTranslation>[0]
): Promise<void> {
  if (!oneTranslatedFieldReplaced(args)) return;
  const rename = await translatedFieldRename(
    args,
    args.adapter.getCapabilities().dialect
  );
  const refusals = refusalsForTranslatedFieldRenamedAsTranslationEnds({
    renamed: rename?.to.name,
  });
  if (refusals.length === 0) return;
  throw NextlyError.validation({
    errors: refusals,
    logContext: { entity: args.entity, fields: refusals.map(r => r.path) },
  });
}

/**
 * The renamed field's values as this database has them (`renamed` maps its new column to its old
 * one): read from the old column while it is there; from the new one once an earlier apply renamed
 * it; and `moved` when neither is left, because an earlier apply copied them out, archived them and
 * dropped the column, then stopped before the registry recorded the change.
 */
async function renamedSource(
  adapter: DrizzleAdapter,
  tableName: string,
  renamed: ReadonlyMap<string, string> | undefined
): Promise<{ renamedFrom?: ReadonlyMap<string, string>; moved: boolean }> {
  if (!renamed) return { moved: false };
  const live = new Set(await companionColumnNames(adapter, tableName));
  const [[to, from]] = [...renamed];
  if (live.has(from)) return { renamedFrom: renamed, moved: false };
  return { moved: !live.has(to) };
}

/**
 * The rename in this change: the one the dialog's answer decided, when the caller has one, else
 * the one the main table's rule finds for a translated field replaced by a new one.
 */
async function renameInChange(args: {
  adapter: DrizzleAdapter;
  oldFields: readonly LeavingFieldLike[];
  newFields: readonly LeavingFieldLike[];
  renamed?: FieldRename | null;
}): Promise<TranslatedFieldRename | undefined> {
  const decided = args.renamed;
  if (decided === null) return undefined;
  if (decided !== undefined) {
    const from = args.oldFields.find(f => f.name === decided.from);
    const to = args.newFields.find(f => f.name === decided.to);
    return from && to ? { from, to } : undefined;
  }
  return oneTranslatedFieldReplaced(args)
    ? translatedFieldRename(args, args.adapter.getCapabilities().dialect)
    : undefined;
}

/**
 * The shared fields that become translated in this change while their storage changes, judged
 * against the column each one's value sits in now, which its old definition describes.
 */
function reshapedJoiningFields(
  joining: readonly string[],
  args: {
    oldFields: readonly LeavingFieldLike[];
    newFields: readonly LeavingFieldLike[];
    builtBy: ColumnOrigin;
  },
  dialect: SupportedDialect
): string[] {
  const columnOf = (field: LeavingFieldLike | undefined) =>
    field === undefined
      ? undefined
      : fieldToLocalizedColumnSpec(field, dialect, args.builtBy);
  const before = new Map(args.oldFields.map(f => [f.name, f]));
  const after = new Map(args.newFields.map(f => [f.name, f]));
  return joining.filter(name =>
    storageDiffers(columnOf(before.get(name)), columnOf(after.get(name)))
  );
}

/**
 * Whether the change takes away exactly one translated field and adds exactly one field, the only
 * shape the rename rule reads as a rename. Asked of the names alone, so a save that renames
 * nothing translated asks the adapter nothing.
 */
function oneTranslatedFieldReplaced(args: {
  oldFields: readonly LeavingFieldLike[];
  newFields: readonly LeavingFieldLike[];
}): boolean {
  const after = new Set(args.newFields.map(f => f.name));
  const before = new Set(args.oldFields.map(f => f.name));
  const removed = args.oldFields.filter(f => !after.has(f.name));
  const added = args.newFields.filter(f => !before.has(f.name));
  return (
    removed.length === 1 &&
    added.length === 1 &&
    isFieldLocalized(removed[0], true)
  );
}

/** A translated field this change renames: its definition before and after. */
interface TranslatedFieldRename {
  from: LeavingFieldLike;
  to: LeavingFieldLike;
}

/**
 * The translated field this change renames, by the main table's rule (`detectFieldRename`), which
 * the companion transition follows too; undefined when no translated field is renamed.
 */
async function translatedFieldRename(
  args: {
    oldFields: readonly LeavingFieldLike[];
    newFields: readonly LeavingFieldLike[];
  },
  dialect: SupportedDialect
): Promise<TranslatedFieldRename | undefined> {
  const { DynamicCollectionSchemaService } = await import(
    "../../dynamic-collections/services/dynamic-collection-schema-service"
  );
  const rename = new DynamicCollectionSchemaService(
    undefined,
    dialect
  ).detectFieldRename(
    args.oldFields as unknown as FieldDefinition[],
    args.newFields as unknown as FieldDefinition[]
  );
  if (!rename || !isFieldLocalized(rename.from, true)) return undefined;
  // The same objects as the change's own lists, so the caller can find the renamed field by
  // identity.
  const from = args.oldFields.find(f => f.name === rename.from.name);
  const to = args.newFields.find(f => f.name === rename.to.name);
  return from && to ? { from, to } : undefined;
}

/** The renamed field's new name when its storage changes too; undefined otherwise. */
function reshaped(
  rename: TranslatedFieldRename,
  builtBy: ColumnOrigin,
  dialect: SupportedDialect
): string | undefined {
  return storageDiffers(
    fieldToLocalizedColumnSpec(rename.from, dialect, builtBy),
    fieldToLocalizedColumnSpec(rename.to, dialect, builtBy)
  )
    ? rename.to.name
    : undefined;
}

/**
 * The renamed field's column under its new name, mapped to the column it has now, for the archive
 * writes made before the rename runs.
 */
function renamedColumn(
  rename: TranslatedFieldRename | undefined,
  builtBy: ColumnOrigin,
  dialect: SupportedDialect
): ReadonlyMap<string, string> | undefined {
  if (!rename) return undefined;
  const from = fieldToLocalizedColumnSpec(rename.from, dialect, builtBy)?.name;
  const to = fieldToLocalizedColumnSpec(
    { ...rename.from, name: rename.to.name },
    dialect,
    builtBy
  )?.name;
  return from && to ? new Map([[to, from]]) : undefined;
}
