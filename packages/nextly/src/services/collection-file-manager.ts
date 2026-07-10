import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { sql } from "drizzle-orm";

import { resolveLocalizedFieldNames } from "../domains/i18n/classify-fields";
import type { LocalizedFieldRef } from "../domains/i18n/companion-join";
import { buildCompanionRuntimeTable } from "../domains/i18n/runtime/companion-registration";
import { toSnakeCase } from "../domains/schema/services/field-column-descriptor";
import { generateRuntimeSchema } from "../domains/schema/services/runtime-schema-generator";
import type { FieldDefinition } from "../schemas/dynamic-collections";
import type { DatabaseInstance } from "../types/database-operations";

export interface FileManagerConfig {
  schemasDir: string;
  migrationsDir: string;
}

/**
 * Function type for fetching collection metadata from the registry service.
 * This allows the FileManager to load collection fields without circular dependencies.
 *
 * Why `status?: boolean`: the runtime schema generator only
 * adds the `status` column when `{ status: true }` is passed in. Without
 * the flag here, UI-created status-enabled collections went through the
 * FileManager fallback path and produced a Drizzle descriptor without a
 * status column — so `select()` left status out of GET responses and the
 * admin's published-edit branch could never fire. The fetcher now reads
 * the column from `dynamic_collections` / `dynamic_singles` and forwards
 * a coerced boolean to FileManager's runtime generation.
 */
export type CollectionMetadataFetcher = (collectionName: string) => Promise<{
  fields: FieldDefinition[];
  tableName: string;
  status?: boolean;
  /**
   * Whether content-localization is enabled for this collection (i18n M4). When true, the
   * companion `<tableName>_locales` table holds the translatable columns and
   * {@link CollectionFileManager.loadCompanionSchema} can build its queryable Drizzle table.
   */
  localized?: boolean;
} | null>;

/** The companion `_locales` runtime schema for a localized collection. */
export interface CompanionSchema {
  /** The queryable Drizzle table object for `<mainTable>_locales`. */
  table: unknown;
  /** Physical companion table name (e.g. `dc_pages_locales`). */
  companionTableName: string;
  /**
   * The collection's translatable fields (they live on the companion). Each carries both the
   * camelCase field name (row key) and the snake_case companion column, because the two differ
   * for camelCase fields (`metaTitle` → `meta_title`).
   */
  localizedFields: LocalizedFieldRef[];
  /** Whether the companion has a per-locale `_status` column (collection has Draft/Published). */
  hasStatus: boolean;
}

export class CollectionFileManager {
  private migrationsDir: string;
  private db: DatabaseInstance;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private schemaRegistry: Map<string, any> = new Map();
  private adapter?: DrizzleAdapter;
  private metadataFetcher?: CollectionMetadataFetcher;

  constructor(db: DatabaseInstance, config: FileManagerConfig) {
    this.db = db;
    this.migrationsDir = config.migrationsDir;
  }

  /**
   * Set the adapter for runtime schema generation.
   * Called during service initialization.
   */
  setAdapter(adapter: DrizzleAdapter): void {
    this.adapter = adapter;
  }

  /**
   * Set the metadata fetcher for loading collection fields from the database.
   * This is used for runtime schema generation for UI collections.
   */
  setMetadataFetcher(fetcher: CollectionMetadataFetcher): void {
    this.metadataFetcher = fetcher;
  }

  registerSchema(collectionName: string, schema: unknown): void {
    this.schemaRegistry.set(`dc_${collectionName.replace(/-/g, "_")}`, schema);
  }

  registerSchemas(schemas: Record<string, unknown>): void {
    console.log(
      "[FileManager] registerSchemas called with keys:",
      Object.keys(schemas)
    );
    Object.entries(schemas).forEach(([key, schema]) => {
      this.schemaRegistry.set(key, schema);
      console.log("[FileManager] Registered schema:", key);
    });
    console.log(
      "[FileManager] Registry now has:",
      Array.from(this.schemaRegistry.keys())
    );
  }

