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
import { statedMoment } from "../../dynamic-collections/services/stated-default";
import { resolveLocalizedFieldNames } from "../../i18n/classify-fields";
import type {
  BrowserRenameResolution,
  LegacyFieldResolution,
  LegacyResolutionsBundle,
} from "../pipeline/prompt-dispatcher/browser";
import { parseEventId, type Resolution } from "../pipeline/resolution/types";
import {
  classifyFieldKind,
  fieldProducesColumn,
  fieldsStoredOnRow,
  toSnakeCase,
} from "../services/field-column-descriptor";
import { storedDateValue } from "../utils/backfill-default";

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
 * The fields a save adds to a Single's table: stored on its row after the save, and neither a
 * column of the row before it (`fieldProducesColumn`: a many-to-many or a field group's field of
 * the same name kept its values elsewhere) nor renamed onto (a rename keeps the value the column
 * holds).
 */
export function fieldsNewToSingleTable(args: {
  oldFields: readonly FieldDefinition[];
  newFields: readonly FieldDefinition[];
  /** The columns the save renames onto. */
  renamedTo: readonly string[];
}): (FieldDefinition & { name: string })[] {
  const kept = new Set([
    ...namedOnRow(args.oldFields)
      .filter(field => fieldProducesColumn(field))
      .map(field => toSnakeCase(field.name)),
    ...args.renamedTo,
  ]);
  // A field with no column of its own (a virtual field, a many-to-many) has none to fill.
  return namedOnRow(args.newFields).filter(
    field => fieldProducesColumn(field) && !kept.has(toSnakeCase(field.name))
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
  /** The person's typed answers, each naming the column it settles by its event. */
  eventResolutions: readonly Resolution[] | undefined;
  dialect: SupportedDialect;
  /** Whether the Single's translatable values are kept per language after the save. */
  translatedAfter: boolean;
}): {
  fileAnswers: { rowFills?: { field: string; value: unknown }[] };
  legacyBundle: LegacyResolutionsBundle | undefined;
  /** The fields the push road answers for itself, which its review therefore does not ask about. */
  settledOnPush: ReadonlySet<string>;
} {
  const answered = args.resolutions ?? {};
  // The columns the person answered with a typed answer, each named by its event on this table.
  const answeredColumns = new Set(
    (args.eventResolutions ?? []).flatMap(resolution => {
      try {
        const event = parseEventId(resolution.eventId);
        return event.table === args.single.tableName ? [event.column] : [];
      } catch {
        return [];
      }
    })
  );
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
    // Only an answer the person gave, in either shape, never a member every object inherits
    // (`constructor`).
    fill =>
      !translated.has(fill.field) &&
      !Object.hasOwn(answered, fill.field) &&
      !answeredColumns.has(toSnakeCase(fill.field))
  );
  const byName = new Map(namedOnRow(args.fields).map(f => [f.name, f]));
  // Required fields wherever the row stores them, inside a group with no name included.
  const required = new Set(
    namedOnRow(args.fields)
      .filter(field => field.required === true)
      .map(field => field.name)
  );
  // The push offers no default for a unique column (the classifier's rule for a table of many
  // rows), so it leaves a unique field to the person, as before the row was filled; the file
  // fills it, since one row cannot repeat a value.
  const onPush = rowFills.filter(
    fill => byName.get(fill.field)?.unique !== true
  );
  const pushAnswers: Record<string, LegacyFieldResolution> = {
    ...Object.fromEntries(
      onPush
        .filter(fill => required.has(fill.field))
        .map(fill => [
          fill.field,
          {
            action: "provide_default" as const,
            value: storedForm(byName.get(fill.field), fill.value, args.dialect),
          },
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
    settledOnPush: new Set(onPush.map(fill => fill.field)),
  };
}

/**
 * `value` in the form its field's column stores, as the push binds an answer: a date as the
 * moment it names (`storedDateValue`, epoch seconds on SQLite), a JSON field's value as its JSON
 * text, and a boolean as 1 or 0 on SQLite, which keeps a boolean so. The file's fill writes the
 * same forms (`resolutionStatement`).
 */
function storedForm(
  field: FieldDefinition | undefined,
  value: unknown,
  dialect: SupportedDialect
): unknown {
  if (field === undefined) return value;
  if (field.type === "date") {
    const at = statedMoment(value);
    return at === null ? value : storedDateValue(at, dialect);
  }
  if (classifyFieldKind(field, "collection") === "json") {
    return JSON.stringify(value);
  }
  if (typeof value === "boolean" && dialect === "sqlite") return value ? 1 : 0;
  return value;
}

/**
 * The review of a Single's dialog save as the save will apply it: a field its row is filled for
 * with the field's stated default (`dialogRowAnswers`) asks nothing, so the dialog does not hold
 * Save for an answer the default already gives. The review names fields by their column (snake
 * case) where the save names them by field name, so both are compared as columns. Once nothing is
 * asked, the verdict and the destructive flag are rolled up again from the changes that remain, most
 * severe first, as the translator rolls them: an added field the row is filled for is safe.
 */
export function reviewWithRowFillsSettled<P extends Record<string, unknown>>(
  preview: P,
  filled: ReadonlySet<string>
): P {
  const columns = new Set([...filled].map(toSnakeCase));
  const isFilled = (name: unknown): boolean =>
    typeof name === "string" && columns.has(toSnakeCase(name));
  const asked = Array.isArray(preview.interactiveFields)
    ? (preview.interactiveFields as readonly { name?: unknown }[])
    : [];
  const interactiveFields = asked.filter(field => !isFilled(field.name));
  if (interactiveFields.length === asked.length) return preview;
  const changes = settledChanges(preview.changes, isFilled);
  if (
    preview.classification !== "interactive" ||
    interactiveFields.length > 0
  ) {
    return { ...preview, interactiveFields, ...(changes ? { changes } : {}) };
  }
  const classification = rolledUpVerdict(changes);
  return {
    ...preview,
    interactiveFields,
    ...(changes ? { changes } : {}),
    classification,
    hasDestructiveChanges: classification !== "safe",
  };
}

/** The review's field changes, by group (`added`, `removed`, `changed`, `unchanged`). */
type ReviewChanges = Record<string, unknown>;
/** One field change of the review, as far as its settling reads it. */
type ReviewChange = { name?: unknown; classification?: unknown };
/** The groups of the review's changes that carry a classification; `unchanged` carries none. */
const CLASSIFIED_GROUPS = ["added", "removed", "changed"] as const;

/** The review's changes with each added field the row is filled for no longer asking. */
function settledChanges(
  changes: unknown,
  isFilled: (name: unknown) => boolean
): ReviewChanges | undefined {
  if (typeof changes !== "object" || changes === null) return undefined;
  const groups = changes as ReviewChanges;
  if (!Array.isArray(groups.added)) return groups;
  return {
    ...groups,
    added: (groups.added as readonly ReviewChange[]).map(change =>
      change.classification === "interactive" && isFilled(change.name)
        ? { ...change, classification: "safe" }
        : change
    ),
  };
}

/** The most severe classification among the changes: interactive, then destructive, then safe. */
function rolledUpVerdict(
  changes: ReviewChanges | undefined
): "safe" | "destructive" | "interactive" {
  const verdicts = CLASSIFIED_GROUPS.flatMap(group => {
    const list = changes?.[group];
    return Array.isArray(list)
      ? (list as readonly ReviewChange[]).map(change => change.classification)
      : [];
  });
  if (verdicts.includes("interactive")) return "interactive";
  return verdicts.includes("destructive") ? "destructive" : "safe";
}
