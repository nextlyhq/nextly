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

import { ensureI18nArchive } from "./ensure-archive";
import { fieldsJoiningTranslation } from "./field-joins-translation";
import {
  type LeavingFieldLike,
  refusalsForFieldsJoiningTranslation,
  refusalsForFieldsLeavingTranslation,
  refusalsForTranslatedFieldRenamedAndReshaped,
  storageDiffers,
} from "./field-leaves-translation-rules";
import { fieldToLocalizedColumnSpec } from "./field-to-column-spec";
import {
  buildLeavingFieldsArchiveStatements,
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
}): Promise<void> {
  if (!args.wasLocalized || !args.isLocalized) return;
  const leaving = new Set(
    fieldsLeavingTranslation(args.oldFields, args.newFields)
  );
  const joining = fieldsJoiningTranslation(args.oldFields, args.newFields);
  const mayRenameTranslated = oneTranslatedFieldReplaced(args);
  // Nothing to judge or archive when no field changes whether it is translated, or its name.
  if (leaving.size === 0 && joining.length === 0 && !mayRenameTranslated) {
    return;
  }

  const dialect = args.adapter.getCapabilities().dialect;
  const refusals = [
    ...refusalsForFieldsLeavingTranslation({
      leaving,
      newFields: args.newFields,
      oldFields: args.oldFields,
      dialect,
      builtBy: args.builtBy,
      surface: "builder",
    }),
    ...refusalsForFieldsJoiningTranslation({
      reshaped: reshapedJoiningFields(joining, args, dialect),
      surface: "builder",
    }),
    ...refusalsForTranslatedFieldRenamedAndReshaped({
      reshaped: mayRenameTranslated
        ? await renamedAndReshaped(args, dialect)
        : undefined,
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
      oldFields: args.oldFields,
      newFields: args.newFields,
    })
  );
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

/**
 * The new name of a translated field this change renames, by the main table's rule
 * (`detectFieldRename`), when its storage changes too; undefined otherwise.
 */
async function renamedAndReshaped(
  args: {
    oldFields: readonly LeavingFieldLike[];
    newFields: readonly LeavingFieldLike[];
    builtBy: ColumnOrigin;
  },
  dialect: SupportedDialect
): Promise<string | undefined> {
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
  return storageDiffers(
    fieldToLocalizedColumnSpec(rename.from, dialect, args.builtBy),
    fieldToLocalizedColumnSpec(rename.to, dialect, args.builtBy)
  )
    ? rename.to.name
    : undefined;
}
