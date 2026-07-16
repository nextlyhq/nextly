/**
 * Collection Sync Service
 *
 * Orchestrates the synchronization of code-first collections from `nextly.config.ts`
 * to the database, and generates corresponding Zod validation schemas and
 * TypeScript types.
 *
 * This service is typically called during:
 * - Development server startup (`nextly dev`)
 * - CLI commands (`nextly sync`, `nextly generate:types`)
 * - Build process (`nextly build`)
 *
 * @module services/collections/collection-sync-service
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import { CollectionSyncService } from '@nextly/services/collections';
 * import { loadConfig } from 'nextly/cli/utils';
 *
 * // Load config and sync
 * const { config } = await loadConfig();
 * const syncService = new CollectionSyncService(adapter, logger);
 * const result = await syncService.sync(config, {
 *   dialect: 'postgresql',
 *   cwd: process.cwd(),
 * });
 *
 * console.log('Created:', result.sync.created);
 * console.log('Updated:', result.sync.updated);
 * console.log('Unchanged:', result.sync.unchanged);
 * ```
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { CollectionConfig } from "../../../collections/config/define-collection";
import type { SanitizedNextlyConfig } from "../../../collections/config/define-config";
import type { FieldConfig } from "../../../collections/fields/types";
import type { DynamicCollectionRecord } from "../../../schemas/dynamic-collections/types";
import type { Logger } from "../../../services/shared";
import { BaseService } from "../../../shared/base-service";
import {
  toSingularLabel,
  toPluralLabel,
} from "../../../shared/lib/pluralization";
import type { SupportedDialect } from "../../../types/database";
import { ZodGenerator, TypeGenerator } from "../../schema";

import {
  CollectionRegistryService,
  type CodeFirstCollectionConfig,
  type SyncResult,
} from "./collection-registry-service";

/**
 * Options for the sync operation.
 */
export interface SyncOptions {
  /**
   * Generate Zod validation schemas.
   * @default false (opt-in: only generate when explicitly requested)
   */
  generateZodSchemas?: boolean;

  /**
   * Generate TypeScript types (payload-types.ts).
   * @default false (opt-in: only generate when explicitly requested)
   */
  generateTypes?: boolean;

  /**
   * What to do with collections that were removed from code but exist in DB.
   * - 'warn': Log a warning (default)
   * - 'delete': Remove from registry
   * - 'ignore': Do nothing
   * @default 'warn'
   */
  onRemoved?: "warn" | "delete" | "ignore";

  /**
   * Database dialect for schema generation.
   * If not provided, auto-detected from adapter.
   */
  dialect?: SupportedDialect;

  /**
   * Working directory for file generation.
   * @default process.cwd()
   */
  cwd?: string;

  /**
   * Dry run mode - don't write files, just return what would be generated.
   * @default false
   */
  dryRun?: boolean;
}

/**
 * Error found during relationship validation.
 */
export interface RelationshipValidationError {
  /**
   * The collection slug where the invalid relationship was found.
   */
  collection: string;

  /**
   * The field path (supports nested paths like "group.author").
   */
  field: string;

  /**
   * The target collection that was referenced.
   */
  targetCollection: string;

  /**
   * Description of why the relationship is invalid.
   */
  reason: string;
}

/**
 * Warning found during relationship validation.
 */
export interface RelationshipValidationWarning {
  /**
   * The collection slug where the warning was found.
   */
  collection: string;

  /**
   * The field path.
   */
  field: string;

  /**
   * Warning message.
   */
  message: string;
}

/**
 * Result of relationship validation across all collections.
 */
export interface RelationshipValidationResult {
  /**
   * Whether all relationships are valid (no errors).
   */
  valid: boolean;

  /**
   * Errors found during validation.
   * Errors indicate relationships that cannot work (missing target collections).
   */
  errors: RelationshipValidationError[];

  /**
   * Warnings found during validation.
   * Warnings indicate potential issues (e.g., referencing UI-only collections).
   */
  warnings: RelationshipValidationWarning[];
}

