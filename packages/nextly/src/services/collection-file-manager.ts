import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { sql } from "drizzle-orm";

import type { CollectionArtifacts } from "../domains/dynamic-collections";
import { generateRuntimeSchema } from "../domains/schema/services/runtime-schema-generator";
import { getNextlyLogger } from "../observability/logger";
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
} | null>;

export class CollectionFileManager {
  private schemasDir: string;
  private migrationsDir: string;
  private db: DatabaseInstance;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private schemaRegistry: Map<string, any> = new Map();
  private adapter?: DrizzleAdapter;
  private metadataFetcher?: CollectionMetadataFetcher;

  // Node require loader (safe in Next.js)
  private requireModule = createRequire(import.meta.url);

  constructor(db: DatabaseInstance, config: FileManagerConfig) {
    this.db = db;
    this.schemasDir = config.schemasDir;
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
    for (const [key, schema] of Object.entries(schemas)) {
      this.schemaRegistry.set(key, schema);
    }
    getNextlyLogger().debug({
      scope: "file-manager",
      msg: "registered schemas",
      keys: Array.from(this.schemaRegistry.keys()),
    });
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

  async saveArtifacts(artifacts: CollectionArtifacts): Promise<void> {
    await fs.mkdir(this.schemasDir, { recursive: true });
    await fs.mkdir(this.migrationsDir, { recursive: true });

    const migrationPath = path.join(
      this.migrationsDir,
      artifacts.migrationFileName
    );
    await fs.writeFile(migrationPath, artifacts.migrationSQL);

    const schemaPath = path.join(this.schemasDir, artifacts.schemaFileName);
    await fs.writeFile(schemaPath, artifacts.schemaCode);

    await this.updateSchemaIndex(artifacts.schemaFileName, artifacts.tableName);
  }

  async saveUpdateArtifacts(
    migrationSQL: string,
    migrationFileName: string,
    schemaCode: string,
    schemaFileName: string
  ): Promise<void> {
    const migrationPath = path.join(this.migrationsDir, migrationFileName);
    await fs.writeFile(migrationPath, migrationSQL);

    const schemaPath = path.join(this.schemasDir, schemaFileName);
    await fs.writeFile(schemaPath, schemaCode);
  }

  async deleteSchemaFile(
    schemaFileName: string,
    tableName: string
  ): Promise<void> {
    const schemaPath = path.join(this.schemasDir, schemaFileName);

    try {
      await fs.unlink(schemaPath);
      await this.removeFromSchemaIndex(schemaFileName, tableName);
    } catch (_error) {
      console.warn(`Could not delete schema file: ${schemaPath}`);
    }
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

  private async updateSchemaIndex(
    fileName: string,
    tableName: string
  ): Promise<void> {
    const indexPath = path.join(this.schemasDir, "index.ts");
    const exportLine = `export { ${tableName} } from './${fileName.replace(".ts", "")}';\n`;

    try {
      const content = await fs.readFile(indexPath, "utf-8");
      if (content.includes(exportLine.trim())) {
        return;
      }
      await fs.appendFile(indexPath, exportLine);
    } catch (_error) {
      // Create index file if it doesn't exist
      await fs.writeFile(indexPath, exportLine);
    }
  }

  private async removeFromSchemaIndex(
    fileName: string,
    tableName: string
  ): Promise<void> {
    const indexPath = path.join(this.schemasDir, "index.ts");
    const exportLine = `export { ${tableName} } from './${fileName.replace(".ts", "")}';`;

    try {
      const content = await fs.readFile(indexPath, "utf-8");
      const filtered = content
        .split("\n")
        .filter(line => !line.includes(exportLine))
        .join("\n");

      await fs.writeFile(indexPath, filtered);
    } catch {
      console.warn(`Could not update index file: ${indexPath}`);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async loadDynamicSchema(collectionName: string): Promise<any> {
    const schemaKey = `dc_${collectionName.replace(/-/g, "_")}`;
    getNextlyLogger().debug({
      scope: "file-manager",
      msg: "loadDynamicSchema",
      collection: collectionName,
      schemaKey,
      registryKeys: Array.from(this.schemaRegistry.keys()),
    });

    // First check registry (for code-first collections with pre-compiled schemas)
    if (this.schemaRegistry.has(schemaKey)) {
      return this.schemaRegistry.get(schemaKey);
    }

    // If not in registry, try to generate a runtime schema for UI collections
    // This allows UI-created collections to work without pre-compiled TypeScript schemas
    if (this.adapter && this.metadataFetcher) {
      try {
        const metadata = await this.metadataFetcher(collectionName);
        if (metadata && metadata.fields) {
          const dialect = this.adapter.dialect;
          const tableName =
            metadata.tableName || `dc_${collectionName.replace(/-/g, "_")}`;

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
          return runtimeSchema.table;
        }
      } catch (error) {
        getNextlyLogger().error({
          scope: "file-manager",
          msg: "failed to generate runtime schema",
          collection: collectionName,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const availableSchemas = Array.from(this.schemaRegistry.keys()).join(", ");
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
   * Hot-reload a schema from disk (development only)
   * Useful after schema updates to avoid app restart
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async reloadSchema(collectionName: string): Promise<void> {
    const schemaFileName = `${collectionName}.ts`;
    const schemaPath = path.resolve(path.join(this.schemasDir, schemaFileName));
    const schemaKey = `dc_${collectionName.replace(/-/g, "_")}`;

    try {
      try {
        const resolved = this.requireModule.resolve(schemaPath);
        delete this.requireModule.cache[resolved];
      } catch (innerError: unknown) {
        console.warn(
          `Failed to clear require cache for schema "${collectionName}"`,
          {
            schemaPath,
            error:
              innerError instanceof Error
                ? innerError.message
                : String(innerError),
            stack: innerError instanceof Error ? innerError.stack : undefined,
          }
        );
      }

      const schemaModule = this.requireModule(schemaPath);
      const schema = schemaModule[schemaKey];

      if (!schema) {
        throw new Error(
          `Schema export "${schemaKey}" not found in ${schemaFileName}`
        );
      }

      this.schemaRegistry.set(schemaKey, schema);

      getNextlyLogger().debug({
        scope: "file-manager",
        msg: "hot-reloaded schema",
        collection: collectionName,
      });
    } catch (error: unknown) {
      console.error(`Failed to reload schema for ${collectionName}`, {
        schemaName: collectionName,
        filePath: schemaPath,
        expectedExport: schemaKey,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });

      throw new Error(
        `Failed to reload schema: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