  // Replace the cached runtime Drizzle schema for one collection with a
  // freshly-generated table object. Called after an admin-UI schema apply
  // so that the very next entry-list / entry-get query uses the correct
  // column names without a DB roundtrip or server restart.
  //
  // Replaces the old `invalidateSchema` (delete + lazy rebuild) approach.
  // That approach had a race: the rebuild read `dynamic_collections.fields`
  // from the DB, so if that write was still in flight the rebuild would
  // produce the stale schema again. Pushing the fresh table in directly
  // eliminates the race — the caller already has the correct table object
  // (built from the apply payload's `fields` list).
  refreshSchema(tableName: string, freshTable: unknown): void {
    this.schemaRegistry.set(tableName, freshTable);
  }

  /**
   * Drop the slug-keyed cache entry so the lazy fetcher rebuilds the Drizzle
   * table from current `dynamic_collections` state. See `refreshSchema` for
   * the tableName-keyed variant used when the new table is already built.
   */
  invalidateSchemaForSlug(collectionName: string): void {
    const schemaKey = `dc_${collectionName.replace(/-/g, "_")}`;
    this.schemaRegistry.delete(schemaKey);
  }

  // Persist only the SQL migration for a created/updated collection. The
  // Drizzle `.ts` schema is no longer generated: nothing at runtime imports
  // it (the runtime builds its Drizzle table from `dynamic_collections`
  // metadata via generateRuntimeSchema), so writing it produced orphan files
  // that drift from the database. This matches how singles and components
  // already work — they persist no schema file at all, only run their DDL.
  async saveMigration(
    migrationSQL: string,
    migrationFileName: string
  ): Promise<void> {
    await fs.mkdir(this.migrationsDir, { recursive: true });
    const migrationPath = path.join(this.migrationsDir, migrationFileName);
    await fs.writeFile(migrationPath, migrationSQL);
  }

  async saveDropMigration(
    migrationSQL: string,
    migrationFileName: string
  ): Promise<void> {
    await fs.mkdir(this.migrationsDir, { recursive: true });
    const migrationPath = path.join(this.migrationsDir, migrationFileName);
    await fs.writeFile(migrationPath, migrationSQL);
  }

  async runMigration(migrationSQL: string): Promise<void> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dbInstance = this.db as any;

      // The "--> statement-breakpoint" is used as a separator in Drizzle migrations
      const statements = migrationSQL
        .split("--> statement-breakpoint")
        .map(s => s.trim())
        .filter(s => s.length > 0);

