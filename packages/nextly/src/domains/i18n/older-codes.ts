/**
 * Where a language code's older spelling (`pt_BR`) is still stored: the one answer to "has this
 * code's content been moved to its standard form yet", for the start that refuses to serve a site
 * whose rows are still under the older spelling, and for `nextly migrate`, whose data steps move them.
 *
 * @module domains/i18n/older-codes
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { sql } from "drizzle-orm";

import { MEDIA_USAGE_TABLE } from "../../schemas/media-usage/table-name";
import { TRANSLATION_PROVENANCE_TABLE } from "../../schemas/translation-provenance/table-name";
import { VERSIONS_TABLE } from "../../schemas/versions/types";

/** Whether `table` holds a row whose `column` is `code`. */
async function holdsRowIn(
  adapter: DrizzleAdapter,
  table: string,
  column: string,
  code: string
): Promise<boolean> {
  const rows = await adapter.queryStatement<{ found: unknown }>(
    sql`SELECT 1 AS ${sql.identifier("found")} FROM ${sql.identifier(table)} WHERE ${sql.identifier(column)} = ${code} LIMIT 1`
  );
  return rows.length > 0;
}

/**
 * The tables still holding a row under `code`: each of the translation tables `translationTables`
 * keeps its language in `_locale`, and every other table the code is stored in.
 */
export async function tablesHoldingCode(
  adapter: DrizzleAdapter,
  translationTables: readonly string[],
  code: string
): Promise<string[]> {
  const holding: string[] = [];
  for (const table of translationTables) {
    if (await holdsRowIn(adapter, table, "_locale", code)) holding.push(table);
  }
  // Every other table the code is stored in, by the column that holds it: the versions and the
  // releases' members (`locale`), a pinned base kept for a language's pending change (its slot),
  // each translation's record of where it came from, the archive of removed translations, and
  // each media use and preview link in a language.
  const others: readonly [table: string, column: string, value: string][] = [
    [VERSIONS_TABLE, "locale", code],
    ["nextly_version_pins", "slot", `pending:${code}`],
    [TRANSLATION_PROVENANCE_TABLE, "locale", code],
    [TRANSLATION_PROVENANCE_TABLE, "source_locale", code],
    ["nextly_i18n_archive", "locale", code],
    ["nextly_release_members", "locale", code],
    [MEDIA_USAGE_TABLE, "locale", code],
    ["nextly_preview_links", "locale", code],
  ];
  for (const [table, column, value] of others) {
    if (holding.includes(table)) continue;
    if (!(await adapter.tableExists(table))) continue;
    if (await holdsRowIn(adapter, table, column, value)) holding.push(table);
  }
  return holding;
}

/** A code stored the earlier way, and the configured code it is read as. */
export interface StoredOlderSpelling {
  from: string;
  to: string;
}

/**
 * The older spellings of `codes` that rows in `translationTables` are still stored under, found
 * from the rows rather than the configuration: a configuration already corrected to the standard
 * code no longer names them. Only an underscore is ever converted (`standardLanguageCode`), so an
 * older spelling of `pt-BR` is `pt_BR` in any letter case. Each table is first asked whether it
 * holds any code with an underscore at all, stopping at the first row; only a table that does is
 * read for its spellings.
 */
export async function storedOlderSpellings(
  adapter: DrizzleAdapter,
  translationTables: readonly string[],
  codes: readonly string[]
): Promise<StoredOlderSpelling[]> {
  // The underscore form of each configured code that has a part after its language.
  const byLowered = new Map(
    codes
      .filter(code => code.includes("-"))
      .map(code => [code.replace(/-/g, "_").toLowerCase(), code] as const)
  );
  if (byLowered.size === 0) return [];
  // `_` is LIKE's single-character wildcard, so it is matched through an escape character.
  const underscored = sql`${sql.identifier("_locale")} LIKE ${"%!_%"} ESCAPE '!'`;
  const found = new Map<string, string>();
  for (const table of translationTables) {
    const any = await adapter.queryStatement<{ found: unknown }>(
      sql`SELECT 1 AS ${sql.identifier("found")} FROM ${sql.identifier(table)} WHERE ${underscored} LIMIT 1`
    );
    if (any.length === 0) continue;
    const spellings = await adapter.queryStatement<{ locale: unknown }>(
      sql`SELECT DISTINCT ${sql.identifier("_locale")} AS ${sql.identifier("locale")} FROM ${sql.identifier(table)} WHERE ${underscored}`
    );
    for (const { locale } of spellings) {
      if (typeof locale !== "string") continue;
      const to = byLowered.get(locale.toLowerCase());
      if (to !== undefined) found.set(locale, to);
    }
  }
  return [...found].map(([from, to]) => ({ from, to }));
}

/**
 * The `nextly_meta` key recording that the database was found to hold no row under an older
 * spelling of the configured languages, and the value it records: those languages, so a change to
 * them is scanned for again.
 */
export const OLDER_CODES_CHECKED_KEY = "i18n.olderCodesChecked";

/** The value `OLDER_CODES_CHECKED_KEY` records for `codes`: one per configured language set. */
export function olderCodesCheckedFor(codes: readonly string[]): string {
  return [...new Set(codes)].sort().join(",");
}
