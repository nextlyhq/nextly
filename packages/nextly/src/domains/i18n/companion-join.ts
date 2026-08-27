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

import { and, eq, inArray, sql, type SQL } from "drizzle-orm";

import type { CompanionReadiness } from "./runtime/companion-readiness";

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

  const nonBlank =
    localizedColumns.length > 0
      ? sql.join(
          localizedColumns.map(c => {
            const col = sql.identifier(c);
            return sql`(${t}.${col} IS NOT NULL AND ${t}.${col} <> '')`;
          }),
          sql` OR `
        )
      : sql`1=0`;

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
      return sql`EXISTS (${rowFor(sql`${t}.${sql.identifier("_status")} = ${state}`)})`;
    default:
      return undefined;
  }
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

  for (const row of rows) {
    const perLocaleRows = byParent.get(row[idKey]) ?? {};
    const meta: Record<string, LocaleTranslationMeta> = {};
    for (const code of locales) {
      const rawCr = perLocaleRows[code];
      // On a status-scoped read, a companion row not in that status is treated as
      // absent, so the overview does not report a draft-only translation as present.
      const cr =
        args.statusValue !== undefined &&
        rawCr &&
        rawCr._status !== args.statusValue
          ? undefined
          : rawCr;
      const hasContent =
        !!cr && localizedFields.some(f => !isBlank(cr[f.column]));
      const entry: LocaleTranslationMeta = {
        translated: code === defaultLocale ? true : hasContent,
      };
      if (hasStatus && cr && typeof cr._status === "string") {
        entry.status = cr._status;
      }
      meta[code] = entry;
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
