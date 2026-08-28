/**
 * Companion-aware read primitives (i18n M4).
 *
 * Localized collections store their translatable fields in a companion `<table>_locales` table
 * (Option B). The read path resolves each localized field to the requested language with fallback.
 * Following Nextly's component-data precedent (spec §14 — "same cost profile as component data,
 * already batch-populated"), display resolution is a **batch populate**: one extra query fetches
 * the companion rows for the page of results, then values are merged onto each row in JS with the
 * blank-as-untranslated fallback rule (spec §8). Search / sort / where filtering, which must run
 * in SQL, use the EXISTS builder here instead (M4c).
 *
 * @module domains/i18n/companion-join
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";

import { COMPANION_UPDATED_AT_COLUMN } from "./companion-columns";
import type { CompanionReadiness } from "./runtime/companion-readiness";
import { buildCompanionStampTable } from "./runtime/companion-stamp-table";

/**
 * A quoted table or alias reference, as `sql.identifier` produces one.
 *
 * Named because the staleness comparison joins the companion to itself and has to pass those
 * references around: `sql.identifier` returns Drizzle's `Name`, not a `SQL`, and spelling the
 * distinction out here is what keeps the helpers below honest instead of casting it away.
 */
type CompanionTableRef = ReturnType<typeof sql.identifier>;

/** One localized field: its API/row key (camelCase) + its physical companion column (snake_case). */
export interface LocalizedFieldRef {
  /** Field name — the API/row key (e.g. `metaTitle`). */
  name: string;
  /** Physical companion column — snake_case (e.g. `meta_title`). Used for SQL/lookup. */
  column: string;
}