      for (const statement of statements) {
        const cleanStatement = statement
          .split("\n")
          .filter(line => !line.trim().startsWith("--"))
          .join("\n")
          .trim();

        if (!cleanStatement) continue;

        // Check if this is a SQLite database (drizzle better-sqlite3 exposes $client)
        // $client is the underlying better-sqlite3 Database instance
        if (
          dbInstance.$client &&
          typeof dbInstance.$client.exec === "function"
        ) {
          // SQLite (better-sqlite3) - use $client.exec() for DDL statements
          // exec() is synchronous and handles raw SQL directly
          dbInstance.$client.exec(cleanStatement);
        } else if (typeof dbInstance.execute === "function") {
          // PostgreSQL/MySQL - async with sql.raw()
          await dbInstance.execute(sql.raw(cleanStatement));
        } else {
          throw new Error(
            "Database instance does not support execute or $client.exec methods"
          );
        }
      }
    } catch (error: unknown) {
      throw new Error(
        `Migration failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async loadDynamicSchema(collectionName: string): Promise<any> {
    const schemaKey = `dc_${collectionName.replace(/-/g, "_")}`;
    console.log(
      "[FileManager] loadDynamicSchema called for:",
      collectionName,
      "looking for key:",
      schemaKey
    );
    console.log(
      "[FileManager] Registry keys:",
      Array.from(this.schemaRegistry.keys())
    );

    // First check registry (for code-first collections with pre-compiled schemas)
    if (this.schemaRegistry.has(schemaKey)) {
      console.log("[FileManager] Found schema in registry");
      return this.schemaRegistry.get(schemaKey);
    }

    // If not in registry, try to generate a runtime schema for UI collections
    // This allows UI-created collections to work without pre-compiled TypeScript schemas
    if (this.adapter && this.metadataFetcher) {
      console.log(
        "[FileManager] Schema not in registry, attempting runtime generation..."
      );

      try {
        const metadata = await this.metadataFetcher(collectionName);
        if (metadata && metadata.fields) {
          const dialect = this.adapter.dialect;
          const tableName =
            metadata.tableName || `dc_${collectionName.replace(/-/g, "_")}`;

          console.log(
            "[FileManager] Generating runtime schema for:",
            collectionName,
            "dialect:",
            dialect,
            "tableName:",
            tableName
          );

          const runtimeSchema = generateRuntimeSchema(
            tableName,
            metadata.fields,
            dialect,
            // Why: forward the Draft/Published flag so the generated
            // descriptor includes the `status` column when the
            // collection / single has the lifecycle enabled. Boot path
            // in di/register.ts already does this; FileManager's lazy
            // fallback used to drop the option silently.
            { status: metadata.status === true }
          );

          this.schemaRegistry.set(schemaKey, runtimeSchema.table);
          console.log("[FileManager] Runtime schema generated and cached");

          return runtimeSchema.table;
        }
      } catch (error) {
        console.error(
          "[FileManager] Failed to generate runtime schema:",
          error
        );
      }
    }

    const availableSchemas = Array.from(this.schemaRegistry.keys()).join(", ");
    console.log("[FileManager] Schema NOT found! Available:", availableSchemas);
    // Most common cause when "Available: none" is that getNextly() was
    // called without `{ config: nextlyConfig }`. The cached singleton
    // then bootstraps with an empty collections list, no rows land in
    // dynamic_collections, and runtime schema generation can't find
    // metadata for any code-first collection. The fix is to forward
    // the config — see templates/blog/src/lib/nextly.ts for the
    // canonical project-local wrapper pattern. Fix-up note added in
    const noneRegistered = availableSchemas.length === 0;
    const guidance = noneRegistered
      ? `Available schemas: none. The collections registry is empty — most likely getNextly() was called without { config: nextlyConfig } and the cached singleton bootstrapped without your code-first collections. Fix: import nextly.config and pass it through, e.g. \`getNextly({ config: nextlyConfig })\`, or use a project-local wrapper at src/lib/nextly.ts.`
      : `Available schemas: ${availableSchemas}. Did you spell the collection slug right and call registerSchemas() during initialization?`;
    throw new Error(
      `Schema for collection "${collectionName}" not found in registry. ${guidance}`
    );
  }

  /**
   * Load (and cache) the companion `<table>_locales` runtime Drizzle schema for a localized
   * collection (i18n M4). Returns `null` when the collection is not localized / has no localized
   * fields — callers use that to take the unchanged non-localized read path.
   *
   * Built on-demand from the collection's field metadata (mirrors {@link loadDynamicSchema}'s
   * fallback path) so the read path can JOIN the companion without a second table registry.
   * The result is cached under the companion's SQL name so repeated reads reuse one table object.
   */
  async loadCompanionSchema(
    collectionName: string
  ): Promise<CompanionSchema | null> {
    if (!this.adapter || !this.metadataFetcher) return null;
    const metadata = await this.metadataFetcher(collectionName);
    if (!metadata || metadata.localized !== true) return null;

    const tableName =
      metadata.tableName || `dc_${collectionName.replace(/-/g, "_")}`;
    const companionTableName = `${tableName}_locales`;

    const cached = this.schemaRegistry.get(companionTableName);
    // Pair each translatable field's API name (camelCase row key) with its physical companion
    // column (snake_case) — the same conversion the column descriptor applies to main columns.
    const localizedFields: LocalizedFieldRef[] = resolveLocalizedFieldNames(
      metadata.fields,
      true
    ).map(name => ({ name, column: toSnakeCase(name) }));
    if (localizedFields.length === 0) return null;
    const hasStatus = metadata.status === true; // i18n M6: per-locale `_status` column
    if (cached) {
      return { table: cached, companionTableName, localizedFields, hasStatus };
    }

    const companion = buildCompanionRuntimeTable({
      slug: collectionName,
      tableName,
      fields: metadata.fields,
      dialect: this.adapter.dialect,
      localized: true,
      status: hasStatus,
    });
    if (!companion) return null;

    this.schemaRegistry.set(companionTableName, companion.table);
    return {
      table: companion.table,
      companionTableName,
      localizedFields,
      hasStatus,
    };
  }
}
