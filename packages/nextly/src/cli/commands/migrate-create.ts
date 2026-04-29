/**
 * Migrate Create Command
 *
 * Implements the `nextly migrate:create` command for generating SQL migration
 * files from collection and single schema changes.
 *
 * @module cli/commands/migrate-create
 * @since 1.0.0
 *
 * @example
 * ```bash
 * # Generate migration from pending schema changes
 * nextly migrate:create
 *
 * # Generate migration with custom name
 * nextly migrate:create add_author_to_posts
 *
 * # Create blank migration for custom SQL
 * nextly migrate:create custom_data_migration --blank
 *
 * # Custom config path
 * nextly migrate:create --config ./custom/nextly.config.ts
 * ```
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import type { Command } from "commander";

import type { CollectionConfig } from "../../collections/config/define-collection.js";
import type { FieldConfig } from "../../collections/fields/types/index.js";
import type { ComponentConfig } from "../../components/config/types.js";
import {
  MigrationGenerator,
  type GeneratedMigration,
  type SchemaDiff,
} from "../../domains/schema/services/migration-generator.js";
import type { SupportedDialect } from "../../domains/schema/services/schema-generator.js";
import { resolveSingleTableName } from "../../domains/singles/services/resolve-single-table-name.js";
import type { DynamicCollectionRecord } from "../../schemas/dynamic-collections/types.js";
import { ComponentSchemaService } from "../../services/components/component-schema-service.js";
import { UserExtSchemaService } from "../../services/users/user-ext-schema-service.js";
import {
  toSingularLabel,
  toPluralLabel,
} from "../../shared/lib/pluralization.js";
import type { SingleConfig } from "../../singles/config/types.js";
import { createContext, type CommandContext } from "../program.js";
import {
  createAdapter,
  validateDatabaseEnv,
  getDialectDisplayName,
  type CLIDatabaseAdapter,
} from "../utils/adapter.js";
import { loadConfig, type LoadConfigResult } from "../utils/config-loader.js";
import { formatDuration } from "../utils/logger.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Component record for migration generation.
 * Similar to DynamicCollectionRecord but simplified for components.
 */
interface ComponentRecord {
  slug: string;
  tableName: string;
  fields: FieldConfig[];
  label: string;
}

/**
 * Options specific to the migrate:create command
 */
export interface MigrateCreateCommandOptions {
  /**
   * Create an empty migration file for custom SQL.
   * @default false
   */
  blank?: boolean;
}

/**
 * Combined options (global + command-specific)
 */
interface ResolvedMigrateCreateOptions extends MigrateCreateCommandOptions {
  config?: string;
  verbose?: boolean;
  quiet?: boolean;
  cwd?: string;
}

/**
 * Result of migration creation
 */
interface MigrationCreateResult {
  /** Path to the generated migration file */
  migrationFile: string;
  /** Migration name (without extension) */
  migrationName: string;
  /** Number of collections included in the migration */
  collectionCount: number;
  /** Names of collections included */
  collectionNames: string[];
  /** Number of singles included in the migration */
  singleCount: number;
  /** Names of singles included */
  singleNames: string[];
  /** Number of components included in the migration */
  componentCount: number;
  /** Names of components included */
  componentNames: string[];
  /** Whether user_ext table migration is included */
  hasUserExt: boolean;
  /** Whether this is a blank migration */
  isBlank: boolean;
  /** Database dialect */
  dialect: SupportedDialect;
  /** Duration in milliseconds */
  durationMs: number;
}

// ============================================================================
// Migrate Create Command Implementation
// ============================================================================

/**
 * Execute the migrate:create command
 *
 * @param name - Optional migration name
 * @param options - Combined global and command options
 * @param context - Command context with logger
 */
