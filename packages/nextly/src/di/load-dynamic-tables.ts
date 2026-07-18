/**
 * Boot-time helper that reads `dynamic_collections`, `dynamic_singles`,
 * and `dynamic_components` rows and re-registers their runtime Drizzle
 * tables with the schema registry, so the framework can talk to those
 * tables on the very first request after a restart.
 *
 * This complements the dispatcher's create-time `registerDynamicSchema`
 * call — the dispatcher path keeps the resolver fresh in the current
 * Node process, but loses the registration after a restart. This boot
 * pass picks them back up by reading from the `dynamic_*` registry table.
 *
 * Extracted from `register.ts` so the contract can be unit-tested
 * directly without spinning up the full DI container.
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { FieldConfig } from "../collections/fields/types";

/**
 * Row shape returned by the `SELECT table_name, fields, slug, status FROM
 * dynamic_<*>` queries this helper runs. `status` is optional because
 * `dynamic_components` doesn't have one — the SELECT branches by table.
 */
export type DynamicTableRow = {
  table_name: string;
  fields: string;
  slug: string;
  status?: boolean | number | null;
  localized?: boolean | number | null;
};

/**
 * Read every row of `sourceTable` and call `register` for each. The
 * callback decides how to translate the row into a runtime Drizzle table
 * (Collections / Singles use `generateRuntimeSchema`; Components use
 * `ComponentSchemaService.generateRuntimeSchema`).
 *
 * Why an empty-field row still calls register: a freshly-created UI
 * Single is committed with `fields: []` and the user adds fields one
 * at a time in the Builder. The framework still needs the resolver to
 * know about the table so /api/singles/<slug> requests can find it.
 * The system columns (id/title/slug/timestamps/status) alone form a
 * valid Drizzle table — having no user-defined fields is NOT a reason
 * to skip registration.
 */
export async function loadDynamicTables(
  adapter: DrizzleAdapter,
  sourceTable: "dynamic_collections" | "dynamic_singles" | "dynamic_components",
  register: (
    tableName: string,
    fields: unknown[],
    hasStatus: boolean,
    localized: boolean
  ) => Promise<void>
): Promise<void> {
  // Components don't have `status` / `localized` columns — selecting them would
  // fail on strict dialects. Branch the SELECT so the boot pass survives every
  // dialect/version combination.
  const hasStatusColumn = sourceTable !== "dynamic_components";
  const selectSql = hasStatusColumn
    ? `SELECT table_name, fields, slug, status, localized FROM ${sourceTable}`
    : `SELECT table_name, fields, slug FROM ${sourceTable}`;

  try {
    let rows: DynamicTableRow[];
    try {
      rows = await adapter.executeQuery<DynamicTableRow>(selectSql);
    } catch (err) {
      // A database upgraded before the registry table gained the `localized`
      // column throws on the combined SELECT. Without this retry the outer catch
      // would treat it like a missing table and skip EVERY dynamic entity,
      // hiding existing Builder collections. Retry without `localized` so rows
      // still register (as non-localized). Components never select it.
      if (!hasStatusColumn) throw err;
      rows = await adapter.executeQuery<DynamicTableRow>(
        `SELECT table_name, fields, slug, status FROM ${sourceTable}`
      );
    }

    for (const row of rows) {
      try {
        const fields =
          typeof row.fields === "string" ? JSON.parse(row.fields) : row.fields;

        if (!Array.isArray(fields)) continue;

        // Coerce dialect-specific representations into a JS boolean.
        // sqlite returns 0/1, postgres returns booleans, mysql may return
        // 0/1 as numbers — same dance as the registry deserializer.
        const hasStatus = row.status === 1 || row.status === true;
        const localized = row.localized === 1 || row.localized === true;
        await register(row.table_name, fields, hasStatus, localized);
      } catch {
        // Skip individual row if schema generation fails.
      }
    }
  } catch {
    // Dynamic table may not exist yet (fresh database).
  }
}

