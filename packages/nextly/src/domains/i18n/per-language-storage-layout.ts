/**
 * The boot refusal of a database laid out before per-language storage: with
 * `experimental.perLanguageStorage` on, an entity whose main table still holds its translatable
 * columns would be served from two layouts at once, and the schema push that follows would plan to
 * drop those columns. Storage is never mixed, so the boot stops first and names what it found.
 *
 * Any entity can be in that state with the setting on, a translatable one too when it gained its
 * flag in the same deployment; with it off, only one whose values the setting kept per language.
 *
 * @module domains/i18n/per-language-storage-layout
 * @experimental
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { sql, type SQL } from "drizzle-orm";

import { NextlyError } from "../../errors/nextly-error";
import { introspectLiveSnapshot } from "../schema/pipeline/diff/introspect-live";
import {
  readIdentifierCaseRules,
  type IdentifierCaseAdapter,
} from "../schema/utils/read-identifier-case";
import {
  indexCatalog,
  resolveCatalogName,
  type IdentifierCaseRules,
} from "../schema/utils/resolve-catalog-name";

import { deriveCompanionSpec } from "./migration/derive-companion-spec";

/** An entity as the refusal reads it: where it is stored, its fields and its own flag. */
export interface LaidOutEntity {
  kind: "collection" | "single" | "component";
  slug: string;
  tableName: string;
  fields: readonly { name?: string; type: string; localized?: boolean }[];
  localized?: unknown;
}

/**
 * The live table named `name`, as this server compares table names: MySQL with
 * `lower_case_table_names=1` (the default on macOS and Windows) reports every table in lower case
 * and compares them without case, so a mixed-case `dbName` is found under either spelling, while
 * one with `lower_case_table_names=0` keeps names differing only in case apart.
 */
function liveTable<T extends { name: string }>(
  tables: readonly T[],
  name: string,
  rules: IdentifierCaseRules
): T | undefined {
  const resolved = resolveCatalogName(
    indexCatalog(
      tables.map(table => table.name),
      rules.tables
    ),
    name
  );
  return resolved === undefined
    ? undefined
    : tables.find(table => table.name === resolved);
}

/**
 * Which of `columns` the live table holds, as this server compares column names: SQLite and MySQL
 * compare them without case, so a column spelled `Headline` is the translatable `headline`.
 */
function columnsIn(
  live: { columns: readonly { name: string }[] },
  columns: readonly string[],
  rules: IdentifierCaseRules
): string[] {
  const catalog = indexCatalog(
    live.columns.map(column => column.name),
    rules.columns
  );
  return columns.filter(
    column => resolveCatalogName(catalog, column) !== undefined
  );
}

/** What the refusal needs of the adapter: its dialect and a handle to introspect through. */
type LayoutAdapter = IdentifierCaseAdapter;

/**
 * The translatable columns `entity` would keep on its main table if it were not stored per
 * language: the columns its companion is given, read from the companion's own spec so the two
 * cannot disagree about which fields are translatable.
 */
function translatableColumns(
  entity: LaidOutEntity,
  dialect: SupportedDialect
): string[] {
  const spec = deriveCompanionSpec({
    slug: entity.slug,
    dbName: entity.tableName,
    fields: entity.fields as Parameters<
      typeof deriveCompanionSpec
    >[0]["fields"],
    dialect,
    defaultLocale: "en",
    collectionLocalized: true,
    builtBy: "codeFirst",
  });
  return spec ? spec.columns.map(column => column.name) : [];
}

/**
 * Refuses the boot when the database keeps an entity not marked translatable in the other layout
 * than the setting chooses, naming each one and its columns.
 *
 * - With the setting on (`perLanguage`): its translatable columns still on its main table. An
 *   entity whose table does not exist yet is laid out per language when it is created, so it is
 *   not a refusal.
 * - With it off: its translatable values only in its per-language table, as the setting laid
 *   them out, so its main table has none of those columns to read. A per-language table left
 *   beside a main table that holds the columns again, as turning translation off leaves one, is
 *   not a refusal.
 */
export async function refuseMixedStorage(
  adapter: LayoutAdapter,
  entities: readonly LaidOutEntity[],
  perLanguage = true
): Promise<void> {
  // With the setting on every entity keeps its translatable values per language, a translatable
  // one too: one that gains `localized: true` in the same deployment still holds them on its main
  // table. With it off a translatable entity keeps them per language as it always has.
  const candidates = entities
    .filter(entity => perLanguage || entity.localized !== true)
    .map(entity => ({
      entity,
      columns: translatableColumns(entity, adapter.dialect),
    }))
    .filter(({ columns }) => columns.length > 0);
  if (candidates.length === 0) return;
  // How this server compares names, read once: the catalog reports them in its own spelling.
  const rules = await readIdentifierCaseRules(adapter);
  if (!perLanguage) {
    await refuseValuesKeptPerLanguage(adapter, candidates, rules);
    return;
  }

  const snapshot = await introspectLiveSnapshot(
    adapter.getDrizzle(),
    adapter.dialect,
    candidates.map(({ entity }) => entity.tableName)
  );
  const found = candidates.flatMap(({ entity, columns }) => {
    const live = liveTable(snapshot.tables, entity.tableName, rules);
    if (!live) return [];
    const onMain = columnsIn(live, columns, rules);
    return onMain.length > 0 ? [{ entity, onMain }] : [];
  });
  if (found.length === 0) return;

  const named = found
    .map(
      ({ entity, onMain }) =>
        `the ${entity.kind} "${entity.slug}" (${onMain.join(", ")})`
    )
    .join("; ");
  throw new NextlyError({
    code: "NEXTLY_PER_LANGUAGE_STORAGE_MIXED",
    publicMessage:
      `experimental.perLanguageStorage is on, but this database still keeps translatable values ` +
      `on the main tables of ${named}. A site never serves both layouts: turn the setting off ` +
      `until those values are stored per language.`,
    logContext: {
      entities: found.map(({ entity, onMain }) => ({
        kind: entity.kind,
        slug: entity.slug,
        columns: onMain,
      })),
    },
  });
}

