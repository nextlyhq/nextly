import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
// The transaction a write that must not outlive a collection holds its row in.
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import type { FieldDefinition } from "@nextly/schemas/dynamic-collections";

import { toDbError } from "../../../database/errors";
// PR 4 migration: switched DB error mapping from the legacy
// mapDbErrorToServiceError helper to NextlyError.fromDatabaseError. The
// public method return shape (MetadataServiceResult) is preserved because
// out-of-scope callers (CollectionService orchestrator, dynamic-collections)
// still consume the result tuple; only the internal error mapping changed.
import type { PermissionSeedService } from "../../../domains/auth/services/permission-seed-service";
import { NextlyError, isProgrammerError } from "../../../errors";
import { errorEnvelopeFields } from "../../../errors/from-service-envelope";
import type { UiSchemaEntity } from "../../../schemas/_zod/ui-schema";
import type { StoredHookConfig } from "../../../schemas/dynamic-collections/types";
import type { CollectionFileManager } from "../../../services/collection-file-manager";
import { assertGlobalResourceSlugAvailable } from "../../../services/lib/resource-slug-guard";
import type { Logger } from "../../../services/shared";
import { assertAddressAllowed } from "../../../shared/address-rule";
import { BaseService } from "../../../shared/base-service";
import { runReadsInTransaction } from "../../../shared/lib/read-transaction-scope";
import type { SupportedDialect } from "../../../types/database";
import type { DynamicCollectionService } from "../../dynamic-collections";
import { clearRegistryRowCache } from "../../dynamic-collections/services/collection-row-cache";
import type { UnregisteredCollectionRow } from "../../dynamic-collections/services/dynamic-collection-registry-service";
import type { CollectionArtifacts } from "../../dynamic-collections/services/dynamic-collection-service";
import { teardownEntityComponentData } from "../../field-groups/services/teardown-entity-field-group-data";
import { teardownEntityI18n } from "../../i18n/migration/teardown-entity-i18n";
import {
  publishesPerLanguage,
  storesPerLanguage,
} from "../../i18n/per-language-storage";
import {
  checkSaveHistory,
  writeCollectionSave,
  type BuilderSaveSetup,
  type CollectionSaveDeps,
} from "../../schema/builder-save/collection-save";
import {
  entityAfterUpdate,
  type UpdateSettings,
} from "../../schema/builder-save/update-save";
import { getActiveExtensionSchema } from "../../schema/extension/active-schema";
import {
  applyCollectionSchemaChange,
  refuseNewCollectionIndexNamesTaken,
} from "../../schema/services/collection-schema-apply";
import { withSchemaChangeExcluded } from "../../schema/services/schema-change-exclusion";
import { loadUiSchema } from "../../schema/ui-schema/loader";

import { collectionSaveIssuesDdl } from "./collection-save-issues-ddl";
import { collectionTableName } from "./collection-utils";
import type { TeardownAdapter } from "./teardown-adapter-in-transaction";

/** The parts of a collection's registry row its delete reads. */
interface DeletedCollectionRow {
  /** The registry row's id: a slug deleted and created again names a new one. */
  id?: unknown;
  tableName: string;
  labels?: { singular: string; plural: string };
  fields?: FieldDefinition[];
  /** Set on a code-first collection's row: its definition is the code's. */
  locked?: boolean | number | null;
}

