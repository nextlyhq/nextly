/**
 * Generate Types Command
 *
 * Implements the `nextly generate:types` command for generating TypeScript
 * type definitions and Zod validation schemas from collection and single
 * configurations.
 *
 * @module cli/commands/generate-types
 * @since 1.0.0
 *
 * @example
 * ```bash
 * # Generate TypeScript types and Zod schemas
 * nextly generate:types
 *
 * # Custom output path for types
 * nextly generate:types --output ./src/types/nextly-types.ts
 *
 * # Skip module declaration (for use in external projects)
 * nextly generate:types --no-declare
 *
 * # Skip Zod schema generation
 * nextly generate:types --no-zod
 * ```
 */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";

import type { Command } from "commander";

import type { CollectionConfig } from "../../collections/config/define-collection";
import { ZodGenerator } from "../../domains/schema/services/zod-generator";
import { resolveComponentTableName } from "../../domains/schema/utils/resolve-table-name";
import { resolveSingleTableName } from "../../domains/singles/services/resolve-single-table-name";
import {
  buildWorkflowRegistry,
  publishWorkflows,
} from "../../domains/workflows/registry";
// Reserved-option refusals are reported through the canonical error shape, so
// the CLI renders them like any other declaration failure.
import type { FieldGroupConfig } from "../../field-groups/config/types";
import { writeComponentMapFiles } from "../../plugins/codegen/write-component-map";
// The option names the field identity would overwrite, refused here because a
// code-defined user field never passes through the manifest schema.
import type { DynamicCollectionRecord } from "../../schemas/dynamic-collections/types";
import type { DynamicFieldGroupRecord } from "../../schemas/dynamic-field-groups/types";
import type { DynamicSingleRecord } from "../../schemas/dynamic-singles/types";
import type { UserFieldDefinitionRecord } from "../../schemas/user-field-definitions/types";
import {
  generatedTypesFile,
  generatedZodDir,
} from "../../shared/lib/generated-output-paths";
import { toSingularLabel, toPluralLabel } from "../../shared/lib/pluralization";
import { carriedUserFieldOptions } from "../../shared/lib/user-field-plugin-options";
import { DEFAULT_TYPESCRIPT_CONFIG } from "../../shared/types/config";
import type { SingleConfig } from "../../singles/config/types";
import type { UserFieldConfig } from "../../users/config/types";
import { configDeclarationError, exitWithError } from "../errors/index";
import { createContext, type CommandContext } from "../program";
import { loadConfigOrExit } from "../utils/command-prerequisites";
import type { LoadConfigResult } from "../utils/config-loader";
import {
  formatDuration,
  formatCount,
  logWarnings,
  type Logger,
} from "../utils/logger";
import { writeGeneratedTypesFile } from "../utils/write-generated-types";

import { runComponentMapCheck } from "./component-map-check-command";
import {
  applyBlockManifestState,
  readBlockManifestState,
} from "./generate-manifest";

// ============================================================================
// Types
// ============================================================================

/**
 * Options specific to the generate:types command
 */
export interface GenerateTypesCommandOptions {
  /**
   * Custom output path for the generated types file.
   * If not provided, uses the path from config, whose default is
   * ./src/types/generated/nextly-types.ts
   */
  output?: string;

  /**
   * Whether to include module declaration/augmentation.
   * @default true (declare is included)
   */
  declare?: boolean;

  /**
   * Whether to generate Zod validation schemas.
   * @default true (Zod schemas are generated)
   */
  zod?: boolean;

  /**
   * Only check that the committed component map agrees with the config, writing nothing, and
   * exit with the verdict (`runComponentMapCheck`). For CI.
   */
  check?: boolean;
}

/**
 * Combined options (global + command-specific)
 */
interface ResolvedGenerateTypesOptions extends GenerateTypesCommandOptions {
  config?: string;
  verbose?: boolean;
  quiet?: boolean;
  cwd?: string;
}