export async function runMigrateCreate(
  name: string | undefined,
  options: ResolvedMigrateCreateOptions,
  context: CommandContext
): Promise<void> {
  const { logger } = context;
  const startTime = Date.now();

  logger.header("Migrate Create");

  // Step 1: Validate database environment
  logger.debug("Validating database environment...");
  const dbValidation = validateDatabaseEnv();

  if (!dbValidation.valid) {
    for (const error of dbValidation.errors) {
      logger.error(error);
    }
    logger.newline();
    logger.info(
      "Set DATABASE_URL and optionally DB_DIALECT environment variables."
    );
    process.exit(1);
  }

  const dialect = dbValidation.dialect!;
  logger.debug(`Database dialect: ${dialect}`);

  // Step 2: Load configuration
  logger.info("Loading configuration...");

  let configResult: LoadConfigResult;
  try {
    configResult = await loadConfig({
      configPath: options.config,
      cwd: options.cwd,
      debug: options.verbose,
    });
  } catch (error) {
    logger.error(
      `Failed to load config: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }

  if (configResult.configPath) {
    logger.success(`Loaded config from ${configResult.configPath}`);
  } else {
    logger.warn("No config file found, using defaults");
  }

  const collectionCount = configResult.config.collections.length;
  const singleCount = configResult.config.singles?.length ?? 0;
  const componentCount = configResult.config.components?.length ?? 0;
  const userFieldCount = configResult.config.users?.fields?.length ?? 0;
  logger.keyValue("Collections", collectionCount);
  logger.keyValue("Singles", singleCount);
  logger.keyValue("Components", componentCount);
  if (userFieldCount > 0) {
    logger.keyValue("User Fields", userFieldCount);
  }
  logger.keyValue("Dialect", getDialectDisplayName(dialect));

  // Step 3: Handle blank migration
  if (options.blank) {
    logger.newline();
    logger.info("Creating blank migration...");

    try {
      const result = await createBlankMigration(
        name,
        dialect,
        configResult,
        options,
        context
      );

      displayResult(result, context);

      const duration = Date.now() - startTime;
      logger.newline();
      logger.divider();
      logger.success(`Blank migration created in ${formatDuration(duration)}`);
    } catch (error) {
      logger.error(
        `Failed to create migration: ${error instanceof Error ? error.message : String(error)}`
      );
      process.exit(1);
    }

    return;
  }

  // Step 4: Check for collections, singles, components, or user fields
  if (
    collectionCount === 0 &&
    singleCount === 0 &&
    componentCount === 0 &&
    userFieldCount === 0
  ) {
    logger.warn(
      "No collections, singles, components, or user fields defined in config"
    );
    logger.info(
      "Add collections, singles, components, or user fields to your nextly.config.ts to generate migrations."
    );
    logger.newline();
    logger.info("Or use --blank to create an empty migration for custom SQL.");
    return;
  }

  // Step 5: Connect to database (needed to check current schema state)
  logger.newline();
  logger.info(`Connecting to ${getDialectDisplayName(dialect)}...`);

  let adapter: CLIDatabaseAdapter;
  try {
    adapter = await createAdapter({
      dialect: dbValidation.dialect,
      databaseUrl: dbValidation.databaseUrl,
      logger: options.verbose ? logger : undefined,
    });
    logger.success("Database connected");
  } catch (error) {
    logger.error(
      `Failed to connect to database: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }

  try {
    // Step 6: Generate migration from schema changes
    logger.newline();
    logger.info("Analyzing schema changes...");

    const result = await createMigrationFromChanges(
      name,
      dialect,
      configResult,
      adapter,
      options,
      context
    );

    if (!result) {
      logger.newline();
      logger.info("No schema changes detected.");
      logger.info("Use --blank to create an empty migration for custom SQL.");
      return;
    }

    displayResult(result, context);

    const duration = Date.now() - startTime;
    logger.newline();
    logger.divider();
    logger.success(`Migration created in ${formatDuration(duration)}`);
  } finally {
    await adapter.disconnect();
  }
}

// ============================================================================
// Migration Generation
// ============================================================================

/**
 * Create a blank migration file for custom SQL
 */
async function createBlankMigration(
  name: string | undefined,
  dialect: SupportedDialect,
  configResult: LoadConfigResult,
  options: ResolvedMigrateCreateOptions,
  context: CommandContext
): Promise<MigrationCreateResult> {
  const { logger } = context;
  const startTime = Date.now();
  const cwd = options.cwd ?? process.cwd();

  // Generate migration name
  const migrationName = generateMigrationName(name || "custom_migration");

  // Generate blank migration content
  const content = generateBlankMigrationContent(migrationName, dialect);

  // Resolve output path
  const migrationsDir = resolve(cwd, configResult.config.db.migrationsDir);
  const migrationFile = resolve(migrationsDir, `${migrationName}.sql`);

  // Ensure directory exists
  await ensureDir(migrationsDir);

  // Write migration file
  await writeFile(migrationFile, content, "utf-8");
  logger.debug(`Written migration to: ${migrationFile}`);

  return {
    migrationFile,
    migrationName,
    collectionCount: 0,
    collectionNames: [],
    singleCount: 0,
    singleNames: [],
    componentCount: 0,
    componentNames: [],
    hasUserExt: false,
    isBlank: true,
    dialect,
    durationMs: Date.now() - startTime,
  };
}

/**
 * Create migration from detected schema changes
 */
async function createMigrationFromChanges(
  name: string | undefined,
  dialect: SupportedDialect,
  configResult: LoadConfigResult,
  adapter: CLIDatabaseAdapter,
  options: ResolvedMigrateCreateOptions,
  context: CommandContext
): Promise<MigrationCreateResult | null> {
  const { logger } = context;
  const startTime = Date.now();
  const cwd = options.cwd ?? process.cwd();
  const { config } = configResult;

  // Convert collections to records format
  const collections = convertToRecords(config.collections);

  // Convert singles to records format (reusing DynamicCollectionRecord structure)
  const singles = convertToSingleRecords(config.singles ?? []);

  // Convert components to records format
  const components = convertToComponentRecords(config.components ?? []);

  if (
    collections.length === 0 &&
    singles.length === 0 &&
    components.length === 0
  ) {
    return null;
  }

  // Create migration generator
  const generator = new MigrationGenerator({
    dialect,
    includeForeignKeys: true,
    includeIndexes: true,
  });

  // Scan existing migration files to find which slugs already have migration coverage.
  // This ensures we generate migrations for plugin collections (e.g., forms, form-submissions)
  // even if their tables already exist in the database (created by auto-sync during `nextly dev`).
  const migrationsDir = resolve(cwd, config.db.migrationsDir);
  const migrated = await getMigratedSlugs(migrationsDir);

  const diffs: SchemaDiff[] = [];
  const newCollections: DynamicCollectionRecord[] = [];
  const newSingles: DynamicCollectionRecord[] = [];
  const newComponents: ComponentRecord[] = [];

  // Check collections - generate migration if no existing migration file covers this collection
  for (const collection of collections) {
    if (migrated.collections.has(collection.slug)) {
      // Migration file already exists for this collection
      logger.debug(`Migration exists, skipping: ${collection.slug}`);
      continue;
    }

    // No migration file covers this collection - generate one
    diffs.push({
      collectionSlug: collection.slug,
      tableName: collection.tableName,
      isNew: true,
      isDeleted: false,
      changes: [{ type: "create_table", tableName: collection.tableName }],
      description: `Create table ${collection.tableName}`,
    });
    newCollections.push(collection);

    const tableExists = await checkTableExists(
      adapter as unknown as DrizzleAdapter,
      collection.tableName
    );
    if (tableExists) {
      logger.debug(
        `Collection needs migration (table exists, no migration file): ${collection.slug}`
      );
    } else {
      logger.debug(`New collection detected: ${collection.slug}`);
    }
  }

  // Check singles - generate migration if no existing migration file covers this single
  for (const single of singles) {
    if (migrated.singles.has(single.slug)) {
      logger.debug(`Migration exists, skipping single: ${single.slug}`);
      continue;
    }

    diffs.push({
      collectionSlug: single.slug,
      tableName: single.tableName,
      isNew: true,
      isDeleted: false,
      changes: [{ type: "create_table", tableName: single.tableName }],
      description: `Create table ${single.tableName}`,
    });
    newSingles.push(single);

    const tableExists = await checkTableExists(
      adapter as unknown as DrizzleAdapter,
      single.tableName
    );
    if (tableExists) {
      logger.debug(
        `Single needs migration (table exists, no migration file): ${single.slug}`
      );
    } else {
      logger.debug(`New single detected: ${single.slug}`);
    }
  }

  // Check components - generate migration if no existing migration file covers this component
  for (const component of components) {
    if (migrated.components.has(component.slug)) {
      logger.debug(`Migration exists, skipping component: ${component.slug}`);
      continue;
    }

    diffs.push({
      collectionSlug: component.slug,
      tableName: component.tableName,
      isNew: true,
      isDeleted: false,
      changes: [{ type: "create_table", tableName: component.tableName }],
      description: `Create component table ${component.tableName}`,
    });
    newComponents.push(component);

    const tableExists = await checkTableExists(
      adapter as unknown as DrizzleAdapter,
      component.tableName
    );
    if (tableExists) {
      logger.debug(
        `Component needs migration (table exists, no migration file): ${component.slug}`
      );
    } else {
      logger.debug(`New component detected: ${component.slug}`);
    }
  }

  // Check user_ext table (if user fields are configured)
  let newUserExt = false;
  const userFields = config.users?.fields;

  if (userFields && userFields.length > 0 && !migrated.hasUserExt) {
    newUserExt = true;
    diffs.push({
      collectionSlug: "user_ext",
      tableName: "user_ext",
      isNew: true,
      isDeleted: false,
      changes: [{ type: "create_table", tableName: "user_ext" }],
      description: "Create user extension table user_ext",
    });

    const tableExists = await checkTableExists(
      adapter as unknown as DrizzleAdapter,
      "user_ext"
    );
    if (tableExists) {
      logger.debug(
        "user_ext needs migration (table exists, no migration file)"
      );
    } else {
      logger.debug("New user_ext table detected");
    }
  } else if (userFields && userFields.length > 0 && migrated.hasUserExt) {
    logger.debug("Migration exists, skipping: user_ext");
  }

  // No changes detected
  if (
    diffs.length === 0 &&
    newCollections.length === 0 &&
    newSingles.length === 0 &&
    newComponents.length === 0 &&
    !newUserExt
  ) {
    return null;
  }

  // Generate migrations for new collections, singles, components, and user_ext
  let migration: GeneratedMigration;
  const totalNew =
    newCollections.length +
    newSingles.length +
    newComponents.length +
    (newUserExt ? 1 : 0);

  // Create schema services for component and user_ext migrations
  const componentSchemaService = new ComponentSchemaService(dialect);
  const userExtSchemaService = new UserExtSchemaService(dialect);

  if (totalNew === 1 && newCollections.length === 1) {
    // Single collection - use dedicated method
    const customName = name || `create_${newCollections[0].slug}`;
    migration = generator.generateCreateMigration(
      newCollections[0],
      customName
    );
  } else if (totalNew === 1 && newSingles.length === 1) {
    // Single single - use dedicated method
    const customName = name || `create_single_${newSingles[0].slug}`;
    migration = generator.generateCreateMigration(newSingles[0], customName);
  } else if (totalNew === 1 && newComponents.length === 1) {
    // Single component - use ComponentSchemaService
    const component = newComponents[0];
    const customName = name || `create_comp_${component.slug}`;
    const upSql = componentSchemaService.generateMigrationSQL(
      component.tableName,
      component.fields
    );
    const dropResult = componentSchemaService.generateDropTableMigration(
      component.tableName
    );

    const now = new Date();
    const timestamp = formatTimestamp(now);

    migration = {
      name: `${timestamp}_${sanitizeName(customName)}`,
      up: upSql,
      down: dropResult.migrationSQL,
      checksum: "",
      description: customName,
      dialect,
      generatedAt: now,
    };
  } else if (totalNew === 1 && newUserExt) {
    // Single user_ext table - use UserExtSchemaService
    const customName = name || "create_user_ext";
    const upSql = userExtSchemaService.generateMigrationSQL(userFields!);
    const dropResult = userExtSchemaService.generateDropTableMigration();

    const now = new Date();
    const timestamp = formatTimestamp(now);

    migration = {
      name: `${timestamp}_${sanitizeName(customName)}`,
      up: upSql,
      down: dropResult.migrationSQL,
      checksum: "",
      description: customName,
      dialect,
      generatedAt: now,
    };
  } else if (totalNew > 1) {
    // Multiple collections/singles/components - generate individual migrations and combine
    const upParts: string[] = [];
    const downParts: string[] = [];

    // Generate collection migrations
    for (const collection of newCollections) {
      const collectionMigration = generator.generateCreateMigration(collection);
      upParts.push(`-- Collection: ${collection.slug}`);
      upParts.push(collectionMigration.up);
      upParts.push("");
      downParts.unshift(collectionMigration.down);
      downParts.unshift(`-- Collection: ${collection.slug}`);
      downParts.unshift("");
    }

    // Generate single migrations
    for (const single of newSingles) {
      const singleMigration = generator.generateCreateMigration(single);
      upParts.push(`-- Single: ${single.slug}`);
      upParts.push(singleMigration.up);
      upParts.push("");
      downParts.unshift(singleMigration.down);
      downParts.unshift(`-- Single: ${single.slug}`);
      downParts.unshift("");
    }

    // Generate component migrations
    for (const component of newComponents) {
      const upSql = componentSchemaService.generateMigrationSQL(
        component.tableName,
        component.fields
      );
      const dropResult = componentSchemaService.generateDropTableMigration(
        component.tableName
      );

      upParts.push(`-- Component: ${component.slug}`);
      upParts.push(upSql);
      upParts.push("");
      downParts.unshift(dropResult.migrationSQL);
      downParts.unshift(`-- Component: ${component.slug}`);
      downParts.unshift("");
    }

    // Generate user_ext migration
    if (newUserExt && userFields) {
      const upSql = userExtSchemaService.generateMigrationSQL(userFields);
      const dropResult = userExtSchemaService.generateDropTableMigration();

      upParts.push("-- UserExt: user_ext");
      upParts.push(upSql);
      upParts.push("");
      downParts.unshift(dropResult.migrationSQL);
      downParts.unshift("-- UserExt: user_ext");
      downParts.unshift("");
    }

    // Generate migration name
    let customName: string;
    if (name) {
      customName = name;
    } else {
      const parts: string[] = [];
      if (newCollections.length > 0) {
        parts.push(`${newCollections.length}_collections`);
      }
      if (newSingles.length > 0) {
        parts.push(`${newSingles.length}_singles`);
      }
      if (newComponents.length > 0) {
        parts.push(`${newComponents.length}_components`);
      }
      if (newUserExt) {
        parts.push("user_ext");
      }
      customName = `create_${parts.join("_")}`;
    }

    const now = new Date();
    const timestamp = formatTimestamp(now);

    migration = {
      name: `${timestamp}_${sanitizeName(customName)}`,
      up: upParts.join("\n").trim(),
      down: downParts.join("\n").trim(),
      checksum: "", // Will be recalculated
      description: customName,
      dialect,
      generatedAt: now,
    };
  } else {
    // No new collections/singles/components but have diffs - use batch migration
    const customName = name || "schema_update";
    migration = generator.generateBatchMigration(diffs, customName);
  }

  // Format the final migration content
  const content = formatMigrationFile(
    migration,
    newCollections,
    newSingles,
    newComponents,
    newUserExt
  );

  // Resolve output path (migrationsDir already resolved above for getMigratedSlugs)
  const migrationFile = resolve(migrationsDir, `${migration.name}.sql`);

  // Ensure directory exists
  await ensureDir(migrationsDir);

  // Write migration file
  await writeFile(migrationFile, content, "utf-8");
  logger.debug(`Written migration to: ${migrationFile}`);

  return {
    migrationFile,
    migrationName: migration.name,
    collectionCount: newCollections.length,
    collectionNames: newCollections.map(c => c.slug),
    singleCount: newSingles.length,
    singleNames: newSingles.map(s => s.slug),
    componentCount: newComponents.length,
    componentNames: newComponents.map(c => c.slug),
    hasUserExt: newUserExt,
    isBlank: false,
    dialect,
    durationMs: Date.now() - startTime,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Scan existing migration files to find which collection/single/component slugs
 * already have migration coverage. This prevents generating duplicate migrations
 * for collections whose tables already exist (e.g., plugin collections created
 * by auto-sync during `nextly dev`).
 *
 * Parses `-- Collections:`, `-- Singles:`, `-- Components:`, and `-- UserExt:` headers
 * in existing migration files.
 */
async function getMigratedSlugs(migrationsDir: string): Promise<{
  collections: Set<string>;
  singles: Set<string>;
  components: Set<string>;
  hasUserExt: boolean;
}> {
  const collections = new Set<string>();
  const singles = new Set<string>();
  const components = new Set<string>();
  let hasUserExt = false;

  try {
    const files = await readdir(migrationsDir);
    const sqlFiles = files.filter(f => f.endsWith(".sql"));

    for (const file of sqlFiles) {
      try {
        const content = await readFile(resolve(migrationsDir, file), "utf-8");
        // Only parse the header (first 20 lines) for efficiency
        const headerLines = content.split("\n").slice(0, 20);

        for (const line of headerLines) {
          // Parse "-- Collections: forms, form-submissions"
          const collectionsMatch = line.match(/^-- Collections:\s*(.+)/);
          if (collectionsMatch) {
            for (const slug of collectionsMatch[1]
              .split(",")
              .map(s => s.trim())) {
              if (slug) collections.add(slug);
            }
          }

          // Parse "-- Singles: header, footer"
          const singlesMatch = line.match(/^-- Singles:\s*(.+)/);
          if (singlesMatch) {
            for (const slug of singlesMatch[1].split(",").map(s => s.trim())) {
              if (slug) singles.add(slug);
            }
          }

          // Parse "-- Components: hero, card"
          const componentsMatch = line.match(/^-- Components:\s*(.+)/);
          if (componentsMatch) {
            for (const slug of componentsMatch[1]
              .split(",")
              .map(s => s.trim())) {
              if (slug) components.add(slug);
            }
          }

          // Parse "-- UserExt: user_ext"
          if (line.match(/^-- UserExt:\s*user_ext/)) {
            hasUserExt = true;
          }
        }
      } catch {
        // Skip unreadable files
      }
    }
  } catch {
    // Migrations directory doesn't exist yet - no existing migrations
  }

  return { collections, singles, components, hasUserExt };
}

/**
 * Check if a table exists in the database
 */
async function checkTableExists(
  adapter: DrizzleAdapter,
  tableName: string
): Promise<boolean> {
  try {
    const dialect = adapter.getCapabilities().dialect;
    let query: string;

    switch (dialect) {
      case "postgresql":
        query = `SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_name = '${tableName}'
        )`;
        break;
      case "mysql":
        query = `SELECT COUNT(*) as count FROM information_schema.tables
          WHERE table_schema = DATABASE()
          AND table_name = '${tableName}'`;
        break;
      case "sqlite":
        query = `SELECT name FROM sqlite_master
          WHERE type='table' AND name='${tableName}'`;
        break;
      default:
        return false;
    }

    const result = await adapter.executeQuery<Record<string, unknown>>(query);

    if (dialect === "postgresql") {
      return result?.[0]?.exists === true;
    } else if (dialect === "mysql") {
      return ((result?.[0]?.count as number) ?? 0) > 0;
    } else {
      return Array.isArray(result) && result.length > 0;
    }
  } catch {
    // If query fails, assume table doesn't exist
    return false;
  }
}

/**
 * Generate migration file name with timestamp
 */
function generateMigrationName(description: string): string {
  const now = new Date();
  const timestamp = formatTimestamp(now);
  const sanitized = sanitizeName(description);
  return `${timestamp}_${sanitized}`;
}

/**
 * Format timestamp as YYYYMMDD_HHMMSS
 */
function formatTimestamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${year}${month}${day}_${hours}${minutes}${seconds}`;
}

/**
 * Sanitize migration name for file system
 */
function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

/**
 * Generate blank migration file content.
 *
 * F11 PR 2 (Q4=A): forward-only model. No `-- DOWN` section emitted.
 * If a deployed migration needs to be reverted, write a NEW corrective
 * migration that reverses it.
 */
function generateBlankMigrationContent(
  name: string,
  dialect: SupportedDialect
): string {
  const now = new Date().toISOString();
  const dialectName = getDialectDisplayName(dialect);

  return `-- Migration: ${name}
-- Generated at: ${now}
-- Dialect: ${dialectName}
--
-- This is a blank migration file for custom SQL.
-- Add your migration SQL below.

-- UP
-- Add your migration SQL here

`;
}

/**
 * Format migration content with header and sections
 */
function formatMigrationFile(
  migration: GeneratedMigration,
  collections: DynamicCollectionRecord[],
  singles: DynamicCollectionRecord[] = [],
  components: ComponentRecord[] = [],
  hasUserExt: boolean = false
): string {
  const collectionList =
    collections.length > 0
      ? `-- Collections: ${collections.map(c => c.slug).join(", ")}\n`
      : "";

  const singleList =
    singles.length > 0
      ? `-- Singles: ${singles.map(s => s.slug).join(", ")}\n`
      : "";

  const componentList =
    components.length > 0
      ? `-- Components: ${components.map(c => c.slug).join(", ")}\n`
      : "";

  const userExtLine = hasUserExt ? "-- UserExt: user_ext\n" : "";

  const dialectName = getDialectDisplayName(migration.dialect);

  // F11 PR 2 (Q4=A): forward-only — no `-- DOWN` section emitted.
  // The MigrationGenerator may still populate `migration.down` internally
  // (out of scope for PR 2 to refactor); we just don't write it to disk.
  return `-- Migration: ${migration.description}
${collectionList}${singleList}${componentList}${userExtLine}-- Generated at: ${migration.generatedAt.toISOString()}
-- Dialect: ${dialectName}
-- Checksum: ${migration.checksum}

-- UP
${migration.up}
`;
}

/**
 * Convert CollectionConfig[] to DynamicCollectionRecord[] format
 */
function convertToRecords(
  collections: CollectionConfig[]
): DynamicCollectionRecord[] {
  return collections.map(collection => ({
    id: collection.slug,
    slug: collection.slug,
    labels: {
      singular: collection.labels?.singular ?? toSingularLabel(collection.slug),
      plural: collection.labels?.plural ?? toPluralLabel(collection.slug),
    },
    tableName: collection.slug.replace(/-/g, "_"),
    fields: collection.fields,
    timestamps: collection.timestamps ?? true,
    description: collection.admin?.description,
    source: "code" as const,
    locked: true,
    schemaHash: "",
    schemaVersion: 1,
    migrationStatus: "pending" as const,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
}

/**
 * Convert SingleConfig[] to DynamicCollectionRecord[] format.
 * Singles are adapted to the collection record format for migration generation.
 * Key differences:
 * - Table name has `single_` prefix
 * - Singles always have updatedAt but not createdAt (timestamps: false, handled specially)
 * - Labels only have singular (no plural needed)
 */
function convertToSingleRecords(
  singles: SingleConfig[]
): DynamicCollectionRecord[] {
  return singles.map(single => ({
    id: single.slug,
    slug: single.slug,
    labels: {
      singular: single.label?.singular ?? toTitleCase(single.slug),
      plural: single.label?.singular ?? toTitleCase(single.slug), // Singles don't need plural
    },
    // Route through the canonical resolver so migration generation
    // produces the same physical table name the registry and DDL paths do.
    tableName: resolveSingleTableName({
      slug: single.slug,
      dbName: single.dbName,
    }),
    fields: single.fields,
    // Singles have updatedAt only (not createdAt), but we set timestamps: true
    // since the migration generator will add both columns.
    // The actual Single table only uses updatedAt, but having both doesn't hurt.
    timestamps: true,
    description: single.description ?? single.admin?.description,
    source: "code" as const,
    locked: true,
    schemaHash: "",
    schemaVersion: 1,
    migrationStatus: "pending" as const,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
}

/**
 * Convert ComponentConfig[] to ComponentRecord[] format for migration generation.
 * Components use a simpler record format than collections/singles.
 */
function convertToComponentRecords(
  components: ComponentConfig[]
): ComponentRecord[] {
  return components.map(component => ({
    slug: component.slug,
    // Components use `comp_` prefix for table names
    tableName: component.dbName ?? `comp_${component.slug.replace(/-/g, "_")}`,
    fields: component.fields,
    label: component.label?.singular ?? toTitleCase(component.slug),
  }));
}

/**
 * Convert slug to title case
 */
function toTitleCase(slug: string): string {
  return slug
    .split(/[-_]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Ensure directory exists
 */
async function ensureDir(dir: string): Promise<void> {
  try {
    await mkdir(dir, { recursive: true });
  } catch {
    // Directory may already exist
  }
}

/**
 * Display migration creation result
 */
function displayResult(
  result: MigrationCreateResult,
  context: CommandContext
): void {
  const { logger } = context;

  logger.newline();

  if (result.isBlank) {
    logger.success(`Created blank migration → ${result.migrationFile}`);
    logger.newline();
    logger.info("Edit the migration file to add your custom SQL.");
  } else {
    logger.success(`Created migration → ${result.migrationFile}`);

    // Display collections
    if (result.collectionCount > 0) {
      logger.keyValue("Collections", result.collectionCount);

      if (result.collectionNames.length <= 5) {
        for (const name of result.collectionNames) {
          logger.item(name, 1);
        }
      } else {
        for (const name of result.collectionNames.slice(0, 4)) {
          logger.item(name, 1);
        }
        logger.item(`... and ${result.collectionNames.length - 4} more`, 1);
      }
    }

    // Display singles
    if (result.singleCount > 0) {
      logger.keyValue("Singles", result.singleCount);

      if (result.singleNames.length <= 5) {
        for (const name of result.singleNames) {
          logger.item(name, 1);
        }
      } else {
        for (const name of result.singleNames.slice(0, 4)) {
          logger.item(name, 1);
        }
        logger.item(`... and ${result.singleNames.length - 4} more`, 1);
      }
    }

    // Display components
    if (result.componentCount > 0) {
      logger.keyValue("Components", result.componentCount);

      if (result.componentNames.length <= 5) {
        for (const name of result.componentNames) {
          logger.item(name, 1);
        }
      } else {
        for (const name of result.componentNames.slice(0, 4)) {
          logger.item(name, 1);
        }
        logger.item(`... and ${result.componentNames.length - 4} more`, 1);
      }
    }

    // Display user_ext
    if (result.hasUserExt) {
      logger.keyValue("User Extension", "user_ext");
    }
  }

  logger.newline();
  logger.info("Next steps:");
  logger.item("Review the migration file", 1);
  logger.item("Run `nextly migrate` to apply the migration", 1);
}

// ============================================================================
// Command Registration
// ============================================================================

/**
 * Register the migrate:create command with the program
 *
 * @param program - Commander program instance
 */
export function registerMigrateCreateCommand(program: Command): void {
  program
    .command("migrate:create")
    .description(
      "Create a new migration file from schema changes or for custom SQL"
    )
    .argument("[name]", "Migration name (e.g., create_posts_table)")
    .option("--blank", "Create an empty migration file for custom SQL", false)
    .action(
      async (
        name: string | undefined,
        cmdOptions: MigrateCreateCommandOptions,
        cmd: Command
      ) => {
        const globalOpts = cmd.optsWithGlobals();
        const context = createContext(globalOpts);

        const resolvedOptions: ResolvedMigrateCreateOptions = {
          ...cmdOptions,
          config: globalOpts.config,
          verbose: globalOpts.verbose,
          quiet: globalOpts.quiet,
          cwd: globalOpts.cwd,
        };

        try {
          await runMigrateCreate(name, resolvedOptions, context);
        } catch (error) {
          context.logger.error(
            error instanceof Error ? error.message : String(error)
          );
          process.exit(1);
        }
      }
    );
}
