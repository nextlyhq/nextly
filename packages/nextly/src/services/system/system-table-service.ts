/**
 * System Table Service
 *
 * Manages Nextly's internal system tables (`dynamic_collections`, `nextly_migrations`)
 * across all database dialects. Provides automatic table creation in development mode
 * and migration template generation for production deployments.
 *
 * ## Behavior by Environment
 *
 * - **Development Mode**: Auto-creates system tables if they don't exist
 * - **Production Mode**: Requires explicit migration via CLI commands
 *
 * ## Supported Dialects
 *
 * - PostgreSQL: Uses native UUID, JSONB, TIMESTAMP types
 * - MySQL: Uses VARCHAR(36) for UUIDs, JSON, DATETIME types
 * - SQLite: Uses TEXT for UUIDs and JSON, INTEGER for timestamps
 *
 * @module services/system/system-table-service
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import { SystemTableService } from '@nextly/services/system';
 * import { createAdapter } from '@revnixhq/adapter-drizzle';
 *
 * const adapter = await createAdapter({ dialect: 'postgresql', url: '...' });
 * const systemTableService = new SystemTableService(adapter, console);
 *
 * // Development: Auto-create system tables
 * await systemTableService.ensureSystemTables();
 *
 * // Production: Generate migration SQL
 * const sql = systemTableService.generateMigrationSQL();
 * ```
 */

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import type { SupportedDialect } from "@revnixhq/adapter-drizzle/types";

import { BaseService } from "../base-service";
import type { Logger } from "../shared";

/**
 * Result of system table check operation.
 */
export interface SystemTableStatus {
  /** Whether dynamic_collections table exists */
  dynamicCollectionsExists: boolean;
  /** Whether dynamic_components table exists */
  dynamicComponentsExists: boolean;
  /** Whether nextly_migrations table exists */
  nextlyMigrationsExists: boolean;
  /** Whether all system tables are ready */
  allReady: boolean;
}

/**
 * Result of system table initialization.
 */
export interface SystemTableInitResult {
  /** Tables that were created */
  created: string[];
  /** Tables that already existed */
  existing: string[];
  /** Whether initialization was successful */
  success: boolean;
  /** Error message if initialization failed */
  error?: string;
}

/**
 * Migration SQL for system tables.
 */
export interface SystemMigrationSQL {
  /** SQL to create/update system tables (UP migration) */
  up: string;
  /** SQL to drop system tables (DOWN migration) */
  down: string;
  /** Database dialect this SQL is for */
  dialect: SupportedDialect;
}

