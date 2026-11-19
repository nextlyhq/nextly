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
