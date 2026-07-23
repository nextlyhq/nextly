import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { FieldDefinition } from "@nextly/schemas/dynamic-collections";

import { toDbError } from "../../../database/errors";
// PR 4 migration: switched DB error mapping from the legacy
// mapDbErrorToServiceError helper to NextlyError.fromDatabaseError. The
// public method return shape (MetadataServiceResult) is preserved because
// out-of-scope callers (CollectionService orchestrator, dynamic-collections)
// still consume the result tuple; only the internal error mapping changed.
import type { PermissionSeedService } from "../../../domains/auth/services/permission-seed-service";
import { NextlyError, isProgrammerError } from "../../../errors";
import type { CollectionFileManager } from "../../../services/collection-file-manager";
import type { Logger } from "../../../services/shared";
import { BaseService } from "../../../shared/base-service";
import type { SupportedDialect } from "../../../types/database";
import { teardownEntityComponentData } from "../../components/services/teardown-entity-component-data";
import type { DynamicCollectionService } from "../../dynamic-collections";
import { teardownEntityI18n } from "../../i18n/migration/teardown-entity-i18n";

/** Result shape returned by metadata service methods. */
export interface MetadataServiceResult {
  success: boolean;
  statusCode: number;
  message: string;
  data: Record<string, unknown> | Record<string, unknown>[] | null;
  meta?: Record<string, unknown>;
}

/**
 * Convert any thrown error to a MetadataServiceResult failure shape.
 *
 * Maps DbErrors via NextlyError.fromDatabaseError; non-DbError throwables
 * route through the requested fallback path so caller-supplied status codes
 * (e.g. 400 for validation, 404 for not-found) still apply when the cause
 * is not a database failure. Identifying detail (slug, table name, etc.)
 * stays in logContext per §13.8 and never reaches the wire.
 */
function errorToMetadataResult(
  error: unknown,
  fallback: { statusCode: number; defaultMessage: string },
  dialect: SupportedDialect
): MetadataServiceResult {
  // NextlyError instances already carry public/log payloads in the right
  // shape; surface the publicMessage and statusCode and drop logContext.
  if (NextlyError.is(error)) {
    return {
      success: false,
      statusCode: error.statusCode,
      message: error.publicMessage,
      data: null,
    };
  }
  // Best-effort DbError detection — fromDatabaseError handles both DbError
  // and arbitrary throwables and never leaks driver text. Free helper takes
  // dialect explicitly (no `this`); without normalising via toDbError(dialect)
  // first, real unique/fk violations would collapse to INTERNAL_ERROR and the
  // caller's fallback statusCode would always win.
  // A defect in our own code (a bad property access, a missing binding) is not
  // a caller mistake, so it must not inherit the caller's 4xx fallback. Left
  // unchecked, a TypeError reaches the wire as "Validation failed" and sends
  // the caller hunting through their payload for a bug that is ours.
  if (isProgrammerError(error)) {
    return {
      success: false,
      statusCode: 500,
      message: fallback.defaultMessage,
      data: null,
    };
  }
  const mapped = NextlyError.fromDatabaseError(toDbError(dialect, error));
  // If the input was a true DbError, fromDatabaseError returns a non-internal
  // code. For anything else we honour the caller's fallback so e.g.
  // "Failed to create collection" stays a 400 not a 500.
  if (mapped.code === "INTERNAL_ERROR") {
    return {
      success: false,
      statusCode: fallback.statusCode,
      message: error instanceof Error ? error.message : fallback.defaultMessage,
      data: null,
    };
  }
  return {
    success: false,
    statusCode: mapped.statusCode,
    message: mapped.publicMessage,
    data: null,
  };
}

/**
 * Synthetic title field definition for dynamic collections.
 * This field is automatically added to all UI-created collections.
 * Used as the primary display name for entries.
 */
const TITLE_FIELD: FieldDefinition = {
  name: "title",
  type: "text",
  label: "Title",
  required: true,
  admin: {
    placeholder: "Enter title",
  },
};

/**
 * Synthetic slug field definition for dynamic collections.
 * This field is automatically added to all UI-created collections.
 * Auto-generated from title/name if left empty.
 */