const POSTGRES_SQL = {
  checkTable: `
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name = $1
    ) AS exists
  `,

  createDynamicCollections: `
    CREATE TABLE IF NOT EXISTS "dynamic_collections" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "slug" VARCHAR(255) NOT NULL UNIQUE,
      "labels" JSONB NOT NULL,
      "table_name" VARCHAR(255) NOT NULL UNIQUE,
      "description" TEXT,
      "fields" JSONB NOT NULL,
      "timestamps" BOOLEAN NOT NULL DEFAULT true,
      "admin" JSONB,
      "source" VARCHAR(20) NOT NULL DEFAULT 'ui',
      "locked" BOOLEAN NOT NULL DEFAULT false,
      "config_path" VARCHAR(500),
      "schema_hash" VARCHAR(64) NOT NULL,
      "schema_version" INTEGER NOT NULL DEFAULT 1,
      "migration_status" VARCHAR(20) NOT NULL DEFAULT 'pending',
      "last_migration_id" UUID,
      "created_by" UUID,
      "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
      "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS "dynamic_collections_source_idx" ON "dynamic_collections" ("source");
    CREATE INDEX IF NOT EXISTS "dynamic_collections_migration_status_idx" ON "dynamic_collections" ("migration_status");
    CREATE INDEX IF NOT EXISTS "dynamic_collections_created_by_idx" ON "dynamic_collections" ("created_by");
    CREATE INDEX IF NOT EXISTS "dynamic_collections_created_at_idx" ON "dynamic_collections" ("created_at");
    CREATE INDEX IF NOT EXISTS "dynamic_collections_updated_at_idx" ON "dynamic_collections" ("updated_at");
  `,

  createNextlyMigrations: `
    CREATE TABLE IF NOT EXISTS "nextly_migrations" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "name" VARCHAR(255) NOT NULL UNIQUE,
      "batch" INTEGER NOT NULL,
      "checksum" VARCHAR(64) NOT NULL,
      "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
      "error_message" TEXT,
      "executed_at" TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS "nextly_migrations_batch_idx" ON "nextly_migrations" ("batch");
    CREATE INDEX IF NOT EXISTS "nextly_migrations_status_idx" ON "nextly_migrations" ("status");
    CREATE INDEX IF NOT EXISTS "nextly_migrations_executed_at_idx" ON "nextly_migrations" ("executed_at");
  `,

  createDynamicComponents: `
    CREATE TABLE IF NOT EXISTS "dynamic_components" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "slug" VARCHAR(255) NOT NULL UNIQUE,
      "label" VARCHAR(255) NOT NULL,
      "table_name" VARCHAR(255) NOT NULL UNIQUE,
      "description" TEXT,
      "fields" JSONB NOT NULL,
      "admin" JSONB,
      "source" VARCHAR(20) NOT NULL DEFAULT 'ui',
      "locked" BOOLEAN NOT NULL DEFAULT false,
      "config_path" VARCHAR(500),
      "schema_hash" VARCHAR(64) NOT NULL,
      "schema_version" INTEGER NOT NULL DEFAULT 1,
      "migration_status" VARCHAR(20) NOT NULL DEFAULT 'pending',
      "last_migration_id" UUID,
      "created_by" UUID,
      "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
      "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS "dynamic_components_source_idx" ON "dynamic_components" ("source");
    CREATE INDEX IF NOT EXISTS "dynamic_components_migration_status_idx" ON "dynamic_components" ("migration_status");
    CREATE INDEX IF NOT EXISTS "dynamic_components_created_by_idx" ON "dynamic_components" ("created_by");
    CREATE INDEX IF NOT EXISTS "dynamic_components_created_at_idx" ON "dynamic_components" ("created_at");
    CREATE INDEX IF NOT EXISTS "dynamic_components_updated_at_idx" ON "dynamic_components" ("updated_at");
  `,

  dropDynamicCollections: `
    DROP TABLE IF EXISTS "dynamic_collections" CASCADE;
  `,

  dropDynamicComponents: `
    DROP TABLE IF EXISTS "dynamic_components" CASCADE;
  `,

  dropNextlyMigrations: `
    DROP TABLE IF EXISTS "nextly_migrations" CASCADE;
  `,
};

