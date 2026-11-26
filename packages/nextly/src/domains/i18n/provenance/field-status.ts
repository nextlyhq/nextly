/**
 * Whether a translated value is out of date, computed from the recorded provenance, never stored:
 * a value is out of date when its source language's live value of the field no longer has the
 * fingerprint the translation was made from. A value written originally in its language has no
 * source and is never out of date.
 *
 * ONE comparison, {@link sourceValueComparedSql}, in SQL, used by every reader: the per-field
 * answer the translation overview shows, and the language-level answer the overview's `stale` and
 * the list filter (the worklist's "stale" tab) give. A language with values recorded is judged by
 * them alone; one with none recorded (written before origins were recorded) by the language-level
 * stamp, as before. A container whose texts have records of their own is judged by those: its own
 * record is of the whole value, which a row moved or a shared value changed is a change of.
 *
 * @experimental Until per-field provenance is complete.
 *
 * @module domains/i18n/provenance/field-status
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";

import {
  TRANSLATION_PROVENANCE_ROW_SEPARATOR,
  TRANSLATION_PROVENANCE_TABLE,
  translationProvenanceTables,
  type ProvenanceOrigin,
  type ProvenanceScopeKind,
} from "../../../schemas/translation-provenance";
import { toSnakeCase } from "../../schema/services/field-column-descriptor";
import { nonBlankColumnSql } from "../non-blank-sql";
import { isTextPath, TEXT_PATH_PATTERN } from "../pipeline/unit-address";

import { fieldOfPath } from "./source-text";

/** Where one field's value in one language came from, and whether its source moved since. */
export interface FieldProvenance {
  origin: ProvenanceOrigin;
  /** The engine of a machine translation. */
  engine?: string;
  /** The language the value was made from; absent for a value written originally. */
  sourceLocale?: string;
  /**
   * Whether the source's value changed after this one was made from it. Absent where that cannot
   * be told: the source has no recorded value, or the origin is unknown. For a container whose
   * `texts` are recorded, whether any of those is; absent where none is known to be and one can't
   * be told.
   */
  outOfDate?: boolean;
  /**
   * Where each text inside a repeater or group came from, by its path, where those are recorded.
   */
  texts?: Record<string, FieldProvenance>;
}

/** The collection or Single whose documents a read is about. */
export interface ProvenanceScope {
  scopeKind: ProvenanceScopeKind;
  scopeSlug: string;
  /**
   * The names of its translatable fields: a language with a value of one of them unrecorded, as
   * a translation made before origins were recorded, is judged by its language-level stamp.
   */
  fields: readonly string[];
  /**
   * Those of `fields` whose storage is not text (a number, a boolean, a date, a decimal or JSON):
   * holding a value when not null, never compared with an empty string.
   */
  nonTextFields: readonly string[];
}

/**
 * A scope's fields, from the translatable fields a translation table keeps: their names, and
 * which of them do not store text. The one derivation every reader's scope is built by.
 */
export function provenanceFieldsOf(
  localizedFields: readonly { name: string; nonText?: boolean }[]
): Pick<ProvenanceScope, "fields" | "nonTextFields"> {
  return {
    fields: localizedFields.map(field => field.name),
    nonTextFields: localizedFields
      .filter(field => field.nonText === true)
      .map(field => field.name),
  };
}

/** A table alias as `sql.identifier` produces it. */
type Alias = ReturnType<typeof sql.identifier>;

const PROVENANCE = sql.identifier(TRANSLATION_PROVENANCE_TABLE);
const SOURCE = sql.identifier("nx_provenance_source");
const TARGET = sql.identifier("nx_provenance_target");
const RECORDED = sql.identifier("nx_provenance_recorded");
const UNKNOWN = sql.identifier("nx_provenance_unknown");
const COVERED = sql.identifier("nx_provenance_covered");
const CLAIMED = sql.identifier("nx_provenance_claimed");
const TEXT = sql.identifier("nx_provenance_text");

/** One column of a row of the provenance table, under `alias`. */
function column(alias: Alias, name: string): SQL {
  return sql`${alias}.${sql.identifier(name)}`;
}

