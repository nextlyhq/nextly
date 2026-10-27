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

import { isVirtualField } from "../../../collections/fields/virtual";
import { NextlyError } from "../../../errors/nextly-error";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import type { ColumnOrigin } from "../../schema/services/field-column-descriptor";
import { isFieldLocalized } from "../classify-fields";
import {
  companionColumnNames,
  localizedColumnsOnMain,
} from "../runtime/companion-io";

import { ensureI18nArchive } from "./ensure-archive";
import { fieldsJoiningTranslation } from "./field-joins-translation";
import {
  type LeavingFieldLike,
  refusalsForFieldsJoiningTranslation,
  refusalsForFieldsLeavingTranslation,
  refusalsForTranslatedFieldRenamedAndReshaped,
  refusalsForTranslatedFieldRenamedAsTranslationEnds,
  refusalsForTranslatedFieldsRemovedBesideAdded,
  storageDiffers,
  withoutLeavingConstraints,
} from "./field-leaves-translation-rules";
import { fieldToLocalizedColumnSpec } from "./field-to-column-spec";
import { refusalsForConstrainedFieldsLeaving } from "./leaving-constraint-preconditions";
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
 * - A Required or Unique field whose default-language values cannot take the setting once they
 *   are shared (`refusalsForConstrainedFieldsLeaving`): an entry with none, for Required; two
 *   entries that would share one, for Unique. Each surface creates the shared column without the
 *   setting and applies it after the copy, so values that can take it leave in one change.
 *
 * A shared field that becomes translated while its storage changes is refused here too
 * (`refusalsForFieldsJoiningTranslation`): its value would be copied as it is into a companion
 * column of the new shape.
 *
 * Then every non-default language's value of each leaving field is written to the archive. The
 * writes are safe to repeat, so the companion transition that later drops the column, and a
 * migration file replayed elsewhere, can make them again without adding rows. Should a later step
 * of the change be refused, the rows written here are copies of values that are still in place.
 * A leaving field whose values an earlier apply of the change already moved onto the main table,
 * dropping its companion column, is neither judged nor archived again (`movedLeavingFields`), so
 * the same change, retried, can finish.
 *
 * Nothing is asked when no field leaves translation, or when the entity is not translated before
 * and after the change (turning translation off for the whole entity archives by its own path).
 * Turning translation off or on still refuses a field that is or becomes translated removed beside
 * an added one, as neither move can follow it to its new name.
 *
 * @throws NextlyError `VALIDATION_ERROR` naming each reshaped field and the order that works,
 *   leaving or joining, and each constrained field with how many entries are in the way; or
 *   `NEXTLY_MIGRATION_APPLY_FAILED` when the archive refuses the values
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
  /**
   * Set by the schema dialogs, whose push refuses a main-table column drop the admin did not
   * confirm (`BrowserPromptDispatcher`). Before translation is on, every field is a main-table
   * column, so that refusal already asks about each one the change takes away.
   */
  mainDropsConfirmed?: boolean;
}): Promise<void> {
  if (!args.wasLocalized) {
    // Turning translation on moves a field's main column to the companion only under a name the
    // field has before and after the change (`buildCompanionTransitionStatements`), so one that
    // becomes translated and is removed beside an added field, a rename included, would lose its
    // value with its main column. A rename is not carried by that move, so only an explicit
    // drop-and-add answer passes, or a save whose main-table drops are confirmed on their own.
    if (args.isLocalized && !args.mainDropsConfirmed) {
      refuseTranslatedFieldsRemovedBesideAdded(args, args.oldFields, {
        translationStarts: true,
      });
    }
    return;
  }
  if (!args.isLocalized) {
    await refuseRenameAsTranslationEnds(args);
    // Turning translation off restores each field from the companion under the name it had, so
    // a translated field removed beside an added one is restored under a name no field has.
    refuseTranslatedFieldsRemovedBesideAdded(args, args.oldFields);
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
  // Before the early return below: a change that only removes and adds translated fields changes
  // no field's translation, and is exactly the one that would drop a column unasked.
  refuseTranslatedFieldsRemovedBesideAdded(args, oldFields);
  // Nothing to judge or archive when no field changes whether it is translated, or its name.
  if (leaving.size === 0 && joining.length === 0 && !rename) {
    return;
  }
  const dialect = args.adapter.getCapabilities().dialect;
  // The companion's columns as this database has them, read once: they say where a renamed field's
  // values are, and which leaving fields an earlier apply already moved.
  const live = new Set(
    await companionColumnNames(args.adapter, args.tableName)
  );
  const renamedFrom = renamedSource(
    live,
    renamedColumn(rename, args.builtBy, dialect)
  );
  const moved = await movedLeavingFields(args.adapter, args.tableName, live, {
    leaving,
    oldFields,
    renamedFrom,
    builtBy: args.builtBy,
    dialect,
  });

  const shapeRefusals = [
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
  // A Required or Unique field leaving translation takes its setting on once the default
  // language's values are shared, so those values are asked whether they can take it. A field
  // refused above for its storage is not asked as well.
  const refusedPaths = new Set(shapeRefusals.map(r => r.path));
  const refusals = [
    ...shapeRefusals,
    ...(await refusalsForConstrainedFieldsLeaving({
      adapter: args.adapter,
      dialect,
      tableName: args.tableName,
      builtBy: args.builtBy,
      defaultLocale: args.defaultLocale,
      // A field whose values an earlier apply already moved has none left here to ask.
      leaving: new Set(
        [...leaving].filter(
          name => !refusedPaths.has(`fields.${name}`) && !moved.has(name)
        )
      ),
      oldFields,
      newFields: args.newFields,
      renamedFrom,
      surface: "builder",
    })),
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
      // A moved field's archive rows were written by the apply that moved it.
      oldFields: oldFields.filter(f => !moved.has(f.name)),
      newFields: args.newFields,
      renamedFrom,
    })
  );
}