/** Slug sets for the dynamic (Builder/UI + previously-synced) entities. */
export interface DynamicSlugSets {
  /** All dynamic entity slugs (collections + singles + components) — valid extend targets. */
  all: Set<string>;
  /** Dynamic collection slugs only — valid `relationTo` targets. */
  collections: Set<string>;
}

/**
 * Read the slugs of every dynamic collection/single/component from the DB
 * registry tables. Used at boot (P8) to resolve plugin `extend`/relation targets
 * that point at Builder-made entities — which the fold deferred because they
 * aren't code/plugin entities and aren't knowable until the DB is reachable.
 * Best-effort: a missing table (fresh DB) yields empty sets.
 */
export async function loadDynamicSlugs(
  adapter: DrizzleAdapter
): Promise<DynamicSlugSets> {
  const all = new Set<string>();
  const collections = new Set<string>();
  const read = async (
    table: "dynamic_collections" | "dynamic_singles" | "dynamic_components",
    into?: Set<string>
  ): Promise<void> => {
    try {
      const rows = await adapter.executeQuery<{ slug: string }>(
        `SELECT slug FROM ${table}`
      );
      for (const row of rows) {
        if (typeof row.slug === "string") {
          all.add(row.slug);
          into?.add(row.slug);
        }
      }
    } catch {
      // Table may not exist yet (fresh database) — leave the sets as-is.
    }
  };
  await read("dynamic_collections", collections);
  await read("dynamic_singles");
  await read("dynamic_components");
  return { all, collections };
}

/** A Builder entity loaded with everything the boot reconciler needs. */
export interface LoadedBuilderEntity {
  slug: string;
  tableName: string;
  /** Parsed `fields` JSON (user fields + any previously-persisted plugin fields). */
  fields: FieldConfig[];
  /** Draft/Published flag (collections/singles; always false for components). */
  status: boolean;
}

export interface LoadedBuilderEntities {
  collections: LoadedBuilderEntity[];
  singles: LoadedBuilderEntity[];
  components: LoadedBuilderEntity[];
}

/**
 * Load full Builder entities (slug + physical table name + parsed fields +
 * status) from the three `dynamic_*` registry tables. Used by the boot
 * reconciler (P8) to merge + materialize plugin contributions onto UI-Builder
 * entities. Best-effort: a missing table (fresh DB) yields an empty array, and
 * a row whose `fields` JSON is unparseable is skipped — same resilience as
 * {@link loadDynamicTables}.
 */
export async function loadBuilderEntities(
  adapter: DrizzleAdapter
): Promise<LoadedBuilderEntities> {
  const read = async (
    table: "dynamic_collections" | "dynamic_singles" | "dynamic_components",
    hasStatusColumn: boolean
  ): Promise<LoadedBuilderEntity[]> => {
    const selectSql = hasStatusColumn
      ? `SELECT slug, table_name, fields, status FROM ${table}`
      : `SELECT slug, table_name, fields FROM ${table}`;
    try {
      const rows = await adapter.executeQuery<DynamicTableRow>(selectSql);
      const out: LoadedBuilderEntity[] = [];
      for (const row of rows) {
        try {
          const fields =
            typeof row.fields === "string"
              ? JSON.parse(row.fields)
              : row.fields;
          if (!Array.isArray(fields)) continue;
          out.push({
            slug: row.slug,
            tableName: row.table_name,
            fields,
            // Same dialect-boolean coercion as loadDynamicTables.
            status: row.status === 1 || row.status === true,
          });
        } catch {
          // Skip a row whose fields JSON is malformed.
        }
      }
      return out;
    } catch {
      // Table may not exist yet (fresh database).
      return [];
    }
  };

  return {
    collections: await read("dynamic_collections", true),
    singles: await read("dynamic_singles", true),
    components: await read("dynamic_components", false),
  };
}
