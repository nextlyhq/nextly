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
 * nextly build --no-types --no-zod
 *
 * # Combine options
 * nextly build --strict --skip-migrations-check
 * ```
 */

import { createHash } from "node:crypto";
import { relative, resolve } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { Command } from "commander";

import type { CollectionConfig } from "../../collections/config/define-collection";
import { assertValidCollectionConfig } from "../../collections/config/validate-config";
import { declaredNamesOf } from "../../domains/schema/migrate/resolved-schema";
import { ZodGenerator } from "../../domains/schema/services/zod-generator";
import { describeError } from "../../errors/index";
import type { FieldGroupConfig } from "../../field-groups/config/types";
import { assertValidFieldGroupConfig } from "../../field-groups/config/validate-field-group";
import type { DynamicCollectionRecord } from "../../schemas/dynamic-collections/types";
import { generatedZodDir } from "../../shared/lib/generated-output-paths";
import { toSingularLabel, toPluralLabel } from "../../shared/lib/pluralization";
import type { SingleConfig } from "../../singles/config/types";
import { assertValidSingleConfig } from "../../singles/config/validate-single";
import { reportDryRun, type DryRunChange } from "../dry-run";
import { exitWithError, type CliError } from "../errors";
import {
  buildDeclarationsInvalid,
  buildFailed,
  buildGenerationFailed,
  buildMigrationsNotApplied,
  buildStrictWarnings,
  type BuildDeclarationIssue,
} from "../errors/areas/commands";
import { createContext, type CommandContext } from "../program";
import {
  createCliAdapter,
  openDryRunAdapter,
  validateDatabaseEnv,
  getDialectDisplayName,
  type CLIDatabaseAdapter,
  type SupportedDialect,
} from "../utils/adapter";
import { loadDeclaredConfigOrExit } from "../utils/command-prerequisites";
import type { LoadConfigResult } from "../utils/config-loader";
import { hasSchemaToSync } from "../utils/has-schema";
import { formatDuration, formatCount } from "../utils/logger";
import {
  readableMigrationFiles,
  type DeclaredNames,
} from "../utils/migration-discovery";
import {
  generateTypesFile,
  generatedOutputOrder,
  writeGeneratedOutput,
  type GeneratedFile,
} from "../utils/write-generated-types";

import {
  convertToComponentRecords,
  convertToSingleRecords,
  convertToUserFieldRecords,
  publishConfiguredWorkflows,
  reportedAsRefusal,
} from "./generate-types";

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
   * Skip Zod validation schema generation
   * @default false (Zod schemas are generated)
   */
  zod?: boolean;

  /**
   * `--dry-run`: validate and plan the files as a real build does, name each
   * file it would write and the failure it would end with, and write nothing.
   */
  dryRun?: boolean;
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
    generatedZodSchemas: [],
    durationMs: 0,
  };

  // Step 1: Load configuration
  logger.info("Loading configuration...");

  // The configuration with its plugin field declarations checked. A dry run
  // names an invalid declaration as its refusal; a real run reports it and
  // exits, so it reads like every other build failure.
  const configResult = await loadDeclaredConfigOrExit(
    {
      configPath: options.config,
      cwd: options.cwd,
      debug: options.verbose,
    },
    logger,
    error => reportedAsRefusal(logger, error, options.dryRun === true)
  );
  if (configResult === undefined) return;

  // A workflow that cannot be attached fails the build rather than the
  // deploy, and the types this build generates carry the workflows' names.
  const published = await publishConfiguredWorkflows(
    configResult,
    logger,
    options.dryRun === true
  );
  if (!published) return;

  if (configResult.configPath) {
    logger.success(`Loaded config from ${configResult.configPath}`);
  } else {
    logger.warn("No config file found, using defaults");
  }

  const collectionCount = configResult.config.collections.length;
  result.collectionCount = collectionCount;
  logger.keyValue("Collections", collectionCount);

  // Singles and field groups answer to the same declaration rules as collections,
  // and a project can be made entirely of them. Validated before the
  // no-collections return below, which would otherwise let an invalid
  // declaration past the only check that would have caught it.
  const entityValidation = validateSinglesAndFieldGroups(
    configResult.config.singles ?? [],
    configResult.config.fieldGroups ?? [],
    context
  );
  result.errors.push(...entityValidation.errors);

  // Any supported entity is enough to build for. Gating on collections alone
  // meant an app of singles, field groups, or plugin-backed user fields wrote
  // no types at all, or kept a stale file from a previous run.
  const hasSchema = hasSchemaToSync(configResult.config);

  if (!hasSchema) {
    if (entityValidation.errors.length > 0) {
      result.success = false;
      result.durationMs = Date.now() - startTime;
      const invalid = buildDeclarationsInvalid(
        declarationIssues(entityValidation.errors)
      );
      // A dry run names the failure, as it does once the build has a schema.
      if (options.dryRun === true) {
        reportDryRun(logger, { changes: [], refusals: [invalid.what] });
        return;
      }
      exitWithError(logger, invalid);
    }
    logger.warn("No schema defined in config");
    logger.info("Add collections to your nextly.config.ts to build.");
    // Nothing to generate; a dry run still ends as every dry run ends.
    if (options.dryRun === true) reportDryRun(logger, { changes: [] });
    return;
  }

  // Worth saying even though the build continues: the other entity kinds still
  // generate types, so stopping here would leave an app of singles or user
  // fields with no output.
  if (collectionCount === 0) {
    logger.warn("No collections defined in config");
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

  // Reported together: a build is valid only if every entity is, and a single
  // or component error that did not fail the build would be a report the
  // command prints and then ignores.
  const declarationErrors = [
    ...validationResult.errors,
    ...entityValidation.errors,
  ];

  // Each step that fails the build adds its reason here, and the build ends with them in the
  // error shape once every step that runs has run, so each reason is printed once, at the end.
  const failures: CliError[] = [];
  // The files a real build writes, which a dry run names in place of writing them.
  const dryRunChanges: DryRunChange[] = [];

  if (declarationErrors.length > 0) {
    result.success = false;
    failures.push(
      buildDeclarationsInvalid(declarationIssues(declarationErrors))
    );
  } else {
    logger.success(
      `Validated ${formatCount(collectionCount, "collection")} successfully`
    );
  }

  if (validationResult.warnings.length > 0) {
    if (options.strict) {
      // Under `--strict` the warnings are the failure, so they are listed in it.
      result.success = false;
      failures.push(buildStrictWarnings(validationResult.warnings));
    } else {
      logger.warn(`${validationResult.warnings.length} warning(s):`);
      for (const warning of validationResult.warnings) {
        logger.item(warning, 1);
      }
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

      result.generatedZodSchemas = generationResult.zodSchemas;
      result.generatedTypesFile = generationResult.typesFile;
      result.warnings.push(...generationResult.warnings);
      for (const file of generationResult.files) {
        dryRunChanges.push({
          action: "write",
          target: relative(options.cwd ?? process.cwd(), file.path),
        });
      }

      // Display generation results
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
      failures.push(buildGenerationFailed(error));
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
          // Under `--strict` the migrations are the failure, so they are named in it.
          result.success = false;
          failures.push(buildMigrationsNotApplied(migrationResult));
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

        // Show failed migrations; under `--strict` the failure names them.
        if (!options.strict && migrationResult.failedMigrations.length > 0) {
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

  // A dry run ends with what it planned: the files, and each reason the real
  // build would fail, which a dry run names and does not exit on.
  if (options.dryRun === true) {
    logger.newline();
    reportDryRun(logger, {
      changes: dryRunChanges,
      refusals: failures.map(failure => failure.what),
    });
    return;
  }

  logger.newline();
  logger.divider();

  if (result.success) {
    logger.success(`Build completed in ${formatDuration(result.durationMs)}`);

    // Summary stats
    const stats: string[] = [];
    stats.push(`${result.collectionCount} collection(s)`);
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
    exitWithError(logger, buildFailed(failures));
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
      const message = describeError(error);
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

/** Declaration errors as the build's failure lists them, by the entity and field each belongs to. */
function declarationIssues(errors: BuildError[]): BuildDeclarationIssue[] {
  return errors.map(error => ({
    location: error.field
      ? `${error.collection}.${error.field}`
      : error.collection,
    message: error.message,
  }));
}

/**
 * Run the comprehensive config validators over singles and field groups.
 *
 * Collections were already covered here; singles and field groups were not, so a
 * declaration they alone carry — including one a plugin field type's own rules
 * reject — reported success from `nextly build` and surfaced later at runtime.
 * This is the one place the check is reliable, because the CLI registers plugin
 * field types while loading the config, so the registry is populated by the
 * time these run.
 */
function validateSinglesAndFieldGroups(
  singles: SingleConfig[],
  fieldGroups: FieldGroupConfig[],
  context: CommandContext
): { errors: BuildError[] } {
  const { logger } = context;
  const errors: BuildError[] = [];

  for (const single of singles) {
    logger.debug(`Validating single: ${single.slug}`);
    try {
      assertValidSingleConfig(single);
    } catch (error) {
      errors.push({ collection: single.slug, message: describeError(error) });
    }
  }

  for (const fieldGroup of fieldGroups) {
    logger.debug(`Validating field group: ${fieldGroup.slug}`);
    try {
      assertValidFieldGroupConfig(fieldGroup);
    } catch (error) {
      errors.push({
        collection: fieldGroup.slug,
        message: describeError(error),
      });
    }
  }

  return { errors };
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
  zodSchemas: string[];
  typesFile?: string;
  warnings: string[];
  /** Every file the build writes, in order; under `--dry-run`, written to none. */
  files: GeneratedFile[];
}> {
  const { logger } = context;
  const { config } = configResult;
  const cwd = options.cwd ?? process.cwd();

  const result = {
    zodSchemas: [] as string[],
    typesFile: undefined as string | undefined,
    warnings: [] as string[],
    files: [] as GeneratedFile[],
  };
  // Each file is planned first, path and content, and then written, so a dry
  // run names exactly the files a real build writes.
  const dryRun = options.dryRun === true;

  // Convert CollectionConfig[] to DynamicCollectionRecord[] for generators
  const records = convertToRecords(config.collections);

  // The other entity kinds, converted with the same functions `generate:types`
  // uses. Passing collections alone produced a different types file from the
  // two commands, so a field declared on a single, a field group, or the user
  // schema was absent from the build-generated types.
  const singleRecords = convertToSingleRecords(config.singles ?? []);
  const componentRecords = convertToComponentRecords(config.fieldGroups ?? []);
  const userFieldRecords = convertToUserFieldRecords(
    config.users?.fields ?? []
  );

  let zodFiles: GeneratedFile[] = [];
  let typesFile: GeneratedFile | undefined;

  // Generate Zod schemas
  if (options.zod !== false) {
    logger.debug("Generating Zod schemas...");

    const zodGenerator = new ZodGenerator({
      generateTypes: true,
      includeComments: true,
    });

    // schemasDir/zod, fitted to the app's layout as `generate:types` fits it.
    const zodDir = generatedZodDir(cwd, config.db.schemasDir);
    const indexFile = zodGenerator.generateIndexFile(records);
    zodFiles = [
      ...zodGenerator.generateAllSchemas(records).map(schema => ({
        path: resolve(zodDir, schema.filename),
        code: schema.code,
      })),
      { path: resolve(zodDir, indexFile.filename), code: indexFile.code },
    ];
  }

  // Generate TypeScript types
  if (options.types !== false) {
    logger.debug("Generating TypeScript types...");

    // The same writer `generate:types` uses, so a deployment build writes the
    // file a development run wrote: the same narrowed names, the same path.
    typesFile = generateTypesFile({
      cwd,
      outputFile: config.typescript.outputFile,
      config,
      plugins: config.plugins ?? [],
      collections: records,
      singles: singleRecords,
      components: componentRecords,
      userFields: userFieldRecords,
      moduleAugmentation: true,
    });
  }

  // Everything planned, then written in one place unless this is a dry run.
  const output = { zod: zodFiles, types: typesFile };
  result.files.push(...generatedOutputOrder(output));
  if (!dryRun && result.files.length > 0) {
    await writeGeneratedOutput(output, {
      cwd,
      outputFile: config.typescript.outputFile,
      warn: message => logger.warn(message),
    });
    result.zodSchemas.push(...zodFiles.map(file => file.path));
    result.typesFile = typesFile?.path;
    logger.debug(`Written ${formatCount(result.files.length, "file")}`);
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
    localized: (collection as { localized?: boolean }).localized === true,
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
    const connection = {
      dialect: dbValidation.dialect,
      databaseUrl: dbValidation.databaseUrl,
      logger: options.verbose ? logger : undefined,
    };
    // A dry run opens the database read-only; one that is not there has no
    // migrations to check, as a database the build cannot reach has none.
    if (options.dryRun === true) {
      const opened = await openDryRunAdapter(connection);
      if ("missing" in opened) {
        logger.debug(`Cannot check migrations: ${opened.missing}`);
        return result;
      }
      adapter = opened;
    } else {
      adapter = await createCliAdapter(connection);
    }
    logger.debug(`Connected to ${getDialectDisplayName(dialect)}`);
  } catch (error) {
    logger.debug(`Cannot check migrations: ${describeError(error)}`);
    return result;
  }

  try {
    result.checked = true;

    // Discover migration files
    const migrationsDir = resolve(cwd, configResult.config.db.migrationsDir);
    // The files counted are the ones `nextly migrate` reads.
    const migrationFiles = await discoverMigrations(
      migrationsDir,
      dialect,
      await declaredNamesOf(
        { ...configResult, projectRoot: cwd },
        { orNone: true }
      )
    );

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
  migrationsDir: string,
  dialect: SupportedDialect,
  declared: DeclaredNames | undefined
): Promise<ParsedMigration[]> {
  return (await readableMigrationFiles(migrationsDir, dialect, declared)).map(
    ({ baseName, filePath, content }) => ({
      name: baseName,
      filePath,
      checksum: createHash("sha256").update(content).digest("hex"),
    })
  );
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
// Command Action
// ============================================================================

/** The action of `nextly build`, loaded when it runs. */
export async function buildAction(
  cmdOptions: BuildCommandOptions,
  cmd: Command
) {
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
    exitWithError(context.logger, error);
  }
}