const MYSQL_SQL = {
  checkTable: `
    SELECT COUNT(*) AS count
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
    AND table_name = ?
  `,

  createDynamicCollections: `
    CREATE TABLE IF NOT EXISTS \`dynamic_collections\` (
      \`id\` VARCHAR(36) PRIMARY KEY,
      \`slug\` VARCHAR(255) NOT NULL UNIQUE,
      \`labels\` JSON NOT NULL,
      \`table_name\` VARCHAR(255) NOT NULL UNIQUE,
      \`description\` TEXT,
      \`fields\` JSON NOT NULL,
      \`timestamps\` BOOLEAN NOT NULL DEFAULT true,
      \`admin\` JSON,
      \`source\` VARCHAR(20) NOT NULL DEFAULT 'ui',
      \`locked\` BOOLEAN NOT NULL DEFAULT false,
      \`config_path\` VARCHAR(500),
      \`schema_hash\` VARCHAR(64) NOT NULL,
      \`schema_version\` INTEGER NOT NULL DEFAULT 1,
      \`migration_status\` VARCHAR(20) NOT NULL DEFAULT 'pending',
      \`last_migration_id\` VARCHAR(36),
      \`created_by\` VARCHAR(36),
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX \`dynamic_collections_source_idx\` (\`source\`),
      INDEX \`dynamic_collections_migration_status_idx\` (\`migration_status\`),
      INDEX \`dynamic_collections_created_by_idx\` (\`created_by\`),
      INDEX \`dynamic_collections_created_at_idx\` (\`created_at\`),
      INDEX \`dynamic_collections_updated_at_idx\` (\`updated_at\`)
    );
  `,

  createNextlyMigrations: `
    CREATE TABLE IF NOT EXISTS \`nextly_migrations\` (
      \`id\` VARCHAR(36) PRIMARY KEY,
      \`name\` VARCHAR(255) NOT NULL UNIQUE,
      \`batch\` INTEGER NOT NULL,
      \`checksum\` VARCHAR(64) NOT NULL,
      \`status\` VARCHAR(20) NOT NULL DEFAULT 'pending',
      \`error_message\` TEXT,
      \`executed_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX \`nextly_migrations_batch_idx\` (\`batch\`),
      INDEX \`nextly_migrations_status_idx\` (\`status\`),
      INDEX \`nextly_migrations_executed_at_idx\` (\`executed_at\`)
    );
  `,

  createDynamicComponents: `
    CREATE TABLE IF NOT EXISTS \`dynamic_components\` (
      \`id\` VARCHAR(36) PRIMARY KEY,
      \`slug\` VARCHAR(255) NOT NULL UNIQUE,
      \`label\` VARCHAR(255) NOT NULL,
      \`table_name\` VARCHAR(255) NOT NULL UNIQUE,
      \`description\` TEXT,
      \`fields\` JSON NOT NULL,
      \`admin\` JSON,
      \`source\` VARCHAR(20) NOT NULL DEFAULT 'ui',
      \`locked\` BOOLEAN NOT NULL DEFAULT false,
      \`config_path\` VARCHAR(500),
      \`schema_hash\` VARCHAR(64) NOT NULL,
      \`schema_version\` INTEGER NOT NULL DEFAULT 1,
      \`migration_status\` VARCHAR(20) NOT NULL DEFAULT 'pending',
      \`last_migration_id\` VARCHAR(36),
      \`created_by\` VARCHAR(36),
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX \`dynamic_components_source_idx\` (\`source\`),
      INDEX \`dynamic_components_migration_status_idx\` (\`migration_status\`),
      INDEX \`dynamic_components_created_by_idx\` (\`created_by\`),
      INDEX \`dynamic_components_created_at_idx\` (\`created_at\`),
      INDEX \`dynamic_components_updated_at_idx\` (\`updated_at\`)
    );
  `,

  dropDynamicCollections: `
    DROP TABLE IF EXISTS \`dynamic_collections\`;
  `,

  dropDynamicComponents: `
    DROP TABLE IF EXISTS \`dynamic_components\`;
  `,

  dropNextlyMigrations: `
    DROP TABLE IF EXISTS \`nextly_migrations\`;
  `,
};

