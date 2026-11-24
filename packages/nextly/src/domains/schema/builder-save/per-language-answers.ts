/**
 * The person's answer for a field kept per language that a save makes required: fill, or delete,
 * the entries that hold no value for it in the default language.
 *
 * A field kept per language (every translatable field under per-language storage, and a translated
 * entity's on the earlier layout) has no column on the main table: its values are in the entity's
 * translations table, one row per entry and language. Making it required writes no NOT NULL there,
 * since a language other than the default one may hold no value and fall back, so the schema
 * pipeline's questions, asked of the main table's columns, never reach it, and the dialog never
 * asks. A save that brings the answer itself (an API client, a Single's stated default) is settled
 * on the translations table's default-language rows (`resolutionStatements`), by every road a save
 * takes: its migration file, and the push that applies the change in development.
 *
 * @module domains/schema/builder-save/per-language-answers
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { appLocalization } from "../../i18n/configured-locales";
import type { LegacyResolutionsBundle } from "../pipeline/prompt-dispatcher/browser";
import { parseEventId, type Resolution } from "../pipeline/resolution/types";
import {
  resolutionStatements,
  type ColumnResolution,
  type PerLanguageColumn,
} from "../pipeline/sql-templates/resolution-statements";
import {
  classifyFieldKind,
  fieldsStoredOnRow,
  toSnakeCase,
} from "../services/field-column-descriptor";
import { perLanguageAfter } from "../value-conversion/type-change/field-type-changes";

/** A field as these answers read it: by its name, and whether it is required. */
type NamedField = { readonly name?: string; readonly required?: boolean };

/**
 * The fields of an entity kept per language after a change, by name: its translatable fields
 * wherever the entity stores them per language (`perLanguageAfter`, the rule the save's type-change
 * check reads), none where it does not.
 */
export function keptPerLanguage(
  localized: boolean | undefined,
  fields: readonly unknown[]
): ReadonlySet<string> {
  return (
    perLanguageAfter(
      { localized: localized === true },
      fields as FieldDefinition[]
    ).translatedAfter ?? new Set()
  );
}

/**
 * Whether field `name` is required after a change and was not before it: an answer for its
 * entries is one the change asks. A field the change adds is not there before it. Both lists are
 * read as a row stores them, a group with no name laying its fields out beside the others.
 */
export function madeRequired(
  before: readonly unknown[],
  after: readonly unknown[],
  name: string
): boolean {
  const find = (fields: readonly unknown[]) =>
    fieldsStoredOnRow(fields as NamedField[]).find(f => f.name === name);
  return find(after)?.required === true && find(before)?.required !== true;
}

/**
 * The language whose value a required field kept per language needs: the site's default language,
 * as the running app reads it (Settings' where the configuration declares none), else
 * `configured`, the configuration's.
 */
export function defaultLanguage(configured: string | undefined): string {
  return appLocalization()?.defaultLocale ?? configured ?? "en";
}

/** Where a field kept per language on main table `table` settles its rows, in `locale`. */
export function perLanguageColumn(
  table: string,
  locale: string
): PerLanguageColumn {
  return { companionTable: `${table}_locales`, locale };
}

/**
 * The statements a push runs for the person's answers on fields kept per language, once the
 * translations table is in step with the change (so a field it adds has its column): for each
 * field kept per language after it that it makes required (`madeRequired`), the answer given for
 * that field, settled on its default-language rows (`resolutionStatements`). The answers come in
 * the shapes the push takes them: a typed answer naming the field's column on the main table by
 * its event, as the dialog names a column; an earlier per-field fill; and a fill an update sends
 * for a field it adds (`fills`). The first given wins, in that order. A field without an answer
 * keeps its entries as they are, as the dialog, which asks nothing for it, leaves them; an answer
 * for any other field is not this step's.
 *
 * A Single's row fills (`rowFills`, its document given the default each field new to its table
 * states, whether or not the field is required) are settled the same way, for a field kept per
 * language that no answer settles: its default-language row takes the default.
 */
export function perLanguageSettleStatements(args: {
  /** The entity's main table, which a typed answer's event names. */
  tableName: string;
  /** Whether the entity is translated after the change. */
  localized: boolean | undefined;
  oldFields: readonly unknown[];
  newFields: readonly FieldDefinition[];
  eventResolutions: readonly Resolution[];
  legacy?: LegacyResolutionsBundle;
  fills?: ReadonlyArray<{ field: string; value: unknown }>;
  /** A Single's row fills, by field (`dialogRowAnswers`). */
  rowFills?: ReadonlyArray<{ field: string; value: unknown }>;
  /** The default language, whose rows are settled (`defaultLanguage`). */
  locale: string;
  dialect: SupportedDialect;
}): string[] {
  const kept = keptPerLanguage(args.localized, args.newFields);
  const resolutions = fieldsStoredOnRow(args.newFields).flatMap(
    (field): ColumnResolution[] => {
      const name = field.name;
      if (typeof name !== "string" || !kept.has(name)) return [];
      const answer =
        (madeRequired(args.oldFields, args.newFields, name)
          ? answerFor(args, name)
          : undefined) ?? rowFillFor(args.rowFills, name);
      if (answer === undefined) return [];
      const settled = {
        tableName: args.tableName,
        columnName: toSnakeCase(name),
        perLanguage: perLanguageColumn(args.tableName, args.locale),
      };
      return [
        answer.kind === "fill"
          ? {
              ...settled,
              kind: "fill",
              value: answer.value,
              ...(classifyFieldKind(field, "collection") === "json"
                ? { json: true }
                : {}),
            }
          : { ...settled, kind: "delete_nonconforming" },
      ];
    }
  );
  return resolutions.flatMap(r => resolutionStatements(r, args.dialect));
}

/** A Single's row fill for field `name`, as the fill it is. */
function rowFillFor(
  rowFills: ReadonlyArray<{ field: string; value: unknown }> | undefined,
  name: string
): { kind: "fill"; value: unknown } | undefined {
  const fill = rowFills?.find(f => f.field === name);
  return fill === undefined ? undefined : { kind: "fill", value: fill.value };
}

/** The answer given for field `name` in any of the push's shapes, the first of them. */
function answerFor(
  args: Pick<
    Parameters<typeof perLanguageSettleStatements>[0],
    "tableName" | "eventResolutions" | "legacy" | "fills"
  >,
  name: string
): { kind: "fill"; value: unknown } | { kind: "delete" } | undefined {
  const column = toSnakeCase(name);
  for (const resolution of args.eventResolutions) {
    if (
      resolution.kind !== "provide_default" &&
      resolution.kind !== "delete_nonconforming"
    ) {
      continue;
    }
    let event: ReturnType<typeof parseEventId>;
    try {
      event = parseEventId(resolution.eventId);
    } catch {
      // A malformed event names no field; the pipeline passes it over as it does.
      continue;
    }
    if (event.table !== args.tableName || event.column !== column) continue;
    return resolution.kind === "provide_default"
      ? { kind: "fill", value: resolution.value }
      : { kind: "delete" };
  }
  // An earlier per-field answer, read as an own property only, never one every object inherits.
  const legacy = args.legacy?.byFieldName ?? {};
  const earlier = Object.hasOwn(legacy, name) ? legacy[name] : undefined;
  if (earlier?.action === "provide_default") {
    return { kind: "fill", value: earlier.value };
  }
  const fill = args.fills?.find(f => f.field === name);
  return fill === undefined ? undefined : { kind: "fill", value: fill.value };
}
