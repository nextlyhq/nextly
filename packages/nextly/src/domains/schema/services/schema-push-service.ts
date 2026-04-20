/**
 * Schema Push Service
 *
 * Provides development mode auto-sync functionality for collection schemas.
 * This service handles the "push mode" synchronization where schema changes
 * are applied directly to the database without generating migration files.
 *
 * ## How It Works
 *
 * In development mode:
 * 1. Detects collections with pending schema changes (via schema hash comparison)
 * 2. For each collection with changes, drops and recreates the table
 * 3. Updates migration status to 'synced' (no migration file created)
 * 4. Warns user about data loss
 *
 * In production mode:
 * - Auto-sync is disabled
 * - Exits with error if pending migrations exist
 * - Forces proper migration workflow
 *
 * In development, databases are treated as sandboxes and schema changes
 * are auto-applied without migration files.
 *
 * @module services/schema/schema-push-service
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import { SchemaPushService } from '@nextly/services/schema';
 *
 * const pushService = new SchemaPushService(adapter, logger);
 *
 * // Check if auto-sync is allowed
 * if (pushService.isAutoSyncAllowed()) {
 *   const result = await pushService.syncSchema(config, {
 *     force: false, // Show warnings
 *   });
 *
 *   console.log('Synced:', result.synced.length);
 *   console.log('Skipped:', result.skipped.length);
 * }
 * ```
 */

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";

import type { CollectionConfig } from "../../../collections/config/define-collection";
import type { SanitizedNextlyConfig } from "../../../collections/config/define-config";
import type { FieldConfig } from "../../../collections/fields/types";
import type { SchemaRegistry } from "../../../database/schema-registry";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { BaseService } from "../../../shared/base-service";
import type { Logger } from "../../../shared/types";

import {
  DrizzlePushService,
  type PushPreviewResult,
} from "./drizzle-push-service";
import {
  generateRuntimeSchema,
  type SupportedDialect,
} from "./runtime-schema-generator";
import { SchemaGenerator } from "./schema-generator";

/**
 * Convert a camelCase field name to snake_case for database column names.
 * Matches the conversion used in schema-generator.ts and runtime-schema-generator.ts.
 */
function toSnakeCase(name: string): string {
  return name
    .replace(/([A-Z])/g, "_$1")
    .toLowerCase()
    .replace(/^_/, "");
}

// ============================================================
// Types
// ============================================================

/**
 * Options for schema push operation.
 */
export interface SchemaPushOptions {
  /**
   * Force sync without warnings (auto-accept data loss).
   * @default false
   */
  force?: boolean;

  /**
   * Dry run mode - don't apply changes, just report what would be done.
   * @default false
   */
  dryRun?: boolean;

  /**
   * Working directory for resolving paths.
   * @default process.cwd()
   */
  cwd?: string;

  /**
   * Skip tables that already exist instead of dropping and recreating them.
   * When true, only creates tables that don't exist yet (non-destructive).
   * @default false
   */
  skipExistingTables?: boolean;
}

/**
 * Result of a single collection sync.
 */
export interface CollectionSyncInfo {
  /** Collection slug */
  slug: string;

  /** Table name in database */
  tableName: string;

  /** Whether the table existed before sync */
  tableExisted: boolean;

  /** Whether data was lost (table was dropped) */
  dataLoss: boolean;

  /** Any warnings generated */
  warnings: string[];
}

/**
 * Result of the schema push operation.
 */
export interface SchemaPushResult {
  /** Collections that were synced (created or recreated) */
  synced: CollectionSyncInfo[];

  /** Collections that were skipped (no changes or errors) */
  skipped: Array<{
    slug: string;
    reason: string;
  }>;

  /** Collections that failed to sync */
  errors: Array<{
    slug: string;
    error: string;
  }>;

  /** Overall warnings */
  warnings: string[];

  /** Whether any data loss occurred */
  hasDataLoss: boolean;

  /** Duration in milliseconds */
  durationMs: number;
}

/**
 * Environment detection result.
 */
export interface EnvironmentInfo {
  /** Current NODE_ENV value */
  nodeEnv: string | undefined;

  /** Whether running in development mode */
  isDevelopment: boolean;

  /** Whether running in production mode */
  isProduction: boolean;

  /** Whether auto-sync is allowed based on environment */
  autoSyncAllowed: boolean;
}

// ============================================================
// SchemaPushService Class
// ============================================================

