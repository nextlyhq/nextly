/**
 * Build Command
 *
 * Implements the `nextly build` command for production build preparation.
 * Validates all collections, generates final schema/type files, and verifies
 * migration status.
 *
 * @module cli/commands/build
 * @since 1.0.0
 *
 * @example
 * ```bash
 * # Basic usage - validate and generate all files
 * nextly build
 *
 * # Strict mode - fail on any warnings
 * nextly build --strict
 *
 * # Skip migration status check (for offline builds)
 * nextly build --skip-migrations-check
 *
 * # Skip specific generation steps
 * nextly build --no-types --no-schemas
 *
 * # Combine options
 * nextly build --strict --skip-migrations-check
 * ```
 */

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, basename } from "node:path";

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import type { Command } from "commander";

import type { CollectionConfig } from "../../collections/config/define-collection";
import { assertValidCollectionConfig } from "../../collections/config/validate-config";
import {
  SchemaGenerator,
  type SupportedDialect,
} from "../../domains/schema/services/schema-generator";
import {
  TypeGenerator,
  type TypeGeneratorOptions,
} from "../../domains/schema/services/type-generator";
import { ZodGenerator } from "../../domains/schema/services/zod-generator";
import type { DynamicCollectionRecord } from "../../schemas/dynamic-collections/types";
import {
  toSingularLabel,
  toPluralLabel,
} from "../../shared/lib/pluralization";
import { createContext, type CommandContext } from "../program";
import {
  createAdapter,
  validateDatabaseEnv,
  getDialectDisplayName,
  type CLIDatabaseAdapter,
} from "../utils/adapter";
import { loadConfig, type LoadConfigResult } from "../utils/config-loader";
import { formatDuration, formatCount } from "../utils/logger";

// ============================================================================
// Types
// ============================================================================

/**
 * Options specific to the build command
 */
export interface BuildCommandOptions {
  /**
   * Fail on any validation warnings
   * @default false
   */
  strict?: boolean;

  /**
   * Skip migration status check (for offline builds)
   * @default false
   */
  skipMigrationsCheck?: boolean;

  /**
   * Skip TypeScript type generation
   * @default false (types are generated)
   */
  types?: boolean;

  /**
   * Skip Drizzle schema generation
   * @default false (schemas are generated)
   */
  schemas?: boolean;

  /**
   * Skip Zod validation schema generation
   * @default false (Zod schemas are generated)
   */
  zod?: boolean;
}

/**
 * Combined options (global + command-specific)
 */
interface ResolvedBuildOptions extends BuildCommandOptions {
  config?: string;
  verbose?: boolean;
  quiet?: boolean;
  cwd?: string;
}

/**
 * Result of the build process
 */
interface BuildResult {
  /** Whether the build succeeded */
  success: boolean;

  /** Number of collections processed */
  collectionCount: number;

  /** Validation errors encountered */
  errors: BuildError[];

  /** Validation warnings encountered */
  warnings: string[];

  /** Generated Drizzle schema files */
  generatedSchemas: string[];

  /** Generated Zod schema files */
  generatedZodSchemas: string[];

  /** Path to generated types file */
  generatedTypesFile?: string;

  /** Migration status (if checked) */
  migrationStatus?: MigrationCheckResult;

  /** Total duration in milliseconds */
  durationMs: number;
}

/**
 * Build error with collection context
 */
interface BuildError {
  /** Collection slug that caused the error */
  collection: string;

  /** Error message */
  message: string;

  /** Field name if error is field-specific */
  field?: string;
}

/**
 * Result of migration status check
 */
interface MigrationCheckResult {
  /** Whether check was performed */
  checked: boolean;

  /** Number of pending migrations */
  pendingCount: number;

  /** Number of failed migrations */
  failedCount: number;

  /** Names of pending migrations */
  pendingMigrations: string[];

  /** Names of failed migrations */
  failedMigrations: string[];
}

/**
 * Parsed migration file data
 */
interface ParsedMigration {
  name: string;
  filePath: string;
  checksum: string;
}