/**
 * Result of type generation
 */
interface GenerationResult {
  /** Path to generated TypeScript types file */
  typesFile?: string;
  /** Path to the generated block manifest, when plugins declare blocks. */
  blockManifestFile?: string;
  /** Path to the generated admin component import map, when plugins contribute admin UI (D60) */
  componentImportMapFile?: string;
  /** Number of collection interfaces generated */
  collectionCount: number;
  /** Number of single interfaces generated */
  singleCount: number;
  /** Number of component interfaces generated */
  componentCount: number;
  /** Number of custom user fields included in User type */
  userFieldCount: number;
  /** Paths to generated Zod schema files */
  zodSchemaFiles: string[];
  /** Path to Zod index file */
  zodIndexFile?: string;
  /** Total duration in milliseconds */
  durationMs: number;
  /** Any warnings encountered */
  warnings: string[];
}

// ============================================================================
// Generate Types Command Implementation
// ============================================================================

/**
 * Write the admin component import map (D60) and its strings-only path list
 * beside the types file. Importing the map from the app self-registers every
 * plugin admin component, with no manual host imports. The admin's server
 * layout reads the list in development to write the pair again when it falls
 * behind, and `generate:types --check` reads it in CI.
 *
 * Both are written even when nothing contributes a component: the app imports
 * them, so removing them would break its build. An empty map imports nothing,
 * so a package that is no longer installed is not imported either.
 *
 * @returns the map's path
 */
async function settleImportMap(
  plugins: Parameters<typeof writeComponentMapFiles>[0],
  typesOutputPath: string,
  cwd: string,
  configFile: string | undefined,
  // The site config's `admin.dashboard`, whose own widgets the map lists too.
  siteDashboard: unknown
): Promise<string | undefined> {
  const written = await writeComponentMapFiles(
    plugins,
    typesOutputPath,
    cwd,
    configFile,
    siteDashboard
  );
  return written.paths[0];
}

/**
 * Execute the generate:types command
 *
 * @param options - Combined global and command options
 * @param context - Command context with logger
 */
