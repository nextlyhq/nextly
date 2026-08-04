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
import {
  isFieldGroupRegistry,
  resolveFieldGroupRegistryName,
  type FieldGroupRegistryName,
} from "../domains/field-groups/storage/resolve-storage-names";
import { isCodeOwned } from "../domains/schema/pipeline/registered-collections";

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
  /**
   * Ownership, as the registry recorded it. These tables hold code-first and plugin-owned rows
   * alongside Builder-made ones, and the two are built by different creators that size a text
   * column differently — so a caller describing a column has to be able to tell them apart.
   */
  source?: string | null;
  locked?: boolean | number | null;
};

/**
 * Read every row of `sourceTable` and call `register` for each. The
 * callback decides how to translate the row into a runtime Drizzle table
 * (Collections / Singles use `generateRuntimeSchema`; Components use
 * `FieldGroupSchemaService.generateRuntimeSchema`).
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
  sourceTable:
    | "dynamic_collections"
    | "dynamic_singles"
    | FieldGroupRegistryName,
  register: (
    tableName: string,
    fields: unknown[],
    hasStatus: boolean,
    localized: boolean,
    /**
     * Whether the Schema Builder owns this row, rather than code or a plugin. Passed because a
     * caller that emits DDL has to describe a column the way its creator built it, and these
     * tables hold both kinds. `undefined` where the registry is too old to say.
     */
    builderOwned: boolean | undefined
  ) => Promise<void>
): Promise<void> {
  // Components have no `status` column (they're not Draft/Published) — selecting it
  // would fail. They DO carry `localized` (i18n). Collections/singles carry both.
  // Asked under both registry spellings: the storage migration renames this
  // table, and comparing against the legacy name alone would add `status` to the
  // select the moment it has run.
  const statusCol = isFieldGroupRegistry(sourceTable) ? "" : ", status";

  // Tried in order, each step giving up exactly one optional column, so a database that predates
  // any of them still registers its tables instead of the missing column disabling every dynamic
  // table app-wide. Ownership goes first because it is the newest and the least costly to lose:
  // without it a caller falls back to describing a column as the pipeline would.
  const candidateSelects = [
    `SELECT table_name, fields, slug${statusCol}, localized, source, locked FROM ${sourceTable}`,
    `SELECT table_name, fields, slug${statusCol}, localized FROM ${sourceTable}`,
    `SELECT table_name, fields, slug${statusCol} FROM ${sourceTable}`,
  ];

  const readRows = async (): Promise<DynamicTableRow[]> => {
    let lastError: unknown;
    for (const sql of candidateSelects) {
      try {
        return await adapter.executeQuery<DynamicTableRow>(sql);
      } catch (err) {
        // Only a MISSING column may step down. A transient, permission, or genuinely-missing-table
        // error must propagate (to the outer catch) instead of being converted into a registration
        // with the wrong runtime schema for the table.
        const msg = err instanceof Error ? err.message : String(err);
        if (
          !/localized|source|locked|no such column|does not exist|unknown column/i.test(
            msg
          )
        ) {
          throw err;
        }
        lastError = err;
      }
    }
    throw lastError;
  };

  try {
    const rows = await readRows();

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
        // `undefined` when the registry could not report ownership at all, which is different from
        // reporting "not the Builder": the caller treats the unknown case as the pipeline's, the
        // same reading every code-first table already gets.
        const builderOwned =
          row.source === undefined && row.locked === undefined
            ? undefined
            : !isCodeOwned({
                source: row.source ?? undefined,
                locked: row.locked === 1 || row.locked === true,
              });
        await register(
          row.table_name,
          fields,
          hasStatus,
          localized,
          builderOwned
        );
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
    table: "dynamic_collections" | "dynamic_singles" | FieldGroupRegistryName,
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
  try {
    await read(await resolveFieldGroupRegistryName(adapter));
  } catch {
    // Same contract as `read` itself: a catalog probe that cannot answer leaves
    // the sets as they are rather than failing the boot that called it.
  }
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
    table: "dynamic_collections" | "dynamic_singles" | FieldGroupRegistryName,
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

  // The registry NAME is resolved inside the same best-effort boundary as the
  // read it feeds. Resolving outside it turns a transient catalog failure — a
  // `listTables` blip, or a denied `lower_case_table_names` query on MySQL —
  // into a rejection that aborts service registration, where this helper's
  // whole contract is to answer with an empty list instead.
  const readComponents = async (): Promise<LoadedBuilderEntity[]> => {
    try {
      return await read(await resolveFieldGroupRegistryName(adapter), false);
    } catch {
      return [];
    }
  };

  return {
    collections: await read("dynamic_collections", true),
    singles: await read("dynamic_singles", true),
    components: await readComponents(),
  };
}
