import * as path from "path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { getHookRegistry } from "@nextly/hooks/hook-registry";

import type { RequestActor } from "../auth/request-actor";
import { container } from "../di/container";
import type { PermissionSeedService } from "../domains/auth/services/permission-seed-service";
import { DynamicCollectionService } from "../domains/dynamic-collections";
import type { SanitizedLocalizationConfig } from "../domains/i18n/config/types";
import type { RichTextOutputFormat } from "../lib/rich-text-html";
import type { FieldDefinition } from "../schemas/dynamic-collections";
import type { DatabaseInstance } from "../types/database-operations";

import { AccessControlService } from "./access";
import { CollectionFileManager } from "./collection-file-manager";
import {
  CollectionEntryService,
  CollectionMetadataService,
  CollectionRelationshipService,
  type WhereFilter,
  type UserContext,
} from "./collections/index";
import type { ComponentDataService } from "./components/component-data-service";
import type { ComponentRegistryService } from "./components/component-registry-service";
import { consoleLogger } from "./shared";
import type { Logger } from "./shared";

/**
 * CollectionsHandler - Unified facade for collection operations.
 *
 * This handler provides a backward-compatible API that delegates to specialized services:
 * - CollectionMetadataService: Collection CRUD (create, list, get, update, delete)
 * - CollectionEntryService: Entry CRUD with hooks and permissions
 * - CollectionRelationshipService: Relationship expansion and junction table management
 *
 * For new code, consider using the specialized services directly for better separation of concerns.
 *
 * @example
 * ```typescript
 * // Using the facade (backward compatible)
 * const handler = new CollectionsHandler(db);
 * await handler.createCollection({ name: 'posts', ... });
 *
 * // Using specialized services directly (recommended for new code)
 * const metadataService = new CollectionMetadataService(db, fileManager, collectionService);
 * await metadataService.createCollection({ name: 'posts', ... });
 * ```
 */
export class CollectionsHandler {
  private readonly metadataService: CollectionMetadataService;
  private readonly entryService: CollectionEntryService;
  private readonly relationshipService: CollectionRelationshipService;

  private readonly collectionService: DynamicCollectionService;
  private readonly fileManager: CollectionFileManager;
  private readonly logger: Logger;

  constructor(
    adapter: DrizzleAdapter,
    db: DatabaseInstance,
    logger: Logger = consoleLogger,
    consumerAppRoot?: string,
    /** Normalized localization config (i18n M4) — enables companion-aware reads. */
    private readonly localization?: SanitizedLocalizationConfig
  ) {
    this.logger = logger;
    this.collectionService = new DynamicCollectionService(adapter, logger);

    const hookRegistry = getHookRegistry();

    const appRoot = consumerAppRoot || process.cwd();
    this.fileManager = new CollectionFileManager(db, {
      schemasDir: path.join(appRoot, "src/db/schemas/dynamic"),
      migrationsDir: path.join(appRoot, "src/db/migrations/dynamic"),
    });

    // Set up the adapter and metadata fetcher for runtime schema generation
    // This allows UI-created collections to work without pre-compiled TypeScript schemas
    this.fileManager.setAdapter(adapter);
    this.fileManager.setMetadataFetcher(async (collectionName: string) => {
      try {
        const result = await adapter.selectOne<{
          fields: string;
          tableName: string;
          status: boolean | number | null;
          localized: boolean | number | null;
        }>("dynamic_collections", {
          where: {
            and: [{ column: "slug", op: "=", value: collectionName }],
          },
        });

        if (result) {
          const fields =
            typeof result.fields === "string"
              ? JSON.parse(result.fields)
              : result.fields;
          return {
            fields,
            tableName: result.tableName,
            // SQLite returns 0/1 for booleans; PG/MySQL return real booleans.
            status: result.status === true || result.status === 1,
            // i18n M4: forward the localized flag so loadCompanionSchema builds the companion.
            localized: result.localized === true || result.localized === 1,
          };
        }
      } catch (error) {
        console.error(
          "[CollectionsHandler] Failed to fetch collection metadata:",
          error
        );
      }
      return null;
    });

    this.relationshipService = new CollectionRelationshipService(
      adapter,
      logger,
      this.fileManager,
      this.collectionService
    );

    this.metadataService = new CollectionMetadataService(
      adapter,
      logger,
      this.fileManager,
      this.collectionService
    );

    const accessControlService = new AccessControlService();

    const componentDataService = container.has("componentDataService")
      ? container.get<ComponentDataService>("componentDataService")
      : undefined;

    // Late-inject relationshipService if componentDataService was created before it was available
    if (componentDataService) {
      componentDataService.setRelationshipService(this.relationshipService);
    }

    this.entryService = new CollectionEntryService(
      adapter,
      logger,
      this.fileManager,
      this.collectionService,
      this.relationshipService,
      hookRegistry,
      accessControlService,
      componentDataService,
      undefined,
      this.localization
    );
  }