/**
 * Refuses a change that removes translated fields while it adds others with no rename decided
 * for them (`refusalsForTranslatedFieldsRemovedBesideAdded`), before anything runs. An explicit
 * drop-and-add answer from the schema dialog is the admin choosing the drop, so it passes.
 *
 * @throws NextlyError `VALIDATION_ERROR` naming each removed field and the two saves that work
 */
function refuseTranslatedFieldsRemovedBesideAdded(
  args: Parameters<typeof archiveFieldsLeavingTranslation>[0],
  oldFields: readonly LeavingFieldLike[],
  /** Set for the change that turns translation on, whose refusal names that save first. */
  options: { translationStarts?: boolean } = {}
): void {
  if (args.renamed === null) return;
  const before = new Set(oldFields.map(f => f.name));
  const after = new Set(args.newFields.map(f => f.name));
  // Any new field that stores something, translated or shared, wherever it stores it: a column
  // on the main table or the companion, a junction table, a field group's own table. A translated
  // field renamed to a type that is shared by default reads as one removed and one shared field
  // added. Only a virtual field stores nothing.
  const storesSomething = (
    f: LeavingFieldLike & { virtual?: unknown; options?: unknown }
  ) => !isVirtualField(f);
  const added = args.newFields
    .filter(f => !before.has(f.name) && storesSomething(f))
    .map(f => f.name);
  const removed = oldFields.filter(
    f => !after.has(f.name) && isFieldLocalized(f, true)
  );
  // Judged by name first, so a change that does not both remove and add asks the adapter nothing.
  if (added.length === 0 || removed.length === 0) return;
  const dialect = args.adapter.getCapabilities().dialect;
  const refusals = refusalsForTranslatedFieldsRemovedBesideAdded({
    removed: removed
      .filter(
        f => fieldToLocalizedColumnSpec(f, dialect, args.builtBy) !== null
      )
      .map(f => f.name),
    added,
    translationStarts: options.translationStarts,
  });
  if (refusals.length === 0) return;
  throw NextlyError.validation({
    errors: refusals,
    logContext: { entity: args.entity, fields: refusals.map(r => r.path) },
  });
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
 * Where the renamed field's values are read from (`renamed` maps its new column to its old one):
 * the old column while the companion `live` still has it; undefined once an earlier apply renamed
 * it, so they are read under the new name.
 */
function renamedSource(
  live: ReadonlySet<string>,
  renamed: ReadonlyMap<string, string> | undefined
): ReadonlyMap<string, string> | undefined {
  if (!renamed) return undefined;
  const [[, from]] = [...renamed];
  return live.has(from) ? renamed : undefined;
}

/**
 * The leaving fields whose values an earlier apply of the same change already moved: the column
 * they are read from (under its old name for a renamed field, `renamedFrom`) is not among the
 * companion's `live` columns, AND the main table has the field's shared column. That apply copied
 * their default language's values onto the main table, archived the other languages and dropped
 * the companion column, then stopped before the registry recorded it, for instance when the push
 * applying a Required or Unique setting was refused. A retry has no values of theirs left to judge
 * or archive.
 *
 * A companion column missing while the main table has no shared column either is not that state
 * (a companion that drifted, or was only partly provisioned), so such a field is judged and
 * archived as any other, and the read of its missing column refuses the change before any schema
 * work. The main table is read only when a companion column is missing.
 */
async function movedLeavingFields(
  adapter: DrizzleAdapter,
  tableName: string,
  live: ReadonlySet<string>,
  args: {
    leaving: ReadonlySet<string>;
    oldFields: readonly LeavingFieldLike[];
    renamedFrom: ReadonlyMap<string, string> | undefined;
    builtBy: ColumnOrigin;
    dialect: SupportedDialect;
  }
): Promise<Set<string>> {
  const columnOf = (f: LeavingFieldLike) =>
    fieldToLocalizedColumnSpec(f, args.dialect, args.builtBy)?.name;
  const offCompanion = args.oldFields.filter(f => {
    const col = args.leaving.has(f.name) ? columnOf(f) : undefined;
    return col !== undefined && !live.has(args.renamedFrom?.get(col) ?? col);
  });
  if (offCompanion.length === 0) return new Set();
  const onMain = new Set(
    (await localizedColumnsOnMain(adapter, tableName, offCompanion)).map(
      c => c.name
    )
  );
  return new Set(
    offCompanion
      .filter(f => {
        const col = columnOf(f);
        return col !== undefined && onMain.has(col);
      })
      .map(f => f.name)
  );
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
 * The fields a schema dialog's apply pushes first when a Required or Unique field stops being
 * translated: those fields without their settings. Created with them, the shared column would hold
 * NULL or one placeholder in every entry before the companion transition copies the default
 * language's values in, so the apply pushes this list, runs the transition, and then pushes the
 * real fields to apply the settings. Undefined when no field needs it.
 */
/**
 * The fields that leave translation in this change, named as they are after it. A field the change
 * renames is matched under its new name, so one renamed and made shared in the same change leaves
 * translation too, and its Required or Unique setting waits for the default language's values.
 * The one rule every Builder path uses, the schema dialogs and the schema service's saves alike.
 */
export function fieldsLeavingTranslationUnder(
  oldFields: readonly LeavingFieldLike[],
  newFields: readonly LeavingFieldLike[],
  renamed?: FieldRename | null
): string[] {
  return fieldsLeavingTranslation(
    renamed
      ? oldFields.map(f =>
          f.name === renamed.from ? { ...f, name: renamed.to } : f
        )
      : oldFields,
    newFields
  );
}

export function fieldsWithLeavingSettingsDeferred<
  F extends LeavingFieldLike,
>(args: {
  oldFields: readonly LeavingFieldLike[];
  newFields: readonly F[];
  wasLocalized: boolean;
  isLocalized: boolean;
  /**
   * The rename the schema dialog's answer decided (`resolveCompanionRename`). A field renamed and
   * made shared leaves translation under its new name, as `archiveFieldsLeavingTranslation`
   * judges it.
   */
  renamed?: FieldRename | null;
}): F[] | undefined {
  if (!args.wasLocalized || !args.isLocalized) return undefined;
  const deferred = withoutLeavingConstraints(
    args.newFields,
    new Set(
      fieldsLeavingTranslationUnder(
        args.oldFields,
        args.newFields,
        args.renamed
      )
    )
  );
  return deferred.some((f, i) => f !== args.newFields[i])
    ? deferred
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