/**
 * Schema Push Service for development mode auto-sync.
 *
 * This service implements the "push mode" synchronization pattern. In
 * development, schema changes are
 * applied directly to the database without migration files.
 *
 * @extends BaseService - Provides adapter access and logging
 */
export class SchemaPushService extends BaseService {
  constructor(adapter: DrizzleAdapter, logger: Logger) {
    super(adapter, logger);
  }

  // ============================================================
  // Public API
  // ============================================================

  /**
   * Get current environment information.
   *
   * @returns Environment details including NODE_ENV and auto-sync allowance
   */
  getEnvironment(): EnvironmentInfo {
    const nodeEnv = process.env.NODE_ENV;
    const isDevelopment =
      nodeEnv === "development" || nodeEnv === undefined || !nodeEnv;
    const isProduction = nodeEnv === "production";

    return {
      nodeEnv,
      isDevelopment,
      isProduction,
      autoSyncAllowed: isDevelopment && !isProduction,
    };
  }

  /**
   * Check if auto-sync is allowed in the current environment.
   *
   * Auto-sync is only allowed in development mode (NODE_ENV !== 'production').
   *
   * @returns True if auto-sync is allowed
   */
  isAutoSyncAllowed(): boolean {
    return this.getEnvironment().autoSyncAllowed;
  }

  /**
   * Validate that auto-sync can proceed in the current environment.
   *
   * In production mode, this will throw an error if there are pending
   * schema changes that require migrations.
   *
   * @param hasPendingChanges - Whether there are pending schema changes
   * @throws Error if in production with pending changes
   */
  validateEnvironment(hasPendingChanges: boolean): void {
    const env = this.getEnvironment();

    if (env.isProduction && hasPendingChanges) {
      throw new Error(
        "Cannot auto-sync schema in production mode. " +
          "Pending schema changes require explicit migrations. " +
          "Run `nextly migrate:generate` to create migration files, then `nextly migrate:run` to apply them."
      );
    }
  }

  /**
   * Sync collection schemas to the database.
   *
   * This method:
   * 1. Validates the environment (blocks in production)
   * 2. For each collection with changes, drops and recreates the table
   * 3. Generates and executes CREATE TABLE statements
   * 4. Reports data loss warnings
   *
   * @param config - Nextly configuration with collections
   * @param collectionsToSync - Slugs of collections that need syncing
   * @param options - Sync options
   * @returns Sync result with details
   */
  async syncSchema(
    config: SanitizedNextlyConfig,
    collectionsToSync: string[],
    options: SchemaPushOptions = {}
  ): Promise<SchemaPushResult> {
    const startTime = Date.now();

    const result: SchemaPushResult = {
      synced: [],
      skipped: [],
      errors: [],
      warnings: [],
      hasDataLoss: false,
      durationMs: 0,
    };

    // Skip if nothing to sync
    if (collectionsToSync.length === 0) {
      result.durationMs = Date.now() - startTime;
      return result;
    }

    // Validate environment
    this.validateEnvironment(collectionsToSync.length > 0);

    // Get dialect for schema generation
    const dialect = this.adapter.getCapabilities().dialect as SupportedDialect;

    // Create schema generator
    const schemaGenerator = new SchemaGenerator({ dialect });

    // Filter collections to only those that need syncing
    const collectionsMap = new Map(config.collections.map(c => [c.slug, c]));

    for (const slug of collectionsToSync) {
      const collection = collectionsMap.get(slug);

      if (!collection) {
        result.skipped.push({
          slug,
          reason: "Collection not found in config",
        });
        continue;
      }

      try {
        const syncInfo = await this.syncCollection(
          collection,
          schemaGenerator,
          options
        );
        result.synced.push(syncInfo);

        if (syncInfo.dataLoss) {
          result.hasDataLoss = true;
        }
      } catch (error) {
        result.errors.push({
          slug,
          error: error instanceof Error ? error.message : String(error),
        });
        this.logger.error(`Failed to sync collection: ${slug}`, { error });
      }
    }

    // Add overall warnings
    if (result.hasDataLoss && !options.force) {
      result.warnings.push(
        "Schema sync caused data loss. Use --force to suppress this warning."
      );
    }

    result.durationMs = Date.now() - startTime;

    this.logger.info("Schema push completed", {
      synced: result.synced.length,
      skipped: result.skipped.length,
      errors: result.errors.length,
      hasDataLoss: result.hasDataLoss,
      durationMs: result.durationMs,
    });

    return result;
  }