  /**
   * Ensure params have a `user` object for hook contexts.
   *
   * The API dispatcher passes `userId` (from the authenticated session) but
   * the entry service expects `user: { id }`. This bridges the gap so that
   * activity-log hooks receive a valid user and are not silently skipped.
   *
   * `routeAuthorized: true` marks that the route middleware
   * (`requireCollectionAccess`) already performed the coarse RBAC / code-access
   * gate, so the entry service skips re-running only THAT check. It is NOT a
   * trusted-server context: `overrideAccess` stays `false` so the stored
   * collection access rules (owner-only / role-based / authenticated / custom)
   * and field-level write access are still enforced with the real user — the
   * route pre-check authorizes the operation, not access to every record or
   * field. Trusted-server bypass is a separate, explicit `overrideAccess: true`
   * (seeds, plugin `as:'system'`), never inferred from route auth.
   */
  private resolveUserParam<
    T extends {
      userId?: string;
      userName?: string;
      userEmail?: string;
      userRoles?: string[];
      user?: UserContext;
      overrideAccess?: boolean;
      routeAuthorized?: boolean;
    },
  >(params: T): Omit<T, "userName" | "userEmail" | "userRoles"> {
    const { userName, userEmail, userRoles, ...rest } = params;
    if (!rest.user && rest.userId) {
      return {
        ...rest,
        user: {
          id: rest.userId,
          name: userName,
          email: userEmail,
          // Carry the authenticated role set so role-based access rules and
          // field-level access.read evaluate against the real user.
          roles: userRoles,
          // Also expose a singular `role` so field-level access callbacks that
          // read the documented `req.user.role` (rather than the role set) see
          // an authorized value instead of stripping fields for a legitimate
          // caller. A representative slug; role-set-aware rules use `roles`.
          role: userRoles?.[0],
        },
        // Default the bridged route caller to enforced access, but never
        // clobber an explicit trusted-server override (overrideAccess: true)
        // if one was passed alongside the userId.
        overrideAccess: rest.overrideAccess ?? false,
        // Route authorization is NEVER inferred from a userId being present:
        // the RBAC/database-permission gate may only be skipped when the caller
        // explicitly attests the route middleware already ran it (the REST
        // dispatcher passes `routeAuthorized: true`). Any other caller that
        // merely attributes a userId for hooks/audit gets `false`, so the gate
        // still runs and a rule-less collection is not mutated without the
        // permission check. A trusted override forces it false regardless, so
        // it never defeats the response redaction guard
        // (`overrideAccess && !routeAuthorized`).
        routeAuthorized:
          !(rest.overrideAccess ?? false) && !!rest.routeAuthorized,
      };
    }
    return rest;
  }

  /**
   * Wire the PermissionSeedService into the internal CollectionMetadataService.
   * Must be called after construction so that collection creation auto-seeds
   * CRUD permissions for newly created collections.
   */
  setPermissionSeedService(service: PermissionSeedService): void {
    this.metadataService.setPermissionSeedService(service);
  }

  // Push a freshly-generated Drizzle table object into the FileManager's
  // schema cache for `slug`. Both caches (FileManager for SELECT/query
  // builders, SchemaRegistry for adapter CRUD) must be updated together
  // after an admin schema apply; this method handles the FileManager side.
  // The caller (collection-dispatcher.ts) handles SchemaRegistry directly.
  refreshCollectionSchema(tableName: string, freshTable: unknown): void {
    this.fileManager.refreshSchema(tableName, freshTable);
  }

  /**
   * Register dynamic schemas with the file manager.
   * @param schemas - Map of schema names to schema objects
   */
  registerDynamicSchemas(schemas: Record<string, unknown>): void {
    this.metadataService.registerDynamicSchemas(schemas);
  }

