/**
 * Whether a Single's or field group's Schema Builder save is one only its dialog's push applies,
 * rather than the migration file the save writes.
 *
 * @module dispatcher/helpers/push-carries-values
 */
import { fieldsLeavingTranslationUnder } from "../../domains/i18n/migration/archive-preflight";
import { fieldsJoiningTranslation } from "../../domains/i18n/migration/field-joins-translation";
import type { FieldRename } from "../../domains/i18n/migration/reconcile-companion";
import type { TableSpec } from "../../domains/schema/pipeline/diff/types";
import { reachesRelationStorage } from "../../domains/schema/pipeline/recorded-shapes";
import type { FieldDefinition } from "../../schemas/dynamic-collections";

/**
 * Whether the save carries values across its change, which the dialog's push does and the file,
 * written from the newest snapshot, does not yet: translation turned on or off for the entity's
 * values, or its per-language Draft/Published turned on or off, each seeding or restoring
 * columns from the ones they replace; a field joining translation or leaving it, its values moved
 * between the main table and the companion (judged under `renamed`, the companion rename the save
 * makes, as the preflights judge it); and a change reaching a relation's storage
 * (`reachesRelationStorage`), which the push plans from the live table.
 *
 * Any other save moves no value, and its file applies it, in tries over a busy table and on SQLite
 * as a migration file runs, with the companion brought in step after it.
 */
export async function pushCarriesValues(args: {
  oldFields: readonly FieldDefinition[];
  newFields: readonly FieldDefinition[];
  /** Whether the values are stored per language before and after the save. */
  wasStored: boolean;
  isStored: boolean;
  /** Per-language Draft/Published before and after the save. A field group has neither. */
  wasStatus?: boolean;
  status?: boolean;
  /** The companion rename the save makes, if any. */
  renamed: FieldRename | null | undefined;
  /** The entity's main table as the database holds it. */
  liveTable: () => Promise<TableSpec | undefined>;
}): Promise<boolean> {
  if (args.wasStored !== args.isStored) return true;
  if (args.isStored && args.wasStatus !== args.status) return true;
  if (
    args.isStored &&
    fieldsJoiningTranslation(args.oldFields, args.newFields).length > 0
  ) {
    return true;
  }
  if (
    args.wasStored &&
    fieldsLeavingTranslationUnder(args.oldFields, args.newFields, args.renamed)
      .length > 0
  ) {
    return true;
  }
  return reachesRelationStorage({
    before: args.oldFields,
    after: args.newFields,
    liveTable: args.liveTable,
  });
}