const SQLITE_SQL = {
  checkTable: `
    SELECT COUNT(*) AS count
    FROM sqlite_master
    WHERE type = 'table'
    AND name = ?
  `,

  createDynamicCollections: `
    CREATE TABLE IF NOT EXISTS "dynamic_collections" (
      "id" TEXT PRIMARY KEY,
      "slug" TEXT NOT NULL UNIQUE,
      "labels" TEXT NOT NULL,
      "table_name" TEXT NOT NULL UNIQUE,
      "description" TEXT,
      "fields" TEXT NOT NULL,
      "timestamps" INTEGER NOT NULL DEFAULT 1,
      "admin" TEXT,
      "source" TEXT NOT NULL DEFAULT 'ui',
      "locked" INTEGER NOT NULL DEFAULT 0,
      "config_path" TEXT,
      "schema_hash" TEXT NOT NULL,
      "schema_version" INTEGER NOT NULL DEFAULT 1,
      "migration_status" TEXT NOT NULL DEFAULT 'pending',
      "last_migration_id" TEXT,
      "access_rules" TEXT,
      "hooks" TEXT,
      "created_by" TEXT,
      "created_at" INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      "updated_at" INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    );

    CREATE INDEX IF NOT EXISTS "dynamic_collections_source_idx" ON "dynamic_collections" ("source");
    CREATE INDEX IF NOT EXISTS "dynamic_collections_migration_status_idx" ON "dynamic_collections" ("migration_status");
    CREATE INDEX IF NOT EXISTS "dynamic_collections_created_by_idx" ON "dynamic_collections" ("created_by");
    CREATE INDEX IF NOT EXISTS "dynamic_collections_created_at_idx" ON "dynamic_collections" ("created_at");
    CREATE INDEX IF NOT EXISTS "dynamic_collections_updated_at_idx" ON "dynamic_collections" ("updated_at");
  `,

  createNextlyMigrations: `
    CREATE TABLE IF NOT EXISTS "nextly_migrations" (
      "id" TEXT PRIMARY KEY,
      "name" TEXT NOT NULL UNIQUE,
      "batch" INTEGER NOT NULL,
      "checksum" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'pending',
      "error_message" TEXT,
      "executed_at" INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    );

    CREATE INDEX IF NOT EXISTS "nextly_migrations_batch_idx" ON "nextly_migrations" ("batch");
    CREATE INDEX IF NOT EXISTS "nextly_migrations_status_idx" ON "nextly_migrations" ("status");
    CREATE INDEX IF NOT EXISTS "nextly_migrations_executed_at_idx" ON "nextly_migrations" ("executed_at");
  `,

  createDynamicComponents: `
    CREATE TABLE IF NOT EXISTS "dynamic_components" (
      "id" TEXT PRIMARY KEY,
      "slug" TEXT NOT NULL UNIQUE,
      "label" TEXT NOT NULL,
      "table_name" TEXT NOT NULL UNIQUE,
      "description" TEXT,
      "fields" TEXT NOT NULL,
      "admin" TEXT,
      "source" TEXT NOT NULL DEFAULT 'ui',
      "locked" INTEGER NOT NULL DEFAULT 0,
      "config_path" TEXT,
      "schema_hash" TEXT NOT NULL,
      "schema_version" INTEGER NOT NULL DEFAULT 1,
      "migration_status" TEXT NOT NULL DEFAULT 'pending',
      "last_migration_id" TEXT,
      "created_by" TEXT,
      "created_at" INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      "updated_at" INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    );

    CREATE INDEX IF NOT EXISTS "dynamic_components_source_idx" ON "dynamic_components" ("source");
    CREATE INDEX IF NOT EXISTS "dynamic_components_migration_status_idx" ON "dynamic_components" ("migration_status");
    CREATE INDEX IF NOT EXISTS "dynamic_components_created_by_idx" ON "dynamic_components" ("created_by");
    CREATE INDEX IF NOT EXISTS "dynamic_components_created_at_idx" ON "dynamic_components" ("created_at");
    CREATE INDEX IF NOT EXISTS "dynamic_components_updated_at_idx" ON "dynamic_components" ("updated_at");
  `,

  dropDynamicCollections: `
    DROP TABLE IF EXISTS "dynamic_collections";
  `,

  dropDynamicComponents: `
    DROP TABLE IF EXISTS "dynamic_components";
  `,

  dropNextlyMigrations: `
    DROP TABLE IF EXISTS "nextly_migrations";
  `,
};