  /**
   * Create a new collection.
   * @param data - Collection creation data
   */
  async createCollection(data: {
    name: string;
    label: string;
    description?: string;
    icon?: string;
    group?: string;
    order?: number;
    sidebarGroup?: string;
    /** Whether the collection has Draft/Published enabled. */
    status?: boolean;
    /** i18n: whether the collection is localized (translatable fields + companion table). */
    localized?: boolean;
    fields: FieldDefinition[];
    createdBy?: string;
  }) {
    return this.metadataService.createCollection(data);
  }

  /**
   * List collections with pagination, search, and sorting.
   * @param options - Pagination, search, and sort options
   */
  async listCollections(options?: {
    page?: number;
    limit?: number;
    search?: string;
    // "name" is the admin/API alias for "slug" — both sort on the slug column.
    sortBy?: "name" | "slug" | "createdAt" | "updatedAt";
    sortOrder?: "asc" | "desc";
    includeSchema?: boolean;
  }) {
    return this.metadataService.listCollections(options);
  }

  /**
   * Get a single collection by name.
   * Enriches component fields with inline schemas for Admin UI rendering.
   * @param params - Parameters containing collection name
   */
  async getCollection(params: { collectionName: string }) {
    const result = await this.metadataService.getCollection(params);

    // Enrich component fields with inline schemas for Admin UI so that
    // form rendering works without extra API calls per component.
    const data = result.data as Record<string, unknown> | null;
    if (result.success && data?.fields) {
      try {
        const hasComponentRegistry = container.has("componentRegistryService");
        if (hasComponentRegistry) {
          const componentRegistry = container.get<ComponentRegistryService>(
            "componentRegistryService"
          );

          const enrichedFields =
            await componentRegistry.enrichFieldsWithComponentSchemas(
              data.fields as unknown as Record<string, unknown>[]
            );

          data.fields = enrichedFields;
          if (data.schemaDefinition) {
            (data.schemaDefinition as Record<string, unknown>).fields =
              enrichedFields;
          }
        }
      } catch (enrichError) {
        console.error(
          "[CollectionsHandler.getCollection] Failed to enrich component fields:",
          enrichError instanceof Error
            ? enrichError.message
            : String(enrichError)
        );
      }
    }

    return result;
  }

  /**
   * Update a collection's metadata and/or schema.
   * @param params - Parameters containing collection name
   * @param body - Update data
   */
  async updateCollection(
    params: { collectionName: string },
    body: {
      label?: string;
      description?: string;
      icon?: string;
      group?: string;
      order?: number;
      sidebarGroup?: string;
      useAsTitle?: string;
      hidden?: boolean;
      fields?: FieldDefinition[];
    }
  ) {
    return this.metadataService.updateCollection(params, body);
  }

  /**
   * Delete a collection.
   * @param params - Parameters containing collection name
   */
  async deleteCollection(params: { collectionName: string }) {
    return this.metadataService.deleteCollection(params);
  }

  /**
   * List entries in a collection with pagination.
   * @param params - Collection name, pagination options, and query filters
   */
  async listEntries(params: {
    collectionName: string;
    /** Page number (1-indexed, default: 1) */
    page?: number;
    /** Number of documents per page (default: 10, max: 500) */
    limit?: number;
    /** Search query to filter entries by searchable fields */
    search?: string;
    /** Depth for relationship population */
    depth?: number;
    /** Select specific fields to include */
    select?: Record<string, boolean>;
    /** Where clause for filtering */
    where?: WhereFilter;
    /**
     * Output format for rich text fields.
     * - "json" (default): Return Lexical JSON structure only
     * - "html": Return HTML string only
     * - "both": Return object with both { json, html } properties
     */
    richTextFormat?: RichTextOutputFormat;
    /**
     * Sort order for results.
     * Prefix with `-` for descending.
     * @example '-createdAt' for descending, 'title' for ascending
     */
    sort?: string;
    /** User context for access control */
    user?: UserContext;
    /** When true, bypass all access control checks */
    overrideAccess?: boolean;
    /**
     * Draft/Published filter override (only effective when collection.status
     * === true). Public callers default to 'published'; trusted callers can
     * pass 'all' to see drafts too. Forwarded to query service as-is.
     */
    status?: "published" | "draft" | "all";
    /** Requested content locale (i18n M4) — forwarded to the query service. */
    locale?: string;
    /** Fallback control (`false`/`"none"` disables fallback). */
    fallbackLocale?: string | false;
    /** i18n M7: attach a per-locale `_translations` overview map to each row. */
    translationStatus?: boolean;
    /** Arbitrary data passed to hooks via context */
    context?: Record<string, unknown>;
  }) {
    return this.entryService.listEntries(params);
  }

