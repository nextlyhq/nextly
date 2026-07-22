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

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import type { HookRegistry } from "@nextly/hooks/hook-registry";
import type { RichTextOutputFormat } from "@nextly/lib/rich-text-html";

import type { RequestActor } from "../../auth/request-actor";
import type { RBACAccessControlService } from "../../domains/auth/services/rbac-access-control-service";
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
import type { DynamicCollectionService } from "../../domains/dynamic-collections";
import type { SanitizedLocalizationConfig } from "../../domains/i18n/config/types";
import type { WebhookRetentionRunner } from "../../domains/webhooks/retention-runner";
import type { PaginatedResponse } from "../../types/pagination";
import type { AccessControlService } from "../access";
import { BaseService } from "../base-service";
import type { CollectionFileManager } from "../collection-file-manager";
import type { ComponentDataService } from "../components/component-data-service";
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
    hookRegistry: HookRegistry,
    accessControlService: AccessControlService,
    componentDataService?: ComponentDataService,
    rbacAccessControlService?: RBACAccessControlService,
    /** Normalized localization config (i18n M4) — forwarded to the query service. */
    localization?: SanitizedLocalizationConfig,
    /**
     * Offers a webhook-retention pass after a write. Wired here rather than at
     * a caller because every write path that appends an event runs through this
     * service — the dispatcher-facing handler, `CollectionService`, and direct
     * callers alike — so this is the one place that covers them all.
     */
    private readonly retentionRunner?: WebhookRetentionRunner
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
      this.accessService,
      this.hookService,
      componentDataService,
      localization
    );
    this.mutationService = new CollectionMutationService(
      adapter,
      logger,
      fileManager,
      collectionService,
      relationshipService,
      this.accessService,
      this.hookService,
      componentDataService,
      localization
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
    /** Requested content locale (i18n M4) — forwarded to the query service. */
    locale?: string;
    /** Fallback control (`false`/`"none"` disables fallback). */
    fallbackLocale?: string | false;
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
    /** Requested content locale (i18n M4) — forwarded to the query service. */
    locale?: string;
    /** Fallback control (`false`/`"none"` disables fallback). */
    fallbackLocale?: string | false;
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
    /**
     * Draft/Published filter override (only effective when collection.status
     * === true). 'all' bypasses the default published-only filter — used by
     * the admin so unpublished entries stay reachable. Forwarded to the
     * query service which maps it to a SQL predicate.
     */
    status?: "published" | "draft" | "all";
    /** Requested content locale (i18n M4) — forwarded to the query service. */
    locale?: string;
    /** Fallback control (`false`/`"none"` disables fallback). */
    fallbackLocale?: string | false;
    context?: Record<string, unknown>;
  }) {
    return this.queryService.getEntry(params);
  }

  /**
   * Batches a write-triggered pass may run. Small on purpose: the write path is
   * the only retention trigger an install without a drain has, so the pass must
   * be awaited to survive a serverless invocation being frozen after the
   * response — which means one save per interval pays for it, and that save
   * should not be waiting on a full backlog sweep. Ten thousand rows an hour
   * from this path alone keeps ahead of most sites; anything with a drain gets
   * the full budget there.
   */
  private static readonly WRITE_PATH_PRUNE_BATCHES = 2;

  /**
   * Run a retention pass after a successful write, if one is due.
   *
   * Awaited rather than fired and forgotten: on a serverless runtime the
   * invocation can be frozen or torn down as soon as the response is returned,
   * so a detached promise may never get past the gate — and for an install with
   * no drain this is the only trigger there is. `maybeRun` absorbs its own
   * failures, so this cannot turn a successful save into an error.
   */
  private async offerRetentionPass(): Promise<void> {
    await this.retentionRunner?.maybeRun(
      CollectionEntryService.WRITE_PATH_PRUNE_BATCHES
    );
  }

  async createEntry(
    params: {
      collectionName: string;
      user?: UserContext;
      /** Who performed the write, recorded on the outbox event. */
      actor?: RequestActor;
      overrideAccess?: boolean;
      /** Write locale (i18n M5) — translatable values stored for this language. */
      locale?: string;
      context?: Record<string, unknown>;
    },
    body: Record<string, unknown>,
    depth?: number
  ) {
    const result = await this.mutationService.createEntry(params, body, depth);
    await this.offerRetentionPass();
    return result;
  }

  /**
   * Whether this user may update the entry, without performing the update.
   *
   * For callers that write something other than the document and still owe it
   * the document's own update rules. See the mutation service for why this
   * shares `updateEntry`'s evaluation rather than restating it.
   */
  async canUpdateEntry(params: {
    collectionName: string;
    entryId: string;
    user?: UserContext;
    routeAuthorized?: boolean;
  }): Promise<boolean> {
    return this.mutationService.canUpdateEntry(params);
  }

  async updateEntry(
    params: {
      collectionName: string;
      entryId: string;
      user?: UserContext;
      /** Who performed the write, recorded on the outbox event. */
      actor?: RequestActor;
      overrideAccess?: boolean;
      /** Write locale (i18n M5) — translatable values updated for this language. */
      locale?: string;
      context?: Record<string, unknown>;
      /**
       * Set when this write restores an earlier version, recorded on the
       * version it captures.
       */
      sourceVersionNo?: number;
    },
    body: Record<string, unknown>,
    depth?: number
  ) {
    const result = await this.mutationService.updateEntry(params, body, depth);
    await this.offerRetentionPass();
    return result;
  }

  /** i18n M7: publish every language of an entry at once (spec §10). */
  async publishAllLocales(params: {
    collectionName: string;
    entryId: string;
    user?: UserContext;
    overrideAccess?: boolean;
  }) {
    const result = await this.mutationService.publishAllLocales(params);
    await this.offerRetentionPass();
    return result;
  }

  async deleteEntry(params: {
    collectionName: string;
    entryId: string;
    user?: UserContext;
    /** Who performed the delete, recorded on the outbox event. */
    actor?: RequestActor;
    overrideAccess?: boolean;
    context?: Record<string, unknown>;
  }) {
    const result = await this.mutationService.deleteEntry(params);
    await this.offerRetentionPass();
    return result;
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
    /** Acting identity from the transport, forwarded to the recorded event. */
    actor?: RequestActor;
  }) {
    const result = await this.bulkService.duplicateEntry(params);
    await this.offerRetentionPass();
    return result;
  }

  // Phase 4.5: bulk methods carry full records on update (caller needs
  // the post-mutation values) and minimal {id} records on delete.
  async bulkDeleteEntries(params: {
    collectionName: string;
    ids: string[];
    user?: UserContext;
    overrideAccess?: boolean;
    context?: Record<string, unknown>;
  }): Promise<BulkOperationResult<{ id: string }>> {
    const result = await this.bulkService.bulkDeleteEntries(params);
    await this.offerRetentionPass();
    return result;
  }

  async bulkUpdateEntries(params: {
    collectionName: string;
    ids: string[];
    data: Record<string, unknown>;
    user?: UserContext;
    overrideAccess?: boolean;
    context?: Record<string, unknown>;
    /** Acting identity from the transport, forwarded to the recorded event. */
    actor?: RequestActor;
  }): Promise<BulkOperationResult<Record<string, unknown>>> {
    const result = await this.bulkService.bulkUpdateEntries(params);
    await this.offerRetentionPass();
    return result;
  }

  async bulkUpdateByQuery(
    params: {
      collectionName: string;
      where: WhereFilter;
      data: Record<string, unknown>;
      user?: UserContext;
      overrideAccess?: boolean;
      /** Route auth already ran; response is still redacted for this user */
      routeAuthorized?: boolean;
      context?: Record<string, unknown>;
      /** Acting identity from the transport, forwarded to the recorded event. */
      actor?: RequestActor;
    },
    options?: BulkOperationOptions & { limit?: number }
  ): Promise<BulkOperationResult<Record<string, unknown>>> {
    const result = await this.bulkService.bulkUpdateByQuery(params, options);
    await this.offerRetentionPass();
    return result;
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
  ): Promise<BulkOperationResult<{ id: string }>> {
    const result = await this.bulkService.bulkDeleteByQuery(params, options);
    await this.offerRetentionPass();
    return result;
  }

  async createEntries(
    params: {
      collectionName: string;
      user?: UserContext;
      overrideAccess?: boolean;
    },
    entries: Record<string, unknown>[],
    options?: BulkOperationOptions
  ): Promise<BatchOperationResult> {
    const result = await this.bulkService.createEntries(
      params,
      entries,
      options
    );
    await this.offerRetentionPass();
    return result;
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
    const result = await this.bulkService.updateEntries(
      params,
      entries,
      options
    );
    await this.offerRetentionPass();
    return result;
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
    const result = await this.bulkService.deleteEntries(params, ids, options);
    await this.offerRetentionPass();
    return result;
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