export async function runGenerateTypes(
  options: ResolvedGenerateTypesOptions,
  context: CommandContext
): Promise<void> {
  const { logger } = context;
  const startTime = Date.now();

  logger.header("Generate Types");

  // Step 1: Load configuration
  logger.info("Loading configuration...");

  const configResult = await loadConfigOrExit(
    {
      configPath: options.config,
      cwd: options.cwd,
      debug: options.verbose,
    },
    logger
  );

  if (configResult.configPath) {
    logger.success(`Loaded config from ${configResult.configPath}`);
  } else {
    logger.warn("No config file found, using defaults");
  }

  await publishConfiguredWorkflows(configResult, logger);

  const collectionCount = configResult.config.collections.length;
  const singleCount = configResult.config.singles?.length ?? 0;
  const componentCount = configResult.config.fieldGroups?.length ?? 0;
  const userFieldCount = configResult.config.users?.fields?.length ?? 0;
  logger.keyValue("Collections", collectionCount);
  logger.keyValue("Singles", singleCount);
  logger.keyValue("Field groups", componentCount);
  if (userFieldCount > 0) {
    logger.keyValue("User Fields", userFieldCount);
  }

  // User fields alone are enough to generate for: the `User` interface carries
  // them, and stopping here would leave an app with no output, or a stale file
  // from a previous run.
  // Settled BEFORE the empty-schema return below, which exits without running
  // anything after it. An app whose only schema came from a page-builder plugin
  // reaches zero on every count the moment that plugin is removed, and that is
  // exactly when its manifest most needs deleting. The path is recorded and
  // reported on the result further down, where that object exists.
  // Settled through the same pair `generate:manifest` uses, so the command that
  // writes the file and the command that checks it cannot disagree about what
  // belongs on disk. `expected === null` is expressed by REMOVING any previous
  // manifest: writing nothing would leave the last run's file still advertising
  // blocks the app no longer has.
  // Fitted to the app's layout, as the types file it sits beside is below.
  const manifestCwd = options.cwd ?? process.cwd();
  const typesFileForLayout = generatedTypesFile(
    manifestCwd,
    options.output ?? configResult.config.typescript.outputFile
  );
  const manifestState = await readBlockManifestState(
    configResult.config.plugins ?? [],
    typesFileForLayout,
    manifestCwd
  );
  await applyBlockManifestState(manifestState);
  const writtenManifestPath =
    manifestState.expected === null ? undefined : manifestState.path;
  if (writtenManifestPath) {
    logger.debug(`Written block manifest to: ${writtenManifestPath}`);
  }
  // The plugin component import map, settled before the same return and for
  // the same reason: an app whose schema is all made in the Schema Builder
  // declares nothing in code, yet still renders plugin admin components — its
  // plugins' pages and settings, and a document view offered on a field type.
  // Without the map a bundled admin cannot resolve them and draws an empty
  // slot. Beside the CONFIGURED types file, fitted to the app's layout, and
  // not beside an `--output` override: the admin page imports the map from one
  // place, and the admin's check rewrites it in development and names it in
  // production from the config, so a map written elsewhere would be one nothing
  // reads.
  const writtenImportMapPath = await settleImportMap(
    configResult.config.plugins ?? [],
    generatedTypesFile(manifestCwd, configResult.config.typescript.outputFile),
    manifestCwd,
    // The config file it was loaded from, whose type the map imports to check each widget
    // component against its widget. None for a site running on the default config.
    configResult.configPath,
    configResult.config.admin?.dashboard
  );
  if (writtenImportMapPath) {
    logger.debug(`Written plugin admin import map to: ${writtenImportMapPath}`);
  }

  if (
    collectionCount === 0 &&
    singleCount === 0 &&
    componentCount === 0 &&
    userFieldCount === 0
  ) {
    logger.warn("No collections, singles, or components defined in config");
    logger.info(
      "Add collections, singles, or components to your nextly.config.ts to generate types."
    );
    return;
  }

  // Step 2: Generate types
  logger.newline();
  logger.info("Generating types...");

  try {
    const result = await generateTypes(configResult, options, context);
    // Reported here because the manifest is settled earlier, before the
    // empty-schema return, while this object is built by the call above.
    result.blockManifestFile = writtenManifestPath;
    result.componentImportMapFile = writtenImportMapPath;

    // Step 3: Display results
    displayResults(result, options, context);

    // Final summary
    const duration = Date.now() - startTime;
    logger.newline();
    logger.divider();
    logger.success(`Type generation completed in ${formatDuration(duration)}`);
  } catch (error) {
    exitWithError(logger, error);
  }
}

/**
 * Check the configuration's attached workflows as boot checks them, plugins'
 * collections and password fields included, and publish them, so the types
 * generated next carry their stage and step names. A workflow that cannot be
 * attached ends the command, reported as a declaration failure. A command
 * reads no database, so the components an attached collection reaches are
 * judged at boot.
 */
export async function publishConfiguredWorkflows(
  configResult: LoadConfigResult,
  logger: Pick<Logger, "getOptions">
): Promise<void> {
  try {
    publishWorkflows(
      await buildWorkflowRegistry(
        configResult.config,
        configResult.configPath ?? null,
        // A command reads no database: the components the configuration
        // defines are judged from their definitions, and any other at boot.
        {
          components: configResult.config.fieldGroups ?? [],
          readRegistry: false,
        }
      )
    );
  } catch (error) {
    exitWithError(logger, configDeclarationError(error) ?? error);
  }
}

/**
 * Generate TypeScript types and Zod schemas
 */