  /**
   * Create a new entry in a collection.
   * @param params - Collection name, optional user ID, and optional depth for relationship population
   * @param body - Entry data
   */
  async createEntry(
    params: {
      collectionName: string;
      userId?: string;
      userName?: string;
      userEmail?: string;
      /** Authenticated role set, forwarded to role-based access rules. */
      userRoles?: string[];
      /** Depth for relationship population in response (0-5) */
      depth?: number;
      /** User context for access control */
      user?: UserContext;
      /** Who performed the write, recorded on the outbox event. */
      actor?: RequestActor;
      /** When true, bypass all access control checks */
      overrideAccess?: boolean;
      /** Write locale (i18n M5) — translatable values stored for this language. */
      locale?: string;
      /**
       * Set by the REST dispatcher to attest the route middleware already ran
       * the RBAC/code-access gate, so the entry service skips only that
       * redundant re-check. Never inferred from a userId.
       */
      routeAuthorized?: boolean;
      /** Arbitrary data passed to hooks via context */
      context?: Record<string, unknown>;
    },
    body: Record<string, unknown>
  ) {
    return this.entryService.createEntry(
      {
        ...this.resolveUserParam(params),
        locale: params.locale,
        actor: params.actor,
      },
      body,
      params.depth
    );
  }

  /**
   * Get a single entry by ID.
   * @param params - Collection name, entry ID, and optional user ID
   */
  async getEntry(params: {
    collectionName: string;
    entryId: string;
    userId?: string;
    /** Depth for relationship population (0-5) */
    depth?: number;
    /** Select specific fields to include */
    select?: Record<string, boolean>;
    /**
     * Output format for rich text fields.
     * - "json" (default): Return Lexical JSON structure only
     * - "html": Return HTML string only
     * - "both": Return object with both { json, html } properties
     */
    richTextFormat?: RichTextOutputFormat;
    /** User context for access control */
    user?: UserContext;
    /** When true, bypass all access control checks */
    overrideAccess?: boolean;
    /**
     * Draft/Published filter override (only effective when collection.status
     * === true). Public callers default to 'published'; trusted callers can
     * pass 'all' to see drafts too. Forwarded to query service as-is.
     */
    status?: "published" | "draft" | "all";
    /** Requested content locale (i18n M4) — forwarded to the query service. */
    locale?: string;
    /** Fallback control (`false`/`"none"` disables fallback). */
    fallbackLocale?: string | false;
    /** i18n M7: attach a per-locale `_translations` overview map to the entry. */
    translationStatus?: boolean;
    /** Arbitrary data passed to hooks via context */
    context?: Record<string, unknown>;
    /**
     * Set by a route that already authenticated and authorized the caller.
     * Skips the redundant RBAC re-check (which resolves the caller's stored
     * roles and would reject a scoped API key) while leaving owner-only and
     * other document-level rules in force.
     */
    routeAuthorized?: boolean;
  }) {
    return this.entryService.getEntry(params);
  }

  /**
   * Count entries in a collection.
   * @param params - Collection name and optional filters
   */
  async countEntries(params: {
    collectionName: string;
    /** Search query to filter entries by searchable fields */
    search?: string;
    /** Where clause for filtering */
    where?: WhereFilter;
    /** User context for access control */
    user?: UserContext;
    /** When true, bypass all access control checks */
    overrideAccess?: boolean;
    /**
     * Draft/Published filter override (only effective when collection.status
     * === true). Same semantics as listEntries.
     */
    status?: "published" | "draft" | "all";
    /** Requested content locale (i18n M4) — forwarded to the query service. */
    locale?: string;
    /** Fallback control (`false`/`"none"` disables fallback). */
    fallbackLocale?: string | false;
    /** Arbitrary data passed to hooks via context */
    context?: Record<string, unknown>;
  }) {
    return this.entryService.countEntries(params);
  }