/**
 * The refusal with the setting off: an entity whose translatable values are only in its
 * per-language table, so reading its main table would ask for columns it does not have.
 */
async function refuseValuesKeptPerLanguage(
  adapter: LayoutAdapter,
  candidates: readonly { entity: LaidOutEntity; columns: string[] }[],
  rules: IdentifierCaseRules
): Promise<void> {
  const snapshot = await introspectLiveSnapshot(
    adapter.getDrizzle(),
    adapter.dialect,
    candidates.flatMap(({ entity }) => [
      entity.tableName,
      `${entity.tableName}_locales`,
    ])
  );
  const found = candidates.flatMap(({ entity, columns }) => {
    const main = liveTable(snapshot.tables, entity.tableName, rules);
    const companion = liveTable(
      snapshot.tables,
      `${entity.tableName}_locales`,
      rules
    );
    if (!main || !companion) return [];
    const onMain = new Set(columnsIn(main, columns, rules));
    const perLanguageOnly = columnsIn(companion, columns, rules).filter(
      column => !onMain.has(column)
    );
    return perLanguageOnly.length > 0 ? [{ entity, perLanguageOnly }] : [];
  });
  if (found.length === 0) return;
  const named = found
    .map(
      ({ entity, perLanguageOnly }) =>
        `the ${entity.kind} "${entity.slug}" (${perLanguageOnly.join(", ")})`
    )
    .join("; ");
  throw new NextlyError({
    code: "NEXTLY_PER_LANGUAGE_STORAGE_MIXED",
    publicMessage:
      `experimental.perLanguageStorage is off, but this database keeps the translatable values ` +
      `of ${named} only in their per-language tables, as the setting laid them out. A site never ` +
      `serves both layouts: turn the setting back on.`,
    logContext: {
      entities: found.map(({ entity, perLanguageOnly }) => ({
        kind: entity.kind,
        slug: entity.slug,
        columns: perLanguageOnly,
      })),
    },
  });
}

/** What the undeclared-languages check needs of the adapter, beyond the layout refusal's. */
type LanguageCheckAdapter = LayoutAdapter & {
  listTables(): Promise<string[]>;
  queryStatement<T>(statement: SQL): Promise<T[]>;
};

/**
 * Refuses the boot of a site keeping every translatable field per language that declares no
 * languages, neither in its configuration nor in Settings, while its per-language tables hold rows
 * in a language other than the implicit one (`implicitLocale`). Such a site would serve the
 * implicit language alone and its other translations would read as gone, as after a
 * `localization` block is removed. Nothing is moved: the refusal names the languages found and the
 * way back.
 */
export async function refuseUndeclaredLanguages(
  adapter: LanguageCheckAdapter,
  entities: readonly LaidOutEntity[],
  implicitLocale: string
): Promise<void> {
  const rules = await readIdentifierCaseRules(adapter);
  const catalog = indexCatalog(await adapter.listTables(), rules.tables);
  const found = new Set<string>();
  for (const entity of entities) {
    const companion = resolveCatalogName(
      catalog,
      `${entity.tableName}_locales`
    );
    if (companion === undefined) continue;
    const rows = await adapter.queryStatement<{ locale: unknown }>(
      sql`SELECT DISTINCT ${sql.identifier("_locale")} AS locale FROM ${sql.identifier(companion)} WHERE ${sql.identifier("_locale")} <> ${implicitLocale}`
    );
    for (const row of rows) {
      if (typeof row.locale === "string") found.add(row.locale);
    }
  }
  if (found.size === 0) return;
  const named = [...found]
    .sort()
    .map(locale => `"${locale}"`)
    .join(", ");
  throw new NextlyError({
    code: "NEXTLY_PER_LANGUAGE_STORAGE_LANGUAGES_UNDECLARED",
    publicMessage:
      `experimental.perLanguageStorage is on and this site declares no languages, so it would ` +
      `serve its content in "${implicitLocale}" alone, but this database holds translations in ` +
      `${named}. Put the localization block back, or add these languages in Settings, then ` +
      `restart.`,
    logContext: { languages: [...found].sort(), implicitLocale },
  });
}