async function generateTypes(
  configResult: LoadConfigResult,
  options: ResolvedGenerateTypesOptions,
  context: CommandContext
): Promise<GenerationResult> {
  const { logger } = context;
  const { config } = configResult;
  const startTime = Date.now();

  const result: GenerationResult = {
    collectionCount: config.collections.length,
    singleCount: config.singles?.length ?? 0,
    componentCount: config.fieldGroups?.length ?? 0,
    userFieldCount: config.users?.fields?.length ?? 0,
    zodSchemaFiles: [],
    durationMs: 0,
    warnings: [],
  };

  const cwd = options.cwd ?? process.cwd();

  // Convert CollectionConfig[] to DynamicCollectionRecord[] for generators
  const records = convertToRecords(config.collections);

  // Convert SingleConfig[] to DynamicSingleRecord[] for generators
  const singleRecords = convertToSingleRecords(config.singles ?? []);

  // Convert FieldGroupConfig[] to DynamicFieldGroupRecord[] for generators
  const componentRecords = convertToComponentRecords(config.fieldGroups ?? []);

  // Convert UserFieldConfig[] to UserFieldDefinitionRecord[] for generators
  const userFieldRecords = convertToUserFieldRecords(
    config.users?.fields ?? []
  );

  // Generate TypeScript types
  const generateDeclare = options.declare !== false;
  const typesOutputPath = options.output ?? config.typescript.outputFile;

  logger.debug(`Generating TypeScript types (declare: ${generateDeclare})`);

  // `config` is the already-merged config (plugin contributions folded by
  // loadConfig); `config.plugins` is the resolved plugin list.
  const typesFilePath = await writeGeneratedTypesFile({
    cwd,
    outputFile: typesOutputPath,
    config,
    plugins: config.plugins ?? [],
    collections: records,
    singles: singleRecords,
    components: componentRecords,
    userFields: userFieldRecords,
    moduleAugmentation: generateDeclare,
    warn: message => logger.warn(message),
  });

  result.typesFile = typesFilePath;
  logger.debug(`Written types to: ${typesFilePath}`);

  // Generate Zod schemas if enabled
  if (options.zod !== false) {
    logger.debug("Generating Zod validation schemas...");

    const zodGenerator = new ZodGenerator({
      generateTypes: true,
      includeComments: true,
    });

    // Generate schemas for all collections
    const zodSchemas = zodGenerator.generateAllSchemas(records);

    // Zod schemas go to schemasDir/zod, fitted to the app's layout.
    const zodOutputDir = generatedZodDir(cwd, config.db.schemasDir);
    await ensureDir(zodOutputDir);

    // Write individual schema files
    for (const schema of zodSchemas) {
      const schemaPath = resolve(zodOutputDir, schema.filename);
      await writeFile(schemaPath, schema.code, "utf-8");
      result.zodSchemaFiles.push(schemaPath);
      logger.debug(`Written Zod schema: ${schemaPath}`);
    }

    // Generate and write index file
    const indexFile = zodGenerator.generateIndexFile(records);
    const indexPath = resolve(zodOutputDir, indexFile.filename);
    await writeFile(indexPath, indexFile.code, "utf-8");
    result.zodIndexFile = indexPath;
    logger.debug(`Written Zod index: ${indexPath}`);
  }

  result.durationMs = Date.now() - startTime;

  return result;
}

/**
 * Convert CollectionConfig[] to DynamicCollectionRecord[] format
 */
