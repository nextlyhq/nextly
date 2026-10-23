/**
 * What making another language the default would touch, shown before it is confirmed.
 *
 * The default language already has its own translation rows, so the change moves no data: the
 * summary says how many translations each language holds across every translated collection,
 * Single and field group, and how many pending changes the current default has. A change with
 * pending changes in the current default is refused, so nothing half-published crosses it.
 *
 * @module domains/i18n/default-language-change
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { sql } from "drizzle-orm";

import { resolveFieldGroupRegistryName } from "../field-groups/storage/resolve-storage-names";

export interface DefaultChangeSummary {
  from: string;
  to: string;
  /** Translation rows per language, across every translated collection, Single and field group. */
  translationsPerLanguage: Record<string, number>;
  /** Pending changes (working drafts) in the current default language. */
  pendingInCurrentDefault: number;
}

/**
 * The translation tables of every translated entity, the ones that exist. Which tables exist is
 * read once, so the cost is the same however many entities the site has: one listing, and one read
 * of each of the three registries.
 */
async function translationTables(adapter: DrizzleAdapter): Promise<string[]> {
  const existing = new Set(await adapter.listTables());
  const registries = [
    "dynamic_collections",
    "dynamic_singles",
    await resolveFieldGroupRegistryName(adapter),
  ];
  const tables: string[] = [];
  for (const registry of registries) {
    // Checked before reading: on PostgreSQL a failed read would abort the transaction around it.
    if (!existing.has(registry)) continue;
    const rows = await adapter.select<{
      tableName: string;
      localized: unknown;
    }>(registry, {
      columns: ["tableName", "localized"],
    });
    for (const row of rows) {
      const companion = `${row.tableName}_locales`;
      if (Boolean(row.localized) && existing.has(companion)) {
        tables.push(companion);
      }
    }
  }
  return tables;
}

/** Pending changes (working drafts) in `locale`. */
export async function pendingChangesIn(
  adapter: DrizzleAdapter,
  locale: string
): Promise<number> {
  if (!(await adapter.tableExists("nextly_versions"))) return 0;
  return countPendingChangesIn(adapter, locale);
}

/**
 * Pending changes in `locale`, counted on `executor`: the open transaction's, when the count
 * decides a write made in it. The versions table must exist (`pendingChangesIn` asks first).
 */
export async function countPendingChangesIn(
  executor: Pick<DrizzleAdapter, "queryStatement">,
  locale: string
): Promise<number> {
  const [row] = await executor.queryStatement<{ n: unknown }>(
    sql`SELECT COUNT(*) AS n FROM ${sql.identifier("nextly_versions")} WHERE ${sql.identifier("draft_key")} IS NOT NULL AND ${sql.identifier("locale")} = ${locale}`
  );
  return Number(row?.n ?? 0);
}

export async function summarizeDefaultChange(
  adapter: DrizzleAdapter,
  from: string,
  to: string
): Promise<DefaultChangeSummary> {
  const translationsPerLanguage: Record<string, number> = {};
  const tables = await translationTables(adapter);
  // Every table's count in one statement, so the round trips do not grow with the entities.
  const counts =
    tables.length === 0
      ? []
      : await adapter.queryStatement<{ locale: string; n: unknown }>(
          sql.join(
            tables.map(
              table =>
                sql`SELECT ${sql.identifier("_locale")} AS locale, COUNT(*) AS n FROM ${sql.identifier(table)} GROUP BY ${sql.identifier("_locale")}`
            ),
            sql` UNION ALL `
          )
        );
  for (const { locale, n } of counts) {
    translationsPerLanguage[locale] =
      (translationsPerLanguage[locale] ?? 0) + Number(n);
  }
  return {
    from,
    to,
    translationsPerLanguage,
    pendingInCurrentDefault: await pendingChangesIn(adapter, from),
  };
}
