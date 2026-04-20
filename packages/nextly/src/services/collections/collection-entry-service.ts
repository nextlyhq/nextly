/**
 * CollectionEntryService — Thin facade for collection entry CRUD operations.
 *
 * This file was originally a 6,490-line god file. It has been decomposed into
 * focused single-responsibility services:
 *
 * - {@link CollectionAccessService} — Access control evaluation (RBAC + collection rules)
 * - {@link CollectionHookService} — Hook context building and stored hook management
 * - {@link CollectionQueryService} — Read operations (list, count, get)
 * - {@link CollectionMutationService} — Write operations (create, update, delete)
 * - {@link CollectionBulkService} — Bulk and batch operations
 *
 * Utility functions live in `collection-utils.ts` and shared types in `collection-types.ts`.
 *
 * This facade preserves the original public API so that all callers (DI container,
 * API handlers, tests) continue to work unchanged.
 */

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import type { TransactionContext } from "@revnixhq/adapter-drizzle/types";

import type { HookRegistry } from "@nextly/hooks/hook-registry";
import type { RichTextOutputFormat } from "@nextly/lib/rich-text-html";

import { CollectionAccessService } from "../../domains/collections/services/collection-access-service";
import { CollectionBulkService } from "../../domains/collections/services/collection-bulk-service";
import { CollectionHookService } from "../../domains/collections/services/collection-hook-service";
import { CollectionMutationService } from "../../domains/collections/services/collection-mutation-service";
import { CollectionQueryService } from "../../domains/collections/services/collection-query-service";
import type {
  CollectionServiceResult,
  UserContext,
  BulkOperationResult,
  BatchOperationResult,
  BulkOperationOptions,
  BulkUpdateEntry,
} from "../../domains/collections/services/collection-types";
import type { PaginatedResponse } from "../../types/pagination";
import type { AccessControlService } from "../access";
import type { FieldPermissionCheckerService } from "../auth/field-permission-checker-service";
import type { RBACAccessControlService } from "../auth/rbac-access-control-service";
import { BaseService } from "../base-service";
import type { CollectionFileManager } from "../collection-file-manager";
import type { ComponentDataService } from "../components/component-data-service";
import type { DynamicCollectionService } from "../dynamic-collections";
import type { Logger } from "../shared";

import type { CollectionRelationshipService } from "./collection-relationship-service";
import type { WhereFilter } from "./query-operators";

export {
  type CollectionServiceResult,
  type UserContext,
  type BulkOperationResult,
  type BatchOperationResult,
  type BulkOperationOptions,
  type BulkCreateOptions,
  type BulkUpdateEntry,
} from "../../domains/collections/services/collection-types";

/**
 * CollectionEntryService handles all entry-level CRUD operations for dynamic collections.
 *
 * This is a thin facade that delegates to focused split services. The constructor
 * signature and public API are unchanged from the original implementation.
 *
 * @extends BaseService - Provides adapter access, transaction helpers
 */
export class CollectionEntryService extends BaseService {
  private readonly accessService: CollectionAccessService;
  private readonly hookService: CollectionHookService;
  private readonly queryService: CollectionQueryService;
  private readonly mutationService: CollectionMutationService;
  private readonly bulkService: CollectionBulkService;

  constructor(
    adapter: DrizzleAdapter,
    logger: Logger,
    fileManager: CollectionFileManager,
    collectionService: DynamicCollectionService,
    relationshipService: CollectionRelationshipService,
    fieldPermissionChecker: FieldPermissionCheckerService,
    hookRegistry: HookRegistry,
    accessControlService: AccessControlService,
    componentDataService?: ComponentDataService,
    rbacAccessControlService?: RBACAccessControlService
  ) {
    super(adapter, logger);

    this.accessService = new CollectionAccessService(
      adapter,
      logger,
      collectionService,
      accessControlService,
      rbacAccessControlService
    );
    this.hookService = new CollectionHookService(hookRegistry);

    this.queryService = new CollectionQueryService(
      adapter,
      logger,
      fileManager,
      collectionService,
      relationshipService,
      fieldPermissionChecker,
      this.accessService,
      this.hookService,
      componentDataService
    );
    this.mutationService = new CollectionMutationService(
      adapter,
      logger,
      fileManager,
      collectionService,
      relationshipService,
      fieldPermissionChecker,
      this.accessService,
      this.hookService,
      componentDataService
    );
    this.bulkService = new CollectionBulkService(
      adapter,
      logger,
      this.accessService,
      this.queryService,
      this.mutationService
    );
  }

  async listEntries(params: {
    collectionName: string;
    user?: UserContext;
    search?: string;
    page?: number;
    limit?: number;
    depth?: number;
    select?: Record<string, boolean>;
    where?: WhereFilter;
    richTextFormat?: RichTextOutputFormat;
    sort?: string;
    overrideAccess?: boolean;
    context?: Record<string, unknown>;
  }): Promise<CollectionServiceResult<PaginatedResponse<unknown>>> {
    return this.queryService.listEntries(params);
  }

  async countEntries(params: {
    collectionName: string;
    user?: UserContext;
    search?: string;
    where?: WhereFilter;
    overrideAccess?: boolean;
    context?: Record<string, unknown>;
  }): Promise<CollectionServiceResult<{ totalDocs: number }>> {
    return this.queryService.countEntries(params);
  }

