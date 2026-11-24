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
import type { DatabaseInstance } from "../../../types/database-operations";
import { appLocalization } from "../../i18n/configured-locales";
import type { LegacyResolutionsBundle } from "../pipeline/prompt-dispatcher/browser";
import { parseEventId, type Resolution } from "../pipeline/resolution/types";
import {
  resolutionStatements,
  type ColumnResolution,
  type PerLanguageColumn,
} from "../pipeline/sql-templates/resolution-statements";
import { applyMigrationWhole } from "../services/apply-migration-statements";
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
 * entries is one the change asks. A field the change adds is not there before it, nor in a list
 * that is absent. Both lists are read as a row stores them, a group with no name laying its fields
 * out beside the others.
 */
export function madeRequired(
  before: unknown,
  after: unknown,
  name: string
): boolean {
  const find = (fields: unknown) =>
    Array.isArray(fields)
      ? fieldsStoredOnRow(fields as NamedField[]).find(f => f.name === name)
      : undefined;
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

/** The answers a push takes for a change, in the shapes it takes them, any of them absent. */
interface PushAnswers {
  /** The entity's main table, which a typed answer's event names. */
  tableName: string;
  /** Whether the entity is translated after the change. */
  localized: boolean | undefined;
  /** The fields before the change, as the registry records them. */
  oldFields: unknown;
  newFields: readonly FieldDefinition[];
  /** The typed answers, each naming the column it settles by its event, as the dialog names one. */
  eventResolutions: readonly Resolution[] | undefined;
  /** The earlier per-field answers. */
  legacy: LegacyResolutionsBundle | undefined;
  /** The fills an update sends for the fields it adds. */
  fills: ReadonlyArray<{ field: string; value: unknown }> | undefined;
  /** A Single's row fills, by field (`dialogRowAnswers`). */
  rowFills: ReadonlyArray<{ field: string; value: unknown }> | undefined;
}

/**
 * The statements a push runs for the person's answers on fields kept per language, once the
 * translations table is in step with the change (so a field it adds has its column): for each
 * field kept per language after it that it makes required (`madeRequired`), the answer given for
 * that field, settled on its default-language rows in `locale` (`resolutionStatements`). The first
 * answer given wins: a typed one, then an earlier per-field fill, then an update's fill. A field
 * without an answer keeps its entries as they are, as the dialog, which asks nothing for it,
 * leaves them; an answer for any other field is not this step's. None where the entity keeps no
 * value per language (`keptPerLanguage`).
 *
 * A Single's row fills (its document given the default each field new to its table states,
 * whether or not the field is required) are settled the same way, for a field kept per language
 * that no answer settles: its default-language row takes the default.
 */
function perLanguageSettleStatements(
  args: PushAnswers,
  locale: string,
  dialect: SupportedDialect
): string[] {
  const kept = keptPerLanguage(args.localized, args.newFields);
  const resolutions = fieldsStoredOnRow(args.newFields).flatMap(
    (field): ColumnResolution[] => {
      const name = field.name;
      if (typeof name !== "string" || !kept.has(name)) return [];
      const answer =
        (madeRequired(args.oldFields, args.newFields, name)
          ? answerFor(args, name)
          : undefined) ?? fillFor(args.rowFills, name);
      if (answer === undefined) return [];
      return [settlement(args.tableName, field, answer, locale)];
    }
  );
  return resolutions.flatMap(r => resolutionStatements(r, dialect));
}

/**
 * The push's settle of its answers for fields kept per language (`perLanguageSettleStatements`),
 * run as one change (`applyMigrationWhole`) where there is any, once the push has brought the
 * translations table in step: what the collection's push and a Single's push run last.
 */
export async function settleKeptPerLanguage(
  target: {
    db: DatabaseInstance;
    dialect: SupportedDialect;
    entity: "collection" | "single";
  },
  args: PushAnswers
): Promise<void> {
  const statements = perLanguageSettleStatements(
    args,
    defaultLanguage(undefined),
    target.dialect
  );
  if (statements.length === 0) return;
  await applyMigrationWhole({
    db: target.db,
    dialect: target.dialect,
    migrationSQL: statements.join("\n--> statement-breakpoint\n"),
    entity: target.entity,
  });
}

/** The settlement of `answer` for `field`, kept per language on main table `table`. */
function settlement(
  table: string,
  field: FieldDefinition,
  answer: Answer,
  locale: string
): ColumnResolution {
  const settled = {
    tableName: table,
    columnName: toSnakeCase(field.name),
    perLanguage: perLanguageColumn(table, locale),
  };
  if (answer.kind === "delete") {
    return { ...settled, kind: "delete_nonconforming" };
  }
  const json = classifyFieldKind(field, "collection") === "json";
  return {
    ...settled,
    kind: "fill",
    value: answer.value,
    ...(json ? { json: true } : {}),
  };
}

/** An answer for a field's entries: fill them, or delete them. */
type Answer = { kind: "fill"; value: unknown } | { kind: "delete" };

/** A fill for field `name` among `fills`, as the answer it is. */
function fillFor(
  fills: ReadonlyArray<{ field: string; value: unknown }> | undefined,
  name: string
): Answer | undefined {
  const fill = fills?.find(f => f.field === name);
  return fill === undefined ? undefined : { kind: "fill", value: fill.value };
}

/** The answer given for field `name` in any of the push's shapes, the first of them. */
function answerFor(args: PushAnswers, name: string): Answer | undefined {
  return (
    typedAnswerFor(args.eventResolutions ?? [], args.tableName, name) ??
    earlierFillFor(args.legacy, name) ??
    fillFor(args.fills, name)
  );
}

/** The typed answer naming field `name`'s column on `table` by its event. */
function typedAnswerFor(
  resolutions: readonly Resolution[],
  table: string,
  name: string
): Answer | undefined {
  const column = toSnakeCase(name);
  for (const resolution of resolutions) {
    if (resolution.kind === "provide_default") {
      if (namesColumn(resolution.eventId, table, column)) {
        return { kind: "fill", value: resolution.value };
      }
    } else if (resolution.kind === "delete_nonconforming") {
      if (namesColumn(resolution.eventId, table, column)) {
        return { kind: "delete" };
      }
    }
  }
  return undefined;
}

/** Whether `eventId` names `column` of `table`; a malformed one names none, as the push reads it. */
function namesColumn(eventId: string, table: string, column: string): boolean {
  try {
    const event = parseEventId(eventId);
    return event.table === table && event.column === column;
  } catch {
    return false;
  }
}

/** An earlier per-field fill for field `name`, read as an own property only. */
function earlierFillFor(
  legacy: LegacyResolutionsBundle | undefined,
  name: string
): Answer | undefined {
  const byFieldName = legacy?.byFieldName ?? {};
  // Never a member every object inherits (`constructor`).
  if (!Object.hasOwn(byFieldName, name)) return undefined;
  const earlier = byFieldName[name];
  return earlier?.action === "provide_default"
    ? { kind: "fill", value: earlier.value }
    : undefined;
}
