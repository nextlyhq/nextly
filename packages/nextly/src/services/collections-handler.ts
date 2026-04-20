import * as path from "path";

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";

import { getHookRegistry } from "@nextly/hooks/hook-registry";

import { container } from "../di/container";
import type { RichTextOutputFormat } from "../lib/rich-text-html";
import type { FieldDefinition } from "../schemas/dynamic-collections";
import type { DatabaseInstance } from "../types/database-operations";

import { AccessControlService } from "./access";
import { FieldPermissionCheckerService } from "./auth/field-permission-checker-service";
import type { PermissionSeedService } from "./auth/permission-seed-service";
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
import { DynamicCollectionService } from "./dynamic-collections";
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
    consumerAppRoot?: string
  ) {
    this.logger = logger;
    this.collectionService = new DynamicCollectionService(adapter, logger);

    const fieldPermissionChecker = new FieldPermissionCheckerService(
      adapter,
      logger
    );

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
          table_name: string;
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
            tableName: result.table_name,
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
      fieldPermissionChecker,
      hookRegistry,
      accessControlService,
      componentDataService
    );
  }

  /**
   * Ensure params have a `user` object for hook contexts.
   *
   * The API dispatcher passes `userId` (from the authenticated session) but
   * the entry service expects `user: { id }`. This bridges the gap so that
   * activity-log hooks receive a valid user and are not silently skipped.
   *
   * We also set `overrideAccess: true` because the routeHandler has already
   * performed auth/authorization checks.
   */
  private resolveUserParam<
    T extends {
      userId?: string;
      userName?: string;
      userEmail?: string;
      user?: UserContext;
      overrideAccess?: boolean;
    },
  >(params: T): Omit<T, "userName" | "userEmail"> {
    const { userName, userEmail, ...rest } = params;
    if (!rest.user && rest.userId) {
      return {
        ...rest,
        user: {
          id: rest.userId,
          name: userName,
          email: userEmail,
        },
        overrideAccess: true,
      } as Omit<T, "userName" | "userEmail">;
    }
    return rest as Omit<T, "userName" | "userEmail">;
  }

  /**
   * Wire the PermissionSeedService into the internal CollectionMetadataService.
   * Must be called after construction so that collection creation auto-seeds
   * CRUD permissions for newly created collections.
   */
  setPermissionSeedService(service: PermissionSeedService): void {
    this.metadataService.setPermissionSeedService(service);
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
    pageSize?: number;
    search?: string;
    sortBy?: "slug" | "createdAt" | "updatedAt";
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
      defaultColumns?: string[];
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
      /** Depth for relationship population in response (0-5) */
      depth?: number;
      /** User context for access control */
      user?: UserContext;
      /** When true, bypass all access control checks */
      overrideAccess?: boolean;
      /** Arbitrary data passed to hooks via context */
      context?: Record<string, unknown>;
    },
    body: Record<string, unknown>
  ) {
    return this.entryService.createEntry(
      this.resolveUserParam(params),
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
    /** Arbitrary data passed to hooks via context */
    context?: Record<string, unknown>;
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
      /** Depth for relationship population in response (0-5) */
      depth?: number;
      /** User context for access control */
      user?: UserContext;
      /** When true, bypass all access control checks */
      overrideAccess?: boolean;
      /** Arbitrary data passed to hooks via context */
      context?: Record<string, unknown>;
    },
    body: Record<string, unknown>
  ) {
    return this.entryService.updateEntry(
      this.resolveUserParam(params),
      body,
      params.depth
    );
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
    /** User context for access control */
    user?: UserContext;
    /** When true, bypass all access control checks */
    overrideAccess?: boolean;
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
    /** User context for access control */
    user?: UserContext;
    /** When true, bypass all access control checks */
    overrideAccess?: boolean;
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
    /** User context for access control */
    user?: UserContext;
    /** When true, bypass all access control checks */
    overrideAccess?: boolean;
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
      /** User context for access control */
      user?: UserContext;
      /** When true, bypass all access control checks */
      overrideAccess?: boolean;
      /** Arbitrary data passed to hooks via context */
      context?: Record<string, unknown>;
    },
    options?: { limit?: number }
  ) {
    return this.entryService.bulkUpdateByQuery(params, options);
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
    /** Optional field overrides to apply to the duplicated entry */
    overrides?: Record<string, unknown>;
    /** User context for access control */
    user?: UserContext;
    /** When true, bypass all access control checks */
    overrideAccess?: boolean;
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