/**
 * The one comparison: whether the source language's live value of `target`'s field has a
 * fingerprint that `differs` from, or `matches`, the one `target` was made from. A row with no
 * source (written originally) or no recorded source value matches neither, by SQL's
 * three-valued logic.
 */
function sourceValueComparedSql(
  target: Alias,
  answer: "differs" | "matches"
): SQL {
  const compare = answer === "differs" ? sql`<>` : sql`=`;
  return sql`EXISTS (
    SELECT 1 FROM ${PROVENANCE} ${SOURCE}
    WHERE ${column(SOURCE, "scope_kind")} = ${column(target, "scope_kind")}
    AND ${column(SOURCE, "scope_slug")} = ${column(target, "scope_slug")}
    AND ${column(SOURCE, "entry_id")} = ${column(target, "entry_id")}
    AND ${column(SOURCE, "field_path")} = ${column(target, "field_path")}
    AND ${column(SOURCE, "part_state")} = ${"live"}
    AND ${column(SOURCE, "locale")} = ${column(target, "source_locale")}
    AND ${column(SOURCE, "value_fingerprint")} ${compare} ${column(target, "source_fingerprint")}
  )`;
}

/**
 * A text's own record, saying where it came from: one that only keeps its fingerprint, for what was
 * made from it before the text had a record, says nothing of it, and its container's record does.
 */
function textRecordSql(alias: Alias): SQL {
  return sql`(${column(alias, "field_path")} LIKE ${TEXT_PATH_PATTERN}
    AND (${column(alias, "origin")} <> ${"unknown"}
    OR ${column(alias, "source_locale")} IS NOT NULL))`;
}

/**
 * Whether `alias` is the record of a container whose texts have records of their own in its language
 * and part: they say what it says of them. Their paths begin with its field and the separator, which
 * is compared by its place and not as a pattern, since a field's name may hold `_`.
 */
function readByItsTextsSql(alias: Alias): SQL {
  const path = column(alias, "field_path");
  const text = column(TEXT, "field_path");
  return sql`EXISTS (
    SELECT 1 FROM ${PROVENANCE} ${TEXT}
    WHERE ${column(TEXT, "scope_kind")} = ${column(alias, "scope_kind")}
    AND ${column(TEXT, "scope_slug")} = ${column(alias, "scope_slug")}
    AND ${column(TEXT, "entry_id")} = ${column(alias, "entry_id")}
    AND ${column(TEXT, "locale")} = ${column(alias, "locale")}
    AND ${column(TEXT, "part_state")} = ${column(alias, "part_state")}
    AND SUBSTR(${text}, 1, LENGTH(${path})) = ${path}
    AND SUBSTR(${text}, LENGTH(${path}) + 1, 1) = ${TRANSLATION_PROVENANCE_ROW_SEPARATOR}
    AND ${textRecordSql(TEXT)}
  )`;
}

/** The live rows of one document's language, under `alias`. */
function liveRowsOfSql(
  alias: Alias,
  scope: ProvenanceScope,
  entryId: SQL,
  locale: SQL
): SQL {
  return sql`${column(alias, "scope_kind")} = ${scope.scopeKind}
    AND ${column(alias, "scope_slug")} = ${scope.scopeSlug}
    AND ${column(alias, "entry_id")} = ${entryId}
    AND ${column(alias, "locale")} = ${locale}
    AND ${column(alias, "part_state")} = ${"live"}`;
}

/**
 * A row whose source cannot be compared: made from another language (not written originally),
 * but its source's value then or now has no recorded fingerprint, as when the source was written
 * before origins were recorded. A text's is judged as a field's; a row's own record in a structure
 * per language is neither, and a container's is its texts' where those have their own.
 */
function sourceUnknownSql(alias: Alias): SQL {
  return sql`${column(alias, "origin")} <> ${"original"}
    AND (${column(alias, "field_path")} NOT LIKE ${`%${TRANSLATION_PROVENANCE_ROW_SEPARATOR}%`}
    OR ${textRecordSql(alias)})
    AND NOT ${readByItsTextsSql(alias)}
    AND NOT ${sourceValueComparedSql(alias, "differs")}
    AND NOT ${sourceValueComparedSql(alias, "matches")}`;
}