  /**
   * Update an existing entry.
   * @param params - Collection name, entry ID, optional user ID, and optional depth for relationship population
   * @param body - Update data
   */
  async updateEntry(
    params: {
      collectionName: string;
      entryId: string;
      userId?: string;
      userName?: string;
      userEmail?: string;
      /** Authenticated role set, forwarded to role-based access rules. */
      userRoles?: string[];
      /** Depth for relationship population in response (0-5) */
      depth?: number;
      /** User context for access control */
      user?: UserContext;
      /** When true, bypass all access control checks */
      overrideAccess?: boolean;
      /** Write locale (i18n M5) — translatable values updated for this language. */
      locale?: string;
      /**
       * Set by the REST dispatcher to attest the route middleware already ran
       * the RBAC/code-access gate, so the entry service skips only that
       * redundant re-check. Never inferred from a userId.
       */
      routeAuthorized?: boolean;
      /** Arbitrary data passed to hooks via context */
      context?: Record<string, unknown>;
    },
    body: Record<string, unknown>
  ) {
    return this.entryService.updateEntry(
      { ...this.resolveUserParam(params), locale: params.locale },
      body,
      params.depth
    );
  }

  /**
   * i18n M7: publish every language of an entry at once (spec §10). Sets the main status and,
   * for localized+draft collections, every companion `_status` to published, atomically.
   */
  async publishAllLocales(params: {
    collectionName: string;
    entryId: string;
    userId?: string;
    userName?: string;
    userEmail?: string;
    /** Authenticated role set, forwarded to role-based access rules. */
    userRoles?: string[];
    user?: UserContext;
    /** When true, bypass all access control checks */
    overrideAccess?: boolean;
    /**
     * Set by the REST dispatcher to attest the route middleware already ran the
     * RBAC/code-access gate, so the entry service skips only that redundant
     * re-check. Never inferred from a userId.
     */
    routeAuthorized?: boolean;
  }) {
    return this.entryService.publishAllLocales(this.resolveUserParam(params));
  }

  /**
   * Delete an entry.
   * @param params - Collection name, entry ID, and optional user ID
   */
  async deleteEntry(params: {
    collectionName: string;
    entryId: string;
    userId?: string;
    userName?: string;
    userEmail?: string;
    /** Authenticated role set, forwarded to role-based access rules. */
    userRoles?: string[];
    /** User context for access control */
    user?: UserContext;
    /** When true, bypass all access control checks */
    overrideAccess?: boolean;
    /**
     * Set by the REST dispatcher to attest the route middleware already ran
     * the RBAC/code-access gate, so the entry service skips only that redundant
     * re-check. Never inferred from a userId — a caller attributing a user for
     * hooks/audit must still pass the permission gate.
     */
    routeAuthorized?: boolean;
    /** Arbitrary data passed to hooks via context */
    context?: Record<string, unknown>;
  }) {
    return this.entryService.deleteEntry(this.resolveUserParam(params));
  }

  /**
   * Bulk delete multiple entries by IDs.
   * Uses partial success pattern - some entries may fail while others succeed.
   * @param params - Collection name and array of entry IDs to delete
   * @returns Bulk operation result with success/failed arrays and counts
   */
  async bulkDeleteEntries(params: {
    collectionName: string;
    ids: string[];
    userId?: string;
    userName?: string;
    userEmail?: string;
    /** Authenticated role set, forwarded to role-based access rules. */
    userRoles?: string[];
    /** User context for access control */
    user?: UserContext;
    /** When true, bypass all access control checks */
    overrideAccess?: boolean;
    /**
     * Set by the REST dispatcher to attest the route middleware already ran
     * the RBAC/code-access gate, so the entry service skips only that redundant
     * re-check. Never inferred from a userId — a caller attributing a user for
     * hooks/audit must still pass the permission gate.
     */
    routeAuthorized?: boolean;
    /** Arbitrary data passed to hooks via context */
    context?: Record<string, unknown>;
  }) {
    return this.entryService.bulkDeleteEntries(this.resolveUserParam(params));
  }

  /**
   * Bulk update multiple entries with the same data.
   * Uses partial success pattern - some entries may fail while others succeed.
   * @param params - Collection name, array of entry IDs, and update data
   * @returns Bulk operation result with success/failed arrays and counts
   */
  async bulkUpdateEntries(params: {
    collectionName: string;
    ids: string[];
    data: Record<string, unknown>;
    userId?: string;
    userName?: string;
    userEmail?: string;
    /** Authenticated role set, forwarded to role-based access rules. */
    userRoles?: string[];
    /** User context for access control */
    user?: UserContext;
    /** When true, bypass all access control checks */
    overrideAccess?: boolean;
    /**
     * Set by the REST dispatcher to attest the route middleware already ran
     * the RBAC/code-access gate, so the entry service skips only that redundant
     * re-check. Never inferred from a userId — a caller attributing a user for
     * hooks/audit must still pass the permission gate.
     */
    routeAuthorized?: boolean;
    /** Arbitrary data passed to hooks via context */
    context?: Record<string, unknown>;
  }) {
    return this.entryService.bulkUpdateEntries(this.resolveUserParam(params));
  }

