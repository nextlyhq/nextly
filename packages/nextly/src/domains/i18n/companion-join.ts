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

import { and, inArray, sql, type SQL } from "drizzle-orm";

/** Blank = "not translated": null, undefined, or empty string fall back. 0/false are real values. */
function isBlank(value: unknown): boolean {
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
  select: () => {
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
  /** Names of the localized fields to resolve onto each row. */
  localizedFieldNames: string[];
  /** The result rows to mutate in place (each must carry the parent id under `idKey`). */
  rows: Record<string, unknown>[];
  /** The fallback chain: `[requested, …fallbacks, default]`. Single element = no fallback. */
  localeChain: string[];
  /** The main-row primary-key property (defaults to `"id"`). */
  idKey?: string;
}

/**
 * Batch-populate localized fields onto `rows` for the requested language with fallback.
 * One query fetches every relevant companion row (`_parent ∈ ids`, `_locale ∈ chain`); each main
 * row then gets `row[field]` set to the fallback-resolved value. Mutates `rows` in place.
 */
export async function populateCompanionFields(
  args: PopulateCompanionArgs
): Promise<void> {
  const { db, companionTable, localizedFieldNames, rows, localeChain } = args;
  const idKey = args.idKey ?? "id";
  if (
    rows.length === 0 ||
    localizedFieldNames.length === 0 ||
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

  const companionRows = await db
    .select()
    .from(companionTable)
    .where(
      and(
        inArray(parentCol as never, ids),
        inArray(localeCol as never, localeChain)
      )
    );

  // Index: parentId -> locale -> companion row.
  const byParent = new Map<unknown, Record<string, Record<string, unknown>>>();
  for (const cr of companionRows) {
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
    for (const field of localizedFieldNames) {
      const perLocaleValue: Record<string, unknown> = {};
      for (const code of localeChain) {
        perLocaleValue[code] = perLocaleRows[code]?.[field];
      }
      row[field] = resolveLocalizedValue(perLocaleValue, localeChain);
    }
  }
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
}): SQL {
  const { companionTableName, mainIdColumn, locale, valueCondition } = args;
  return sql`EXISTS (
    SELECT 1 FROM ${sql.identifier(companionTableName)}
    WHERE ${sql.identifier(companionTableName)}."_parent" = ${mainIdColumn}
    AND ${sql.identifier(companionTableName)}."_locale" = ${locale}
    AND ${valueCondition}
  )`;
}
