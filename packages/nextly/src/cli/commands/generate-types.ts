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
 * nextly generate:types --output ./src/types/payload-types.ts
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

import type { CollectionConfig } from "../../collections/config/define-collection.js";
import type { ComponentConfig } from "../../components/config/types.js";
import {
  TypeGenerator,
  type TypeGeneratorOptions,
} from "../../domains/schema/services/type-generator.js";
import { ZodGenerator } from "../../domains/schema/services/zod-generator.js";
import { resolveSingleTableName } from "../../domains/singles/services/resolve-single-table-name.js";
import type { DynamicCollectionRecord } from "../../schemas/dynamic-collections/types.js";
import type { DynamicComponentRecord } from "../../schemas/dynamic-components/types.js";
import type { DynamicSingleRecord } from "../../schemas/dynamic-singles/types.js";
import type { UserFieldDefinitionRecord } from "../../schemas/user-field-definitions/types.js";
import {
  toSingularLabel,
  toPluralLabel,
} from "../../shared/lib/pluralization.js";
import type { SingleConfig } from "../../singles/config/types.js";
import type { UserFieldConfig } from "../../users/config/types.js";
import { createContext, type CommandContext } from "../program.js";
import { loadConfig, type LoadConfigResult } from "../utils/config-loader.js";
import { formatDuration, formatCount } from "../utils/logger.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Options specific to the generate:types command
 */
export interface GenerateTypesCommandOptions {
  /**
   * Custom output path for the generated types file.
   * If not provided, uses the path from config or defaults to ./payload-types.ts
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

  if (collectionCount === 0 && singleCount === 0 && componentCount === 0) {
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

    // Step 3: Display results
    displayResults(result, options, context);

    // Final summary
    const duration = Date.now() - startTime;
    logger.newline();
    logger.divider();
    logger.success(`Type generation completed in ${formatDuration(duration)}`);
  } catch (error) {
    logger.error(
      `Generation failed: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
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
    componentCount: config.components?.length ?? 0,
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

  // Convert ComponentConfig[] to DynamicComponentRecord[] for generators
  const componentRecords = convertToComponentRecords(config.components ?? []);

  // Convert UserFieldConfig[] to UserFieldDefinitionRecord[] for generators
  const userFieldRecords = convertToUserFieldRecords(
    config.users?.fields ?? []
  );

  // Generate TypeScript types
  const generateDeclare = options.declare !== false;
  const typesOutputPath = options.output ?? config.typescript.outputFile;

  logger.debug(`Generating TypeScript types (declare: ${generateDeclare})`);

  const typeGeneratorOptions: TypeGeneratorOptions = {
    includeComments: true,
    generateInputTypes: true,
    generateConfig: true,
    generateModuleAugmentation: generateDeclare,
  };

  const typeGenerator = new TypeGenerator(typeGeneratorOptions);
  const typesFile = typeGenerator.generateTypesFile(
    records,
    singleRecords,
    componentRecords,
    userFieldRecords
  );

  // Resolve and write types file
  const typesFilePath = resolve(cwd, typesOutputPath);
  await ensureDir(dirname(typesFilePath));
  await writeFile(typesFilePath, typesFile.code, "utf-8");

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

    // Determine output directory for Zod schemas (use schemasDir/zod)
    const zodOutputDir = resolve(cwd, config.db.schemasDir, "zod");
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
function convertToSingleRecords(
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
    schemaHash: "", // Not needed for type generation
    schemaVersion: 1,
    migrationStatus: "synced" as const,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
}

/**
 * Convert ComponentConfig[] to DynamicComponentRecord[] format
 */
function convertToComponentRecords(
  components: ComponentConfig[]
): DynamicComponentRecord[] {
  return components.map(component => ({
    id: component.slug, // Use slug as temporary ID
    slug: component.slug,
    label: component.label?.singular ?? toTitleCase(component.slug),
    tableName: component.dbName ?? `comp_${component.slug.replace(/-/g, "_")}`,
    fields: component.fields,
    description: component.description ?? component.admin?.description,
    admin: component.admin,
    source: "code" as const,
    locked: true, // Code-first components are locked
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
function convertToUserFieldRecords(
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
      placeholder:
        "placeholder" in field ? ((field.placeholder as string) ?? null) : null,
      description:
        "description" in field ? ((field.description as string) ?? null) : null,
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
  if (result.warnings.length > 0) {
    logger.newline();
    logger.warn(`${result.warnings.length} warning(s):`);
    for (const warning of result.warnings) {
      logger.item(warning, 1);
    }
  }

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
    .option("-o, --output <path>", "Output file path for TypeScript types")
    .option("--no-declare", "Skip module declaration/augmentation")
    .option("--no-zod", "Skip Zod schema generation")
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

      try {
        await runGenerateTypes(resolvedOptions, context);
      } catch (error) {
        context.logger.error(
          error instanceof Error ? error.message : String(error)
        );
        process.exit(1);
      }
    });
}
