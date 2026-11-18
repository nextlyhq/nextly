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
 * stamp, as before.
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

/** Where one field's value in one language came from, and whether its source moved since. */
export interface FieldProvenance {
  origin: ProvenanceOrigin;
  /** The engine of a machine translation. */
  engine?: string;
  /** The language the value was made from; absent for a value written originally. */
  sourceLocale?: string;
  /**
   * Whether the source's value changed after this one was made from it. Absent where that cannot
   * be told: the source has no recorded value, or the origin is unknown.
   */
  outOfDate?: boolean;
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
 * before origins were recorded. A row's own record in a structure per language is not a field's.
 */
function sourceUnknownSql(alias: Alias): SQL {
  return sql`${column(alias, "origin")} <> ${"original"}
    AND ${column(alias, "field_path")} NOT LIKE ${`%${TRANSLATION_PROVENANCE_ROW_SEPARATOR}%`}
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
  locale: SQL
): SQL {
  if (scope.fields.length === 0) return sql`1=0`;
  return sql`(SELECT COUNT(DISTINCT ${column(COVERED, "field_path")}) FROM ${PROVENANCE} ${COVERED}
    WHERE ${liveRowsOfSql(COVERED, scope, entryId, locale)}
    AND ${column(COVERED, "field_path")} IN (${sql.join(
      scope.fields.map(field => sql`${field}`),
      sql`, `
    )})) < ${scope.fields.length}`;
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
  byStamp: SQL;
}): SQL {
  const { scope, entryId, locale } = args;
  return sql`(EXISTS (
    SELECT 1 FROM ${PROVENANCE} ${TARGET}
    WHERE ${liveRowsOfSql(TARGET, scope, entryId, locale)}
    AND ${sourceValueComparedSql(TARGET, "differs")}
  ) OR (${args.byStamp} AND (NOT EXISTS (
    SELECT 1 FROM ${PROVENANCE} ${RECORDED}
    WHERE ${liveRowsOfSql(RECORDED, scope, entryId, locale)}
  ) OR ${fieldUnrecordedSql(scope, entryId, locale)} OR EXISTS (
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
 * one read of the live rows, each field's answer from {@link sourceValueComparedSql}.
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
  for (const row of rows) {
    // A row's own record, in a field with a structure per language, is not a field's.
    if (String(row.fieldPath).includes(TRANSLATION_PROVENANCE_ROW_SEPARATOR)) {
      continue;
    }
    const key = documentLanguageKey(String(row.entryId), String(row.locale));
    const fields = out.get(key) ?? {};
    fields[String(row.fieldPath)] = fieldStatusOf(row);
    out.set(key, fields);
  }
  return out;
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