  /**
   * Sync schemas using drizzle-kit push (Drizzle API path).
   *
   * Instead of building raw SQL per collection, this method:
   * 1. Generates Drizzle table objects for all collections via runtime-schema-generator
   * 2. Registers them in the SchemaRegistry
   * 3. Calls pushSchema() once with all schemas (drizzle-kit diffs everything at once)
   *
   * This replaces the per-table raw SQL approach with a single drizzle-kit push call.
   *
   * @param collections - Collections to sync
   * @param schemaRegistry - SchemaRegistry to register generated table objects
   * @param options - Push options (dryRun for preview)
   * @returns PushPreviewResult with warnings and applied status
   */
  async syncSchemaViaDrizzle(
    collections: CollectionConfig[],
    schemaRegistry: SchemaRegistry,
    options: { dryRun?: boolean } = {}
  ): Promise<PushPreviewResult> {
    const dialect = this.adapter.getCapabilities().dialect as SupportedDialect;
    const db = this.adapter.getDrizzle();

    // Generate Drizzle table objects for each collection
    for (const collection of collections) {
      const baseTableName =
        collection.dbName ?? collection.slug.replace(/-/g, "_");
      const tableName = baseTableName.startsWith("dc_")
        ? baseTableName
        : `dc_${baseTableName}`;

      const fields = (collection.fields ?? []) as FieldDefinition[];
      const { table } = generateRuntimeSchema(tableName, fields, dialect);
      schemaRegistry.registerDynamicSchema(tableName, table);
    }

    // Push all schemas at once via drizzle-kit
    const pushService = new DrizzlePushService(dialect, db);
    const allSchemas = schemaRegistry.getAllSchemas();

    if (options.dryRun) {
      return pushService.preview(allSchemas);
    }

    return pushService.apply(allSchemas);
  }

  /**
   * Check which collections have pending schema changes.
   *
   * Uses the registry's getPendingMigrations to identify collections
   * that need schema updates.
   *
   * @param registryService - Registry service instance
   * @returns Array of collection slugs with pending changes
   */
  async getCollectionsWithPendingChanges(
    getPendingMigrations: () => Promise<Array<{ slug: string }>>
  ): Promise<string[]> {
    const pending = await getPendingMigrations();
    return pending.map(c => c.slug);
  }

  // ============================================================
  // Private Methods
  // ============================================================

  /**
   * Sync a single collection's schema.
   */
  private async syncCollection(
    collection: CollectionConfig,
    schemaGenerator: SchemaGenerator,
    options: SchemaPushOptions
  ): Promise<CollectionSyncInfo> {
    // Use dbName if explicitly set, otherwise generate table name with dc_ prefix
    // The dc_ prefix is the standard convention for dynamic collections
    const baseTableName =
      collection.dbName ?? collection.slug.replace(/-/g, "_");
    const tableName = baseTableName.startsWith("dc_")
      ? baseTableName
      : `dc_${baseTableName}`;

    this.logger.debug(`Syncing collection: ${collection.slug}`, { tableName });

    // Check if table exists
    const tableExists = await this.adapter.tableExists(tableName);

    const syncInfo: CollectionSyncInfo = {
      slug: collection.slug,
      tableName,
      tableExisted: tableExists,
      dataLoss: false,
      warnings: [],
    };

    if (options.dryRun) {
      if (tableExists) {
        syncInfo.warnings.push(`Would drop and recreate table: ${tableName}`);
        syncInfo.dataLoss = true;
      } else {
        syncInfo.warnings.push(`Would create table: ${tableName}`);
      }
      return syncInfo;
    }

    // Skip existing tables in non-destructive mode (used by runtime auto-sync)
    if (tableExists && options.skipExistingTables) {
      this.logger.info(
        `Table ${tableName} already exists for collection ${collection.slug}, skipping (non-destructive mode)`
      );
      syncInfo.warnings.push(`Skipped existing table: ${tableName}`);
      return syncInfo;
    }

    // Non-destructive sync: add missing columns to existing tables (default mode)
    // Only drop+recreate when --force is explicitly used
    if (tableExists && !options.force) {
      const addedColumns = await this.addMissingColumns(collection, tableName);
      if (addedColumns.length > 0) {
        this.logger.info(
          `Added missing columns to ${tableName}: ${addedColumns.join(", ")}`
        );
        syncInfo.warnings.push(
          `Added columns to existing table: ${addedColumns.join(", ")}`
        );
      } else {
        this.logger.info(
          `Table ${tableName} already up to date for collection ${collection.slug}`
        );
      }
      return syncInfo;
    }

    // Drop existing table if it exists (--force mode)
    if (tableExists) {
      this.logger.warn(
        `Dropping table ${tableName} for collection ${collection.slug}`
      );
      await this.dropTable(tableName);
      syncInfo.dataLoss = true;
      syncInfo.warnings.push(`Dropped existing table: ${tableName}`);
    }

    // Generate CREATE TABLE statement
    const createSql = this.generateCreateTableSql(
      collection,
      tableName,
      schemaGenerator
    );

    // Execute CREATE TABLE
    await this.adapter.executeQuery(createSql);

    // CRITICAL: Verify table was actually created
    // This prevents returning success when the table creation silently failed
    const tableCreatedSuccessfully = await this.adapter.tableExists(tableName);
    if (!tableCreatedSuccessfully) {
      throw new Error(
        `Table creation SQL executed but table '${tableName}' does not exist. ` +
          `This may indicate a database permission issue or SQL execution failure.`
      );
    }

    this.logger.info(`Created and verified table: ${tableName}`, {
      collection: collection.slug,
    });

    return syncInfo;
  }