/**
 * Service for managing Nextly's internal system tables.
 *
 * Handles automatic creation in development mode and provides
 * migration SQL generation for production deployments.
 *
 * @example
 * ```typescript
 * const service = new SystemTableService(adapter, logger);
 *
 * // Check if system tables exist
 * const status = await service.checkSystemTables();
 * if (!status.allReady) {
 *   await service.ensureSystemTables();
 * }
 * ```
 */
export class SystemTableService extends BaseService {
  constructor(adapter: DrizzleAdapter, logger: Logger) {
    super(adapter, logger);
  }

  /**
   * Check if system tables exist in the database.
   *
   * @returns Status of each system table
   *
   * @example
   * ```typescript
   * const status = await service.checkSystemTables();
   * console.log('Dynamic Collections:', status.dynamicCollectionsExists);
   * console.log('Nextly Migrations:', status.nextlyMigrationsExists);
   * console.log('All Ready:', status.allReady);
   * ```
   */
  async checkSystemTables(): Promise<SystemTableStatus> {
    const dynamicCollectionsExists = await this.tableExists(
      "dynamic_collections"
    );
    const dynamicComponentsExists =
      await this.tableExists("dynamic_components");
    const nextlyMigrationsExists = await this.tableExists("nextly_migrations");

    return {
      dynamicCollectionsExists,
      dynamicComponentsExists,
      nextlyMigrationsExists,
      allReady:
        dynamicCollectionsExists &&
        dynamicComponentsExists &&
        nextlyMigrationsExists,
    };
  }