/** Blank = "not translated": null, undefined, or empty string fall back. 0/false are real values. */
export function isBlank(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

/**
 * Resolve one localized field's value from its per-locale values along a fallback `chain`
 * (`[requested, …fallbacks, default]`). Returns the first non-blank value; `null` if none.
 * A single-element chain (fallback disabled) returns the raw requested value (or `null` if blank).
 */
export function resolveLocalizedValue(
  perLocale: Record<string, unknown>,
  chain: string[]
): unknown {
  for (const code of chain) {
    const value = perLocale[code];
    if (!isBlank(value)) return value;
  }
  return null;
}

/** A minimal Drizzle-select surface so this helper stays adapter/dialect agnostic. */
interface SelectableDb {
  // An optional column projection narrows the SELECT to specific columns; a
  // bare call selects every column of the table object.
  select: (projection?: Record<string, unknown>) => {
    from: (table: unknown) => {
      where: (cond: unknown) => Promise<Record<string, unknown>[]>;
    };
  };
}

/** A Drizzle table object exposing its columns as properties (`_parent`, `_locale`, fields). */
type CompanionTable = Record<string, unknown>;

export interface PopulateCompanionArgs {
  db: SelectableDb;
  /** The companion `_locales` Drizzle table object (from `loadCompanionSchema`). */
  companionTable: unknown;
  /** The localized fields to resolve onto each row (row key = `name`, companion column = `column`). */
  localizedFields: LocalizedFieldRef[];
  /** The result rows to mutate in place (each must carry the parent id under `idKey`). */
  rows: Record<string, unknown>[];
  /** The fallback chain: `[requested, …fallbacks, default]`. Single element = no fallback. */
  localeChain: string[];
  /** The main-row primary-key property (defaults to `"id"`). */
  idKey?: string;
  /**
   * Per-locale status filter (i18n M6). When set (e.g. `"published"`), only companion rows whose
   * `_status` matches are considered — a draft translation is filtered out and the field falls
   * back to the published default, so a draft never leaks to a public read. Undefined = no filter
   * (admin/`status=all`, or a collection without per-locale status).
   */
  statusValue?: string;
  /**
   * Whether the companion table is physically there, resolved by the caller.
   *
   * This module used to answer that itself by running the join and catching the failure, which is
   * a valid existence check on SQLite and MySQL and a transaction-killer on PostgreSQL: a query
   * against a missing relation marks the whole transaction aborted, so the next statement — often
   * an unrelated one — dies with `current transaction is aborted` and gets the blame. Several of
   * these reads run inside the caller's write transaction, so the check was doing the damage it
   * was written to avoid.
   *
   * Required rather than optional, and required on every one of these readers, so a new caller
   * cannot omit it and quietly reintroduce the blind join. Anything other than `ready` skips the
   * query entirely and the main table's values stand — which is exactly right before a companion
   * migration has run.
   *
   * Callers outside a transaction resolve it with `resolveCompanionReadiness`; callers inside one
   * read `cachedCompanionReadiness`, which cannot query. Undefined means unresolved, and is
   * treated as not ready for the same reason.
   */
  readiness: CompanionReadiness | undefined;
}

/**
 * Batch-populate localized fields onto `rows` for the requested language with fallback.
 * One query fetches every relevant companion row (`_parent ∈ ids`, `_locale ∈ chain`); each main
 * row then gets `row[field]` set to the fallback-resolved value. Mutates `rows` in place.
 */
export async function populateCompanionFields(
  args: PopulateCompanionArgs
): Promise<void> {
  const { db, companionTable, localizedFields, rows, localeChain } = args;
  const idKey = args.idKey ?? "id";
  // Not ready means there is nothing to join to, so the main table's values stand.
  if (args.readiness !== "ready") return;
  if (
    rows.length === 0 ||
    localizedFields.length === 0 ||
    localeChain.length === 0
  ) {
    return;
  }

  const ids = rows
    .map(r => r[idKey])
    .filter((id): id is string | number => id !== null && id !== undefined);
  if (ids.length === 0) return;

  const table = companionTable as CompanionTable;
  const parentCol = table._parent;
  const localeCol = table._locale;

  const companionRows: Record<string, unknown>[] = await db
    .select()
    .from(companionTable)
    .where(
      and(
        inArray(parentCol as never, ids),
        inArray(localeCol as never, localeChain)
      )
    );

  // Index: parentId -> locale -> companion row. A row whose `_status` fails the status filter is
  // dropped here (i18n M6) so it can never be resolved onto a public row — the chain then falls
  // back to the published default. Undefined `statusValue` keeps every row (admin / no per-locale
  // status).
  const byParent = new Map<unknown, Record<string, Record<string, unknown>>>();
  for (const cr of companionRows) {
    if (args.statusValue !== undefined && cr._status !== args.statusValue) {
      continue;
    }
    const parent = cr._parent;
    let perLocale = byParent.get(parent);
    if (!perLocale) {
      perLocale = {};
      byParent.set(parent, perLocale);
    }
    perLocale[String(cr._locale)] = cr;
  }

  for (const row of rows) {
    const perLocaleRows = byParent.get(row[idKey]) ?? {};
    for (const field of localizedFields) {
      const perLocaleValue: Record<string, unknown> = {};
      for (const code of localeChain) {
        perLocaleValue[code] = perLocaleRows[code]?.[field.column];
      }
      row[field.name] = resolveLocalizedValue(perLocaleValue, localeChain);
    }
  }
}

/** A Drizzle-select surface that also supports `.limit()` for a single-row read. */
interface LimitableDb {
  // An optional column projection narrows the SELECT; a bare call selects every
  // column of the table object.
  select: (projection?: Record<string, unknown>) => {
    from: (table: unknown) => {
      where: (cond: unknown) => {
        limit: (n: number) => Promise<Record<string, unknown>[]>;
      };
    };
  };
}

/**
 * Read one companion row's per-locale `_status` for `(parentId, locale)`.
 *
 * Goes through the Drizzle companion table object rather than raw SQL, so the
 * read uses the same typed query builder the populate helpers do. Returns the
 * `_status` string, or `null` when no companion row exists for the pair (or the
 * stored value is not a string). An entity whose companion migration has not run yet is not
 * queried at all and reads as having no per-locale status — see `readiness` on
 * {@link PopulateCompanionArgs}. Everything else propagates: this value drives the
 * publish/unpublish transition, so reading a real failure as "no per-locale status" would emit a
 * spurious event.
 */
export async function readCompanionLocaleStatus(
  db: LimitableDb,
  companionTable: unknown,
  parentId: string | number,
  locale: string,
  readiness: CompanionReadiness | undefined
): Promise<string | null> {
  if (readiness !== "ready") return null;
  const table = companionTable as CompanionTable;
  const rows = await db
    .select()
    .from(companionTable)
    .where(
      and(
        eq(table._parent as never, parentId),
        eq(table._locale as never, locale)
      )
    )
    .limit(1);
  const status = rows[0]?._status;
  return typeof status === "string" ? status : null;
}

/**
 * Whether a companion `_locales` row exists for `(parentId, locale)`.
 *
 * Distinct from {@link readCompanionLocaleStatus}: a row can exist while every
 * translatable value is blank/null, which a value read cannot tell apart from a
 * missing row. Callers deciding whether a snapshot is locale-specific need the
 * row's existence, not its contents. Projects only `_parent` so unrelated
 * companion drift cannot fail the probe. A companion that is not there is not queried and reports
 * no row — see `readiness` on {@link PopulateCompanionArgs}.
 */
export async function companionRowExists(
  db: LimitableDb,
  companionTable: unknown,
  parentId: string | number,
  locale: string,
  readiness: CompanionReadiness | undefined
): Promise<boolean> {
  if (readiness !== "ready") return false;
  const table = companionTable as CompanionTable;
  const rows = await db
    .select({ parent: table._parent })
    .from(companionTable)
    .where(
      and(
        eq(table._parent as never, parentId),
        eq(table._locale as never, locale)
      )
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Read every locale's per-locale `_status` for one entry, keyed by locale.
 *
 * The all-locales companion of {@link readCompanionLocaleStatus}: one query over
 * the Drizzle companion table returns every stored translation's status, so a
 * publish-all can tell which locales actually transition from the single flip.
 * Only locales that have a companion row appear. Goes through the typed query
 * builder rather than raw SQL, and is not run at all against a companion that is not there — see
 * `readiness` on {@link PopulateCompanionArgs}.
 */
export async function readCompanionLocaleStatusAll(
  db: SelectableDb,
  companionTable: unknown,
  parentId: string | number,
  readiness: CompanionReadiness | undefined
): Promise<Map<string, string | null>> {
  const table = companionTable as CompanionTable;
  const byLocale = new Map<string, string | null>();
  if (readiness !== "ready") return byLocale;
  // Project ONLY the columns this scan needs. A bare `.select()` requests
  // every column of the configured Drizzle table object, which throws a
  // missing-column error when the companion table is behind its metadata (a
  // localized field added but its column migration not yet applied) — blocking
  // an otherwise valid publish. `_parent`/`_locale`/`_status` always exist.
  const rows = await db
    .select({ locale: table._locale, status: table._status })
    .from(companionTable)
    .where(eq(table._parent as never, parentId));
  for (const row of rows) {
    const locale = row.locale;
    if (typeof locale !== "string") continue;
    byLocale.set(locale, typeof row.status === "string" ? row.status : null);
  }
  return byLocale;
}

export interface PopulateCompanionAllArgs {
  db: SelectableDb;
  companionTable: unknown;
  localizedFields: LocalizedFieldRef[];
  rows: Record<string, unknown>[];
  /** Every configured locale code to project. */
  locales: string[];
  idKey?: string;
  /**
   * Per-locale status filter (i18n M6). When set (e.g. `"published"`), a companion row whose
   * `_status` differs is treated as absent, so a published `locale=all` read never surfaces a
   * draft translation. Undefined = no filter (admin / no per-locale status).
   */
  statusValue?: string;
  /** See `readiness` on {@link PopulateCompanionArgs}. */
  readiness: CompanionReadiness | undefined;
}

/**
 * `locale=all` variant (admin/export): instead of one resolved value, set each localized field
 * to a language-keyed object (`{ en: "...", de: "..." }`) covering every configured locale.
 * Missing translations are `null`. Mutates `rows` in place; a companion that is not there yet is
 * not queried (same as {@link populateCompanionFields}).
 */
export async function populateCompanionFieldsAllLocales(
  args: PopulateCompanionAllArgs
): Promise<void> {
  const { db, companionTable, localizedFields, rows, locales } = args;
  const idKey = args.idKey ?? "id";
  if (args.readiness !== "ready") return;
  if (
    rows.length === 0 ||
    localizedFields.length === 0 ||
    locales.length === 0
  ) {
    return;
  }
  const ids = rows
    .map(r => r[idKey])
    .filter((id): id is string | number => id !== null && id !== undefined);
  if (ids.length === 0) return;

  const table = companionTable as CompanionTable;
  const companionRows: Record<string, unknown>[] = await db
    .select()
    .from(companionTable)
    .where(
      and(
        inArray(table._parent as never, ids),
        inArray(table._locale as never, locales)
      )
    );

  const byParent = new Map<unknown, Record<string, Record<string, unknown>>>();
  for (const cr of companionRows) {
    // Drop a row failing the status filter so a published locale=all read keys in
    // only published translations (a draft locale then reads as null/absent).
    if (args.statusValue !== undefined && cr._status !== args.statusValue) {
      continue;
    }
    let perLocale = byParent.get(cr._parent);
    if (!perLocale) {
      perLocale = {};
      byParent.set(cr._parent, perLocale);
    }
    perLocale[String(cr._locale)] = cr;
  }

  for (const row of rows) {
    const perLocaleRows = byParent.get(row[idKey]) ?? {};
    for (const field of localizedFields) {
      const keyed: Record<string, unknown> = {};
      for (const code of locales) {
        keyed[code] = perLocaleRows[code]?.[field.column] ?? null;
      }
      row[field.name] = keyed;
    }
  }
}

/**
 * Build an ORDER BY expression for a localized field: a `COALESCE` of correlated subqueries,
 * one per fallback-chain locale, each pulling the companion value for that locale
 * (`NULLIF(...,'')` so a blank translation falls back in sort too). Used in-query so ORDER BY +
 * LIMIT/OFFSET paginate correctly (a post-query populate cannot sort across pages).
 */
export function buildLocalizedOrderExpr(args: {
  companionTableName: string;
  mainIdColumn: unknown;
  /** The companion column name (snake_case). */
  column: string;
  localeChain: string[];
  /**
   * Per-locale status filter. When set, each subquery also requires
   * `_status = statusValue`, so a public read never orders by a draft translation's
   * value (an ordering-only leak otherwise).
   */
  statusValue?: string;
}): SQL {
  const {
    companionTableName,
    mainIdColumn,
    column: columnName,
    localeChain,
    statusValue,
  } = args;
  const t = sql.identifier(companionTableName);
  const col = sql.identifier(columnName);
  const statusPredicate =
    statusValue !== undefined
      ? sql` AND ${t}.${sql.identifier("_status")} = ${statusValue}`
      : sql``;
  const perLocale = localeChain.map(
    code =>
      sql`NULLIF((SELECT ${t}.${col} FROM ${t} WHERE ${t}.${sql.identifier("_parent")} = ${mainIdColumn} AND ${t}.${sql.identifier("_locale")} = ${code}${statusPredicate}), '')`
  );
  return sql`COALESCE(${sql.join(perLocale, sql`, `)})`;
}

/**
 * Build an EXISTS subquery against the companion table for a localized field filter/search
 * (mirrors the component-field EXISTS pattern). Matches when a companion row for the given
 * `locale` and parent satisfies `valueCondition` (a SQL fragment referencing the companion column).
 */
export function buildCompanionExists(args: {
  companionTableName: string;
  mainIdColumn: unknown;
  locale: string;
  valueCondition: SQL;
  /**
   * Per-locale status filter (i18n M6). When set (e.g. `"published"`), the EXISTS only matches a
   * companion row whose `_status` equals it, so a where/search filter can't match a draft
   * translation on a published read. Undefined = no status constraint (admin / no per-locale status).
   */
  statusValue?: string;
}): SQL {
  const {
    companionTableName,
    mainIdColumn,
    locale,
    valueCondition,
    statusValue,
  } = args;
  const t = sql.identifier(companionTableName);
  const statusCond =
    statusValue !== undefined
      ? sql` AND ${t}.${sql.identifier("_status")} = ${statusValue}`
      : sql``;
  return sql`EXISTS (
    SELECT 1 FROM ${t}
    WHERE ${t}.${sql.identifier("_parent")} = ${mainIdColumn}
    AND ${t}.${sql.identifier("_locale")} = ${locale}
    AND ${valueCondition}${statusCond}
  )`;
}

/** The translation states the list "language filter" can filter on (i18n M7). */
/**
 * Every translation state a filter may name, and the source the type is built
 * from.
 *
 * A tuple rather than a union so there is something to READ at runtime. The
 * query service and the worklist endpoint both have to decide whether an
 * incoming string is a state, and while the union existed they each declared
 * their own list of the same four words — so adding or renaming one could make
 * the endpoint accept a value the query layer silently drops, or refuse one it
 * supports.
 */
export const TRANSLATION_FILTER_STATES = [
  "missing",
  "translated",
  "draft",
  "published",
  "stale",
] as const;

export type TranslationFilterState = (typeof TRANSLATION_FILTER_STATES)[number];

export interface TranslationStatusFilter {
  /** Target locale code. */
  locale: string;
  /** Which translation state to keep. */
  state: TranslationFilterState;
}

/**
 * Build a SQL condition for the list "language filter" (i18n M7): keep only entries whose target
 * locale is in the requested translation state. Returns `undefined` when the filter is a no-op
 * (e.g. "translated in the default locale" — always true; or a draft/published filter on a
 * collection without per-locale status), and a always-false `1=0` for "missing in the default
 * locale" (the default is the fallback source, never missing). Mirrors the read-time
 * blank=untranslated rule (spec §8): "translated" = a companion row with a non-blank field.
 */
export function buildTranslationStatusCondition(args: {
  companionTableName: string;
  mainIdColumn: unknown;
  /** Localized companion columns (snake_case) for the non-blank test. */
  localizedColumns: string[];
  /** Whether the companion carries `_status` (draft/published filters need it). */
  hasStatus: boolean;
  /**
   * Whether the companion physically carries `_updated_at` (the `stale` filter needs it).
   *
   * A companion created before i18n B2 does not have the column until a reconcile reaches it, and
   * naming a missing column would fail the whole query. Absent or `false` makes `stale` answer
   * "nothing here is known to be stale" rather than erroring or, far worse, matching everything.
   */
  hasUpdatedAt?: boolean;
  defaultLocale: string;
  filter: TranslationStatusFilter;
}): SQL | undefined {
  const {
    companionTableName,
    mainIdColumn,
    localizedColumns,
    hasStatus,
    defaultLocale,
    filter,
  } = args;
  const t = sql.identifier(companionTableName);
  const { locale, state } = filter;
  const isDefault = locale === defaultLocale;

  // Qualified by an arbitrary table reference rather than by `t` directly, because the `stale` arm
  // below needs the SAME non-blank rule applied to an ALIASED copy of this table. Two spellings of
  // "this locale has content" would let one filter disagree with another about the same row, which
  // is the two-tab defect this function already carries a fix for.
  const nonBlankOn = (ref: CompanionTableRef): SQL =>
    localizedColumns.length > 0
      ? sql.join(
          localizedColumns.map(c => {
            const col = sql.identifier(c);
            return sql`(${ref}.${col} IS NOT NULL AND ${ref}.${col} <> '')`;
          }),
          sql` OR `
        )
      : sql`1=0`;
  const nonBlank = nonBlankOn(t);

  const rowFor = (cond: SQL) =>
    sql`SELECT 1 FROM ${t} WHERE ${t}.${sql.identifier("_parent")} = ${mainIdColumn} AND ${t}.${sql.identifier("_locale")} = ${locale} AND (${cond})`;

  switch (state) {
    case "translated":
      // Default locale is always translated (fallback source) → no restriction.
      return isDefault ? undefined : sql`EXISTS (${rowFor(nonBlank)})`;
    case "missing":
      // Nothing is missing in the default locale.
      return isDefault ? sql`1=0` : sql`NOT EXISTS (${rowFor(nonBlank)})`;
    case "draft":
    case "published":
      if (!hasStatus) return undefined;
      // The lifecycle state AND actual content. `_status` alone is not enough:
      // a companion row can carry a status while every localized column is
      // still blank, and such a row satisfied BOTH this arm and `missing`
      // above — which is `NOT EXISTS (row with non-blank content)`. The same
      // document then appeared under "Not translated" and under "Draft" at
      // once, and a translator could not tell which tab was lying.
      //
      // Conjoining `nonBlank` settles it in the direction the rest of this
      // function already takes: throughout, "translated" means a companion row
      // with non-blank content (spec §8's blank=untranslated rule), so a
      // status with nothing written is untranslated with a status attached,
      // not a draft translation.
      return sql`EXISTS (${rowFor(sql`${t}.${sql.identifier("_status")} = ${state} AND (${nonBlank})`)})`;
    case "stale":
      // i18n B2 — translated, but the source moved afterwards.
      //
      // 🔴 `1=0`, never `undefined`, in BOTH refusing branches, and the difference is the whole
      // safety of this arm. `undefined` means "no restriction", so a worklist tab asking "what
      // needs review" would answer with EVERY document of a collection that cannot answer the
      // question at all — confidently, with nothing on screen to suggest the collection was the
      // problem. `1=0` says "nothing here is KNOWN to be stale", which is what an unanswerable
      // question honestly returns.
      //
      // The default locale IS the source, so it cannot be stale against itself.
      if (isDefault || args.hasUpdatedAt !== true) return sql`1=0`;
      return buildStaleCondition({
        table: t,
        mainIdColumn,
        locale,
        defaultLocale,
        nonBlankOn,
      });
    default:
      return undefined;
  }
}

/**
 * "This locale has content, and the source locale was written after it was."
 *
 * A correlated comparison between two rows of the SAME companion — the target locale's against the
 * default locale's — so the table is joined to itself and BOTH references must be aliased. The
 * other arms of the filter above get away with the bare table name because they mention it once;
 * a second unaliased reference inside a nested subquery would shadow the first, and every row
 * would then be compared against itself, which is never greater and so reports nothing stale ever.
 *
 * 🔴 NULL is handled by SQL's three-valued logic and by nothing else here, which is worth stating
 * because the obvious `IS NOT NULL` guards are ABSENT on purpose. `NULL > 2000` and `2000 > NULL`
 * both evaluate to UNKNOWN, `WHERE` keeps only TRUE, so either missing timestamp yields no inner
 * row and the document is not stale. Explicit guards were written first and then removed: they
 * could be deleted with every test still green, which makes them untested code that reads as
 * load-bearing — the next person to touch this would take them for the protection and leave the
 * comparison unexamined.
 *
 * The two NULL cases and what they mean:
 *
 *  - the target has no `_updated_at` — it was written before the column existed. UNKNOWN.
 *  - the source has no `_updated_at`, or no companion row at all — UNKNOWN.
 *
 * UNKNOWN is reported as "not stale", which under-reports, and that is the direction to fail in:
 * over-reporting would put "needs review" on translations nobody has touched, and a warning that
 * fires on everything is one people switch off. The design records the same choice as folding
 * unknown into `translated` rather than giving it a state of its own.
 *
 * That reliance is load-bearing enough to be pinned rather than assumed: writing the comparison as
 * `COALESCE(src, 0) > COALESCE(tgt, 0)` — the natural "defensive" spelling — reports every
 * unstamped target as stale, and the unstamped-TARGET test below fails on exactly that.
 *
 * `>` and not `>=`: a source and target written in the same instant are a translation saved
 * alongside its source, not a stale one. It also matters physically — SQLite stores whole epoch
 * seconds, so writes inside one second are stored identically, and `>=` would report every
 * same-second pair as stale.
 */
function buildStaleCondition(args: {
  table: CompanionTableRef;
  mainIdColumn: unknown;
  locale: string;
  defaultLocale: string;
  nonBlankOn: (ref: CompanionTableRef) => SQL;
}): SQL {
  const { table, mainIdColumn, locale, defaultLocale, nonBlankOn } = args;
  // Prefixed, because an alias shares a namespace with the caller's own tables and a bare `src`
  // or `target` could collide with a real collection table in the enclosing query.
  const tgt = sql.identifier("nx_stale_target");
  const src = sql.identifier("nx_stale_source");
  const parent = sql.identifier("_parent");
  const localeCol = sql.identifier("_locale");
  const stamp = sql.identifier(COMPANION_UPDATED_AT_COLUMN);

  return sql`EXISTS (
    SELECT 1 FROM ${table} ${tgt}
    WHERE ${tgt}.${parent} = ${mainIdColumn}
    AND ${tgt}.${localeCol} = ${locale}
    AND (${nonBlankOn(tgt)})
    AND EXISTS (
      SELECT 1 FROM ${table} ${src}
      WHERE ${src}.${parent} = ${mainIdColumn}
      AND ${src}.${localeCol} = ${defaultLocale}
      AND ${src}.${stamp} > ${tgt}.${stamp}
    )
  )`;
}

/** Per-locale translation state for one entry (i18n M7 — translation-status overview). */
export interface LocaleTranslationMeta {
  /**
   * Whether this locale has meaningful content — a companion row with at least one non-blank
   * localized field. Mirrors the read-time "blank = untranslated, falls back" rule (spec §8), so a
   * present-but-all-blank row reads as untranslated. The default locale is always `true` (it is the
   * fallback source and the entry itself exists in it).
   */
  translated: boolean;
  /**
   * The locale's draft/published state, from the companion `_status` column. Present only when the
   * collection has per-locale status (i18n M6) and a companion row exists for the locale.
   */
  status?: string;
  /**
   * Whether this language holds a saved change that has not been published.
   *
   * Separate from `status` deliberately: `status` says what the language is,
   * this says whether something is waiting. An overview that reported only the
   * status would show a document as fully published while an author's held work
   * sat inside it, visible only by opening that language — which with several
   * languages means it is not seen at all.
   *
   * Absent rather than `false` when there is nothing pending, matching how the
   * rest of this map omits what does not apply.
   */
  pendingChange?: boolean;
  /**
   * Whether the SOURCE language was written after this one was (i18n B2).
   *
   * 🔴 Separate from `translated` and from `status`, exactly as `pendingChange` is, and for the
   * same reason that field states: these are different facts about one language, and collapsing
   * them loses one. A stale translation is still translated, and still published if it was
   * published — so this is a qualifier the reader appends, never a state that replaces the one
   * the language is in. Reporting a live translation as "needs review" INSTEAD of "published"
   * would understate what the site is actually serving.
   *
   * Absent rather than `false` when nothing is known, matching how the rest of this map omits
   * what does not apply — and here the distinction carries weight, because "not stale" and "no
   * timestamps to compare" are different answers and only one of them is a claim about the
   * content. A row written before `_updated_at` existed is unknown, never up to date.
   */
  stale?: boolean;
}

export interface TranslationStatusArgs {
  db: SelectableDb;
  companionTable: unknown;
  localizedFields: LocalizedFieldRef[];
  rows: Record<string, unknown>[];
  /** Every configured locale code to report on. */
  locales: string[];
  /** The default locale — always reported as translated (the fallback source). */
  defaultLocale: string;
  /** Whether the companion carries a per-locale `_status` column (i18n M6). */
  hasStatus: boolean;
  /**
   * What is needed to read `_updated_at` (i18n B2): the physical companion name and its dialect.
   * The column is deliberately not declared on the companion's runtime table — see
   * {@link readCompanionStamps} — so it is read through its own narrow handle instead.
   *
   * ONE optional object rather than two optional fields, because neither is usable without the
   * other and a caller that supplied only one would silently report every locale as UNKNOWN.
   * Omitting it entirely is legitimate and means exactly that: this caller cannot ask, so nothing
   * is known — never that everything is current.
   */
  staleness?: { companionTableName: string; dialect: SupportedDialect };
  idKey?: string;
  /** See `readiness` on {@link PopulateCompanionArgs}. */
  readiness: CompanionReadiness | undefined;
  /** Row key to write the per-locale map under (default `_translations`). */
  outKey?: string;
  /**
   * Which languages hold a pending change, keyed by document id.
   *
   * Supplied by the caller rather than read here: this module owns the
   * companion join and holds no versions handle, and the lookup is one batched
   * query the caller already has an adapter for. Absent means report none,
   * which is the right answer for a collection with no draft lifecycle.
   */
  pendingChangeLocales?: Map<string, Set<string | null>>;
  /**
   * Per-locale status filter (i18n M6). When set (e.g. `"published"`), a companion row whose
   * `_status` differs is treated as absent, so a published read's overview never reports a
   * draft-only translation as present. Undefined = report every row (admin / no per-locale status).
   */
  statusValue?: string;
}

/**
 * Mark the languages of one document that hold a saved, unpublished change.
 *
 * Carried separately from `status` on purpose: `status` answers what a language
 * IS, this answers whether something is waiting. Keeping them apart means a new
 * lifecycle state later does not have to be crossed with "has pending work".
 *
 * A pending change stored under no locale belongs to the default language: that
 * is the language a document is edited in when localization is configured but
 * the document itself is not localized.
 */
function markPendingChanges(
  meta: Record<string, LocaleTranslationMeta>,
  locales: string[],
  defaultLocale: string,
  pending: Set<string | null> | undefined
): void {
  if (!pending) return;
  for (const code of locales) {
    const entry = meta[code];
    if (!entry) continue;
    if (pending.has(code) || (code === defaultLocale && pending.has(null))) {
      entry.pendingChange = true;
    }
  }
}

/**
 * Translation-status overview (i18n M7): for each result row, set a per-locale map describing
 * which languages are translated and, when the collection has drafts, each language's status.
 * One batched query over the whole page (same cost profile as the other companion populates);
 * mutates `rows` in place. A companion that is not there yet (dev-before-migrate) is not queried,
 * so every row reports no translations rather than the read failing.
 *
 * Output shape (under `outKey`, default `_translations`):
 * `{ en: { translated: true, status: "published" }, de: { translated: false } }`
 */
/**
 * Per-locale `_updated_at` for a page of documents, or nothing when the companion cannot answer.
 *
 * 🔴 Read through its OWN narrow Drizzle handle rather than through the companion's main runtime
 * table, and that is an upgrade-path decision. The main table is registered for every localized
 * entity, including Schema Builder collections held in the registry — and the reconcile that adds
 * this column runs only over entities declared in configuration. Declaring the column there would
 * make the ordinary localized read's bare `select()` name a column those tables do not have, and
 * every localized read on them would fail after an upgrade. A staleness badge is not worth that.
 *
 * So the column is named in ONE place that is allowed to fail, and a companion that has not been
 * reconciled yields no stamps at all — which the caller reports as UNKNOWN, never as up to date.
 * That is the answer the whole feature already gives for a NULL.
 *
 * The catch is narrow on purpose: it swallows the case where the column is absent and rethrows
 * anything else, so a permission fault or a dropped connection still surfaces instead of being
 * reported as "this site has no staleness information".
 */
async function readCompanionStamps(
  db: SelectableDb,
  companionTableName: string,
  dialect: SupportedDialect,
  ids: (string | number)[],
  locales: string[]
): Promise<Map<string, Date>> {
  const out = new Map<string, Date>();
  if (ids.length === 0 || locales.length === 0) return out;

  const stamp = buildCompanionStampTable(companionTableName, dialect);
  let rows: Record<string, unknown>[];
  try {
    rows = await db
      .select({
        _parent: stamp.parent,
        _locale: stamp.locale,
        [COMPANION_UPDATED_AT_COLUMN]: stamp.updatedAt,
      })
      .from(stamp.table)
      .where(
        and(
          inArray(stamp.parent as never, ids),
          inArray(stamp.locale as never, locales)
        )
      );
  } catch (error) {
    if (isMissingColumnError(error, COMPANION_UPDATED_AT_COLUMN)) return out;
    throw error;
  }

  for (const row of rows) {
    const at = toStampDate(row[COMPANION_UPDATED_AT_COLUMN]);
    if (at !== null) {
      out.set(`${String(row._parent)}::${String(row._locale)}`, at);
    }
  }
  return out;
}

/**
 * One raw `_updated_at` value as a `Date`, or `null` when it cannot be one.
 *
 * Drizzle decodes the column for every dialect it declares, so a `Date` is the expected shape.
 * A raw epoch is still accepted because a driver that returns one unmapped would otherwise be
 * read as "no stamp", which is silently wrong rather than loudly wrong.
 *
 * Anything else answers `null` and the caller reports UNKNOWN. Guessing at an unrecognised shape
 * is what would turn a driver change into wrong staleness answers rather than absent ones.
 */
function toStampDate(raw: unknown): Date | null {
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
  if (typeof raw === "number") {
    const at = new Date(raw * 1000);
    return Number.isNaN(at.getTime()) ? null : at;
  }
  return null;
}

/**
 * Does this error say the table has no such column?
 *
 * 🔴 WALKS THE CAUSE CHAIN, because the driver wording is not on the error a caller catches.
 * Measured against a real SQLite adapter, a Drizzle select on a missing column throws:
 *
 *   DrizzleQueryError  "Failed query: select \"_parent\", \"_locale\", \"_updated_at\" from ..."
 *     cause: SqliteError  "no such column: \"_updated_at\" - should this be a string literal..."
 *
 * so a predicate reading only the top-level message finds no driver wording and rethrows — and
 * the legacy companion this exists to tolerate fails its read after all.
 *
 * 🔴 Both conditions are tested PER LEVEL rather than across the chain, and that is not fussiness:
 * the top-level message quotes the SQL, so it CONTAINS the column name. Testing "some level
 * mentions the column" and "some level reads as a missing-column error" separately would match the
 * name from the statement text and the wording from an unrelated cause, and report any nested
 * failure on a query that happens to select this column as a missing column.
 *
 * Matched on wording because none of the three dialects exposes a portable code for this that
 * reaches here: SQLite says `no such column`, PostgreSQL `column ... does not exist`, MySQL
 * `Unknown column`. Requiring the column NAME alongside the shape keeps it from swallowing a
 * different column's absence and reporting the site as having no staleness data.
 */
export function isMissingColumnError(error: unknown, column: string): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  // Bounded by identity rather than by a depth constant: a cause chain that loops would otherwise
  // spin here, and a legitimate chain is short.
  while (current !== null && current !== undefined && !seen.has(current)) {
    seen.add(current);
    // A cause is `unknown`, and only two shapes carry a readable message. Anything else is
    // skipped rather than stringified: `String(someObject)` yields "[object Object]", which
    // matches nothing and would quietly make this level unexaminable.
    const message =
      current instanceof Error
        ? current.message
        : typeof current === "string"
          ? current
          : "";
    if (
      message.includes(column) &&
      /no such column|does not exist|unknown column/i.test(message)
    ) {
      return true;
    }
    current = current instanceof Error ? current.cause : undefined;
  }
  return false;
}

/**
 * Was the SOURCE row written after the TARGET row was? (i18n B2.)
 *
 * The JS twin of the `stale` SQL arm, and deliberately the same rule: content is checked by the
 * caller, both timestamps must be present, and the comparison is strict. Two spellings of "is
 * this stale" would let the worklist tab and the per-row badge disagree about one document, which
 * is the shape of defect this module already carries a fix for.
 *
 * Reads a `Date` because that is what the column's declared `timestamp` kind decodes to on all
 * three dialects. Anything else — a driver returning a raw epoch, a column that was never
 * declared and so never selected — answers `false` rather than guessing, because a wrong
 * comparison here reports a translation nobody touched as needing review.
 */
function isStaleAgainstSource(
  targetAt: Date | undefined,
  sourceAt: Date | undefined
): boolean {
  if (targetAt === undefined || sourceAt === undefined) return false;
  // Strict, matching the SQL. Equal stamps are a translation saved alongside its source — and on
  // SQLite they are also two writes inside one second, since the column stores whole seconds.
  return sourceAt.getTime() > targetAt.getTime();
}

export async function populateTranslationStatus(
  args: TranslationStatusArgs
): Promise<void> {
  const {
    db,
    companionTable,
    localizedFields,
    rows,
    locales,
    defaultLocale,
    hasStatus,
  } = args;
  const idKey = args.idKey ?? "id";
  const outKey = args.outKey ?? "_translations";
  if (args.readiness !== "ready") return;
  if (rows.length === 0 || locales.length === 0) return;

  const ids = rows
    .map(r => r[idKey])
    .filter((id): id is string | number => id !== null && id !== undefined);
  if (ids.length === 0) return;

  const table = companionTable as CompanionTable;
  const companionRows: Record<string, unknown>[] = await db
    .select()
    .from(companionTable)
    .where(
      and(
        inArray(table._parent as never, ids),
        inArray(table._locale as never, locales)
      )
    );

  const byParent = new Map<unknown, Record<string, Record<string, unknown>>>();
  for (const cr of companionRows) {
    let perLocale = byParent.get(cr._parent);
    if (!perLocale) {
      perLocale = {};
      byParent.set(cr._parent, perLocale);
    }
    perLocale[String(cr._locale)] = cr;
  }

  // One extra query for the whole page rather than one per row, and skipped entirely when the
  // caller supplies no reader.
  const stamps = args.staleness
    ? await readCompanionStamps(
        db,
        args.staleness.companionTableName,
        args.staleness.dialect,
        ids,
        locales
      )
    : new Map<string, Date>();

  for (const row of rows) {
    const perLocaleRows = byParent.get(row[idKey]) ?? {};
    const meta: Record<string, LocaleTranslationMeta> = {};
    for (const code of locales) {
      meta[code] = buildLocaleMeta({
        code,
        perLocaleRows,
        localizedFields,
        defaultLocale,
        hasStatus,
        statusValue: args.statusValue,
        stampFor: (locale: string) =>
          stamps.get(`${String(row[idKey])}::${locale}`),
      });
    }
    markPendingChanges(
      meta,
      locales,
      defaultLocale,
      args.pendingChangeLocales?.get(String(row[idKey]))
    );
    row[outKey] = meta;
  }
}

/**
 * The companion row for one locale, or `undefined` when a status-scoped read must not see it.
 *
 * On a published read, a row whose `_status` differs is treated as ABSENT rather than as present-
 * but-draft. That is the rule the whole overview rests on: reporting a draft-only translation as
 * present would tell a reader the public site carries content it does not serve.
 */
function rowInStatusScope(
  row: Record<string, unknown> | undefined,
  statusValue: string | undefined
): Record<string, unknown> | undefined {
  if (row === undefined || statusValue === undefined) return row;
  return row._status === statusValue ? row : undefined;
}

/**
 * One locale's entry in a document's translation overview.
 *
 * Extracted from the loop above rather than inlined, because it answers three independent
 * questions about the same row — does this language have content, what lifecycle state is it in,
 * and has its source moved since — and reading them as one block invites the mistake of treating
 * them as one answer. They are not: a language can be published AND stale, and the whole
 * vocabulary decision behind `stale` is that it qualifies the state rather than replacing it.
 */
function buildLocaleMeta(args: {
  code: string;
  perLocaleRows: Record<string, Record<string, unknown>>;
  localizedFields: LocalizedFieldRef[];
  defaultLocale: string;
  hasStatus: boolean;
  statusValue: string | undefined;
  /** When this locale was last written, or `undefined` when nothing is known. */
  stampFor: (locale: string) => Date | undefined;
}): LocaleTranslationMeta {
  const { code, perLocaleRows, localizedFields, defaultLocale, hasStatus } =
    args;
  const companionRow = rowInStatusScope(perLocaleRows[code], args.statusValue);

  const hasContent =
    !!companionRow &&
    localizedFields.some(f => !isBlank(companionRow[f.column]));
  const entry: LocaleTranslationMeta = {
    translated: code === defaultLocale ? true : hasContent,
  };

  const status = companionRow?._status;
  if (hasStatus && typeof status === "string") entry.status = status;

  // Only ever set to `true`. Left absent when the comparison cannot answer, so a consumer reading
  // `stale === false` is reading a real "not stale" rather than an unknown wearing its clothes.
  //
  // 🔴 `code !== defaultLocale` is BELT-AND-BRACES and is kept deliberately, so it does not read
  // as load-bearing to the next person: for the source locale, `companionRow` and the source row
  // are the same object, so the strict comparison is already false. That redundancy rests on
  // object IDENTITY rather than on a rule, though — a future normalisation that handed this a
  // copy, or a rounded timestamp, could make a row compare greater than itself — so the state the
  // guard asserts is spelled out rather than inferred. No test separates the two mechanisms, and
  // none can while both hold.
  if (
    code !== defaultLocale &&
    hasContent &&
    isStaleAgainstSource(args.stampFor(code), args.stampFor(defaultLocale))
  ) {
    entry.stale = true;
  }
  return entry;
}