  /**
   * Drop a table from the database.
   */
  private async dropTable(tableName: string): Promise<void> {
    const dialect = this.adapter.getCapabilities().dialect;

    // Use appropriate quoting for identifiers
    const quotedName =
      dialect === "mysql" ? `\`${tableName}\`` : `"${tableName}"`;

    const sql = `DROP TABLE IF EXISTS ${quotedName}`;
    await this.adapter.executeQuery(sql);
  }

  /**
   * Generate CREATE TABLE SQL for a collection.
   */
  private generateCreateTableSql(
    collection: CollectionConfig,
    tableName: string,
    _schemaGenerator: SchemaGenerator
  ): string {
    const dialect = this.adapter.getCapabilities().dialect as SupportedDialect;
    const fields = collection.fields as FieldConfig[];
    const timestamps = collection.timestamps !== false;

    // Build column definitions
    const columns: string[] = [];

    // Primary key column
    columns.push(this.getPrimaryKeyColumn(dialect));

    // Title column (standard for all collections, matches runtime-schema-generator.ts)
    // Skip if the collection already defines a title field to avoid duplicate columns
    const hasTitleField = fields.some(f => "name" in f && f.name === "title");
    if (!hasTitleField) {
      columns.push(this.getTitleColumn(dialect));
    }

    // Slug column (standard for all collections, matches runtime-schema-generator.ts)
    // Skip if the collection already defines a slug field to avoid duplicate columns
    const hasSlugField = fields.some(f => "name" in f && f.name === "slug");
    if (!hasSlugField) {
      columns.push(this.getSlugColumn(dialect));
    }

    // Field columns
    for (const field of fields) {
      if ("name" in field && field.name) {
        const columnDef = this.fieldToColumnDef(field, dialect);
        if (columnDef) {
          columns.push(columnDef);
        }
      }
    }

    // Timestamp columns
    if (timestamps) {
      columns.push(...this.getTimestampColumns(dialect));
    }

    // Build CREATE TABLE statement
    const quotedName =
      dialect === "mysql" ? `\`${tableName}\`` : `"${tableName}"`;

    return `CREATE TABLE IF NOT EXISTS ${quotedName} (\n  ${columns.flat().join(",\n  ")}\n)`;
  }

  /**
   * Get primary key column definition.
   */
  private getPrimaryKeyColumn(dialect: string): string {
    switch (dialect) {
      case "postgresql":
        return '"id" UUID PRIMARY KEY DEFAULT gen_random_uuid()';
      case "mysql":
        return "`id` VARCHAR(36) PRIMARY KEY";
      case "sqlite":
        return '"id" TEXT PRIMARY KEY';
      default:
        return '"id" TEXT PRIMARY KEY';
    }
  }

  /**
   * Get title column definition.
   * Standard column for all collections, matches runtime-schema-generator.ts.
   */
  private getTitleColumn(dialect: string): string {
    switch (dialect) {
      case "postgresql":
        return "\"title\" TEXT NOT NULL DEFAULT ''";
      case "mysql":
        return "`title` VARCHAR(255) NOT NULL DEFAULT ''";
      case "sqlite":
        return "\"title\" TEXT NOT NULL DEFAULT ''";
      default:
        return "\"title\" TEXT NOT NULL DEFAULT ''";
    }
  }