/**
 * Comprehensive result of the sync operation.
 */
export interface CollectionSyncResult {
  /**
   * Registry sync result (created/updated/unchanged/errors).
   */
  sync: SyncResult;

  /**
   * Paths to generated Drizzle schema files.
   */
  generatedSchemas: string[];

  /**
   * Paths to generated Zod validation files.
   */
  generatedZodSchemas: string[];

  /**
   * Path to generated TypeScript types file.
   */
  generatedTypesFile?: string;

  /**
   * Collections that were removed from code but exist in DB.
   */
  removedCollections: Array<{ slug: string; tableName: string }>;

  /**
   * Warnings generated during sync.
   */
  warnings: string[];

  /**
   * Duration of the sync operation in milliseconds.
   */
  durationMs: number;
}

/**
 * Extended sync result that includes relationship validation.
 */
export interface CollectionSyncResultWithValidation
  extends CollectionSyncResult {
  /**
   * Relationship validation result.
   */
  relationshipValidation: RelationshipValidationResult;
}

/**
 * Orchestrates synchronization of code-first collections.
 *
 * This service coordinates between:
 * - Config loader (loads nextly.config.ts)
 * - Collection Registry (syncs with database)
 * - Schema generators (Zod, TypeScript)
 *
 * @extends BaseService - Provides adapter access and logging
 */
export class CollectionSyncService extends BaseService {
  private readonly registry: CollectionRegistryService;

  constructor(adapter: DrizzleAdapter, logger: Logger) {
    super(adapter, logger);
    this.registry = new CollectionRegistryService(adapter, logger);
  }