  async getEntry(params: {
    collectionName: string;
    entryId: string;
    user?: UserContext;
    depth?: number;
    select?: Record<string, boolean>;
    richTextFormat?: RichTextOutputFormat;
    overrideAccess?: boolean;
    context?: Record<string, unknown>;
  }) {
    return this.queryService.getEntry(params);
  }

  async createEntry(
    params: {
      collectionName: string;
      user?: UserContext;
      overrideAccess?: boolean;
      context?: Record<string, unknown>;
    },
    body: Record<string, unknown>,
    depth?: number
  ) {
    return this.mutationService.createEntry(params, body, depth);
  }

  async updateEntry(
    params: {
      collectionName: string;
      entryId: string;
      user?: UserContext;
      overrideAccess?: boolean;
      context?: Record<string, unknown>;
    },
    body: Record<string, unknown>,
    depth?: number
  ) {
    return this.mutationService.updateEntry(params, body, depth);
  }

  async deleteEntry(params: {
    collectionName: string;
    entryId: string;
    user?: UserContext;
    overrideAccess?: boolean;
    context?: Record<string, unknown>;
  }) {
    return this.mutationService.deleteEntry(params);
  }

  async createEntryInTransaction(
    tx: TransactionContext,
    params: { collectionName: string; user?: UserContext },
    body: Record<string, unknown>
  ): Promise<CollectionServiceResult<unknown>> {
    return this.mutationService.createEntryInTransaction(tx, params, body);
  }

  async updateEntryInTransaction(
    tx: TransactionContext,
    params: { collectionName: string; entryId: string; user?: UserContext },
    body: Record<string, unknown>
  ): Promise<CollectionServiceResult<unknown>> {
    return this.mutationService.updateEntryInTransaction(tx, params, body);
  }

  async deleteEntryInTransaction(
    tx: TransactionContext,
    params: {
      collectionName: string;
      entryId: string;
      user?: UserContext;
    }
  ): Promise<CollectionServiceResult<{ deleted: boolean }>> {
    return this.mutationService.deleteEntryInTransaction(tx, params);
  }

  async duplicateEntry(params: {
    collectionName: string;
    entryId: string;
    user?: UserContext;
    overrides?: Record<string, unknown>;
    overrideAccess?: boolean;
    context?: Record<string, unknown>;
  }) {
    return this.bulkService.duplicateEntry(params);
  }

  async bulkDeleteEntries(params: {
    collectionName: string;
    ids: string[];
    user?: UserContext;
    overrideAccess?: boolean;
    context?: Record<string, unknown>;
  }): Promise<BulkOperationResult> {
    return this.bulkService.bulkDeleteEntries(params);
  }

  async bulkUpdateEntries(params: {
    collectionName: string;
    ids: string[];
    data: Record<string, unknown>;
    user?: UserContext;
    overrideAccess?: boolean;
    context?: Record<string, unknown>;
  }): Promise<BulkOperationResult> {
    return this.bulkService.bulkUpdateEntries(params);
  }

  async bulkUpdateByQuery(
    params: {
      collectionName: string;
      where: WhereFilter;
      data: Record<string, unknown>;
      user?: UserContext;
      overrideAccess?: boolean;
      context?: Record<string, unknown>;
    },
    options?: BulkOperationOptions & { limit?: number }
  ): Promise<BulkOperationResult> {
    return this.bulkService.bulkUpdateByQuery(params, options);
  }

  async bulkDeleteByQuery(
    params: {
      collectionName: string;
      where: WhereFilter;
      user?: UserContext;
      overrideAccess?: boolean;
      context?: Record<string, unknown>;
    },
    options?: { limit?: number }
  ): Promise<BulkOperationResult> {
    return this.bulkService.bulkDeleteByQuery(params, options);
  }

  async createEntries(
    params: { collectionName: string; user?: UserContext },
    entries: Record<string, unknown>[],
    options?: BulkOperationOptions
  ): Promise<BatchOperationResult> {
    return this.bulkService.createEntries(params, entries, options);
  }

  async createEntriesInTransaction(
    tx: TransactionContext,
    params: { collectionName: string; user?: UserContext },
    entries: Record<string, unknown>[],
    options?: BulkOperationOptions
  ): Promise<BatchOperationResult> {
    return this.bulkService.createEntriesInTransaction(
      tx,
      params,
      entries,
      options
    );
  }

  async updateEntries(
    params: { collectionName: string; user?: UserContext },
    entries: BulkUpdateEntry[],
    options?: BulkOperationOptions
  ): Promise<BatchOperationResult> {
    return this.bulkService.updateEntries(params, entries, options);
  }

  async updateEntriesInTransaction(
    tx: TransactionContext,
    params: { collectionName: string; user?: UserContext },
    entries: BulkUpdateEntry[],
    options?: BulkOperationOptions
  ): Promise<BatchOperationResult> {
    return this.bulkService.updateEntriesInTransaction(
      tx,
      params,
      entries,
      options
    );
  }

  async deleteEntries(
    params: { collectionName: string; user?: UserContext },
    ids: string[],
    options?: BulkOperationOptions
  ): Promise<BatchOperationResult> {
    return this.bulkService.deleteEntries(params, ids, options);
  }

  async deleteEntriesInTransaction(
    tx: TransactionContext,
    params: { collectionName: string; user?: UserContext },
    ids: string[],
    options?: BulkOperationOptions
  ): Promise<BatchOperationResult> {
    return this.bulkService.deleteEntriesInTransaction(
      tx,
      params,
      ids,
      options
    );
  }
}