  /**
   * Get slug column definition.
   * Standard column for all collections, matches runtime-schema-generator.ts.
   */
  private getSlugColumn(dialect: string): string {
    switch (dialect) {
      case "postgresql":
        return '"slug" VARCHAR(255) NOT NULL';
      case "mysql":
        return "`slug` VARCHAR(255) NOT NULL";
      case "sqlite":
        return '"slug" TEXT NOT NULL';
      default:
        return '"slug" TEXT NOT NULL';
    }
  }

  /**
   * Get timestamp column definitions.
   * Uses snake_case column names to match the Drizzle schema generator.
   */
  private getTimestampColumns(dialect: string): string[] {
    switch (dialect) {
      case "postgresql":
        return [
          '"created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL',
          '"updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL',
        ];
      case "mysql":
        return [
          "`created_at` DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL",
          "`updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL",
        ];
      case "sqlite":
        return [
          "\"created_at\" TEXT DEFAULT (datetime('now')) NOT NULL",
          "\"updated_at\" TEXT DEFAULT (datetime('now')) NOT NULL",
        ];
      default:
        return ['"created_at" TEXT NOT NULL', '"updated_at" TEXT NOT NULL'];
    }
  }

  /**
   * Convert a field config to a column definition.
   */
  private fieldToColumnDef(field: FieldConfig, dialect: string): string | null {
    if (!("name" in field) || !field.name) {
      return null;
    }

    const name = toSnakeCase(field.name as string);
    const required = "required" in field && field.required;
    const quotedName = dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

    let columnType: string;
    let defaultValue: string | null = null;

    switch (field.type) {
      case "text":
      case "email":
      case "code":
      case "textarea":
        columnType = dialect === "mysql" ? "TEXT" : "TEXT";
        break;

      case "number":
        columnType =
          dialect === "postgresql"
            ? "NUMERIC"
            : dialect === "mysql"
              ? "DECIMAL(10,2)"
              : "REAL";
        break;

      case "checkbox":
        columnType =
          dialect === "postgresql"
            ? "BOOLEAN"
            : dialect === "mysql"
              ? "TINYINT(1)"
              : "INTEGER";
        // Check for default value in checkbox field
        const checkboxDefault = (field as { defaultValue?: boolean })
          .defaultValue;
        defaultValue = checkboxDefault === true ? "TRUE" : "FALSE";
        break;

      case "date":
        columnType =
          dialect === "postgresql"
            ? "TIMESTAMP WITH TIME ZONE"
            : dialect === "mysql"
              ? "DATETIME"
              : "TEXT";
        break;

      case "select":
        columnType = "TEXT";
        break;

      case "relationship":
      case "upload": {
        const hasMany = (field as { hasMany?: boolean }).hasMany;
        const relationTo = (field as { relationTo?: unknown }).relationTo;
        if (hasMany || Array.isArray(relationTo)) {
          // hasMany or polymorphic — store as JSON array
          columnType =
            dialect === "postgresql"
              ? "JSONB"
              : dialect === "mysql"
                ? "JSON"
                : "TEXT";
        } else {
          // Single foreign key reference
          columnType = dialect === "postgresql" ? "UUID" : "TEXT";
        }
        break;
      }

      case "richText":
      case "json":
        columnType =
          dialect === "postgresql"
            ? "JSONB"
            : dialect === "mysql"
              ? "JSON"
              : "TEXT";
        break;

      case "repeater":
      case "group":
        // Complex types stored as JSON
        columnType =
          dialect === "postgresql"
            ? "JSONB"
            : dialect === "mysql"
              ? "JSON"
              : "TEXT";
        break;

      default:
        // Unknown type - use TEXT as fallback
        columnType = "TEXT";
    }

    let def = `${quotedName} ${columnType}`;

    if (defaultValue !== null) {
      def += ` DEFAULT ${defaultValue}`;
    }

    if (required) {
      def += " NOT NULL";
    }

    return def;
  }

  /**
   * Get existing column names for a table from the database.
   */
  private async getExistingColumns(tableName: string): Promise<Set<string>> {
    const dialect = this.adapter.getCapabilities().dialect;
    let sql: string;
    const params: (string | number | boolean | null)[] = [];

    switch (dialect) {
      case "postgresql":
        sql = `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`;
        params.push(tableName);
        break;
      case "mysql":
        sql = `SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?`;
        params.push(tableName);
        break;
      case "sqlite":
        sql = `PRAGMA table_info("${tableName}")`;
        break;
      default:
        return new Set();
    }

    const rows = await this.adapter.executeQuery<Record<string, unknown>>(
      sql,
      params
    );

    const columns = new Set<string>();
    for (const row of rows) {
      // SQLite uses 'name', others use 'column_name'
      const col = (row.column_name ?? row.name) as string;
      if (col) columns.add(col);
    }
    return columns;
  }