  /**
   * Sync code-first collections from config to database and generate files.
   *
   * This is the main entry point for collection synchronization.
   * It performs the following steps:
   *
   * 1. Convert CollectionConfig[] to CodeFirstCollectionConfig[]
   * 2. Sync to database via CollectionRegistryService
   * 3. Detect removed collections (in DB but not in code)
   * 4. Generate Zod schemas for created/updated collections
   * 5. Generate TypeScript types for all collections
   * 6. Return comprehensive result with all generated files
   *
   * @param config - The loaded nextly.config.ts configuration
   * @param options - Sync options
   * @returns Comprehensive sync result
   *
   * @example
   * ```typescript
   * const result = await syncService.sync(config, {
   *   dialect: 'postgresql',
   *   generateZodSchemas: true,
   *   generateTypes: true,
   * });
   *
   * if (result.sync.errors.length > 0) {
   *   console.error('Sync errors:', result.sync.errors);
   * }
   *
   * console.log('Generated schemas:', result.generatedSchemas);
   * ```
   */
  async sync(
    config: SanitizedNextlyConfig,
    options: SyncOptions = {}
  ): Promise<CollectionSyncResult> {
    const startTime = Date.now();

    const opts = {
      generateZodSchemas: options.generateZodSchemas ?? false,
      generateTypes: options.generateTypes ?? false,
      onRemoved: options.onRemoved ?? "warn",
      dialect: options.dialect ?? this.detectDialect(),
      cwd: options.cwd ?? process.cwd(),
      dryRun: options.dryRun ?? false,
    };

    this.logger.info("Starting collection sync", {
      collectionCount: config.collections.length,
      dialect: opts.dialect,
      dryRun: opts.dryRun,
    });

    const result: CollectionSyncResult = {
      sync: { created: [], updated: [], unchanged: [], errors: [] },
      generatedSchemas: [],
      generatedZodSchemas: [],
      generatedTypesFile: undefined,
      removedCollections: [],
      warnings: [],
      durationMs: 0,
    };

    try {
      const codeFirstConfigs = this.convertToCodeFirstConfigs(
        config.collections
      );

      result.sync =
        await this.registry.syncCodeFirstCollections(codeFirstConfigs);

      result.removedCollections = await this.detectRemovedCollections(
        config.collections
      );

      if (result.removedCollections.length > 0) {
        const deletedSlugs = await this.handleRemovedCollections(
          result.removedCollections,
          opts.onRemoved,
          result.warnings
        );
        if (deletedSlugs.size > 0) {
          result.removedCollections = result.removedCollections.filter(
            r => !deletedSlugs.has(r.slug)
          );
        }
      }

      const changedSlugs = new Set([
        ...result.sync.created,
        ...result.sync.updated,
      ]);

      // Drizzle `.ts` schema generation was removed: nothing imports the
      // generated files (the runtime builds its Drizzle table from
      // dynamic_collections metadata via generateRuntimeSchema), so they
      // were orphan output. `result.generatedSchemas` stays an empty array
      // for backward compatibility with consumers that read it.
      const zodDir = resolve(opts.cwd, config.db.schemasDir, "zod");
      const missingZodCollections = config.collections.filter(c => {
        const zodPath = join(zodDir, `${c.slug}.zod.ts`);
        return !existsSync(zodPath);
      });

      const collectionsForZodGen = [
        ...config.collections.filter(c => changedSlugs.has(c.slug)),
        ...missingZodCollections.filter(c => !changedSlugs.has(c.slug)),
      ];

      if (opts.generateZodSchemas && collectionsForZodGen.length > 0) {
        const zodSchemas = await this.generateZodSchemas(
          collectionsForZodGen,
          config.db.schemasDir,
          opts
        );
        result.generatedZodSchemas = zodSchemas;
      }

      if (
        opts.generateTypes &&
        (changedSlugs.size > 0 || config.collections.length > 0)
      ) {
        const typesFile = await this.generateTypeScriptTypes(
          config.collections,
          config.typescript.outputFile,
          opts
        );
        result.generatedTypesFile = typesFile;
      }

      result.durationMs = Date.now() - startTime;

      this.logger.info("Collection sync completed", {
        created: result.sync.created.length,
        updated: result.sync.updated.length,
        unchanged: result.sync.unchanged.length,
        errors: result.sync.errors.length,
        removedCollections: result.removedCollections.length,
        generatedSchemas: result.generatedSchemas.length,
        generatedZodSchemas: result.generatedZodSchemas.length,
        generatedTypesFile: !!result.generatedTypesFile,
        durationMs: result.durationMs,
      });

      return result;
    } catch (error) {
      result.durationMs = Date.now() - startTime;

      this.logger.error("Collection sync failed", {
        error: error instanceof Error ? error.message : String(error),
        durationMs: result.durationMs,
      });

      throw error;
    }
  }

  /**
   * Detect collections that exist in the database but are not in code.
   *
   * These are collections that were previously synced from code but have
   * since been removed from the config file.
   *
   * @param codeCollections - Collections defined in code
   * @returns Array of slugs for removed collections
   */
  async detectRemovedCollections(
    codeCollections: CollectionConfig[]
  ): Promise<Array<{ slug: string; tableName: string }>> {
    const dbCollections = await this.registry.getAllCollections({
      source: "code",
    });

    const codeSlugs = new Set(codeCollections.map(c => c.slug));

    return dbCollections
      .filter(c => !codeSlugs.has(c.slug))
      .map(c => ({ slug: c.slug, tableName: c.tableName }));
  }

  /**
   * Generate only TypeScript types without syncing.
   *
   * Useful for regenerating types without database sync.
   *
   * @param config - The loaded config
   * @param options - Generation options
   * @returns Path to generated types file
   */
  async generateTypesOnly(
    config: SanitizedNextlyConfig,
    options: Pick<SyncOptions, "cwd" | "dryRun"> = {}
  ): Promise<string | undefined> {
    const opts = {
      cwd: options.cwd ?? process.cwd(),
      dryRun: options.dryRun ?? false,
      dialect: this.detectDialect(),
    };

    return this.generateTypeScriptTypes(
      config.collections,
      config.typescript.outputFile,
      opts
    );
  }