  /**
   * Ensure system tables exist, creating them if necessary.
   *
   * This method is designed for **development mode** where we want
   * zero-friction setup. For production, use `generateMigrationSQL()`
   * and apply via CLI.
   *
   * @returns Result of initialization
   *
   * @example
   * ```typescript
   * const result = await service.ensureSystemTables();
   * if (result.success) {
   *   console.log('Created tables:', result.created);
   *   console.log('Existing tables:', result.existing);
   * } else {
   *   console.error('Failed:', result.error);
   * }
   * ```
   */
  async ensureSystemTables(): Promise<SystemTableInitResult> {
    const created: string[] = [];
    const existing: string[] = [];

    try {
      const dcExists = await this.tableExists("dynamic_collections");
      if (dcExists) {
        existing.push("dynamic_collections");
        this.logger.info("System table 'dynamic_collections' already exists");
      } else {
        await this.createDynamicCollectionsTable();
        created.push("dynamic_collections");
        this.logger.info("Created system table 'dynamic_collections'");
      }

      const dcompExists = await this.tableExists("dynamic_components");
      if (dcompExists) {
        existing.push("dynamic_components");
        this.logger.info("System table 'dynamic_components' already exists");
      } else {
        await this.createDynamicComponentsTable();
        created.push("dynamic_components");
        this.logger.info("Created system table 'dynamic_components'");
      }

      const nmExists = await this.tableExists("nextly_migrations");
      if (nmExists) {
        existing.push("nextly_migrations");
        this.logger.info("System table 'nextly_migrations' already exists");
      } else {
        await this.createNextlyMigrationsTable();
        created.push("nextly_migrations");
        this.logger.info("Created system table 'nextly_migrations'");
      }

      return { created, existing, success: true };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error("Failed to ensure system tables", {
        error: errorMessage,
      });
      return {
        created,
        existing,
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Generate migration SQL for system tables.
   *
   * Returns UP and DOWN migration SQL for the current dialect.
   * This is used by CLI commands to generate migration files
   * for production deployments.
   *
   * @returns Migration SQL with UP and DOWN statements
   *
   * @example
   * ```typescript
   * const migration = service.generateMigrationSQL();
   * console.log('Dialect:', migration.dialect);
   * console.log('UP SQL:\n', migration.up);
   * console.log('DOWN SQL:\n', migration.down);
   * ```
   */
  generateMigrationSQL(): SystemMigrationSQL {
    const sql = this.getSQLTemplates();

    const up = [
      "-- Create dynamic_collections table",
      sql.createDynamicCollections.trim(),
      "",
      "-- Create dynamic_components table",
      sql.createDynamicComponents.trim(),
      "",
      "-- Create nextly_migrations table",
      sql.createNextlyMigrations.trim(),
    ].join("\n");

    const down = [
      "-- Drop nextly_migrations table",
      sql.dropNextlyMigrations.trim(),
      "",
      "-- Drop dynamic_components table",
      sql.dropDynamicComponents.trim(),
      "",
      "-- Drop dynamic_collections table",
      sql.dropDynamicCollections.trim(),
    ].join("\n");

    return {
      up,
      down,
      dialect: this.dialect,
    };
  }

  /**
   * Drop all system tables.
   *
   * **WARNING**: This is a destructive operation that removes all
   * collection metadata and migration history. Use with extreme caution.
   *
   * @returns Result of drop operation
   *
   * @example
   * ```typescript
   * // Only use in development or testing!
   * if (process.env.NODE_ENV === 'development') {
   *   await service.dropSystemTables();
   * }
   * ```
   */
  async dropSystemTables(): Promise<SystemTableInitResult> {
    const dropped: string[] = [];

    try {
      const sql = this.getSQLTemplates();

      // Drop nextly_migrations first (may have FK references)
      const nmExists = await this.tableExists("nextly_migrations");
      if (nmExists) {
        await this.executeSQL(sql.dropNextlyMigrations);
        dropped.push("nextly_migrations");
        this.logger.info("Dropped system table 'nextly_migrations'");
      }

      const dcompExists = await this.tableExists("dynamic_components");
      if (dcompExists) {
        await this.executeSQL(sql.dropDynamicComponents);
        dropped.push("dynamic_components");
        this.logger.info("Dropped system table 'dynamic_components'");
      }

      const dcExists = await this.tableExists("dynamic_collections");
      if (dcExists) {
        await this.executeSQL(sql.dropDynamicCollections);
        dropped.push("dynamic_collections");
        this.logger.info("Dropped system table 'dynamic_collections'");
      }

      return { created: dropped, existing: [], success: true };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error("Failed to drop system tables", {
        error: errorMessage,
      });
      return {
        created: dropped,
        existing: [],
        success: false,
        error: errorMessage,
      };
    }
  }

  private async tableExists(tableName: string): Promise<boolean> {
    const sql = this.getSQLTemplates();
    const results = await this.adapter.executeQuery<{
      exists?: boolean;
      count?: number;
    }>(sql.checkTable.trim(), [tableName]);

    if (results.length === 0) {
      return false;
    }

    const result = results[0];

    // PostgreSQL returns { exists: true/false }
    if (typeof result.exists === "boolean") {
      return result.exists;
    }

    // MySQL/SQLite return { count: number }
    if (typeof result.count === "number") {
      return result.count > 0;
    }

    return false;
  }

  private async createDynamicCollectionsTable(): Promise<void> {
    const sql = this.getSQLTemplates();
    await this.executeSQL(sql.createDynamicCollections);
  }

  private async createDynamicComponentsTable(): Promise<void> {
    const sql = this.getSQLTemplates();
    await this.executeSQL(sql.createDynamicComponents);
  }

  private async createNextlyMigrationsTable(): Promise<void> {
    const sql = this.getSQLTemplates();
    await this.executeSQL(sql.createNextlyMigrations);
  }

  private async executeSQL(sql: string): Promise<void> {
    const statements = sql
      .split(";")
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith("--"));

    for (const statement of statements) {
      await this.adapter.executeQuery(statement + ";");
    }
  }

  private getSQLTemplates() {
    switch (this.dialect) {
      case "postgresql":
        return POSTGRES_SQL;
      case "mysql":
        return MYSQL_SQL;
      case "sqlite":
        return SQLITE_SQL;
      default:
        throw new Error(`Unsupported dialect: ${this.dialect}`);
    }
  }
}