  /**
   * Bulk update entries matching a where clause.
   * Uses partial success pattern - some entries may fail while others succeed.
   * @param params - Collection name, where clause, and update data
   * @param options - Optional limit for safety (default: 1000)
   * @returns Bulk operation result with success/failed arrays and counts
   */
  async bulkUpdateByQuery(
    params: {
      collectionName: string;
      where: WhereFilter;
      data: Record<string, unknown>;
      userId?: string;
      userName?: string;
      userEmail?: string;
      /** Authenticated role set, forwarded to role-based access rules. */
      userRoles?: string[];
      /** User context for access control */
      user?: UserContext;
      /** When true, bypass all access control checks */
      overrideAccess?: boolean;
      /** Route auth already ran; response is still redacted for this user */
      routeAuthorized?: boolean;
      /** Arbitrary data passed to hooks via context */
      context?: Record<string, unknown>;
    },
    options?: { limit?: number }
  ) {
    // Resolve userId -> user and mark route-authorized, mirroring
    // bulkUpdateEntries so the query-based bulk update honors access control
    // and redaction instead of running as an anonymous caller.
    return this.entryService.bulkUpdateByQuery(
      this.resolveUserParam(params),
      options
    );
  }

  /**
   * Bulk delete entries matching a where clause.
   * Uses partial success pattern - some entries may fail while others succeed.
   * @param params - Collection name, where clause, and optional access control options
   * @param options - Optional limit for safety (default: 1000)
   * @returns Bulk operation result with success/failed arrays and counts
   */
  async bulkDeleteByQuery(
    params: {
      collectionName: string;
      where: WhereFilter;
      /** User context for access control */
      user?: UserContext;
      /** When true, bypass all access control checks */
      overrideAccess?: boolean;
      /**
       * Set by the REST dispatcher to attest the route middleware already ran
       * the RBAC/code-access gate, so the entry service skips only that
       * redundant re-check. Never inferred from a userId.
       */
      routeAuthorized?: boolean;
      /** Arbitrary data passed to hooks via context */
      context?: Record<string, unknown>;
    },
    options?: { limit?: number }
  ) {
    return this.entryService.bulkDeleteByQuery(params, options);
  }

  /**
   * Duplicate an existing entry.
   * Creates a new entry with the same field values as the source entry.
   * System fields (id, createdAt, updatedAt) are regenerated.
   * Title/name fields get " (Copy)" appended.
   * @param params - Collection name, entry ID to duplicate, and optional overrides
   * @returns The newly created duplicate entry
   */
  async duplicateEntry(params: {
    collectionName: string;
    entryId: string;
    userId?: string;
    userName?: string;
    userEmail?: string;
    /** Authenticated role set, forwarded to role-based access rules. */
    userRoles?: string[];
    /** Optional field overrides to apply to the duplicated entry */
    overrides?: Record<string, unknown>;
    /** User context for access control */
    user?: UserContext;
    /** When true, bypass all access control checks */
    overrideAccess?: boolean;
    /**
     * Set by the REST dispatcher to attest the route middleware already ran
     * the RBAC/code-access gate, so the entry service skips only that redundant
     * re-check. Never inferred from a userId — a caller attributing a user for
     * hooks/audit must still pass the permission gate.
     */
    routeAuthorized?: boolean;
    /** Arbitrary data passed to hooks via context */
    context?: Record<string, unknown>;
  }) {
    return this.entryService.duplicateEntry(this.resolveUserParam(params));
  }

  /**
   * Get the underlying CollectionMetadataService for direct access.
   * Useful for advanced use cases requiring fine-grained control.
   */
  getMetadataService(): CollectionMetadataService {
    return this.metadataService;
  }

  /**
   * Get the underlying CollectionEntryService for direct access.
   * Useful for advanced use cases requiring fine-grained control.
   */
  getEntryService(): CollectionEntryService {
    return this.entryService;
  }

  /**
   * Get the underlying CollectionRelationshipService for direct access.
   * Useful for advanced use cases requiring fine-grained control.
   */
  getRelationshipService(): CollectionRelationshipService {
    return this.relationshipService;
  }
}
