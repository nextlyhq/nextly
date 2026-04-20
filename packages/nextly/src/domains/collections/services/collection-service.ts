/**
 * CollectionService - Unified service for collection operations
 *
 * This service provides a clean API for both collection metadata (CRUD on collections)
 * and entry operations (CRUD on documents within collections). It follows the new
 * service layer architecture with:
 *
 * - Exception-based error handling using ServiceError
 * - RequestContext for user/locale context
 * - PaginatedResult for list operations
 * - Transaction-aware methods (*InTransaction) using adapter transactions
 * - Database adapter abstraction for multi-DB support (PostgreSQL, MySQL, SQLite)
 *
 * Internally delegates to CollectionMetadataService and CollectionEntryService
 * for the actual implementation, converting their return format to the new pattern.
 *
 * @example
 * ```typescript
 * import { CollectionService, ServiceError, isServiceError } from '@revnixhq/nextly';
 *
 * const service = new CollectionService(adapter, logger, metadataService, entryService);
 *
 * // Create a collection
 * const collection = await service.createCollection({
 *   name: 'posts',
 *   label: 'Blog Posts',
 *   fields: [...]
 * }, context);
 *
 * // Create an entry
 * const entry = await service.createEntry('posts', { title: 'Hello' }, context);
 *
 * // Error handling
 * try {
 *   const entry = await service.findEntryById('posts', 'nonexistent', context);
 * } catch (error) {
 *   if (isServiceError(error)) {
 *     console.log(error.code); // 'NOT_FOUND'
 *     console.log(error.httpStatus); // 404
 *   }
 * }
 *
 * // Transaction support
 * await service.withTransaction(async (tx) => {
 *   const entry = await service.createEntryInTransaction(tx, 'posts', data, context);
 *   await service.updateEntryInTransaction(tx, 'posts', entry.id, moreData, context);
 * });
 * ```
 */

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import type { TransactionContext } from "@revnixhq/adapter-drizzle/types";

import { ServiceError } from "../../../errors";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import type { CollectionEntryService } from "../../../services/collections/collection-entry-service";
import type {
  RequestContext,
  PaginatedResult,
  QueryOptions,
  Logger,
} from "../../../services/shared";
import { BaseService } from "../../../shared/base-service";

import type { CollectionMetadataService } from "./collection-metadata-service";

/**
 * Collection metadata returned from operations
 */
export interface Collection {
  id: string;
  name: string;
  label: string;
  tableName: string;
  description?: string;
  icon?: string;
  schemaDefinition: {
    fields: FieldDefinition[];
  };
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Input for creating a collection
 */
export interface CreateCollectionInput {
  name: string;
  label: string;
  description?: string;
  icon?: string;
  fields: FieldDefinition[];
}

/**
 * Input for updating a collection
 */
export interface UpdateCollectionInput {
  label?: string;
  description?: string;
  icon?: string;
  fields?: FieldDefinition[];
}

/**
 * Options for listing collections
 */
export interface ListCollectionsOptions {
  page?: number;
  pageSize?: number;
  search?: string;
  sortBy?: "slug" | "createdAt" | "updatedAt";
  sortOrder?: "asc" | "desc";
  includeSchema?: boolean;
}

/**
 * Entry (document) within a collection
 */
export interface CollectionEntry {
  id: string;
  [key: string]: unknown;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * CollectionService - Unified service for collection and entry operations
 *
 * Provides both collection metadata CRUD (create/update/delete collections)
 * and entry CRUD (documents within collections) with:
 *
 * - Exception-based error handling (throws ServiceError)
 * - Type-safe RequestContext
 * - PaginatedResult for list operations
 * - Database adapter abstraction for multi-DB support
 * - Transaction support via adapter transactions
 *
 * @extends BaseService - Provides adapter access, transaction helpers, and WHERE clause builders
 */
export class CollectionService extends BaseService {
  constructor(
    adapter: DrizzleAdapter,
    logger: Logger,
    private readonly metadataService: CollectionMetadataService,
    private readonly entryService: CollectionEntryService
  ) {
    super(adapter, logger);
  }

  /**
   * Register dynamic collection schemas for runtime use.
   *
   * This should be called during app initialization to register
   * the generated Drizzle schema files for dynamic collections.
   *
   * @param schemas - Object mapping schema names to Drizzle table definitions
   *
   * @example
   * ```typescript
   * import * as dynamicSchemas from "@/db/schemas/dynamic";
   *
   * const service = getCollectionsService();
   * service.registerDynamicSchemas(dynamicSchemas);
   * ```
   */
  registerDynamicSchemas(schemas: Record<string, unknown>): void {
    this.metadataService.registerDynamicSchemas(schemas);
  }