  /**
   * Validate all relationship references across collections.
   *
   * This method performs a two-pass validation:
   * 1. Collect all collection slugs (code-first + existing in DB)
   * 2. Validate all relationship and upload fields point to existing collections
   *
   * @param configs - Collection configurations to validate
   * @returns Validation result with errors and warnings
   *
   * @example
   * ```typescript
   * const validation = await syncService.validateRelationships(config.collections);
   *
   * if (!validation.valid) {
   *   console.error('Invalid relationships:', validation.errors);
   *   throw new Error('Cannot sync: invalid relationship references');
   * }
   *
   * if (validation.warnings.length > 0) {
   *   console.warn('Relationship warnings:', validation.warnings);
   * }
   * ```
   */
  async validateRelationships(
    configs: CollectionConfig[]
  ): Promise<RelationshipValidationResult> {
    const result: RelationshipValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
    };

    const codeFirstSlugs = new Set(configs.map(c => c.slug));

    const existingCollections = await this.registry.listCollections({});
    const existingSlugs = new Set(existingCollections.data.map(c => c.slug));

    // Built-in system collections that are always valid relationship targets.
    // These exist as system tables, not in dynamic_collections, so they won't
    // appear in codeFirstSlugs or existingSlugs but are valid for relationTo.
    const builtInSlugs = ["media", "users"];

    const allSlugs = new Set([
      ...codeFirstSlugs,
      ...existingSlugs,
      ...builtInSlugs,
    ]);

    const uiOnlySlugs = new Set(
      [...existingSlugs].filter(slug => !codeFirstSlugs.has(slug))
    );

    this.logger.debug("Validating relationships", {
      codeFirstCount: codeFirstSlugs.size,
      existingCount: existingSlugs.size,
      uiOnlyCount: uiOnlySlugs.size,
    });

    for (const config of configs) {
      this.validateCollectionRelationships(
        config,
        allSlugs,
        uiOnlySlugs,
        result
      );
    }

    result.valid = result.errors.length === 0;

    if (!result.valid) {
      this.logger.warn("Relationship validation failed", {
        errorCount: result.errors.length,
        warningCount: result.warnings.length,
      });
    }

