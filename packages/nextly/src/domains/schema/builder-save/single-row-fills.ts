/**
 * The fields new to a Single's table, and the value its one row takes for each.
 *
 * A Single holds one row. A field a save adds to its table takes, in that row, the default the
 * field states, as the application would write it (`singleRowFillValue`): the PATCH road fills it
 * in its alter, and the Schema Builder dialog's save hands the same values to the file it writes.
 * One walk decides which fields are new, for both roads and for the judgement of whether a save's
 * push carries values (`pushCarriesValues`), so they cannot disagree about a field.
 *
 * @module domains/schema/builder-save/single-row-fills
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { DynamicCollectionSchemaService } from "../../dynamic-collections/services/dynamic-collection-schema-service";
import { resolveLocalizedFieldNames } from "../../i18n/classify-fields";
import type {
  BrowserRenameResolution,
  LegacyFieldResolution,
  LegacyResolutionsBundle,
} from "../pipeline/prompt-dispatcher/browser";
import {
  fieldsStoredOnRow,
  toSnakeCase,
} from "../services/field-column-descriptor";

/**
 * The named fields a row stores: the top-level ones and those a group with no name lays out
 * (`fieldsStoredOnRow`), which holds no value and has no column of its own.
 */
export function namedOnRow(
  fields: readonly FieldDefinition[]
): (FieldDefinition & { name: string })[] {
  return fieldsStoredOnRow(fields).filter(
    (field): field is FieldDefinition & { name: string } =>
      typeof field.name === "string" && field.name !== ""
  );
}

/**
 * The fields a save adds to a Single's table: stored on its row after the save, and neither there
 * before it nor renamed onto (a rename keeps the value the column holds).
 */
export function fieldsNewToSingleTable(args: {
  oldFields: readonly FieldDefinition[];
  newFields: readonly FieldDefinition[];
  /** The columns the save renames onto. */
  renamedTo: readonly string[];
}): (FieldDefinition & { name: string })[] {
  const kept = new Set([
    ...namedOnRow(args.oldFields).map(field => toSnakeCase(field.name)),
    ...args.renamedTo,
  ]);
  return namedOnRow(args.newFields).filter(
    field => !kept.has(toSnakeCase(field.name))
  );
}

/**
 * The value a Single's row takes for each field the save adds to its table, by field name: the
 * default the field states, where `fillValue` (`singleRowFillValue`) takes one. A field it takes
 * none for is left out, and its row keeps no value, as before.
 */
function singleRowFills(args: {
  oldFields: readonly FieldDefinition[];
  newFields: readonly FieldDefinition[];
  renamedTo: readonly string[];
  fillValue: (field: FieldDefinition) => unknown;
}): { field: string; value: unknown }[] {
  return fieldsNewToSingleTable(args).flatMap(field => {
    const value = args.fillValue(field);
    return value === undefined ? [] : [{ field: field.name, value }];
  });
}

/**
 * What a Single's dialog save hands on for its row, from the fields before and after it and the
 * person's own answers. The file the save writes takes every row fill (`singleRowFills`, by
 * `singleRowFillValue`, as the PATCH road fills the row) for a field the person did not answer
 * themselves, whose answer wins. The push takes the person's answers, with a required field's
 * fill given as an answer would be, since the push asks only a required field's rows; an optional
 * field's fill reaches the row by the file alone.
 */
export function dialogRowAnswers(args: {
  /** The Single as stored before the save: its table and its fields. */
  single: { tableName: string; fields?: unknown };
  /** Its fields after the save. */
  fields: readonly FieldDefinition[];
  renameResolutions: readonly BrowserRenameResolution[] | undefined;
  resolutions: Readonly<Record<string, LegacyFieldResolution>> | undefined;
  dialect: SupportedDialect;
  /** Whether the Single's translatable values are kept per language after the save. */
  translatedAfter: boolean;
}): {
  fileAnswers: { rowFills?: { field: string; value: unknown }[] };
  legacyBundle: LegacyResolutionsBundle | undefined;
} {
  const answered = args.resolutions ?? {};
  // A translated field's values live in the translations table, one row per language, so the
  // main row takes no fill for it.
  const translated = new Set(
    resolveLocalizedFieldNames([...args.fields], args.translatedAfter)
  );
  const schema = new DynamicCollectionSchemaService(undefined, args.dialect);
  const rowFills = singleRowFills({
    oldFields: (args.single.fields ?? []) as FieldDefinition[],
    newFields: args.fields,
    renamedTo: (args.renameResolutions ?? [])
      .filter(rename => rename.choice === "rename")
      .map(rename => rename.toColumn),
    fillValue: field => schema.singleRowFillValue(field),
  }).filter(
    // Only an answer the person gave, never a member every object inherits (`constructor`).
    fill => !translated.has(fill.field) && !Object.hasOwn(answered, fill.field)
  );
  const required = new Set(
    args.fields.filter(field => field.required === true).map(f => f.name)
  );
  const pushAnswers: Record<string, LegacyFieldResolution> = {
    ...Object.fromEntries(
      rowFills
        .filter(fill => required.has(fill.field))
        .map(fill => [
          fill.field,
          { action: "provide_default" as const, value: fill.value },
        ])
    ),
    ...answered,
  };
  return {
    fileAnswers: rowFills.length > 0 ? { rowFills } : {},
    legacyBundle:
      Object.keys(pushAnswers).length > 0
        ? { tableName: args.single.tableName, byFieldName: pushAnswers }
        : undefined,
  };
}