/**
 * Database migration record (F11). Subset of `nextly_migrations` columns
 * needed by `nextly build` to print "applied vs pending" stats.
 */
interface MigrationRecord {
  filename: string;
  status: string;
}

// ============================================================================
// Build Command Implementation
// ============================================================================

/**
 * Execute the build command
 *
 * @param options - Combined global and command options
 * @param context - Command context with logger
 */
export async function runBuild(
  options: ResolvedBuildOptions,
  context: CommandContext
): Promise<void> {
  const { logger } = context;
  const startTime = Date.now();

  logger.header("Nextly Build");

  const result: BuildResult = {
    success: true,
    collectionCount: 0,
    errors: [],
    warnings: [],
    generatedSchemas: [],
    generatedZodSchemas: [],
    durationMs: 0,
  };

  // Step 1: Load configuration
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
  result.collectionCount = collectionCount;
  logger.keyValue("Collections", collectionCount);

  if (collectionCount === 0) {
    logger.warn("No collections defined in config");
    logger.info("Add collections to your nextly.config.ts to build.");
    return;
  }

  // Step 2: Validate all collections
  logger.newline();
  logger.info("Validating collections...");

  const validationResult = validateAllCollections(
    configResult.config.collections,
    context
  );

  result.errors.push(...validationResult.errors);
  result.warnings.push(...validationResult.warnings);

  if (validationResult.errors.length > 0) {
    result.success = false;
    logger.error(
      `Validation failed with ${formatCount(validationResult.errors.length, "error")}`
    );
    for (const error of validationResult.errors) {
      const location = error.field
        ? `${error.collection}.${error.field}`
        : error.collection;
      logger.item(`${location}: ${error.message}`, 1);
    }
  } else {
    logger.success(
      `Validated ${formatCount(collectionCount, "collection")} successfully`
    );
  }

  if (validationResult.warnings.length > 0) {
    logger.warn(`${validationResult.warnings.length} warning(s):`);
    for (const warning of validationResult.warnings) {
      logger.item(warning, 1);
    }

    if (options.strict) {
      result.success = false;
      logger.error("Build failed due to warnings (--strict mode)");
    }
  }

  // Step 3: Generate files (if validation passed)
  if (result.success) {
    logger.newline();
    logger.info("Generating files...");

    try {
      const generationResult = await generateAllFiles(
        configResult,
        options,
        context
      );

      result.generatedSchemas = generationResult.schemas;
      result.generatedZodSchemas = generationResult.zodSchemas;
      result.generatedTypesFile = generationResult.typesFile;
      result.warnings.push(...generationResult.warnings);

      // Display generation results
      if (generationResult.schemas.length > 0) {
        const dir = getCommonDirectory(generationResult.schemas);
        logger.success(
          `Generated ${formatCount(generationResult.schemas.length, "Drizzle schema")} → ${dir}/`
        );
      }

      if (generationResult.zodSchemas.length > 0) {
        const dir = getCommonDirectory(generationResult.zodSchemas);
        logger.success(
          `Generated ${formatCount(generationResult.zodSchemas.length, "Zod schema")} → ${dir}/`
        );
      }

      if (generationResult.typesFile) {
        logger.success(`Generated types → ${generationResult.typesFile}`);
      }
    } catch (error) {
      result.success = false;
      logger.error(
        `File generation failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Step 4: Check migration status (optional)
  if (!options.skipMigrationsCheck && result.success) {
    logger.newline();
    logger.info("Checking migration status...");

    const migrationResult = await checkMigrationStatus(
      configResult,
      options,
      context
    );
    result.migrationStatus = migrationResult;

    if (migrationResult.checked) {
      if (migrationResult.pendingCount > 0 || migrationResult.failedCount > 0) {
        const issues: string[] = [];
        if (migrationResult.pendingCount > 0) {
          issues.push(`${migrationResult.pendingCount} pending migration(s)`);
        }
        if (migrationResult.failedCount > 0) {
          issues.push(`${migrationResult.failedCount} failed migration(s)`);
        }

        const message = `Migration issues: ${issues.join(", ")}`;

        if (options.strict) {
          result.success = false;
          logger.error(message);
          logger.info("Run `nextly migrate` to apply pending migrations.");
        } else {
          logger.warn(message);
          logger.info(
            "Consider running `nextly migrate` before deploying to production."
          );
          result.warnings.push(message);
        }

        // Show pending migrations
        if (migrationResult.pendingMigrations.length > 0) {
          logger.debug("Pending migrations:");
          for (const name of migrationResult.pendingMigrations) {
            logger.debug(`  - ${name}`);
          }
        }

        // Show failed migrations
        if (migrationResult.failedMigrations.length > 0) {
          logger.error("Failed migrations:");
          for (const name of migrationResult.failedMigrations) {
            logger.error(`  - ${name}`);
          }
        }
      } else {
        logger.success("All migrations are applied");
      }
    } else {
      logger.debug("Migration check skipped (no database connection)");
    }
  } else if (options.skipMigrationsCheck) {
    logger.debug("Migration check skipped (--skip-migrations-check)");
    result.migrationStatus = {
      checked: false,
      pendingCount: 0,
      failedCount: 0,
      pendingMigrations: [],
      failedMigrations: [],
    };
  }

  // Step 5: Final summary
  result.durationMs = Date.now() - startTime;

  logger.newline();
  logger.divider();

  if (result.success) {
    logger.success(`Build completed in ${formatDuration(result.durationMs)}`);

    // Summary stats
    const stats: string[] = [];
    stats.push(`${result.collectionCount} collection(s)`);
    if (result.generatedSchemas.length > 0) {
      stats.push(`${result.generatedSchemas.length} schema(s)`);
    }
    if (result.generatedZodSchemas.length > 0) {
      stats.push(`${result.generatedZodSchemas.length} Zod schema(s)`);
    }
    if (result.generatedTypesFile) {
      stats.push("types");
    }

    logger.info(`Generated: ${stats.join(", ")}`);

    if (result.warnings.length > 0) {
      logger.warn(
        `Completed with ${formatCount(result.warnings.length, "warning")}`
      );
    }
  } else {
    logger.error(`Build failed in ${formatDuration(result.durationMs)}`);
    logger.info("Fix the errors above and run `nextly build` again.");
    process.exit(1);
  }
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate all collections in the configuration
 */
function validateAllCollections(
  collections: CollectionConfig[],
  context: CommandContext
): { errors: BuildError[]; warnings: string[] } {
  const { logger } = context;
  const errors: BuildError[] = [];
  const warnings: string[] = [];

  // Track slugs for duplicate detection
  const slugs = new Set<string>();

  for (const collection of collections) {
    logger.debug(`Validating collection: ${collection.slug}`);

    // Check for duplicate slugs
    if (slugs.has(collection.slug)) {
      errors.push({
        collection: collection.slug,
        message: `Duplicate collection slug: "${collection.slug}"`,
      });
      continue;
    }
    slugs.add(collection.slug);

    // Run comprehensive validation
    try {
      assertValidCollectionConfig(collection);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({
        collection: collection.slug,
        message,
      });
    }
  }

  // Validate relationship references
  const relationshipValidation = validateRelationships(collections);
  errors.push(...relationshipValidation.errors);
  warnings.push(...relationshipValidation.warnings);

  return { errors, warnings };
}

/**
 * Validate that all relationship fields reference existing collections
 */
function validateRelationships(collections: CollectionConfig[]): {
  errors: BuildError[];
  warnings: string[];
} {
  const errors: BuildError[] = [];
  const warnings: string[] = [];

  // Build set of valid collection slugs
  const validSlugs = new Set(collections.map(c => c.slug));

  for (const collection of collections) {
    validateFieldRelationships(
      collection.slug,
      collection.fields,
      validSlugs,
      errors,
      warnings
    );
  }

  return { errors, warnings };
}

/**
 * Recursively validate relationship references in fields
 */
function validateFieldRelationships(
  collectionSlug: string,
  fields: CollectionConfig["fields"],
  validSlugs: Set<string>,
  errors: BuildError[],
  warnings: string[],
  prefix = ""
): void {
  for (const field of fields) {
    // Layout fields (tabs, row, collapsible) may not have a name
    const fieldName = "name" in field ? (field.name as string) : field.type;
    const fieldPath = prefix ? `${prefix}.${fieldName}` : fieldName;

    // Check relationship fields
    if (field.type === "relationship" || field.type === "upload") {
      const relationTo = (field as { relationTo?: string | string[] })
        .relationTo;

      if (relationTo) {
        const targets = Array.isArray(relationTo) ? relationTo : [relationTo];
        for (const target of targets) {
          if (!validSlugs.has(target)) {
            errors.push({
              collection: collectionSlug,
              field: fieldPath,
              message: `References non-existent collection: "${target}"`,
            });
          }
        }
      }
    }

    // Recurse into nested fields
    if (field.type === "repeater" || field.type === "group") {
      const nestedFields = (field as { fields?: CollectionConfig["fields"] })
        .fields;
      if (nestedFields) {
        validateFieldRelationships(
          collectionSlug,
          nestedFields,
          validSlugs,
          errors,
          warnings,
          fieldPath
        );
      }
    }

    // Recurse into blocks (not yet in DynamicFieldType — future field type)
    if ((field.type as string) === "blocks") {
      const blocks = (
        field as {
          blocks?: Array<{ slug: string; fields?: CollectionConfig["fields"] }>;
        }
      ).blocks;
      if (blocks) {
        for (const block of blocks) {
          if (block.fields) {
            validateFieldRelationships(
              collectionSlug,
              block.fields,
              validSlugs,
              errors,
              warnings,
              `${fieldPath}.${block.slug}`
            );
          }
        }
      }
    }

    // Recurse into tabs (not yet in DynamicFieldType — future field type)
    if ((field.type as string) === "tabs") {
      const tabs = (
        field as {
          tabs?: Array<{ name?: string; fields?: CollectionConfig["fields"] }>;
        }
      ).tabs;
      if (tabs) {
        for (const tab of tabs) {
          if (tab.fields) {
            const tabPrefix = tab.name ? `${fieldPath}.${tab.name}` : fieldPath;
            validateFieldRelationships(
              collectionSlug,
              tab.fields,
              validSlugs,
              errors,
              warnings,
              tabPrefix
            );
          }
        }
      }
    }
  }
}

// ============================================================================
// File Generation
// ============================================================================

/**
 * Generate all output files (schemas, types, Zod)
 */
async function generateAllFiles(
  configResult: LoadConfigResult,
  options: ResolvedBuildOptions,
  context: CommandContext
): Promise<{
  schemas: string[];
  zodSchemas: string[];
  typesFile?: string;
  warnings: string[];
}> {
  const { logger } = context;
  const { config } = configResult;
  const cwd = options.cwd ?? process.cwd();

  const result = {
    schemas: [] as string[],
    zodSchemas: [] as string[],
    typesFile: undefined as string | undefined,
    warnings: [] as string[],
  };

  // Convert CollectionConfig[] to DynamicCollectionRecord[] for generators
  const records = convertToRecords(config.collections);

  // Determine dialect from environment
  const dbValidation = validateDatabaseEnv();
  const dialect: SupportedDialect = dbValidation.dialect ?? "postgresql";

  // Generate Drizzle schemas
  if (options.schemas !== false) {
    logger.debug("Generating Drizzle schemas...");

    const schemaGenerator = new SchemaGenerator({
      dialect,
      includeRelations: true,
    });

    const schemas = schemaGenerator.generateAllSchemas(records);
    const schemasDir = resolve(cwd, config.db.schemasDir, "collections");
    await ensureDir(schemasDir);

    for (const schema of schemas) {
      const schemaPath = resolve(schemasDir, schema.filename);
      await writeFile(schemaPath, schema.code, "utf-8");
      result.schemas.push(schemaPath);
      logger.debug(`Written schema: ${schemaPath}`);
    }

    // Generate index file
    const indexFile = schemaGenerator.generateIndexFile(records);
    const indexPath = resolve(schemasDir, indexFile.filename);
    await writeFile(indexPath, indexFile.code, "utf-8");
    result.schemas.push(indexPath);
    logger.debug(`Written index: ${indexPath}`);
  }

  // Generate Zod schemas
  if (options.zod !== false) {
    logger.debug("Generating Zod schemas...");

    const zodGenerator = new ZodGenerator({
      generateTypes: true,
      includeComments: true,
    });

    const zodSchemas = zodGenerator.generateAllSchemas(records);
    const zodDir = resolve(cwd, config.db.schemasDir, "zod");
    await ensureDir(zodDir);

    for (const schema of zodSchemas) {
      const schemaPath = resolve(zodDir, schema.filename);
      await writeFile(schemaPath, schema.code, "utf-8");
      result.zodSchemas.push(schemaPath);
      logger.debug(`Written Zod schema: ${schemaPath}`);
    }

    // Generate index file
    const indexFile = zodGenerator.generateIndexFile(records);
    const indexPath = resolve(zodDir, indexFile.filename);
    await writeFile(indexPath, indexFile.code, "utf-8");
    result.zodSchemas.push(indexPath);
    logger.debug(`Written Zod index: ${indexPath}`);
  }

  // Generate TypeScript types
  if (options.types !== false) {
    logger.debug("Generating TypeScript types...");

    const typeGeneratorOptions: TypeGeneratorOptions = {
      includeComments: true,
      generateInputTypes: true,
      generateConfig: true,
      generateModuleAugmentation: true,
    };

    const typeGenerator = new TypeGenerator(typeGeneratorOptions);
    const typesFile = typeGenerator.generateTypesFile(records);

    const typesFilePath = resolve(cwd, config.typescript.outputFile);
    await ensureDir(dirname(typesFilePath));
    await writeFile(typesFilePath, typesFile.code, "utf-8");
    result.typesFile = typesFilePath;
    logger.debug(`Written types: ${typesFilePath}`);
  }

  return result;
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
    tableName: collection.dbName ?? collection.slug.replace(/-/g, "_"),
    fields: collection.fields,
    timestamps: collection.timestamps ?? true,
    // Why: status defaults to false for code-first collections unless the
    // defineCollection() input explicitly opts in. The structurally-typed
    // collection object may carry a status flag from the user's config.
    status: (collection as { status?: boolean }).status === true,
    description: collection.admin?.description ?? collection.description,
    source: "code" as const,
    locked: true,
    schemaHash: "",
    schemaVersion: 1,
    migrationStatus: "synced" as const,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
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
 * Get common directory from a list of file paths
 */
function getCommonDirectory(paths: string[]): string {
  if (paths.length === 0) return "";
  if (paths.length === 1) {
    const parts = paths[0].split(/[/\\]/);
    parts.pop();
    return parts.join("/") || ".";
  }

  const parts = paths[0].split(/[/\\]/);
  parts.pop();
  return parts.join("/") || ".";
}

// ============================================================================
// Migration Status Check
// ============================================================================

/**
 * Check migration status by connecting to database
 */
async function checkMigrationStatus(
  configResult: LoadConfigResult,
  options: ResolvedBuildOptions,
  context: CommandContext
): Promise<MigrationCheckResult> {
  const { logger } = context;
  const cwd = options.cwd ?? process.cwd();

  const result: MigrationCheckResult = {
    checked: false,
    pendingCount: 0,
    failedCount: 0,
    pendingMigrations: [],
    failedMigrations: [],
  };

  // Validate database environment
  const dbValidation = validateDatabaseEnv();

  if (!dbValidation.valid) {
    logger.debug("Cannot check migrations: database not configured");
    return result;
  }

  const dialect = dbValidation.dialect!;

  // Try to connect to database
  let adapter: CLIDatabaseAdapter;
  try {
    adapter = await createAdapter({
      dialect: dbValidation.dialect,
      databaseUrl: dbValidation.databaseUrl,
      logger: options.verbose ? logger : undefined,
    });
    logger.debug(`Connected to ${getDialectDisplayName(dialect)}`);
  } catch (error) {
    logger.debug(
      `Cannot check migrations: ${error instanceof Error ? error.message : String(error)}`
    );
    return result;
  }

  try {
    result.checked = true;

    // Discover migration files
    const migrationsDir = resolve(cwd, configResult.config.db.migrationsDir);
    const migrationFiles = await discoverMigrations(migrationsDir);

    // Get applied migrations from database
    const appliedMigrations = await getAppliedMigrations(
      adapter as unknown as DrizzleAdapter,
      dialect
    );

    // F11: keyed by `filename` (renamed from `name` in the table schema).
    const appliedMap = new Map(appliedMigrations.map(m => [m.filename, m]));

    // Check each migration file
    for (const file of migrationFiles) {
      const record = appliedMap.get(file.name);

      if (!record) {
        // Not applied yet
        result.pendingCount++;
        result.pendingMigrations.push(file.name);
      } else if (record.status === "failed") {
        // Failed
        result.failedCount++;
        result.failedMigrations.push(file.name);
      }
      // else: applied successfully
    }
  } finally {
    await adapter.disconnect();
  }

  return result;
}

/**
 * Discover migration files from the migrations directory
 */
async function discoverMigrations(
  migrationsDir: string
): Promise<ParsedMigration[]> {
  let files: string[];

  try {
    files = await readdir(migrationsDir);
  } catch {
    return [];
  }

  const sqlFiles = files
    .filter(f => f.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));

  const migrations: ParsedMigration[] = [];

  for (const file of sqlFiles) {
    const filePath = resolve(migrationsDir, file);
    const name = basename(file, ".sql");

    try {
      const content = await readFile(filePath, "utf-8");
      const checksum = createHash("sha256").update(content).digest("hex");
      migrations.push({ name, filePath, checksum });
    } catch {
      // Skip files that can't be read
    }
  }

  return migrations;
}

/**
 * Get applied migrations from the database
 */
async function getAppliedMigrations(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect
): Promise<MigrationRecord[]> {
  // F11: column rename — `name` → `filename`, `executed_at` → `applied_at`.
  const query =
    dialect === "mysql"
      ? "SELECT `filename`, `status` FROM `nextly_migrations` ORDER BY `applied_at` ASC"
      : 'SELECT "filename", "status" FROM "nextly_migrations" ORDER BY "applied_at" ASC';

  try {
    const results = await adapter.executeQuery<Record<string, unknown>>(query);

    return results.map(row => ({
      filename: String(row.filename),
      status: String(row.status),
    }));
  } catch {
    // Table might not exist yet
    return [];
  }
}

// ============================================================================
// Command Registration
// ============================================================================

/**
 * Register the build command with the program
 *
 * @param program - Commander program instance
 */
export function registerBuildCommand(program: Command): void {
  program
    .command("build")
    .description("Production build - validate collections and generate files")
    .option("--strict", "Fail on any validation warnings", false)
    .option(
      "--skip-migrations-check",
      "Skip migration status verification",
      false
    )
    .option("--no-types", "Skip TypeScript type generation")
    .option("--no-schemas", "Skip Drizzle schema generation")
    .option("--no-zod", "Skip Zod validation schema generation")
    .action(async (cmdOptions: BuildCommandOptions, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals();
      const context = createContext(globalOpts);

      const resolvedOptions: ResolvedBuildOptions = {
        ...cmdOptions,
        config: globalOpts.config,
        verbose: globalOpts.verbose,
        quiet: globalOpts.quiet,
        cwd: globalOpts.cwd,
      };

      try {
        await runBuild(resolvedOptions, context);
      } catch (error) {
        context.logger.error(
          error instanceof Error ? error.message : String(error)
        );
        process.exit(1);
      }
    });
}