    return result;
  }

  /**
   * Sync code-first collections with relationship validation.
   *
   * This method performs relationship validation before syncing.
   * Validation errors are logged but do not prevent sync (to allow forward references).
   *
   * @param config - The loaded nextly.config.ts configuration
   * @param options - Sync options
   * @returns Sync result with relationship validation included
   *
   * @example
   * ```typescript
   * const result = await syncService.syncWithValidation(config);
   *
   * if (!result.relationshipValidation.valid) {
   *   console.warn('Relationship issues:', result.relationshipValidation.errors);
   * }
   *
   * console.log('Sync completed:', result.sync.created.length, 'collections created');
   * ```
   */
  async syncWithValidation(
    config: SanitizedNextlyConfig,
    options: SyncOptions = {}
  ): Promise<CollectionSyncResultWithValidation> {
    const relationshipValidation = await this.validateRelationships(
      config.collections
    );

    if (!relationshipValidation.valid) {
      // Log errors but don't prevent sync (allow forward references)
      this.logger.warn("Relationship validation errors detected", {
        errorCount: relationshipValidation.errors.length,
        errors: relationshipValidation.errors,
      });
    }

    if (relationshipValidation.warnings.length > 0) {
      this.logger.warn("Relationship warnings detected", {
        warningCount: relationshipValidation.warnings.length,
        warnings: relationshipValidation.warnings,
      });
    }

    const syncResult = await this.sync(config, options);

    return {
      ...syncResult,
      relationshipValidation,
    };
  }

  private validateCollectionRelationships(
    config: CollectionConfig,
    allSlugs: Set<string>,
    uiOnlySlugs: Set<string>,
    result: RelationshipValidationResult
  ): void {
    const processFields = (fields: FieldConfig[], path: string = ""): void => {
      for (const field of fields) {
        // Layout fields (tabs, collapsible, row, ui) don't have a name
        const fieldName = "name" in field ? (field.name as string) : undefined;
        const fieldPath = fieldName
          ? path
            ? `${path}.${fieldName}`
            : fieldName
          : path;

        if (field.type === "relationship" || field.type === "upload") {
          const relationTo = (field as { relationTo?: string | string[] })
            .relationTo;

          if (relationTo) {
            const targets = Array.isArray(relationTo)
              ? relationTo
              : [relationTo];

            for (const target of targets) {
              if (!allSlugs.has(target)) {
                result.errors.push({
                  collection: config.slug,
                  field: fieldPath || "(root)",
                  targetCollection: target,
                  reason: `Target collection '${target}' does not exist`,
                });
              } else if (uiOnlySlugs.has(target)) {
                // Target exists but is UI-only (could be deleted/modified via Admin UI)
                result.warnings.push({
                  collection: config.slug,
                  field: fieldPath || "(root)",
                  message: `Relationship targets UI collection '${target}' which may be modified or deleted via Admin UI. Consider using code-first for stable references.`,
                });
              }
            }
          }
        }

        if ("fields" in field && Array.isArray(field.fields)) {
          processFields(field.fields as FieldConfig[], fieldPath);
        }
      }
    };

    processFields(config.fields);
  }

  private convertToCodeFirstConfigs(
    collections: CollectionConfig[]
  ): CodeFirstCollectionConfig[] {
    return collections.map(config => ({
      slug: config.slug,
      labels: {
        singular: config.labels?.singular ?? toSingularLabel(config.slug),
        plural: config.labels?.plural ?? toPluralLabel(config.slug),
      },
      fields: config.fields,
      description: config.description,
      tableName: config.dbName ?? config.slug.replace(/-/g, "_"),
      timestamps: config.timestamps ?? true,
      admin: config.admin
        ? {
            group: config.admin.group,
            icon: config.admin.icon,
            hidden: config.admin.hidden,
            useAsTitle: config.admin.useAsTitle,
            isPlugin: config.admin.isPlugin,
            pagination: config.admin.pagination
              ? {
                  defaultLimit: config.admin.pagination.defaultLimit,
                  limits: config.admin.pagination.limits,
                }
              : undefined,
            // Include custom components for plugins (e.g., custom Edit views)
            components: config.admin.components,
          }
        : undefined,
    }));
  }

  private async handleRemovedCollections(
    removed: Array<{ slug: string; tableName: string }>,
    action: "warn" | "delete" | "ignore",
    warnings: string[]
  ): Promise<Set<string>> {
    const deletedSlugs = new Set<string>();

    switch (action) {
      case "warn":
        for (const { slug } of removed) {
          const warning = `Collection "${slug}" exists in database but was removed from code. Run with --remove-orphaned to delete.`;
          warnings.push(warning);
          this.logger.warn(warning);
        }
        break;

      case "delete":
        for (const { slug, tableName } of removed) {
          try {
            // Delete from registry directly via raw query to avoid
            // re-fetch issues with getCollection/updateCollection
            await this.adapter.delete(
              "dynamic_collections",
              this.whereEq("slug", slug)
            );

            const capabilities = this.adapter.getCapabilities();
            const q = capabilities.dialect === "mysql" ? "`" : '"';
            const sql =
              capabilities.dialect === "postgresql"
                ? `DROP TABLE IF EXISTS ${q}${tableName}${q} CASCADE`
                : `DROP TABLE IF EXISTS ${q}${tableName}${q}`;
            await this.adapter.executeQuery(sql);

            deletedSlugs.add(slug);
            this.logger.info(
              `Deleted orphaned collection: ${slug} (table: ${tableName})`
            );
          } catch (error) {
            const warning = `Failed to delete collection "${slug}": ${error instanceof Error ? error.message : String(error)}`;
            warnings.push(warning);
            this.logger.error(warning);
          }
        }
        break;

      case "ignore":
        break;
    }

    return deletedSlugs;
  }

  private detectDialect(): SupportedDialect {
    const capabilities = this.adapter.getCapabilities();
    return capabilities.dialect;
  }

  /**
   * Generate Zod validation schema files for collections.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  private async generateZodSchemas(
    collections: CollectionConfig[],
    schemasDir: string,
    opts: { cwd: string; dryRun: boolean }
  ): Promise<string[]> {
    if (collections.length === 0) {
      return [];
    }

    const generator = new ZodGenerator();
    const generatedFiles: string[] = [];

    const records = this.convertToRecords(collections);

    const schemas = generator.generateAllSchemas(records);

    const indexFile = generator.generateIndexFile(records);

    const outputDir = resolve(opts.cwd, schemasDir, "zod");

    if (!opts.dryRun) {
      if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
      }

      for (const schema of schemas) {
        const filePath = join(outputDir, schema.filename);
        writeFileSync(filePath, schema.code, "utf-8");
        generatedFiles.push(filePath);
        this.logger.debug(`Generated Zod schema: ${filePath}`);
      }

      const indexPath = join(outputDir, indexFile.filename);
      writeFileSync(indexPath, indexFile.code, "utf-8");
      generatedFiles.push(indexPath);
      this.logger.debug(`Generated Zod index: ${indexPath}`);
    } else {
      for (const schema of schemas) {
        generatedFiles.push(join(outputDir, schema.filename));
      }
      generatedFiles.push(join(outputDir, indexFile.filename));
    }

    return generatedFiles;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  private async generateTypeScriptTypes(
    collections: CollectionConfig[],
    outputFile: string,
    opts: { cwd: string; dryRun: boolean }
  ): Promise<string | undefined> {
    if (collections.length === 0) {
      return undefined;
    }

    const generator = new TypeGenerator();

    // Convert to DynamicCollectionRecord format for generator
    const records = this.convertToRecords(collections);

    // Generate types file
    const typesFile = generator.generateTypesFile(records);

    // Resolve output path
    const outputPath = resolve(opts.cwd, outputFile);

    if (!opts.dryRun) {
      // Ensure directory exists
      const dir = dirname(outputPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      // Write types file
      writeFileSync(outputPath, typesFile.code, "utf-8");
      this.logger.debug(`Generated types: ${outputPath}`);
    }

    return outputPath;
  }

  /**
   * Convert CollectionConfig to DynamicCollectionRecord format for generators.
   *
   * Creates a minimal record with fields needed for code generation.
   */
  private convertToRecords(
    collections: CollectionConfig[]
  ): DynamicCollectionRecord[] {
    return collections.map(config => {
      // Use dc_ prefix for table names (same as dynamic collections)
      const baseTableName = config.dbName ?? config.slug.replace(/-/g, "_");
      const tableName = baseTableName.startsWith("dc_")
        ? baseTableName
        : `dc_${baseTableName}`;

      return {
        id: `temp-${config.slug}`,
        slug: config.slug,
        labels: {
          singular: config.labels?.singular ?? toSingularLabel(config.slug),
          plural: config.labels?.plural ?? toPluralLabel(config.slug),
        },
        tableName,
        description: config.description,
        fields: config.fields,
        timestamps: config.timestamps ?? true,
        // Why: status from defineCollection() input if present, otherwise false.
        // Code-first authors opt in by setting `status: true` on the config.
        status: (config as { status?: boolean }).status === true,
        admin: config.admin
          ? {
              group: config.admin.group,
              icon: config.admin.icon,
              hidden: config.admin.hidden,
              useAsTitle: config.admin.useAsTitle,
              isPlugin: config.admin.isPlugin,
              pagination: config.admin.pagination
                ? {
                    defaultLimit: config.admin.pagination.defaultLimit,
                    limits: config.admin.pagination.limits,
                  }
                : undefined,
              // Include custom components for plugins (e.g., custom Edit views)
              components: config.admin.components,
            }
          : undefined,
        source: "code",
        locked: true,
        schemaHash: "",
        schemaVersion: 1,
        migrationStatus: "pending",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    });
  }
}