/**
 * Whether one of the scope's translatable fields has no live record in one document's language:
 * a value from before origins were recorded, which only the language-level stamp can judge. Field
 * by field, so one field recorded since does not leave the others unjudged.
 */
function fieldUnrecordedSql(
  scope: ProvenanceScope,
  entryId: SQL,
  locale: SQL,
  /** The language's own row, whose columns hold its values. */
  row: SQL
): SQL {
  if (scope.fields.length === 0) return sql`1=0`;
  // A field counts only where the language holds a value of it: one made before origins were
  // recorded. A field the language never translated, or cleared, holds none (blank, as every
  // read of a translation counts it); it is missing, not out of date, so a change at its source
  // says nothing of the language.
  const nonText = new Set(scope.nonTextFields);
  return sql`(${sql.join(
    scope.fields.map(
      field => sql`(${nonBlankColumnSql(row, toSnakeCase(field), nonText.has(field))}
    AND NOT EXISTS (SELECT 1 FROM ${PROVENANCE} ${COVERED}
      WHERE ${liveRowsOfSql(COVERED, scope, entryId, locale)}
      AND ${column(COVERED, "field_path")} = ${field}))`
    ),
    sql` OR `
  )})`;
}

/**
 * The language a document's language is made from, for its language-level stamp to be compared
 * with: the source its live records claim (a copy of French, say), else `defaultLocale`, the
 * source every other language is made from. Where records claim more than one, the greatest is
 * taken, so the answer is the same on every dialect.
 */
export function stampSourceLocaleSql(args: {
  scope: ProvenanceScope;
  entryId: SQL;
  locale: SQL;
  defaultLocale: string;
}): SQL {
  const { scope, entryId, locale } = args;
  return sql`COALESCE((SELECT MAX(${column(CLAIMED, "source_locale")}) FROM ${PROVENANCE} ${CLAIMED}
    WHERE ${liveRowsOfSql(CLAIMED, scope, entryId, locale)}
    AND ${column(CLAIMED, "source_locale")} IS NOT NULL), ${args.defaultLocale})`;
}

/**
 * Whether one document's language is out of date: when any of its recorded values is, and
 * otherwise by `byStamp`, the language-level stamp comparison, wherever the recorded values
 * cannot say: the language has none, one of its fields has none (`fieldUnrecordedSql`), or one of
 * them was made from a source with no recorded value (`sourceUnknownSql`).
 */
export function languageOutOfDateSql(args: {
  scope: ProvenanceScope;
  /** The document's id, as the enclosing query has it. */
  entryId: SQL;
  /** The language, as the enclosing query has it. */
  locale: SQL;
  /** The language's own translation row, as the enclosing query has it. */
  row: SQL;
  byStamp: SQL;
}): SQL {
  const { scope, entryId, locale } = args;
  return sql`(EXISTS (
    SELECT 1 FROM ${PROVENANCE} ${TARGET}
    WHERE ${liveRowsOfSql(TARGET, scope, entryId, locale)}
    AND ${sourceValueComparedSql(TARGET, "differs")}
    AND NOT ${readByItsTextsSql(TARGET)}
  ) OR (${args.byStamp} AND (NOT EXISTS (
    SELECT 1 FROM ${PROVENANCE} ${RECORDED}
    WHERE ${liveRowsOfSql(RECORDED, scope, entryId, locale)}
  ) OR ${fieldUnrecordedSql(scope, entryId, locale, args.row)} OR EXISTS (
    SELECT 1 FROM ${PROVENANCE} ${UNKNOWN}
    WHERE ${liveRowsOfSql(UNKNOWN, scope, entryId, locale)}
    AND ${sourceUnknownSql(UNKNOWN)}
  ))))`;
}

/** The surface the per-field read is made through: a Drizzle database. */
interface ProvenanceSelectDb {
  select(fields: Record<string, unknown>): {
    from(table: never): {
      where(condition: SQL | undefined): Promise<Record<string, unknown>[]>;
    };
  };
}

/** The key one document's language is found under in {@link fieldProvenanceOf}'s answer. */
export function documentLanguageKey(entryId: string, locale: string): string {
  return `${entryId}::${locale}`;
}