/** Result shape returned by metadata service methods. */
export interface MetadataServiceResult {
  success: boolean;
  statusCode: number;
  message: string;
  data: Record<string, unknown> | Record<string, unknown>[] | null;
  meta?: Record<string, unknown>;
  /**
   * The failure's typed fields, so a boundary can rebuild the exact error
   * rather than guess it from the status. Absent on success and on an untyped
   * failure.
   */
  code?: string;
  messageKey?: string;
  publicData?: unknown;
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
      // The code above all: a boundary rebuilding from status alone cannot tell
      // a DUPLICATE from a CONFLICT, and an occupied slug would be reported as
      // a stale-resource conflict.
      ...errorEnvelopeFields(error),
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
      // The thrown error itself, which is all this branch has to contribute:
      // a defect in our own code must not lend the result a typed code, but it
      // is the only thing that names where the defect was, and a boundary
      // rebuilding a bare 500 has nothing else to chain.
      ...errorEnvelopeFields(error),
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
      // The ORIGINAL throwable, not `mapped`. This branch exists to refuse
      // `mapped`'s typing so the caller's fallback status survives, and taking
      // its fields here would put back the code the branch just declined; the
      // thrown error is also the one that actually names the failure.
      ...errorEnvelopeFields(error),
    };
  }
  return {
    success: false,
    statusCode: mapped.statusCode,
    message: mapped.publicMessage,
    data: null,
    // The mapped error is typed too. Without its code a raw unique violation
    // becomes a code-less 409, which a boundary reads as staleness rather than
    // the duplicate it is, and a mapped timeout loses DATABASE_ERROR.
    ...errorEnvelopeFields(mapped),
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
  /**
   * Where a Schema Builder save writes its definition and migration, and with
   * which config (`writeCollectionSave`). Set by the service registration;
   * absent, a create runs the collection's own DDL as it did before the
   * writer existed.
   */
  private builderSave?: BuilderSaveSetup;

  constructor(
    adapter: DrizzleAdapter,
    logger: Logger,
    private readonly fileManager: CollectionFileManager,
    private readonly collectionService: DynamicCollectionService
  ) {
    super(adapter, logger);
  }

  /**
   * Set where a Schema Builder save writes its definition and migration.
   * Called from the service registration, which knows the app's config.
   */
  setBuilderSave(setup: BuilderSaveSetup): void {
    this.builderSave = setup;
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
    options?: {
      hasStatus?: boolean;
      localized?: boolean;
      // Whether the companion keeps a `_status` of its own: per-language publishing, which only
      // a translated Draft/Published collection has. The main table's flag when not given.
      companionStatus?: boolean;
    }
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
          status: options?.companionStatus ?? options?.hasStatus === true,
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
    /** Whether writes bust cache tags. Default on; false opts out entirely. */
    revalidate?: boolean;
    /**
     * Whether writes are recorded to the webhook outbox. Default on; false
     * keeps this collection's content out of the outbox and every delivery.
     */
    webhooks?: boolean;
    fields: FieldDefinition[];
    /**
     * The canonical stored-hook shape, not a looser record: the registry row
     * these feed is typed with it, and the executor reads `config` and `order`
     * off every entry.
     */
    hooks?: StoredHookConfig[];
    createdBy?: string;
  }): Promise<MetadataServiceResult> {
    // Every collection create reaches this point (the Builder, the root-exported
    // CollectionService and plugins' ctx.services), so the address is judged here, before any
    // migration is written or DDL runs, and outside the result mapping below so the refusal keeps
    // its address and reason. The rule as written reads the request alone, so it is asked before
    // the lock is taken: a malformed address is answered as one, not with a lock refusal.
    assertAddressAllowed("collection", data.name);
    // The whole create holds the schema lock: the slug check, the migration it runs in
    // development, its file and the registry row. A storage migration running beside it could
    // rename the tables this create is checked against and built beside. Refused at once, and
    // thrown rather than returned as a result, so every caller answers it as the same
    // SERVICE_UNAVAILABLE with the editor's message.
    return withSchemaChangeExcluded(
      {
        adapter: this.adapter,
        logger: this.logger,
        label: `create collection "${data.name}"`,
        // The DDL runs here only in development; elsewhere this writes a migration file and a
        // registry row, and must not create the lock table on a role without DDL rights.
        issuesDdl: this.isDevelopment(),
      },
      () => this.createCollectionExcluded(data)
    );
  }

  /**
   * Write a create's definition and migration and, in development, run it,
   * through the Builder save writer; without one set up, run the create's own
   * DDL in development and keep its file, as before the writer. A refusal or
   * failure comes back as the result the caller returns.
   */
  private async writeCreate(artifacts: CollectionArtifacts): Promise<{
    refused?: MetadataServiceResult;
    /** Whether the migration that ran wrote the registry row already. */
    rowWritten: boolean;
  }> {
    const deps = this.saveDeps();
    if (deps !== undefined && artifacts.manifestEntity !== undefined) {
      try {
        await writeCollectionSave(deps, {
          slug: artifacts.metadata.slug,
          previous: null,
          entity: artifacts.manifestEntity,
          change: "create",
          junctions: this.collectionService.junctionStatements(
            artifacts.tableName,
            [],
            artifacts.metadata.fields
          ),
          keys: {
            before: [],
            after: this.collectionService.relationshipForeignKeys(
              artifacts.tableName,
              artifacts.metadata.fields
            ),
          },
        });
        return { rowWritten: this.isDevelopment() };
      } catch (error: unknown) {
        const refused = errorToMetadataResult(
          error,
          {
            statusCode: 500,
            defaultMessage: "The collection's migration could not be written",
          },
          this.dialect
        );
        return { refused, rowWritten: false };
      }
    }
    if (this.isDevelopment()) {
      try {
        // The artefact carries the registry-row upsert so the committed file
        // recreates it where the Builder has never run. This database gets
        // that row from `registerCollection` below, and it refuses a slug
        // that already exists -- so what runs HERE is the DDL alone.
        await this.fileManager.runMigration(
          artifacts.localMigrationSQL ?? artifacts.migrationSQL
        );
      } catch (migrationError: unknown) {
        const refused = errorToMetadataResult(
          migrationError,
          {
            statusCode: 500,
            defaultMessage: "The collection's table could not be created",
          },
          this.dialect
        );
        return { refused, rowWritten: false };
      }
    }
    // The Drizzle `.ts` schema is no longer written — the runtime builds it
    // from dynamic_collections metadata (see CollectionFileManager.saveMigration).
    await this.fileManager.saveMigration(
      artifacts.migrationSQL,
      artifacts.migrationFileName
    );
    return { rowWritten: false };
  }

  /**
   * Write an update's definition and migration through the Builder save
   * writer, recorded applied once `push` (the update's own push, in
   * development) has run; a settings-only update writes the settings-only
   * migration, recorded the same way. A refusal or failure comes back as the
   * result the caller returns.
   */
  private async writeUpdate(
    deps: CollectionSaveDeps,
    slug: string,
    before: DeletedCollectionRow,
    artifacts: { metadataUpdates: { fields?: FieldDefinition[] } },
    update: UpdateSettings,
    push: (() => Promise<void>) | undefined
  ): Promise<MetadataServiceResult | undefined> {
    try {
      const definition = await loadUiSchema({
        projectRoot: deps.projectRoot,
        uiSchemaFile: deps.config.db.uiSchemaFile,
      });
      const previous =
        definition.collections.find(c => c.slug === slug) ??
        definitionOfRow(slug, before);
      const beforeFields = before.fields ?? [];
      const fields = artifacts.metadataUpdates.fields ?? beforeFields;
      await writeCollectionSave(
        deps,
        {
          slug,
          previous,
          entity: entityAfterUpdate(previous, update, fields),
          change: "update",
          junctions: this.collectionService.junctionStatements(
            before.tableName,
            beforeFields,
            fields
          ),
          keys: {
            before: this.collectionService.relationshipForeignKeys(
              before.tableName,
              beforeFields
            ),
            after: this.collectionService.relationshipForeignKeys(
              before.tableName,
              fields
            ),
          },
        },
        { appliedBy: push ?? (() => Promise.resolve()) }
      );
      return undefined;
    } catch (error: unknown) {
      return errorToMetadataResult(
        error,
        {
          statusCode: 500,
          defaultMessage: "The schema change could not be applied",
        },
        this.dialect
      );
    }
  }

  private async createCollectionExcluded(
    data: Parameters<CollectionMetadataService["createCollection"]>[0]
  ): Promise<MetadataServiceResult> {
    // Against the addresses as they stand now that the lock is held, so a collection or Single
    // registered while this request waited is not built over.
    await assertGlobalResourceSlugAvailable(this.adapter, data.name, {
      addressKind: "collection",
    });
    try {
      const artifacts = await this.collectionService.generateCollection(data);

      // A save applies whole or fails whole: in development the migration runs before anything is
      // recorded, so a change the database refuses leaves no file, no registry row and nothing
      // reported as applied.
      if (this.isDevelopment()) {
        // An index name the new table takes may already be held elsewhere, where the create's
        // IF NOT EXISTS would skip it: refused before the table is created, naming the holder.
        try {
          await refuseNewCollectionIndexNamesTaken(this.adapter, {
            slug: data.name,
            tableName: artifacts.tableName,
            fields: artifacts.metadata.fields,
            localized: data.localized === true,
          });
        } catch (refusal: unknown) {
          return errorToMetadataResult(
            refusal,
            {
              statusCode: 400,
              defaultMessage: "The collection's indexes could not be created",
            },
            this.dialect
          );
        }
      }

      // The definition, then the migration `migrate:create` would write for
      // this collection and, in development, that file run as `nextly migrate`
      // runs it (`writeCollectionSave`).
      const write = await this.writeCreate(artifacts);
      if (write.refused !== undefined) return write.refused;

      if (this.isDevelopment()) {
        try {
          // Verify table was actually created before marking as applied
          const tableExists = await this.adapter.tableExists(
            artifacts.tableName
          );
          if (tableExists) {
            artifacts.metadata.migrationStatus = "applied";
            // The fields as the registry stores them, not as the request spelled them: the
            // table's columns were named from the stored names, and a restart rebuilds these
            // tables from them.
            await this.registerRuntimeSchema(
              artifacts.tableName,
              artifacts.metadata.fields,
              {
                hasStatus: data.status === true,
                // i18n: register the main table without translatable columns and register
                // the companion, so reads/writes route localized fields correctly.
                localized: storesPerLanguage(data),
                // As the migration laid it out: a collection that is not translated publishes
                // as a document, so its companion has no `_status` even when it is Draft/Published.
                companionStatus: publishesPerLanguage(data),
              }
            );
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
        // A migration the writer ran carries the registry row's upsert, as
        // every deploy needs it, so the row stands already: it takes the rest
        // of the metadata. Otherwise the row is written here.
        collection = write.rowWritten
          ? await this.collectionService.updateCollectionMetadata(
              artifacts.metadata.slug,
              artifacts.metadata
            )
          : await this.collectionService.registerCollection(artifacts.metadata);
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
    /**
     * Restrict results to these slugs, applied as a query condition so the
     * `total` this returns counts only rows the caller may see.
     */
    slugAllowlist?: string[];
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
      this.logger.info("[listCollections] Collections admin summary", {
        detail: transformedCollections
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
          .join(", "),
      });

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

      this.logger.info(
        `[NEXTLY DEBUG] getCollection - raw DB record for "${params.collectionName}"`,
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

      this.logger.info(
        `[NEXTLY DEBUG] getCollection - parsed labels for "${params.collectionName}"`,
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

      this.logger.info(
        `[NEXTLY DEBUG] getCollection - final transformed for "${params.collectionName}"`,
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
      /** Toggle cache revalidation. Honoured when defined; undefined leaves it unchanged. */
      revalidate?: boolean;
      /** Toggle webhook recording. Honoured when defined; undefined leaves it unchanged. */
      webhooks?: boolean;
      fields?: FieldDefinition[];
      /**
       * The canonical stored-hook shape, not a looser record: the registry row
       * these feed is typed with it, and the executor reads `config` and `order`
       * off every entry.
       */
      hooks?: StoredHookConfig[];
    }
  ): Promise<MetadataServiceResult> {
    // The whole update holds the schema lock, from the registry read the update is generated from
    // to the registry write, so a storage migration cannot move the table between them.
    return withSchemaChangeExcluded(
      {
        adapter: this.adapter,
        logger: this.logger,
        label: `update collection "${params.collectionName}"`,
        // Only a save that reshapes the table, in development, issues DDL here; a label or admin
        // option change writes the registry row alone.
        issuesDdl: collectionSaveIssuesDdl(body, this.isDevelopment()),
      },
      () => this.updateCollectionExcluded(params, body)
    );
  }

  /** The save, once the schema lock is held. */
  private async updateCollectionExcluded(
    params: { collectionName: string },
    body: Parameters<CollectionMetadataService["updateCollection"]>[1]
  ): Promise<MetadataServiceResult> {
    try {
      // The collection as it stands before the save, read inside the lock: what the apply changes
      // it from.
      const before = await this.collectionService.getCollection(
        params.collectionName
      );
      const updateArtifacts =
        await this.collectionService.generateCollectionUpdate(
          params.collectionName,
          body
        );

      // In development the update takes its change through one push of the
      // schema pipeline, with the archive it needs and what the push leaves
      // out of its diff (a renamed field group's association, the junction
      // tables), as it always has.
      const pushUpdate = async (): Promise<void> => {
        // The file is what a database built from migrations replays; this database takes the
        // change through one apply of the schema pipeline, as the schema dialog's does, which
        // diffs the table as it is, so a save the database refused part-way is finished by the
        // next. The file creates the archive when it is missing but cannot add the kind column
        // to an archive from before rows recorded it, which the apply's writes name.
        if (updateArtifacts.needsArchive) {
          const { ensureI18nArchive } = await import(
            "../../i18n/migration/ensure-archive"
          );
          await ensureI18nArchive(
            this.adapter,
            this.adapter.getCapabilities().dialect
          );
        }
        const wasLocalized =
          (before as { localized?: boolean }).localized === true;
        const wasStatus = (before as { status?: boolean }).status === true;
        const beforeFields = (before.fields ?? []) as FieldDefinition[];
        await applyCollectionSchemaChange({
          slug: params.collectionName,
          collection: { tableName: before.tableName, fields: beforeFields },
          fields: updateArtifacts.metadataUpdates.fields ?? beforeFields,
          wasLocalized,
          isLocalized:
            body.localized !== undefined
              ? body.localized === true
              : wasLocalized,
          status: body.status !== undefined ? body.status === true : wasStatus,
          wasStatus,
          renameResolutions: updateArtifacts.pushAnswers.renameResolutions,
          eventResolutions: [],
          legacyResolutions: updateArtifacts.pushAnswers.legacyResolutions,
          fills: updateArtifacts.pushAnswers.fills,
          // The save detects its own renames; every other pair is a drop and an add.
          dropAndAddUnansweredRenames: true,
        });
        // What the push leaves out of its diff, once it has run: a renamed field group's
        // association and the junction tables, as the file carries them.
        if (updateArtifacts.besideStatements) {
          await this.fileManager.runMigration(updateArtifacts.besideStatements);
        }
      };
      // With the Builder save writer set up, the update's migration is
      // `migrate:create`'s, recorded applied once the push has run, and a
      // settings-only update writes the settings-only migration.
      const writerDeps = this.saveDeps();
      if (writerDeps !== undefined) {
        const refused = await this.writeUpdate(
          writerDeps,
          params.collectionName,
          before,
          updateArtifacts,
          body,
          updateArtifacts.migrationSQL ? pushUpdate : undefined
        );
        if (refused !== undefined) return refused;
      }

      // If the data table changed, persist the SQL migration. No Drizzle
      // `.ts` schema is written — the runtime regenerates it from the
      // dynamic_collections metadata, matching singles/components.
      if (updateArtifacts.migrationSQL) {
        if (writerDeps === undefined) {
          // A save applies whole or fails whole: in development the migration runs before anything is
          // recorded, so a change the database refuses leaves no file, an unchanged registry and
          // nothing reported as applied.
          if (this.isDevelopment()) {
            try {
              await pushUpdate();
            } catch (migrationError: unknown) {
              return errorToMetadataResult(
                migrationError,
                {
                  statusCode: 500,
                  defaultMessage: "The schema change could not be applied",
                },
                this.dialect
              );
            }
          }
          await this.fileManager.saveMigration(
            updateArtifacts.migrationSQL,
            updateArtifacts.migrationFileName!
          );
        }

        if (this.isDevelopment()) {
          try {
            // The companion may have just been dropped or reshaped by that migration, and a
            // `ready` verdict outlives the table it describes: for up to its TTL, concurrent
            // requests on this same process would keep querying a relation that is gone instead of
            // reading the restored main-table values. Forgotten unconditionally — the verdict is
            // re-resolved on demand, so discarding one that was still valid costs a probe, while
            // keeping one that is not costs correctness. The dispatcher disable paths already do
            // this; the metadata path drops through `runMigration` and did not.
            {
              const existing = await this.collectionService.getCollection(
                params.collectionName
              );
              const { forgetCompanionReadiness } = await import(
                "../../i18n/runtime/companion-readiness"
              );
              forgetCompanionReadiness(
                this.adapter,
                `${existing.tableName}_locales`
              );
            }
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
                  // As stored, like the create: the save's own list when it changed the fields,
                  // else the registry's.
                  updateArtifacts.metadataUpdates.fields ??
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
   * Delete a collection, or several in one operation.
   * Generates drop migration, deletes schema file, and unregisters the collection.
   *
   * Refused before anything is removed while something outside the operation
   * depends on any of them: a field that points at one, a foreign key a plugin
   * or the app declares on one of their tables, or another owner's column,
   * index, foreign key or check on one of them (`collection-dependents`).
   * Collections deleted together are checked as one set, so two that point
   * only at each other can go, where deleting either alone is refused.
   *
   * @param params - The collection to delete, and those deleted with it
   * @returns Deletion result
   */
  async deleteCollection(params: {
    collectionName: string;
    /** Collections deleted in the same operation, after `collectionName`. */
    together?: readonly string[];
  }): Promise<MetadataServiceResult> {
    // The whole delete holds the schema lock: the rows it reads, the dependents it asks about,
    // the teardown and the drop. Each of those reads describes storage a migration could be
    // moving, and the delete acts on what they found.
    return withSchemaChangeExcluded(
      {
        adapter: this.adapter,
        logger: this.logger,
        label: `delete collection "${params.collectionName}"`,
        // The table drop runs here only in development; elsewhere the delete writes a drop
        // migration and removes rows. Its one DDL outside development, dropping a localized
        // collection's translations table, still runs under the lock wherever the lock table
        // exists; a path that otherwise issues no DDL does not create it.
        issuesDdl: this.isDevelopment(),
      },
      () => this.deleteCollectionExcluded(params)
    );
  }

  /**
   * Hold collection `slug`'s registry row for share inside `tx` until it
   * ends, and answer whether the collection exists. A delete of the
   * collection holds the row for update before it removes anything, so the
   * two take turns: see `holdCollectionsIn`.
   */
  async holdCollectionIn(
    tx: TransactionContext,
    slug: string
  ): Promise<boolean> {
    const { existing } = await this.collectionService.holdCollectionsIn(
      tx,
      [slug],
      "share"
    );
    return existing.includes(slug);
  }

  /**
   * Hold entry `entryId` of collection `slug` for share inside `tx` until it
   * ends, and answer whether it is there. A delete of the entry locks its row
   * for update before it removes it, and runs its in-transaction handlers
   * after, so the two take turns: a write holding the row commits before the
   * delete goes on, and the delete's handlers see what it wrote, or the write
   * waits for the delete and is told the entry is gone. On SQLite, with one
   * writer at a time, the row is only read. A collection that is not
   * registered holds no entry.
   *
   * The collection is held first, as `holdCollectionIn` holds it. A
   * collection delete locks the registry row, not its entries' rows, before
   * it runs its in-transaction handlers (`onCollectionDelete`), so holding
   * the entry's row alone would let those handlers run before the write has
   * stored what names the entry, and miss it. Held first, the registry row
   * makes the write and a collection delete take turns too, and the record
   * the entry's table is named by is read only once the collection can no
   * longer go.
   *
   * Every read runs on `tx`'s connection, so a pool of one connection is not
   * asked for a second one while the transaction holds it.
   */
  async holdEntryIn(
    tx: TransactionContext,
    slug: string,
    entryId: string
  ): Promise<boolean> {
    if (!(await this.holdCollectionIn(tx, slug))) return false;
    let collection: unknown;
    try {
      // Routed onto `tx`: the registry read otherwise takes a pooled
      // connection, which on a pool of one waits for the very connection
      // this transaction holds.
      collection = await runReadsInTransaction(tx, () =>
        this.collectionService.getCollection(slug)
      );
    } catch (error) {
      if (NextlyError.isNotFound(error)) return false;
      throw error;
    }
    const rows = await tx.select<{ id: unknown }>(
      collectionTableName(collection, slug),
      {
        columns: ["id"],
        where: { and: [{ column: "id", op: "=", value: entryId }] },
        forShare: true,
      }
    );
    return rows.length > 0;
  }

  private async deleteCollectionExcluded(
    params: Parameters<CollectionMetadataService["deleteCollection"]>[0]
  ): Promise<MetadataServiceResult> {
    try {
      // Loaded when a delete runs, not with the service: everything that
      // constructs the service would otherwise load the delete's readers.
      const [
        {
          assertNothingDependsOn,
          databaseDependentsSources,
          unreadableFieldsRefusal,
        },
        { dropOrder },
        { collectionOwnTables },
      ] = await Promise.all([
        import("./collection-dependents"),
        import("./collection-drop-order"),
        import("../../schema/services/field-column-descriptor"),
      ]);
      const slugs = [
        ...new Set([params.collectionName, ...(params.together ?? [])]),
      ];
      const collections: DeletedCollectionRow[] = [];
      for (const slug of slugs) {
        collections.push(
          (await this.collectionService.getCollection(
            slug
          )) as DeletedCollectionRow
        );
      }

      // A collection defined in code is the code's to remove: deleted here,
      // the next start would create it again, empty. Refused for the whole
      // set, before anything else is asked or removed, as the registry's own
      // delete refuses it.
      for (const [index, collection] of collections.entries()) {
        if (collection.locked === true || collection.locked === 1) {
          throw NextlyError.definedInCode({
            thing: "collection",
            change: "delete",
            logContext: {
              reason: "collection-locked-delete",
              slug: slugs[index],
            },
          });
        }
      }

      // A stored field list that is not a list names no junction tables, so
      // what depends on them would go unasked: refused as unreadable fields.
      const unreadable = slugs.findIndex(
        (_, index) =>
          collections[index].fields != null &&
          !Array.isArray(collections[index].fields)
      );
      if (unreadable !== -1) {
        throw unreadableFieldsRefusal(slugs, slugs[unreadable]);
      }

      // Before anything is torn down, and for the whole set, so a refusal
      // leaves every collection exactly as it was. The extension schema is the
      // one this process published at boot or on its last reload.
      await assertNothingDependsOn(
        slugs.map((slug, index) => ({
          slug,
          tables: collectionOwnTables(
            collections[index].tableName,
            collections[index].fields ?? []
          ),
        })),
        databaseDependentsSources(this.adapter, () =>
          Promise.resolve(getActiveExtensionSchema(this.dialect))
        )
      );

      // Holder first, so no database refuses a drop over a key another
      // member of the set still holds; refused here, still before anything
      // is removed, when no such order exists (`collection-drop-order`).
      const order = dropOrder(
        slugs.map((slug, index) => ({
          slug,
          tableName: collections[index].tableName,
          keys: this.collectionService.relationshipForeignKeys(
            collections[index].tableName,
            collections[index].fields ?? []
          ),
        }))
      );
      const ordered = order.map(index => ({
        slug: slugs[index],
        collection: collections[index],
      }));
      await this.removeTogether(ordered);

      return {
        success: true,
        statusCode: 200,
        message:
          slugs.length === 1
            ? "Collection deleted! Restart the app to complete removal."
            : "Collections deleted! Restart the app to complete removal.",
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

  /**
   * Remove what other tables hold for a collection that nothing outside its
   * operation depends on, before its tables go: its field-group values and
   * its translations. Through `adapter`, which is the delete's transaction.
   */
  private async tearDownStoredWithIt(
    slug: string,
    collection: DeletedCollectionRow,
    adapter: TeardownAdapter
  ): Promise<void> {
    // Embedded component instances live in `comp_<slug>` tables keyed by a plain
    // `_parent_table` string with no FK, so dropping this collection's table cascades
    // nothing and would strand every instance. Sweep them (and any nested instances)
    // before the drop.
    await teardownEntityComponentData({
      adapter,
      parentTable: collection.tableName,
    });

    // Tear down the localization artifacts in-process, before the main table goes.
    // Unlike the main-table drop below this is not deferred to `nextly migrate`: the
    // companion holds an FK to `<main>.id` so dropping the child first is safe in every
    // environment, and the shared-archive purge is DML that no migration file should
    // carry (the archive table is created lazily and may not exist).
    await teardownEntityI18n({
      kind: "collection",
      adapter,
      slug,
      tableName: collection.tableName,
    });
  }

  /**
   * Remove the collections deleted together, in drop order: all of them or,
   * where the database can undo a table drop, none.
   *
   * What can fail without removing anything runs first: the drop migration is
   * written before anything is torn down. One transaction then runs each
   * plugin's collection-delete handler (`ctx.hooks.onCollectionDelete`), which
   * removes what the plugin holds for the collections, then removes every
   * collection's field-group values and translations, runs the drop in
   * development, and removes the registry rows, so a failure part-way leaves
   * the earlier collections as they were, and the migration written for the
   * delete is withdrawn. PostgreSQL and SQLite undo the table drops with the
   * rest. MySQL commits each table drop as it runs, and what ran before it:
   * there the registry rows, removed last, keep every collection the delete
   * had not finished registered, and deleting again finishes it, the
   * teardowns finding nothing left where they had run. What this process
   * remembers about each collection is forgotten only once the delete has
   * committed.
   */
  private async removeTogether(
    ordered: ReadonlyArray<{ slug: string; collection: DeletedCollectionRow }>
  ): Promise<void> {
    const deps = this.saveDeps();
    if (deps !== undefined) {
      await this.removeThroughWriter(ordered, deps);
      return;
    }
    const { splitStatements } = await import(
      "../../schema/pipeline/sql-statement-utils"
    );
    const drop = this.dropMigrationFor(ordered);
    await this.fileManager.saveDropMigration(
      drop.migrationSQL,
      drop.migrationFileName
    );
    let unregistered: Map<string, UnregisteredCollectionRow>;
    try {
      // Development drops the tables now, in the delete's transaction;
      // elsewhere `nextly migrate` applies the file.
      unregistered = await this.removeRegistered(
        ordered,
        this.isDevelopment() ? splitStatements([drop.migrationSQL]) : []
      );
    } catch (error) {
      await this.withdrawDropMigration(drop.migrationFileName);
      throw error;
    }
    for (const { slug, collection } of ordered) {
      await this.forgetDeleted(
        slug,
        collection,
        unregistered.get(slug) ?? { removed: 0, stored: undefined }
      );
    }
  }

  /**
   * One transaction removing what the collections deleted together hold, and
   * their registry rows; what each row's removal found is returned. The rows
   * are held for update to the end, and must be the rows loaded; the plugins'
   * collection-delete handlers run before any DDL; then each collection's
   * field-group values and translations go, then `drops` (the delete's own
   * table drops, where it runs them here), then the registry rows. A failure
   * is refused as `collectionDeleteFailure` words it, with whether MySQL may
   * have committed part of it.
   */
  private async removeRegistered(
    ordered: ReadonlyArray<{ slug: string; collection: DeletedCollectionRow }>,
    drops: readonly string[]
  ): Promise<Map<string, UnregisteredCollectionRow>> {
    const [
      { teardownAdapterIn },
      { runCollectionDeleteHandlers },
      { getActiveHookRegistry },
      { collectionDeleteFailure },
    ] = await Promise.all([
      import("./teardown-adapter-in-transaction"),
      import("./collection-delete-plugins"),
      import("../../../hooks/hook-registry"),
      import("./collection-delete-failure"),
    ]);
    // What each registry row's removal found, read after the commit.
    const unregistered = new Map<string, UnregisteredCollectionRow>();
    const slugs = ordered.map(({ slug }) => slug);
    // Set before the first statement that can be DDL (the translations
    // teardown can drop a table): until then a failure on MySQL has
    // committed nothing, and is answered as on the other dialects.
    let ddlStarted = false;
    try {
      await this.adapter.transaction(async tx => {
        // The registry rows first, held for update to the end: a write that
        // must not outlive a collection holds its row for share
        // (`holdCollectionsIn`), so it either commits before the plugins'
        // handlers below read what to remove, or waits and finds the
        // collection gone.
        const hold = await this.collectionService.holdCollectionsIn(
          tx,
          slugs,
          "update"
        );
        // Released once the last statement below has run, failed or not: on
        // MySQL the hold outlives the first table drop's commit only through
        // it, and it belongs to this connection, which the transaction hands
        // back next.
        try {
          // The rows held must be the rows loaded: a slug deleted and created
          // again since names a new collection, which this delete must not
          // touch. Refused here, before anything is removed.
          assertHeldAsLoaded(ordered, hold.ids);
          // The plugins' handlers next: what they remove is plain rows, so
          // here, before any DDL, a handler that throws rolls the whole
          // delete back on every dialect, MySQL included, whose table drops
          // below commit what ran before them.
          await runCollectionDeleteHandlers(getActiveHookRegistry(), slugs, tx);
          // Marked at the first statement that can commit on MySQL, not
          // before the teardown that may issue none: a failure before it
          // rolls everything back, and keeps its own error.
          const teardownAdapter = noticingDdl(
            teardownAdapterIn(this.adapter, tx),
            () => {
              ddlStarted = true;
            }
          );
          for (const { slug, collection } of ordered) {
            await this.tearDownStoredWithIt(slug, collection, teardownAdapter);
          }
          for (const statement of drops) {
            ddlStarted = true;
            await tx.execute(statement);
          }
          for (const { slug } of ordered) {
            unregistered.set(
              slug,
              await this.collectionService.unregisterCollectionIn(tx, slug)
            );
          }
        } finally {
          // A release that fails means the connection is gone, and its locks
          // with it; the delete's own outcome is what the caller is told.
          await hold.release().catch(() => undefined);
        }
      });
    } catch (error) {
      // On MySQL a registry row can have gone before the failure, so the
      // cached rows are not trusted either way.
      clearRegistryRowCache();
      throw collectionDeleteFailure(error, slugs, {
        dialect: this.dialect,
        ddlStarted,
      });
    }
    return unregistered;
  }

  /**
   * Remove the collections deleted together through the Builder save writer.
   * The history checks `nextly migrate` runs first refuse the delete before
   * anything is torn down. One transaction then removes every collection's
   * field-group values, translations and registry row, as without the writer.
   * Then, in drop order, each collection's definition goes and its drop
   * migration is written, with its junction tables' drops, and in development
   * run as `nextly migrate` runs it. A failure there is refused with its
   * reason and keeps the files, which `nextly migrate` finishes from: the
   * registry rows are gone already.
   */
  private async removeThroughWriter(
    ordered: ReadonlyArray<{ slug: string; collection: DeletedCollectionRow }>,
    deps: CollectionSaveDeps
  ): Promise<void> {
    await checkSaveHistory(deps);
    // The registry rows and what the collections hold go first, as without
    // the writer; the tables are dropped by the migrations written below.
    const unregistered = await this.removeRegistered(ordered, []);
    // Every junction of the collections deleted together goes in the first
    // file, before any of their tables: a junction links two of them, and
    // dropping either table first would leave its rows pointing at nothing.
    const junctions = ordered.map(({ collection }) =>
      this.collectionService.junctionStatements(
        collection.tableName,
        collection.fields ?? [],
        []
      )
    );
    const allJunctions = {
      up: junctions.flatMap(j => j.up),
      down: junctions.flatMap(j => j.down),
    };
    for (const [index, { slug, collection }] of ordered.entries()) {
      await writeCollectionSave(
        deps,
        {
          slug,
          previous: definitionOfRow(slug, collection),
          entity: null,
          change: "delete",
          removedTogether: ordered
            .map(other => other.slug)
            .filter(other => other !== slug),
          junctions: index === 0 ? allJunctions : { up: [], down: [] },
        },
        { historyChecked: true, keepFilesOnFailure: true }
      );
    }
    for (const { slug, collection } of ordered) {
      await this.forgetDeleted(
        slug,
        collection,
        unregistered.get(slug) ?? { removed: 0, stored: undefined }
      );
    }
  }

  /** The writer's dependencies for a save here, when a writer is set up. */
  private saveDeps(): CollectionSaveDeps | undefined {
    return this.builderSave === undefined
      ? undefined
      : {
          ...this.builderSave,
          adapter: this.adapter,
          logger: this.logger,
          applies: this.isDevelopment(),
        };
  }

  /**
   * The drop migration of the collections deleted together, in drop order, as
   * ONE file: the durable record `nextly migrate` applies in non-dev/deploy
   * flows, and one file is applied in exactly the order development runs it.
   */
  private dropMigrationFor(
    ordered: ReadonlyArray<{ slug: string; collection: DeletedCollectionRow }>
  ): { migrationSQL: string; migrationFileName: string } {
    // With the fields, so the collections' own many-to-many junctions go too.
    // A single collection's file is the one its delete has always written.
    const [only] = ordered;
    return ordered.length === 1
      ? this.collectionService.generateDropTableMigration(
          only.slug,
          only.collection.tableName,
          only.collection.fields ?? []
        )
      : this.collectionService.generateDropTablesMigration(
          ordered.map(({ slug, collection }) => ({
            collectionName: slug,
            tableName: collection.tableName,
            fields: collection.fields ?? [],
          }))
        );
  }

  /**
   * Withdraw the drop migration of a delete that failed. A file that cannot
   * be removed is logged rather than thrown, so the delete's own failure is
   * what the caller sees: left in place, the next `nextly migrate` would drop
   * the tables of collections that are still registered.
   */
  private async withdrawDropMigration(
    migrationFileName: string
  ): Promise<void> {
    try {
      await this.fileManager.removeDropMigration(migrationFileName);
    } catch (error) {
      this.logger.error(
        `A failed collection delete could not remove its drop migration ${migrationFileName}. Remove it before the next \`nextly migrate\`, which would otherwise drop tables of collections that are still registered: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Once the delete has committed: forget, in this process, what it removed
   * (the registry row's caches, the translations table's readiness, which the
   * teardown recorded against the transaction rather than this adapter), and
   * remove the collection's permissions, a cleanup that warns rather than
   * fails.
   */
  private async forgetDeleted(
    slug: string,
    collection: DeletedCollectionRow,
    unregistered: UnregisteredCollectionRow
  ): Promise<void> {
    await this.collectionService.forgetUnregisteredCollection(
      slug,
      unregistered
    );
    const [{ forgetCompanionReadiness }, { deleteResourcePermissions }] =
      await Promise.all([
        import("../../i18n/runtime/companion-readiness"),
        import("./delete-resource-permissions"),
      ]);
    forgetCompanionReadiness(this.adapter, `${collection.tableName}_locales`);
    await deleteResourcePermissions({
      service: this.permissionSeedService,
      slug,
      kind: "collection",
      logger: this.logger,
    });
  }
}

/**
 * A deleted collection as the definition records it, read from its registry
 * row, whose fields the definition holds as stored: what the delete's
 * migration is generated from.
 */
function definitionOfRow(
  slug: string,
  row: DeletedCollectionRow
): UiSchemaEntity {
  return {
    slug,
    labels: row.labels ?? { singular: slug, plural: slug },
    fields: row.fields ?? [],
  };
}

/** A statement that changes the schema: on MySQL it commits what ran before it. */
const DDL_STATEMENT = /^\s*(drop|alter|create|truncate|rename)\b/i;

/**
 * Refuse a delete whose held registry rows are not the rows it loaded.
 *
 * The rows are loaded before the delete takes its hold, so another delete can
 * remove one in between, and a create can register the slug again. The row
 * the hold then finds is a different collection, or none, and the delete,
 * working from what it loaded, would remove that collection's plugin rows and
 * registry row. A row loaded without an id is compared by its presence alone.
 */
function assertHeldAsLoaded(
  ordered: ReadonlyArray<{ slug: string; collection: DeletedCollectionRow }>,
  held: ReadonlyMap<string, string>
): void {
  const changed = ordered
    .filter(({ slug, collection }) => {
      const id = held.get(slug);
      if (id === undefined) return true;
      // A registry id is a string or a number; anything else was loaded
      // without one and is compared by its presence alone.
      const loaded = collection.id;
      return (
        (typeof loaded === "string" || typeof loaded === "number") &&
        String(loaded) !== id
      );
    })
    .map(({ slug }) => slug);
  if (changed.length === 0) return;
  throw NextlyError.conflict({
    reason: "state",
    message: `${changed.map(slug => `"${slug}"`).join(", ")} changed while it was being deleted. Nothing was removed: refresh and delete it again.`,
    logContext: {
      reason: "collection-delete-row-replaced",
      collections: changed,
    },
  });
}

/**
 * `adapter`, telling `onDdl` before each schema-changing statement its
 * `executeQuery` runs, so a delete knows whether anything it did may have
 * been committed before it failed.
 */
function noticingDdl<A extends object>(adapter: A, onDdl: () => void): A {
  return new Proxy(adapter, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      if (property !== "executeQuery") return value.bind(target);
      return (statement: unknown, ...rest: unknown[]) => {
        if (typeof statement === "string" && DDL_STATEMENT.test(statement)) {
          onDdl();
        }
        return Reflect.apply(value, target, [statement, ...rest]);
      };
    },
  });
}