function convertToRecords(
  collections: CollectionConfig[]
): DynamicCollectionRecord[] {
  return collections.map(collection => ({
    id: collection.slug, // Use slug as temporary ID
    slug: collection.slug,
    labels: {
      singular: collection.labels?.singular ?? toSingularLabel(collection.slug),
      plural: collection.labels?.plural ?? toPluralLabel(collection.slug),
    },
    tableName: collection.slug.replace(/-/g, "_"), // Convert slug to table name
    fields: collection.fields,
    timestamps: collection.timestamps ?? true,
    // Why: status from defineCollection() input if present, otherwise false.
    status: (collection as { status?: boolean }).status === true,
    localized: (collection as { localized?: boolean }).localized === true,
    description: collection.admin?.description,
    source: "code" as const,
    locked: true, // Code-first collections are locked
    schemaHash: "", // Not needed for type generation
    schemaVersion: 1,
    migrationStatus: "synced" as const,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
}

/**
 * Convert SingleConfig[] to DynamicSingleRecord[] format
 */
export function convertToSingleRecords(
  singles: SingleConfig[]
): DynamicSingleRecord[] {
  return singles.map(single => ({
    id: single.slug, // Use slug as temporary ID
    slug: single.slug,
    label: single.label?.singular ?? toTitleCase(single.slug),
    tableName: resolveSingleTableName({
      slug: single.slug,
      dbName: single.dbName,
    }),
    fields: single.fields,
    description: single.description ?? single.admin?.description,
    admin: single.admin,
    source: "code" as const,
    locked: true, // Code-first singles are locked
    // Why: same as collections — opt-in via defineSingle({ status: true }).
    status: (single as { status?: boolean }).status === true,
    localized: (single as { localized?: boolean }).localized === true,
    schemaHash: "", // Not needed for type generation
    schemaVersion: 1,
    migrationStatus: "synced" as const,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
}

/**
 * Convert FieldGroupConfig[] to DynamicFieldGroupRecord[] format
 */
export function convertToComponentRecords(
  components: FieldGroupConfig[]
): DynamicFieldGroupRecord[] {
  return components.map(component => ({
    id: component.slug, // Use slug as temporary ID
    slug: component.slug,
    label: component.label?.singular ?? toTitleCase(component.slug),
    // Canonical resolution keeps generated table names aligned with the
    // registry and runtime schema for the same component.
    tableName: resolveComponentTableName(component.slug),
    fields: component.fields,
    description: component.description ?? component.admin?.description,
    admin: component.admin,
    source: "code" as const,
    locked: true, // Code-first components are locked
    // Preserve the component's localization flag in the generated record so the
    // emitted types match the runtime schema (a localized component omits
    // translatable columns from its main table and carries a companion table).
    localized: (component as { localized?: boolean }).localized === true,
    schemaHash: "", // Not needed for type generation
    schemaVersion: 1,
    migrationStatus: "synced" as const,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
}

/**
 * Convert UserFieldConfig[] to UserFieldDefinitionRecord[] format.
 * Code-first fields are marked with `source: "code"` for precise type generation.
 */
export function convertToUserFieldRecords(
  fields: UserFieldConfig[]
): UserFieldDefinitionRecord[] {
  return fields.map((field, index) => {
    const selectOrRadio = field as {
      options?: Array<{ value: string; label: string } | string>;
    };

    // Normalize options to { label, value } format
    const options =
      selectOrRadio.options?.map(opt =>
        typeof opt === "string" ? { label: opt, value: opt } : opt
      ) ?? null;

    return {
      id: field.name, // Use name as temporary ID
      name: field.name,
      label: ("label" in field && (field.label as string)) || field.name,
      type: field.type,
      required: "required" in field ? Boolean(field.required) : false,
      defaultValue:
        "defaultValue" in field
          ? String(field.defaultValue ?? "") || null
          : null,
      options,
      pluginOptions: carriedUserFieldOptions(field),
      hasMany: "hasMany" in field ? Boolean(field.hasMany) : null,
      minLength:
        "minLength" in field ? ((field.minLength as number) ?? null) : null,
      maxLength:
        "maxLength" in field ? ((field.maxLength as number) ?? null) : null,
      minValue: "min" in field ? ((field.min as number) ?? null) : null,
      maxValue: "max" in field ? ((field.max as number) ?? null) : null,
      placeholder:
        ("placeholder" in field ? (field.placeholder as string) : undefined) ??
        ("admin" in field
          ? ((field.admin as { placeholder?: string })?.placeholder ?? null)
          : null),
      description:
        ("description" in field ? (field.description as string) : undefined) ??
        ("admin" in field
          ? ((field.admin as { description?: string })?.description ?? null)
          : null),
      sortOrder: index,
      source: "code" as const,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  });
}

/**
 * Convert slug to title case label
 * e.g., "site-settings" -> "Site Settings"
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
 * Display generation results to the user
 */
function displayResults(
  result: GenerationResult,
  options: ResolvedGenerateTypesOptions,
  context: CommandContext
): void {
  const { logger } = context;

  // TypeScript types
  if (result.typesFile) {
    // +1 for the User interface (always generated)
    const totalInterfaces =
      result.collectionCount + result.singleCount + result.componentCount + 1;
    const parts: string[] = [];

    if (result.collectionCount > 0) {
      parts.push(formatCount(result.collectionCount, "collection"));
    }
    if (result.singleCount > 0) {
      parts.push(formatCount(result.singleCount, "single"));
    }
    if (result.componentCount > 0) {
      parts.push(formatCount(result.componentCount, "component"));
    }
    parts.push(
      `1 user${result.userFieldCount > 0 ? ` + ${formatCount(result.userFieldCount, "custom field")}` : ""}`
    );

    const summary = parts.join(", ");
    logger.success(
      `Generated ${formatCount(totalInterfaces, "interface")} (${summary}) → ${result.typesFile}`
    );

    if (options.declare === false) {
      logger.info("Module declaration skipped (--no-declare)");
    }
  }

  // Zod schemas
  if (result.zodSchemaFiles.length > 0) {
    const zodDir = dirname(result.zodSchemaFiles[0]);
    logger.success(
      `Generated ${formatCount(result.zodSchemaFiles.length, "Zod schema")} → ${zodDir}/`
    );

    if (options.verbose) {
      for (const file of result.zodSchemaFiles) {
        logger.item(file, 1);
      }
      if (result.zodIndexFile) {
        logger.item(result.zodIndexFile, 1);
      }
    }
  } else if (options.zod === false) {
    logger.info("Zod schemas skipped (--no-zod)");
  }

  // Warnings
  logWarnings(logger, result.warnings);

  // Duration (verbose only)
  logger.debug(`Generation completed in ${formatDuration(result.durationMs)}`);
}

// ============================================================================
// Command Registration
// ============================================================================

/**
 * Register the generate:types command with the program
 *
 * @param program - Commander program instance
 */
export function registerGenerateTypesCommand(program: Command): void {
  program
    .command("generate:types")
    .description(
      "Generate TypeScript type definitions and Zod schemas from collections and singles"
    )
    // The help names the default from the value the config falls back to, so
    // the two cannot disagree.
    .option(
      "-o, --output <path>",
      `Output file path for TypeScript types (default: typescript.outputFile, or ${DEFAULT_TYPESCRIPT_CONFIG.outputFile})`
    )
    .option("--no-declare", "Skip module declaration/augmentation")
    .option("--no-zod", "Skip Zod schema generation")
    .option(
      "--check",
      "Only check that the committed component map agrees with the config, writing nothing (exit 1 when it does not, 2 when it cannot be checked)"
    )
    .action(async (cmdOptions: GenerateTypesCommandOptions, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals();
      const context = createContext(globalOpts);

      const resolvedOptions: ResolvedGenerateTypesOptions = {
        ...cmdOptions,
        config: globalOpts.config,
        verbose: globalOpts.verbose,
        quiet: globalOpts.quiet,
        cwd: globalOpts.cwd,
      };

      // The check writes nothing and runs nothing else: it answers with its exit status alone.
      if (cmdOptions.check === true) {
        process.exit(await runComponentMapCheck(resolvedOptions, context));
      }
      try {
        await runGenerateTypes(resolvedOptions, context);
      } catch (error) {
        exitWithError(context.logger, error);
      }
    });
}