  /**
   * Create a new collection
   *
   * @param input - Collection creation data
   * @param context - Request context with user info
   * @returns Created collection
   * @throws ServiceError if creation fails
   *
   * @example
   * ```typescript
   * const collection = await service.createCollection({
   *   name: 'posts',
   *   label: 'Blog Posts',
   *   fields: [
   *     { name: 'title', type: 'text', required: true },
   *     { name: 'content', type: 'richText' },
   *   ]
   * }, context);
   * ```
   */
  async createCollection(
    input: CreateCollectionInput,
    context: RequestContext
  ): Promise<Collection> {
    this.logger.debug("Creating collection", {
      name: input.name,
      userId: context.user?.id,
    });

    const result = await this.metadataService.createCollection({
      ...input,
      createdBy: context.user?.id,
    });

    if (!result.success) {
      this.logger.warn("Collection creation failed", {
        name: input.name,
        message: result.message,
      });
      throw this.mapLegacyErrorToServiceError(result);
    }

    const created = result.data as Record<string, unknown>;
    this.logger.info("Collection created", {
      name: input.name,
      collectionId: created?.id,
    });

    return created as unknown as Collection;
  }

  /**
   * List collections with pagination
   *
   * @param options - Pagination and filter options
   * @param context - Request context
   * @returns Paginated list of collections
   * @throws ServiceError if listing fails
   */
  async listCollections(
    options: ListCollectionsOptions = {},
    context: RequestContext
  ): Promise<PaginatedResult<Collection>> {
    this.logger.debug("Listing collections", { options });

    const result = await this.metadataService.listCollections(options);

    if (!result.success) {
      throw this.mapLegacyErrorToServiceError(result);
    }

    const pageSize = options.pageSize ?? 10;
    const page = options.page ?? 1;
    const offset = (page - 1) * pageSize;
    const total = (result.meta?.total as number) ?? 0;
    const items = (result.data ?? []) as unknown as Collection[];

    return {
      data: items,
      pagination: {
        total,
        limit: pageSize,
        offset,
        hasMore: offset + items.length < total,
      },
    };
  }

  /**
   * Get a single collection by name
   *
   * @param collectionName - Name of the collection
   * @param context - Request context
   * @returns Collection metadata
   * @throws ServiceError with NOT_FOUND if collection doesn't exist
   */
  async getCollection(
    collectionName: string,
    context: RequestContext
  ): Promise<Collection> {
    this.logger.debug("Getting collection", { collectionName });

    const result = await this.metadataService.getCollection({ collectionName });

    if (!result.success) {
      throw ServiceError.notFound(`Collection not found: ${collectionName}`, {
        entity: "collection",
        collectionName,
      });
    }

    return result.data as unknown as Collection;
  }

  /**
   * Update a collection's metadata and/or schema
   *
   * @param collectionName - Name of the collection to update
   * @param input - Update data
   * @param context - Request context
   * @returns Updated collection
   * @throws ServiceError if update fails
   */
  async updateCollection(
    collectionName: string,
    input: UpdateCollectionInput,
    context: RequestContext
  ): Promise<Collection> {
    this.logger.debug("Updating collection", { collectionName, input });

    const result = await this.metadataService.updateCollection(
      { collectionName },
      input
    );

    if (!result.success) {
      this.logger.warn("Collection update failed", {
        collectionName,
        message: result.message,
      });
      throw this.mapLegacyErrorToServiceError(result);
    }

    this.logger.info("Collection updated", { collectionName });

    return result.data as unknown as Collection;
  }

  /**
   * Delete a collection
   *
   * @param collectionName - Name of the collection to delete
   * @param context - Request context
   * @throws ServiceError if deletion fails
   */
  async deleteCollection(
    collectionName: string,
    context: RequestContext
  ): Promise<void> {
    this.logger.debug("Deleting collection", { collectionName });

    const result = await this.metadataService.deleteCollection({
      collectionName,
    });

    if (!result.success) {
      throw this.mapLegacyErrorToServiceError(result);
    }

    this.logger.info("Collection deleted", { collectionName });
  }

  /**
   * Create a new entry in a collection
   *
   * @param collectionName - Name of the collection
   * @param data - Entry data
   * @param context - Request context with user info
   * @returns Created entry
   * @throws ServiceError if creation fails
   *
   * @example
   * ```typescript
   * const post = await service.createEntry('posts', {
   *   title: 'Hello World',
   *   content: 'My first post',
   * }, context);
   * ```
   */
  async createEntry(
    collectionName: string,
    data: Record<string, unknown>,
    context: RequestContext
  ): Promise<CollectionEntry> {
    this.logger.debug("Creating entry", {
      collectionName,
      userId: context.user?.id,
    });

    const result = await this.entryService.createEntry(
      {
        collectionName,
        user: context.user,
      },
      data
    );

    if (!result.success) {
      this.logger.warn("Entry creation failed", {
        collectionName,
        message: result.message,
        statusCode: result.statusCode,
      });
      throw this.mapLegacyErrorToServiceError(result);
    }

    this.logger.info("Entry created", {
      collectionName,
      entryId: (result.data as Record<string, unknown> | undefined)?.id,
    });

    return result.data as CollectionEntry;
  }