const SLUG_FIELD: FieldDefinition = {
  name: "slug",
  type: "text",
  label: "Slug",
  required: true,
  unique: true,
  admin: {
    placeholder: "my-entry-slug",
  },
  validation: {
    pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
    message: "Slug must be lowercase with hyphens only (e.g., my-entry-slug)",
  },
};

/**
 * Parse labels from a JSON string or return as-is if already an object.
 * SQLite stores JSON columns as strings, so we need to handle both cases.
 */
function parseLabels(
  labels: unknown
): { singular: string; plural: string } | undefined {
  if (!labels) return undefined;
  if (typeof labels === "string") {
    try {
      return JSON.parse(labels) as { singular: string; plural: string };
    } catch {
      return undefined;
    }
  }
  if (typeof labels === "object") {
    return labels as { singular: string; plural: string };
  }
  return undefined;
}

/**
 * CollectionMetadataService handles all collection-level CRUD operations.
 *
 * Responsibilities:
 * - Create new collections (schema generation, migration, registration)
 * - List collections with pagination and search
 * - Get single collection details
 * - Update collection metadata and schema
 * - Delete collections
 *
 * Uses the database adapter pattern for multi-database support (PostgreSQL, MySQL, SQLite).
 * Delegates actual database operations to DynamicCollectionService.
 *
 * @extends BaseService - Provides adapter access and transaction helpers
 *
 * @example
 * ```typescript
 * const metadataService = new CollectionMetadataService(
 *   adapter, logger, fileManager, collectionService
 * );
 * const result = await metadataService.createCollection({
 *   name: 'posts',
 *   label: 'Posts',
 *   fields: [...]
 * });
 * ```
 */
export class CollectionMetadataService extends BaseService {
  private permissionSeedService?: PermissionSeedService;

  constructor(
    adapter: DrizzleAdapter,
    logger: Logger,
    private readonly fileManager: CollectionFileManager,
    private readonly collectionService: DynamicCollectionService
  ) {
    super(adapter, logger);
  }

  /**
   * Set the PermissionSeedService for auto-seeding permissions on collection changes.
   * Called from DI registration after both services are constructed.
   */
  setPermissionSeedService(service: PermissionSeedService): void {
    this.permissionSeedService = service;
  }

