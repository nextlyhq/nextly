/**
 * The translated values a schema save drops with its translations table: a translated field the
 * save removes, or keeps by name while it loses its column on the row, has its values in the
 * entity's `<table>_locales` table, which neither the push's diff nor its preview reads. They go in
 * the step that brings the translations table in step with the save, beside the push or after the
 * save's own file, so the save asks for them by the field's name before anything is written.
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { isFieldLocalized } from "../../i18n/classify-fields";
import { offeredCompanionRename } from "../../i18n/migration/companion-rename";
import { storesPerLanguage } from "../../i18n/per-language-storage";
import type {
  BrowserRenameResolution,
  LegacyResolutionsBundle,
} from "../pipeline/prompt-dispatcher/browser";

import { type ColumnOrigin, toSnakeCase } from "./field-column-descriptor";
import { rowFieldDiff } from "./field-diff";
import { fieldsLosingTheirColumn } from "./field-storage-moves";

/** A save of an entity's fields, as its drops beside the main table are judged. */
export interface FieldsSave {
  /** The entity's table, whose translations table is `<tableName>_locales`. */
  tableName: string;
  /** Which builder made the entity's table, which decides its columns (`ColumnOrigin`). */
  builtBy: ColumnOrigin;
  dialect: SupportedDialect;
  oldFields: readonly FieldDefinition[];
  newFields: readonly FieldDefinition[];
  /** Whether the entity is translated before and after the save. */
  wasLocalized: boolean;
  isLocalized: boolean;
}

/**
 * The fields a save drops from the entity's row: those it removes, as the dialog lists them for the
 * person to confirm (`rowFieldDiff`), a field inside a group with no name included, and those it
 * keeps by name that lose their column on the row (`fieldsLosingTheirColumn`).
 */
export function fieldsDroppedFromRow(save: FieldsSave): FieldDefinition[] {
  const removed = rowFieldDiff(save.oldFields, save.newFields, {
    localized: storesPerLanguage({ localized: save.wasLocalized }),
    newLocalized: storesPerLanguage({ localized: save.isLocalized }),
  }).removed;
  const losingColumn = fieldsLosingTheirColumn(save.oldFields, save.newFields, {
    dialect: save.dialect,
    builtBy: save.builtBy,
  });
  return [...removed, ...losingColumn];
}

/**
 * Of the fields a save drops from the row (`fieldsDroppedFromRow`), the translated ones whose values
 * in the translations table no answer names: each is confirmed by the field's name, as the dialog
 * sends it (`legacy.byFieldName`, `confirm_drop`), or answered as the rename offered for it on the
 * translations table (`offeredCompanionRename`, the one offer the preview shows and the apply takes
 * back), `rename` keeping its values and `drop_and_add` the consent to lose them. A resolution
 * naming any other pair answers nothing.
 *
 * Asked of where the values are stored, as the apply's `resolveCompanionRename` is: under
 * per-language storage an untranslated entity keeps them in the translations table too.
 */
export async function unconfirmedTranslatedDrops(
  save: FieldsSave & {
    renameResolutions: readonly BrowserRenameResolution[];
    legacy?: LegacyResolutionsBundle;
  }
): Promise<FieldDefinition[]> {
  const wasStored = storesPerLanguage({ localized: save.wasLocalized });
  const translated = fieldsDroppedFromRow(save).filter(field =>
    isFieldLocalized(field, wasStored)
  );
  if (translated.length === 0) return [];
  const offered = await offeredCompanionRename({
    tableName: save.tableName,
    oldFields: save.oldFields,
    newFields: save.newFields,
    wasLocalized: wasStored,
    isLocalized: storesPerLanguage({ localized: save.isLocalized }),
    dialect: save.dialect,
    builtBy: save.builtBy,
  });
  const answeredAsOffered = (column: string) =>
    offered !== undefined &&
    offered.candidate.fromColumn === column &&
    save.renameResolutions.some(
      resolution =>
        resolution.tableName === offered.candidate.tableName &&
        resolution.fromColumn === offered.candidate.fromColumn &&
        resolution.toColumn === offered.candidate.toColumn
    );
  return translated.filter(
    field =>
      !answeredAsOffered(toSnakeCase(field.name)) &&
      save.legacy?.byFieldName[field.name]?.action !== "confirm_drop"
  );
}