  /**
   * List entries in a collection
   *
   * @param collectionName - Name of the collection
   * @param options - Query options (pagination, sort, where)
   * @param context - Request context
   * @returns Paginated list of entries
   * @throws ServiceError if listing fails
   */
  async listEntries(
    collectionName: string,
    options: QueryOptions = {},
    context: RequestContext
  ): Promise<PaginatedResult<CollectionEntry>> {
    this.logger.debug("Listing entries", { collectionName, options });

    const limit = options.pagination?.limit ?? 10;
    const page = options.pagination?.page ?? 1;
    const offset = options.pagination?.offset ?? (page - 1) * limit;

    const result = await this.entryService.listEntries({
      collectionName,
      user: context.user,
      page,
      limit,
    });

    if (!result.success || !result.data) {
      throw this.mapLegacyErrorToServiceError(result);
    }

    const paginatedResponse = result.data;
    return {
      data: paginatedResponse.docs as CollectionEntry[],
      pagination: {
        total: paginatedResponse.totalDocs,
        limit: paginatedResponse.limit,
        offset,
        hasMore: paginatedResponse.hasNextPage,
      },
    };
  }

  /**
   * Find an entry by ID
   *
   * @param collectionName - Name of the collection
   * @param entryId - ID of the entry
   * @param context - Request context
   * @returns Entry data
   * @throws ServiceError with NOT_FOUND if entry doesn't exist
   */
  async findEntryById(
    collectionName: string,
    entryId: string,
    context: RequestContext
  ): Promise<CollectionEntry> {
    this.logger.debug("Finding entry by ID", { collectionName, entryId });

    const result = await this.entryService.getEntry({
      collectionName,
      entryId,
      user: context.user,
    });

    if (!result.success) {
      if (result.statusCode === 404) {
        throw ServiceError.notFound(`Entry not found: ${entryId}`, {
          entity: "entry",
          collectionName,
          entryId,
        });
      }
      if (result.statusCode === 403) {
        throw ServiceError.forbidden(result.message || "Access denied", {
          collectionName,
          entryId,
        });
      }
      throw this.mapLegacyErrorToServiceError(result);
    }

    return result.data as CollectionEntry;
  }

  /**
   * Update an entry
   *
   * @param collectionName - Name of the collection
   * @param entryId - ID of the entry to update
   * @param data - Update data
   * @param context - Request context
   * @returns Updated entry
   * @throws ServiceError if update fails
   */
  async updateEntry(
    collectionName: string,
    entryId: string,
    data: Record<string, unknown>,
    context: RequestContext
  ): Promise<CollectionEntry> {
    this.logger.debug("Updating entry", { collectionName, entryId });

    const result = await this.entryService.updateEntry(
      {
        collectionName,
        entryId,
        user: context.user,
      },
      data
    );

    if (!result.success) {
      if (result.statusCode === 404) {
        throw ServiceError.notFound(`Entry not found: ${entryId}`, {
          entity: "entry",
          collectionName,
          entryId,
        });
      }
      if (result.statusCode === 403) {
        throw ServiceError.forbidden(result.message || "Access denied", {
          collectionName,
          entryId,
        });
      }
      this.logger.warn("Entry update failed", {
        collectionName,
        entryId,
        message: result.message,
      });
      throw this.mapLegacyErrorToServiceError(result);
    }

    this.logger.info("Entry updated", { collectionName, entryId });

    return result.data as CollectionEntry;
  }

  /**
   * Delete an entry
   *
   * @param collectionName - Name of the collection
   * @param entryId - ID of the entry to delete
   * @param context - Request context
   * @throws ServiceError if deletion fails
   */
  async deleteEntry(
    collectionName: string,
    entryId: string,
    context: RequestContext
  ): Promise<void> {
    this.logger.debug("Deleting entry", { collectionName, entryId });

    const result = await this.entryService.deleteEntry({
      collectionName,
      entryId,
      user: context.user,
    });

    if (!result.success) {
      if (result.statusCode === 404) {
        throw ServiceError.notFound(`Entry not found: ${entryId}`, {
          entity: "entry",
          collectionName,
          entryId,
        });
      }
      if (result.statusCode === 403) {
        throw ServiceError.forbidden(result.message || "Access denied", {
          collectionName,
          entryId,
        });
      }
      throw this.mapLegacyErrorToServiceError(result);
    }

    this.logger.info("Entry deleted", { collectionName, entryId });
  }