/**
 * Each document's fields' provenance, by language, for `entryIds` of one collection or Single:
 * one read of the live rows, each field's answer from {@link sourceValueComparedSql}, and each
 * text's beside its own field's.
 */
export async function fieldProvenanceOf(
  db: ProvenanceSelectDb,
  dialect: SupportedDialect,
  scope: ProvenanceScope,
  entryIds: readonly string[]
): Promise<Map<string, Record<string, FieldProvenance>>> {
  const out = new Map<string, Record<string, FieldProvenance>>();
  if (entryIds.length === 0) return out;
  const { nextlyTranslationProvenance: table } =
    translationProvenanceTables(dialect);
  // The outer row, addressed by the table's own name: `.from()` emits it unaliased, so the
  // correlated comparison can reach it.
  const target = PROVENANCE;
  const rows = await db
    .select({
      entryId: table.entryId,
      locale: table.locale,
      fieldPath: table.fieldPath,
      origin: table.origin,
      engine: table.engine,
      sourceLocale: table.sourceLocale,
      differs: sql`CASE WHEN ${sourceValueComparedSql(target, "differs")} THEN 1 ELSE 0 END`,
      matches: sql`CASE WHEN ${sourceValueComparedSql(target, "matches")} THEN 1 ELSE 0 END`,
    })
    .from(table as never)
    .where(
      and(
        eq(table.scopeKind as never, scope.scopeKind),
        eq(table.scopeSlug as never, scope.scopeSlug),
        inArray(table.entryId as never, [...entryIds]),
        eq(table.partState as never, "live")
      )
    );
  const textRows: Record<string, unknown>[] = [];
  for (const row of rows) {
    const path = String(row.fieldPath);
    if (path.includes(TRANSLATION_PROVENANCE_ROW_SEPARATOR)) {
      // A row's own record, in a field with a structure per language, is not a field's.
      if (isTextPath(path) && saysWhereFrom(row)) textRows.push(row);
      continue;
    }
    const key = documentLanguageKey(String(row.entryId), String(row.locale));
    const fields = out.get(key) ?? {};
    fields[path] = fieldStatusOf(row);
    out.set(key, fields);
  }
  for (const row of textRows) addText(out, row);
  for (const fields of out.values()) {
    for (const field of Object.values(fields)) rollUpTexts(field);
  }
  return out;
}

/** Puts a text's answer beside its field's: never an entry of its own. */
function addText(
  out: ReadonlyMap<string, Record<string, FieldProvenance>>,
  row: Record<string, unknown>
): void {
  const key = documentLanguageKey(String(row.entryId), String(row.locale));
  const path = String(row.fieldPath);
  const fields = out.get(key) ?? {};
  const field = fieldOfPath(path);
  if (!Object.hasOwn(fields, field)) return;
  (fields[field].texts ??= {})[path] = fieldStatusOf(row);
}

/** Whether a text's record says where it came from, as {@link textRecordSql} asks. */
function saysWhereFrom(row: Record<string, unknown>): boolean {
  return row.origin !== "unknown" || typeof row.sourceLocale === "string";
}

/** Gives a container the answer of its texts, where they have records. */
function rollUpTexts(field: FieldProvenance): void {
  if (field.texts === undefined) return;
  const answers = Object.values(field.texts).map(text => text.outOfDate);
  delete field.outOfDate;
  if (answers.includes(true)) field.outOfDate = true;
  else if (answers.every(answer => answer === false)) field.outOfDate = false;
}

/** One row's answer, as {@link FieldProvenance} says. Drivers give the comparisons as 0/1. */
function fieldStatusOf(row: Record<string, unknown>): FieldProvenance {
  const origin = row.origin as ProvenanceOrigin;
  const status: FieldProvenance = { origin };
  if (typeof row.engine === "string") status.engine = row.engine;
  if (origin === "original") return { ...status, outOfDate: false };
  if (typeof row.sourceLocale === "string") {
    status.sourceLocale = row.sourceLocale;
  }
  if (Number(row.differs) === 1) return { ...status, outOfDate: true };
  if (Number(row.matches) === 1) return { ...status, outOfDate: false };
  return status;
}