  /**
   * Get the expected columns for a collection (name → ALTER TABLE ADD COLUMN definition).
   */
  private getExpectedColumns(
    collection: CollectionConfig
  ): Map<string, string> {
    const dialect = this.adapter.getCapabilities().dialect as string;
    const fields = collection.fields as FieldConfig[];
    const timestamps = collection.timestamps !== false;
    const columns = new Map<string, string>();

    // System columns
    columns.set("id", ""); // id always exists from CREATE TABLE

    const hasTitleField = fields.some(f => "name" in f && f.name === "title");
    if (!hasTitleField) {
      columns.set("title", this.getTitleColumn(dialect));
    }

    const hasSlugField = fields.some(f => "name" in f && f.name === "slug");
    if (!hasSlugField) {
      columns.set("slug", this.getSlugColumn(dialect));
    }

    // User-defined fields
    for (const field of fields) {
      if ("name" in field && field.name) {
        const colDef = this.fieldToColumnDef(field, dialect);
        if (colDef) {
          columns.set(toSnakeCase(field.name as string), colDef);
        }
      }
    }

    // Timestamps
    if (timestamps) {
      columns.set("created_at", "");
      columns.set("updated_at", "");
    }

    return columns;
  }

  /**
   * Add missing columns to an existing table via ALTER TABLE.
   * Returns the list of column names that were added.
   */
  private async addMissingColumns(
    collection: CollectionConfig,
    tableName: string
  ): Promise<string[]> {
    const expectedColumns = this.getExpectedColumns(collection);
    return this.addMissingColumnsFromMap(tableName, expectedColumns);
  }

  /**
   * Add missing columns to an existing table from a field config array.
   *
   * This is used by singles and components auto-sync to add new columns
   * to existing tables without recreating them.
   *
   * @param tableName - Target table name
   * @param fields - Field configurations to sync
   * @param options - Optional settings (e.g. whether to include timestamp columns)
   * @returns List of column names that were added
   */
  async addMissingColumnsForFields(
    tableName: string,
    fields: FieldConfig[],
    options?: { timestamps?: boolean }
  ): Promise<string[]> {
    const dialect = this.adapter.getCapabilities().dialect as string;
    const columns = new Map<string, string>();

    for (const field of fields) {
      if ("name" in field && field.name) {
        const colDef = this.fieldToColumnDef(field, dialect);
        if (colDef) {
          columns.set(toSnakeCase(field.name as string), colDef);
        }
      }
    }

    // Timestamp columns (skip — they're always created with the table)
    if (options?.timestamps !== false) {
      columns.set("created_at", "");
      columns.set("updated_at", "");
    }

    return this.addMissingColumnsFromMap(tableName, columns);
  }

  /**
   * Core column-addition logic shared by collections, singles, and components.
   * Strips NOT NULL from new columns to prevent failures on tables with existing data.
   */
  private async addMissingColumnsFromMap(
    tableName: string,
    expectedColumns: Map<string, string>
  ): Promise<string[]> {
    const dialect = this.adapter.getCapabilities().dialect as string;
    const existingColumns = await this.getExistingColumns(tableName);
    const addedColumns: string[] = [];
    const quotedTable =
      dialect === "mysql" ? `\`${tableName}\`` : `"${tableName}"`;

    for (const [colName, colDef] of expectedColumns) {
      if (!existingColumns.has(colName) && colDef) {
        // Strip NOT NULL when adding to an existing table that may have data.
        // Existing rows would have NULL for the new column, which violates
        // NOT NULL. The application layer (Zod/validation) enforces required
        // fields on new entries; the DB constraint can be added via a migration.
        const safeDef = colDef.replace(/\s+NOT\s+NULL\s*/gi, " ");
        const sql = `ALTER TABLE ${quotedTable} ADD COLUMN ${safeDef}`;
        try {
          await this.adapter.executeQuery(sql);
          addedColumns.push(colName);
        } catch (error) {
          this.logger.warn(
            `Failed to add column ${colName} to ${tableName}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    }

    return addedColumns;
  }
}