  /**
   * Create an entry within an existing transaction
   *
   * Use this when you need to coordinate multiple operations atomically.
   *
   * @param tx - Transaction context from adapter
   * @param collectionName - Name of the collection
   * @param data - Entry data
   * @param context - Request context
   * @returns Created entry
   * @throws Error if underlying service doesn't support transaction context
   *
   * @example
   * ```typescript
   * await service.withTransaction(async (tx) => {
   *   const entry = await service.createEntryInTransaction(tx, 'posts', data, context);
   *   await service.updateEntryInTransaction(tx, 'posts', entry.id, moreData, context);
   * });
   * ```
   */
  async createEntryInTransaction(
    tx: TransactionContext,
    collectionName: string,
    data: Record<string, unknown>,
    context: RequestContext
  ): Promise<CollectionEntry> {
    this.logger.debug("Creating entry in transaction", {
      collectionName,
      userId: context.user?.id,
    });

    const result = await this.entryService.createEntryInTransaction(
      tx,
      {
        collectionName,
        user: context.user,
      },
      data
    );

    if (!result.success) {
      this.logger.warn("Entry creation in transaction failed", {
        collectionName,
        message: result.message,
        statusCode: result.statusCode,
      });
      throw this.mapLegacyErrorToServiceError(result);
    }

    this.logger.info("Entry created in transaction", {
      collectionName,
      entryId: (result.data as CollectionEntry | null)?.id,
    });

    return result.data as CollectionEntry;
  }

  /**
   * Update an entry within an existing transaction
   *
   * @param tx - Transaction context from adapter
   * @param collectionName - Name of the collection
   * @param entryId - ID of the entry to update
   * @param data - Update data
   * @param context - Request context
   * @returns Updated entry
   * @throws Error if underlying service doesn't support transaction context
   */
  async updateEntryInTransaction(
    tx: TransactionContext,
    collectionName: string,
    entryId: string,
    data: Record<string, unknown>,
    context: RequestContext
  ): Promise<CollectionEntry> {
    this.logger.debug("Updating entry in transaction", {
      collectionName,
      entryId,
    });

    const result = await this.entryService.updateEntryInTransaction(
      tx,
      {
        collectionName,
        entryId,
        user: context.user,
      },
      data
    );

    if (!result.success) {
      if (result.statusCode === 404) {
        throw ServiceError.notFound(`Entry not found: ${entryId}`, {
          entity: "entry",
          collectionName,
          entryId,
        });
      }
      if (result.statusCode === 403) {
        throw ServiceError.forbidden(result.message || "Access denied", {
          collectionName,
          entryId,
        });
      }
      this.logger.warn("Entry update in transaction failed", {
        collectionName,
        entryId,
        message: result.message,
      });
      throw this.mapLegacyErrorToServiceError(result);
    }

    this.logger.info("Entry updated in transaction", {
      collectionName,
      entryId,
    });

    return result.data as CollectionEntry;
  }

  /**
   * Delete an entry within an existing transaction
   *
   * @param tx - Transaction context from adapter
   * @param collectionName - Name of the collection
   * @param entryId - ID of the entry to delete
   * @param context - Request context
   * @throws Error if underlying service doesn't support transaction context
   */
  async deleteEntryInTransaction(
    tx: TransactionContext,
    collectionName: string,
    entryId: string,
    context: RequestContext
  ): Promise<void> {
    this.logger.debug("Deleting entry in transaction", {
      collectionName,
      entryId,
    });

    const result = await this.entryService.deleteEntryInTransaction(tx, {
      collectionName,
      entryId,
      user: context.user,
    });

    if (!result.success) {
      if (result.statusCode === 404) {
        throw ServiceError.notFound(`Entry not found: ${entryId}`, {
          entity: "entry",
          collectionName,
          entryId,
        });
      }
      if (result.statusCode === 403) {
        throw ServiceError.forbidden(result.message || "Access denied", {
          collectionName,
          entryId,
        });
      }
      throw this.mapLegacyErrorToServiceError(result);
    }

    this.logger.info("Entry deleted in transaction", {
      collectionName,
      entryId,
    });
  }

  private mapLegacyErrorToServiceError(result: {
    success: boolean;
    statusCode: number;
    message: string;
    data: unknown;
  }): ServiceError {
    const { statusCode, message } = result;

    switch (statusCode) {
      case 400:
        return ServiceError.validation(message);
      case 401:
        return ServiceError.unauthorized(message);
      case 403:
        return ServiceError.forbidden(message);
      case 404:
        return ServiceError.notFound(message);
      case 409:
        return ServiceError.duplicate(message);
      case 422:
        return ServiceError.businessRule(message);
      default:
        return ServiceError.internal(message);
    }
  }
}