  /**
   * Seed CRUD permissions for a collection and assign to super_admin.
   * Non-blocking — errors are logged but do not fail the parent operation.
   */
  private async seedPermissionsForCollection(slug: string): Promise<void> {
    if (!this.permissionSeedService) return;

    try {
      const result =
        await this.permissionSeedService.seedCollectionPermissions(slug);

      if (result.newPermissionIds.length > 0) {
        await this.permissionSeedService.assignNewPermissionsToSuperAdmin(
          result.newPermissionIds
        );
      }

      if (result.created > 0) {
        this.logger.info(
          `Permissions seeded for collection "${slug}": ${result.created} created, ${result.skipped} already existed`
        );
      }
    } catch (error) {
      this.logger.warn(
        `Failed to seed permissions for collection "${slug}": ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Register a runtime-generated Drizzle schema in the adapter's table resolver
   * so the table is immediately usable without server restart.
   */
  private async registerRuntimeSchema(
    tableName: string,
    fields: FieldDefinition[],
    options?: { hasStatus?: boolean; localized?: boolean }
  ): Promise<void> {
    try {
      const { generateRuntimeSchema } = await import(
        "../../schema/services/runtime-schema-generator"
      );
      const dialect = this.adapter.getCapabilities().dialect;
      const localized = options?.localized === true;
      const { table } = generateRuntimeSchema(tableName, fields, dialect, {
        status: options?.hasStatus === true,
        // i18n: omit translatable columns from the main runtime table (they live in
        // the companion), so reads/writes in the current process are correct without
        // a restart — matching the just-created physical table.
        localized,
      });
      // The entry-list read resolves its SELECT columns from the file manager's own schema
      // cache, which is separate from the adapter resolver below. The schema-apply path
      // refreshes both (CollectionsHandler.refreshCollectionSchema); this metadata path must
      // too, or a localization toggle updates CRUD but leaves the read selecting the moved
      // column from a table that no longer has it. Same shared file manager instance, so this
      // reaches the exact cache the read consumes.
      this.fileManager.refreshSchema(tableName, table);
      const resolver = (
        this.adapter as unknown as {
          tableResolver?: {
            registerDynamicSchema?: (name: string, table: unknown) => void;
          };
        }
      ).tableResolver;
      if (resolver && typeof resolver.registerDynamicSchema === "function") {
        resolver.registerDynamicSchema(tableName, table);
      }
      // i18n: also push the companion `_locales` runtime table into BOTH consumers, so the
      // current process resolves it for localized reads/writes before any restart. The read
      // path caches the companion under `<table>_locales` in the same file-manager registry
      // (loadCompanionSchema), so a metadata change on an already-cached collection must
      // replace that entry too or entry reads keep the pre-change companion column set.
      if (localized) {
        const { buildCompanionRuntimeTable } = await import(
          "../../i18n/runtime/companion-registration"
        );
        const companion = buildCompanionRuntimeTable({
          slug: tableName,
          tableName,
          fields: fields,
          dialect,
          localized: true,
          status: options?.hasStatus === true,
        });
        if (companion) {
          this.fileManager.refreshSchema(
            companion.companionTableName,
            companion.table
          );
          if (
            resolver &&
            typeof resolver.registerDynamicSchema === "function"
          ) {
            resolver.registerDynamicSchema(
              companion.companionTableName,
              companion.table
            );
          }
        }
      }
    } catch {
      // Non-fatal: schema will be registered on next server restart
    }
  }

  /**
   * Check if running in development mode.
   */
  private isDevelopment(): boolean {
    return process.env.NODE_ENV === "development";
  }

  /**
   * Register dynamic schemas with the file manager.
   *
   * @param schemas - Map of schema names to schema objects
   */
  registerDynamicSchemas(schemas: Record<string, unknown>): void {
    this.fileManager.registerSchemas(schemas);
  }

  /** Drop the cached Drizzle schema for one slug so the next load rebuilds it. */
  invalidateSchemaForSlug(collectionName: string): void {
    this.fileManager.invalidateSchemaForSlug(collectionName);
  }

  /**
   * Create a new collection.
   * Generates schema, migration files, and registers the collection.
   *
   * @param data - Collection creation data
   * @returns Service result with created collection or error
   */
  async createCollection(data: {
    name: string;
    label: string;
    description?: string;
    icon?: string;
    group?: string;
    useAsTitle?: string;
    hidden?: boolean;
    order?: number;
    sidebarGroup?: string;
    /** Whether the collection has the Draft/Published status feature enabled. */
    status?: boolean;
    /** i18n: whether the collection is localized (translatable fields + companion table). */
    localized?: boolean;
    /** Whether every save is recorded as a restorable version. */
    versions?: boolean;
    fields: FieldDefinition[];
    hooks?: Record<string, unknown>[];
    createdBy?: string;
  }): Promise<MetadataServiceResult> {
    try {
      const artifacts = await this.collectionService.generateCollection(data);

      // Persist the SQL migration. The Drizzle `.ts` schema is no longer
      // written — the runtime builds it from dynamic_collections metadata,
      // matching singles/components (see CollectionFileManager.saveMigration).
      await this.fileManager.saveMigration(
        artifacts.migrationSQL,
        artifacts.migrationFileName
      );

      if (this.isDevelopment()) {
        try {
          await this.fileManager.runMigration(artifacts.migrationSQL);
          // Verify table was actually created before marking as applied
          const tableExists = await this.adapter.tableExists(
            artifacts.tableName
          );
          if (tableExists) {
            artifacts.metadata.migrationStatus = "applied";
            await this.registerRuntimeSchema(artifacts.tableName, data.fields, {
              hasStatus: data.status === true,
              // i18n: register the main table without translatable columns and register
              // the companion, so reads/writes route localized fields correctly.
              localized: data.localized === true,
            });
          } else {
            artifacts.metadata.migrationStatus = "failed";
            this.logger.error(
              `Table "${artifacts.tableName}" was not created after migration`
            );
          }
        } catch (migrationError: unknown) {
          artifacts.metadata.migrationStatus = "failed";
          this.logger.error(
            `Migration execution failed: ${migrationError instanceof Error ? migrationError.message : String(migrationError)}`
          );
        }
      }

      // Database operation — convert DB errors via NextlyError.fromDatabaseError.
      // The factory's generic "Resource already exists." replaces the legacy
      // override "Collection with this name already exists" because §13.8
      // forbids identifier echoing on the wire; the slug remains in logContext
      // through fromDatabaseError's `cause` chain.
      let collection;
      try {
        collection = await this.collectionService.registerCollection(
          artifacts.metadata
        );
      } catch (dbError: unknown) {
        return errorToMetadataResult(
          dbError,
          {
            statusCode: 500,
            defaultMessage: "Failed to save collection to database",
          },
          this.dialect
        );
      }

      // Auto-seed CRUD permissions for the new collection
      await this.seedPermissionsForCollection(artifacts.metadata.slug);

      return {
        success: true,
        statusCode: 201,
        message: this.isDevelopment()
          ? "Collection created! Restart the app to use it in production."
          : "Collection created! Deploy and restart to apply changes.",
        data: collection,
      };
    } catch (error: unknown) {
      // Validation or file-system errors keep the legacy 400 status. DB errors
      // bubbling up here (rare — most are caught at the inner try/catch) are
      // routed through fromDatabaseError so we never echo driver text.
      return errorToMetadataResult(
        error,
        {
          statusCode: 400,
          defaultMessage: "Failed to create collection",
        },
        this.dialect
      );
    }
  }

  /**
   * List collections with pagination, search, and sorting.
   *
   * Includes schema by default since the UI needs field counts for display.
   * Consumers can set includeSchema: false for API-only use cases where
   * field details are not needed.
   *
   * @param options - Pagination, search, and sort options
   * @returns Paginated list of collections
   */
  async listCollections(options?: {
    page?: number;
    limit?: number;
    search?: string;
    // "name" is the admin/API alias for "slug" — both sort on the slug column.
    sortBy?: "name" | "slug" | "createdAt" | "updatedAt";
    sortOrder?: "asc" | "desc";
    includeSchema?: boolean;
  }): Promise<MetadataServiceResult> {
    try {
      // Include schema by default since the UI needs field counts
      // Consumers can override with includeSchema: false for API-only use cases
      const result = await this.collectionService.listCollections({
        ...options,
        includeSchema: options?.includeSchema ?? true,
      });

      // Transform database format to API format expected by the UI
      // Database: { slug, labels: { singular, plural }, fields }
      // API: { name, label, labels (parsed), schemaDefinition: { fields } }
      const transformedCollections = (
        result.collections as unknown as Record<string, unknown>[]
      ).map(collection => {
        // Inject synthetic title/slug field definitions for entry forms.
        // These columns ALWAYS exist in the physical table (enforced by
        // runtime-schema-generator.ts) so the admin UI needs field configs
        // for them to render inputs. Skip if the user already defined them
        // in their code-first config (mirrors the dedup in
        // runtime-schema-generator.ts lines 97-107).
        const baseFields = (collection.fields || []) as Record<
          string,
          unknown
        >[];
        const hasTitle = baseFields.some(f => f.name === "title");
        const hasSlug = baseFields.some(f => f.name === "slug");
        const fields = [
          ...(hasTitle ? [] : [TITLE_FIELD]),
          ...(hasSlug ? [] : [SLUG_FIELD]),
          ...baseFields,
        ];

        // Parse labels from JSON string if needed (SQLite stores JSON as strings)
        const parsedLabels = parseLabels(collection.labels);

        return {
          ...collection,
          // Map slug to name for UI compatibility
          name: collection.slug,
          // Map labels.singular to label for UI compatibility
          label: parsedLabels?.singular || collection.slug,
          // Always provide labels as a parsed object so plural form is accessible
          labels: parsedLabels,
          // Set fields at root level (admin checks this first)
          fields,
          // Also wrap in schemaDefinition for backwards compatibility
          schemaDefinition: {
            fields,
          },
        };
      });

      // Debug: log admin fields to verify sidebarGroup in API response.
      // `c.slug` and `c.admin.sidebarGroup` are typed `unknown`; narrow each to a
      // string before interpolation to satisfy restrict-template-expressions and
      // no-base-to-string (which forbid stringifying objects via template literals).
      console.log(
        "[listCollections] Collections admin summary:",
        transformedCollections
          .map((c: Record<string, unknown>) => {
            const slug = typeof c.slug === "string" ? c.slug : String(c.slug);
            const sidebarGroupRaw = (
              c.admin as Record<string, unknown> | undefined
            )?.sidebarGroup;
            const sidebarGroup =
              typeof sidebarGroupRaw === "string" && sidebarGroupRaw.length > 0
                ? sidebarGroupRaw
                : "none";
            return `${slug}: sidebarGroup=${sidebarGroup}`;
          })
          .join(", ")
      );

      return {
        success: true,
        statusCode: 200,
        message: "Collections fetched successfully",
        data: transformedCollections,
        meta: {
          total: result.total,
          page: result.page,
          limit: result.limit,
          totalPages: result.totalPages,
        },
      };
    } catch (error: unknown) {
      // List failures default to 500. fromDatabaseError handles real DB
      // errors with the §13.8-compliant generic public message.
      return errorToMetadataResult(
        error,
        {
          statusCode: 500,
          defaultMessage: "Failed to fetch collections",
        },
        this.dialect
      );
    }
  }

  /**
   * Get a single collection by name.
   *
   * @param params - Parameters containing collection name
   * @returns Collection details or error
   */
  async getCollection(params: {
    collectionName: string;
  }): Promise<MetadataServiceResult> {
    try {
      const collection = await this.collectionService.getCollection(
        params.collectionName
      );

      // Transform database format to API format expected by the UI
      // Database: { slug, labels: { singular, plural }, fields }
      // API: { name, label, labels (parsed), schemaDefinition: { fields } }
      // For dynamic collections (not code-first or built-in), inject the slug field
      // at the beginning of the fields array so it appears in the entry form.
      // Dynamic collections: source is "ui", undefined, or null
      // Code-first collections: source is "code" or "built-in"

      console.log(
        `[NEXTLY DEBUG] getCollection - raw DB record for "${params.collectionName}":`,
        {
          id: collection.id,
          slug: collection.slug,
          name: collection.name,
          label: collection.label,
          labelsRaw: collection.labels,
          labelsType: typeof collection.labels,
          source: collection.source,
        }
      );

      // Inject synthetic title/slug field definitions for the entry form
      // unless the user already defined them in their code-first config.
      // See note above in the list handler for why this applies to both
      // code-first and UI-first collections.
      const baseFields = (collection.fields || []) as Array<{
        name?: string;
        [k: string]: unknown;
      }>;
      const hasTitle = baseFields.some(f => f.name === "title");
      const hasSlug = baseFields.some(f => f.name === "slug");
      const fields = [
        ...(hasTitle ? [] : [TITLE_FIELD]),
        ...(hasSlug ? [] : [SLUG_FIELD]),
        ...baseFields,
      ];

      // Parse labels from JSON string if needed (SQLite stores JSON as strings)
      const parsedLabels = parseLabels(collection.labels);

      console.log(
        `[NEXTLY DEBUG] getCollection - parsed labels for "${params.collectionName}":`,
        {
          parsedLabels,
          finalName: collection.slug,
          finalLabel: parsedLabels?.singular || collection.slug,
        }
      );

      const transformedCollection = {
        ...collection,
        // Map slug to name for UI compatibility
        name: collection.slug,
        // Map labels.singular to label for UI compatibility
        label: parsedLabels?.singular || collection.slug,
        // Always provide labels as a parsed object so plural form is accessible
        labels: parsedLabels,
        // Set fields at root level (admin checks this first)
        fields,
        // Also wrap in schemaDefinition for backwards compatibility
        schemaDefinition: {
          fields,
        },
      };

      console.log(
        `[NEXTLY DEBUG] getCollection - final transformed for "${params.collectionName}":`,
        {
          name: transformedCollection.name,
          label: transformedCollection.label,
          labels: transformedCollection.labels,
        }
      );

      return {
        success: true,
        statusCode: 200,
        message: "Collection fetched successfully",
        data: transformedCollection,
      };
    } catch (error: unknown) {
      // The underlying registry now throws NextlyError.notFound which carries
      // its own publicMessage and 404 status — pass it through. Anything else
      // falls back to the legacy 404 default the original code used.
      return errorToMetadataResult(
        error,
        {
          statusCode: 404,
          defaultMessage: "Collection not found",
        },
        this.dialect
      );
    }
  }

  /**
   * Update a collection's metadata and/or schema.
   *
   * @param params - Parameters containing collection name
   * @param body - Update data (label, description, icon, fields)
   * @returns Updated collection or error
   */
  async updateCollection(
    params: { collectionName: string },
    body: {
      label?: string;
      description?: string;
      icon?: string;
      group?: string;
      useAsTitle?: string;
      hidden?: boolean;
      order?: number;
      sidebarGroup?: string;
      /** Toggle Draft/Published. Honoured when defined; undefined leaves it unchanged. */
      status?: boolean;
      /** i18n: toggle Internationalization. Honoured when defined; undefined leaves it unchanged. */
      localized?: boolean;
      /** Toggle version history. Honoured when defined; undefined leaves it unchanged. */
      versions?: boolean;
      fields?: FieldDefinition[];
      hooks?: Record<string, unknown>[];
    }
  ): Promise<MetadataServiceResult> {
    try {
      const updateArtifacts =
        await this.collectionService.generateCollectionUpdate(
          params.collectionName,
          body
        );

      // If the data table changed, persist the SQL migration. No Drizzle
      // `.ts` schema is written — the runtime regenerates it from the
      // dynamic_collections metadata, matching singles/components.
      if (updateArtifacts.migrationSQL) {
        await this.fileManager.saveMigration(
          updateArtifacts.migrationSQL,
          updateArtifacts.migrationFileName!
        );

        if (this.isDevelopment()) {
          try {
            await this.fileManager.runMigration(updateArtifacts.migrationSQL);
            // Get collection to access table name for verification
            const existingCollection =
              await this.collectionService.getCollection(params.collectionName);
            const tableExists = await this.adapter.tableExists(
              existingCollection.tableName
            );
            if (tableExists) {
              updateArtifacts.metadataUpdates.migrationStatus = "applied";
              // i18n: a localization enable/disable toggle changes the main table's column
              // shape (drops or restores translatable columns) even with no field edit, so the
              // runtime schema must be re-registered on a flag-only toggle too, not only when
              // `body.fields` is present.
              const wasLocalizedNow =
                (existingCollection as { localized?: boolean }).localized ===
                true;
              const isLocalizedNow =
                body.localized !== undefined
                  ? body.localized === true
                  : wasLocalizedNow;
              if (body.fields || wasLocalizedNow !== isLocalizedNow) {
                // Resolve hasStatus from the update payload, falling back
                // to the collection's existing flag so the runtime
                // schema descriptor matches the table the migration
                // just produced.
                const wasStatus =
                  (existingCollection as { status?: boolean }).status === true;
                const hasStatus =
                  body.status !== undefined ? body.status === true : wasStatus;
                await this.registerRuntimeSchema(
                  existingCollection.tableName,
                  body.fields ??
                    (existingCollection.fields as FieldDefinition[]),
                  {
                    hasStatus,
                    // i18n: re-register the main table with the new localized shape and
                    // (re)register/drop the companion after the update, so the current process
                    // resolves them correctly without a restart.
                    localized: isLocalizedNow,
                  }
                );
              }
            } else {
              updateArtifacts.metadataUpdates.migrationStatus = "failed";
              this.logger.error(
                `Table "${existingCollection.tableName}" not found after migration update`
              );
            }
          } catch (migrationError: unknown) {
            updateArtifacts.metadataUpdates.migrationStatus = "failed";
            this.logger.error(
              `Migration update failed: ${migrationError instanceof Error ? migrationError.message : String(migrationError)}`
            );
          }

          // No on-disk hot-reload needed: registerRuntimeSchema above already
          // refreshed the in-memory Drizzle table from the new field list.
        }
      }

      // Database operation — DB errors map via NextlyError.fromDatabaseError.
      // The legacy override "Collection with this name already exists" is
      // dropped: the factory's generic "Resource already exists." satisfies
      // §13.8 and the slug stays in logContext via the underlying DbError
      // cause chain.
      let updated;
      try {
        updated = await this.collectionService.updateCollectionMetadata(
          params.collectionName,
          updateArtifacts.metadataUpdates
        );
      } catch (dbError: unknown) {
        return errorToMetadataResult(
          dbError,
          {
            statusCode: 500,
            defaultMessage: "Failed to update collection in database",
          },
          this.dialect
        );
      }

      // Ensure CRUD permissions exist for the collection (idempotent)
      await this.seedPermissionsForCollection(params.collectionName);

      return {
        success: true,
        statusCode: 200,
        message: updateArtifacts.migrationSQL
          ? this.isDevelopment()
            ? "Collection updated! Database and schema changes applied successfully."
            : "Collection updated! Deploy and restart to apply changes."
          : "Collection metadata updated successfully.",
        data: updated,
      };
    } catch (error: unknown) {
      // Validation/file-system errors keep the legacy 400. NextlyError or
      // DbError instances pass through with their own status/message.
      return errorToMetadataResult(
        error,
        {
          statusCode: 400,
          defaultMessage: "Failed to update collection",
        },
        this.dialect
      );
    }
  }

  /**
   * Delete a collection.
   * Generates drop migration, deletes schema file, and unregisters the collection.
   *
   * @param params - Parameters containing collection name
   * @returns Deletion result
   */
  async deleteCollection(params: {
    collectionName: string;
  }): Promise<MetadataServiceResult> {
    try {
      const collection = await this.collectionService.getCollection(
        params.collectionName
      );

      // Embedded component instances live in `comp_<slug>` tables keyed by a plain
      // `_parent_table` string with no FK, so dropping this collection's table cascades
      // nothing and would strand every instance. Sweep them (and any nested instances)
      // before the drop.
      await teardownEntityComponentData({
        adapter: this.adapter,
        parentTable: collection.tableName,
      });

      // Tear down the localization artifacts in-process, before the main table goes.
      // Unlike the main-table drop below this is not deferred to `nextly migrate`: the
      // companion holds an FK to `<main>.id` so dropping the child first is safe in every
      // environment, and the shared-archive purge is DML that no migration file should
      // carry (the archive table is created lazily and may not exist).
      await teardownEntityI18n({
        adapter: this.adapter,
        slug: params.collectionName,
        tableName: collection.tableName,
      });

      const dropArtifacts = this.collectionService.generateDropTableMigration(
        params.collectionName,
        collection.tableName
      );

      // Persist the drop migration. It is the durable DDL record applied by
      // `nextly migrate` in non-dev/deploy flows.
      await this.fileManager.saveDropMigration(
        dropArtifacts.migrationSQL,
        dropArtifacts.migrationFileName
      );

      // Run drop migration in development
      if (this.isDevelopment()) {
        await this.fileManager.runMigration(dropArtifacts.migrationSQL);
      }

      // Unregister from metadata
      await this.collectionService.unregisterCollection(params.collectionName);

      // Delete associated permissions
      if (this.permissionSeedService) {
        try {
          const permissionResult =
            await this.permissionSeedService.deletePermissionsForResource(
              params.collectionName
            );

          if (permissionResult.created > 0) {
            this.logger.info(
              `Deleted ${permissionResult.created} permission(s) for collection "${params.collectionName}"`
            );
          }

          if (permissionResult.skipped > 0) {
            this.logger.warn(
              `${permissionResult.skipped} permission(s) for "${params.collectionName}" could not be deleted (may be assigned to roles)`
            );
          }
        } catch (error) {
          this.logger.warn(
            `Failed to cleanup permissions for collection "${params.collectionName}": ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      return {
        success: true,
        statusCode: 200,
        message: "Collection deleted! Restart the app to complete removal.",
        data: { deleted: true },
      };
    } catch (error: unknown) {
      // Default 404 mirrors the original behaviour for "collection not found";
      // NextlyError instances flowing up from the registry already carry the
      // right status (404, 403 for locked collections, etc.).
      return errorToMetadataResult(
        error,
        {
          statusCode: 404,
          defaultMessage: "Failed to delete collection",
        },
        this.dialect
      );
    }
  }
}
