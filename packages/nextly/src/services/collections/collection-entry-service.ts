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

import type { AuthenticatedScope } from "../../auth/authenticated-scope";
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
import { releaseVisibilityFor } from "../../domains/releases/release-visibility";
import type { RetentionRunner } from "../../domains/retention/runner";
import type { WebhookFastDrainScheduler } from "../../domains/webhooks/after-drain";
import type {
  CacheRevalidator,
  RevalidationIntent,
} from "../../revalidation/types";
import type { PaginatedResponse } from "../../types/pagination";
import type { AccessControlService } from "../access";
import { BaseService } from "../base-service";
import type { CollectionFileManager } from "../collection-file-manager";
import type { FieldGroupDataService } from "../field-groups/field-group-data-service";
import type { Logger } from "../shared";

import type { CollectionRelationshipService } from "./collection-relationship-service";
import type { WhereFilter } from "./query-operators";
import type { TrustBound } from "./trust-grant";

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
    fieldGroupDataService?: FieldGroupDataService,
    rbacAccessControlService?: RBACAccessControlService,
    /** Normalized localization config (i18n M4) — forwarded to the query service. */
    localization?: SanitizedLocalizationConfig,
    /**
     * Offers a retention pass after a write — both of them: the webhook event
     * ledger and the audit trails, each on its own window and its own gate. The
     * runner decides which are configured, so a construction site that forwards
     * only one policy silently leaves that domain unpruned rather than failing.
     *
     * Wired here rather than at a caller because every write path that appends
     * an event runs through this service — the dispatcher-facing handler,
     * `CollectionService`, and direct callers alike — so this is the one place
     * that covers them all.
     */
    private readonly retentionRunner?: RetentionRunner,
    /**
     * Kicks an immediate, bounded drain after a write (via Next `after()`), so
     * the first delivery attempt does not wait for the next scheduled trigger.
     * Wired at the same seam as `retentionRunner` for the same reason.
     */
    private readonly fastDrainScheduler?: WebhookFastDrainScheduler,
    /**
     * Resolves the cache revalidator that flushes a write's revalidation intent
     * post-commit. Wired at the same seam as `fastDrainScheduler` because every
     * event-appending write runs through this service. A resolver (not the
     * instance) so it is read at flush time: this service is constructed during
     * boot, before a Next cache adapter registers, and an eager capture would
     * memoize the no-op default. Returns undefined when no adapter is present.
     */
    private readonly resolveCacheRevalidator?: () =>
      | CacheRevalidator
      | undefined
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

    // What a due release makes visible. Built once and shared by the read
    // paths below, so the cheap check's memo is shared too — a cache per read
    // would reload the earliest scheduled instant on every request and lose the
    // entire point of having one.
    const releaseVisibility = releaseVisibilityFor(adapter);

    this.queryService = new CollectionQueryService(
      adapter,
      logger,
      fileManager,
      collectionService,
      relationshipService,
      this.accessService,
      this.hookService,
      fieldGroupDataService,
      localization,
      releaseVisibility
    );
    this.mutationService = new CollectionMutationService(
      adapter,
      logger,
      fileManager,
      collectionService,
      relationshipService,
      this.accessService,
      this.hookService,
      fieldGroupDataService,
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
    /** Draft/Published lifecycle scope; forwarded to the query service. */
    status?: "published" | "draft" | "all";
    overrideAccess?: boolean;
    /**
     * Which collections a trusted read may reach as relationships are expanded.
     * Absent means every populated target inherits the caller's trust. Only ever
     * narrows, and never admits a target's drafts.
     */
    trusted?: TrustBound;
    /** Requested content locale (i18n M4) — forwarded to the query service. */
    locale?: string;
    /** Fallback control (`false`/`"none"` disables fallback). */
    fallbackLocale?: string | false;
    context?: Record<string, unknown>;
    /** Route authorization already ran the coarse RBAC gate; stored rules run. */
    routeAuthorized?: boolean;
    /** Caller's authenticated scope; a scoped key is judged on its read grant. */
    authenticatedScope?: AuthenticatedScope;
  }): Promise<CollectionServiceResult<PaginatedResponse<unknown>>> {
    return this.queryService.listEntries(params);
  }

  async countEntries(params: {
    collectionName: string;
    user?: UserContext;
    search?: string;
    where?: WhereFilter;
    overrideAccess?: boolean;
    /**
     * Which collections a trusted read may reach as relationships are expanded.
     * Absent means every populated target inherits the caller's trust. Only ever
     * narrows, and never admits a target's drafts.
     */
    trusted?: TrustBound;
    /** Requested content locale (i18n M4) — forwarded to the query service. */
    locale?: string;
    /** Fallback control (`false`/`"none"` disables fallback). */
    fallbackLocale?: string | false;
    context?: Record<string, unknown>;
    /** Route authorization already ran the coarse RBAC gate; stored rules run. */
    routeAuthorized?: boolean;
    /** Caller's authenticated scope; a scoped key is judged on its read grant. */
    authenticatedScope?: AuthenticatedScope;
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
     * Which collections a trusted read may reach as relationships are expanded.
     * Absent means every populated target inherits the caller's trust. Only ever
     * narrows, and never admits a target's drafts.
     */
    trusted?: TrustBound;
    /**
     * Draft/Published filter override (only effective when collection.status
     * === true). 'all' bypasses the default published-only filter — used by
     * the admin so unpublished entries stay reachable. Forwarded to the
     * query service which maps it to a SQL predicate.
     */
    status?: "published" | "draft" | "all";
    /**
     * Opt in to the working-draft overlay (draft/published split): a trusted
     * editor read returns the pending working draft in place of the live row.
     * Forwarded to the query service, which gates it on update trust.
     */
    includeWorkingDraft?: boolean;
    /** Requested content locale (i18n M4) — forwarded to the query service. */
    locale?: string;
    /** Fallback control (`false`/`"none"` disables fallback). */
    fallbackLocale?: string | false;
    context?: Record<string, unknown>;
    /** Route authorization already ran the coarse RBAC gate; stored rules run. */
    routeAuthorized?: boolean;
    /** Caller's authenticated scope; a scoped key is judged on its read grant. */
    authenticatedScope?: AuthenticatedScope;
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

  /**
   * Run the post-write side effects only when the mutation actually recorded a
   * change (and therefore appended an outbox event). A rejected write — a
   * validation or access failure surfaced as `success: false`, or a bulk/batch
   * operation where every item failed — recorded nothing, so kicking the drain
   * would deliver unrelated pending events for a write that changed nothing (and
   * let a failed, possibly unauthorized attempt trigger outbound webhooks). The
   * three result shapes report "recorded something" differently. `success` is
   * not a reliable proxy in either direction: a create/update/delete can commit
   * the event and then return `success: false` when a post-commit hook throws,
   * and a `publishAllLocales` no-op (or a no-op update) returns `success: true`
   * having recorded nothing. So a single write keys off the explicit
   * `eventRecorded` flag, which every event-writing path sets. Bulk/batch results
   * carry the same flag for their committed-but-hook-failed items on top of the
   * success count.
   */
  private async afterWriteIfRecorded(
    result:
      | CollectionServiceResult<unknown>
      | BulkOperationResult<unknown>
      | BatchOperationResult,
    disableRevalidate = false
  ): Promise<void> {
    // Revalidation flushes whenever a committed write produced intents. It is
    // NOT tied to the outbox-event gate below: an intent is only ever set after
    // a write commits, so its presence is the "content changed" signal, and a
    // publish-all-locales or a batch create (which record no outbox event) still
    // bust their tags. The per-operation `disableRevalidate` escape hatch skips
    // it (a CLI / seed / bulk-import write that owns its own cache strategy);
    // the outbox drain still runs, so webhooks and retention are unaffected.
    if (!disableRevalidate) {
      await this.flushRevalidation(result);
    }

    // Retention is opportunistic write-path cleanup — the write path is the only
    // prune trigger for installs with no webhook drain, so even a write to only
    // opted-out (`webhooks: false`) entities must still offer a pass. It is NOT
    // the outbox gate, but it IS gated on a committed write: a rejected request
    // (validation / access / not-found) — and a no-op that wrote nothing —
    // committed no content, so paying for an awaited outbox-deletion pass on its
    // behalf is wasted latency. An opted-out write still qualifies (it carries a
    // revalidation intent even though it recorded no event), so coverage holds.
    if (CollectionEntryService.hasCommittedWrite(result)) {
      await this.offerRetentionPass();
    }

    // The fast drain, by contrast, only matters when an outbox event was actually
    // recorded to deliver. Every result — single, bulk (`successCount`), and
    // batch (`successful`) — carries an aggregated `eventRecorded`, so a write of
    // only opted-out entries records nothing and schedules no drain, rather than
    // draining unrelated pending events off a positive success count.
    if (result.eventRecorded === true) {
      this.fastDrainScheduler?.offer();
    }
  }

  /**
   * Whether a mutation result represents at least one committed content write.
   * A single create/update/delete carries the explicit `committed` flag (set the
   * moment its transaction commits, independent of the recording and revalidation
   * opt-outs), so even a write that opts out of BOTH — no event, no intent — is
   * covered, while a rejected request (validation / access / not-found) and a
   * `publishAllLocales` no-op are not. Bulk/batch results use their positive
   * counts; `eventRecorded` covers a committed-but-hook-failed batch. NOT keyed
   * off `success`, which a no-op update also reports.
   */
  private static hasCommittedWrite(
    result:
      | CollectionServiceResult<unknown>
      | BulkOperationResult<unknown>
      | BatchOperationResult
  ): boolean {
    if ("committed" in result && result.committed === true) return true;
    if (result.eventRecorded === true) return true;
    if ("successCount" in result && result.successCount > 0) return true;
    if ("successful" in result && result.successful > 0) return true;
    // Covers single ops that flush an intent without setting `committed` (e.g. a
    // publish-all-locales transition) — a present intent means content changed.
    if ("revalidationIntent" in result && result.revalidationIntent != null) {
      return true;
    }
    if (
      "revalidationIntents" in result &&
      (result.revalidationIntents?.length ?? 0) > 0
    ) {
      return true;
    }
    return false;
  }

  /**
   * Flush a committed write's cache-revalidation intents through the registered
   * revalidator (a no-op when no cache adapter is present). Runs on the same
   * gate as the drain — a write that recorded nothing revalidates nothing — and
   * absorbs its own failure so it never turns a committed write into an error.
   * Awaited (like the retention pass) so an async revalidator's work is not left
   * detached, where a serverless response could cut it off before it completes.
   */
  private async flushRevalidation(
    result:
      | CollectionServiceResult<unknown>
      | BulkOperationResult<unknown>
      | BatchOperationResult
  ): Promise<void> {
    const intents =
      "revalidationIntents" in result && result.revalidationIntents
        ? result.revalidationIntents
        : "revalidationIntent" in result && result.revalidationIntent
          ? [result.revalidationIntent]
          : [];
    await this.flushRevalidationIntents(intents);
  }

  /**
   * Flush an explicit set of revalidation intents collected by a caller-owned
   * transaction (for example the `CollectionService` transaction wrappers, whose
   * return values carry only the entry). Shares the automatic post-write path:
   * a no-op when no cache adapter is registered, and self-absorbing on error so
   * a revalidator fault never turns a committed write into a failure.
   */
  /**
   * Run the write-path maintenance the automatic paths run, for the
   * `CollectionService.withTransaction` wrapper to call after a tx-API write
   * commits. The wrappers return only the entry, so — like
   * `flushRevalidationIntents` — these cannot be triggered from the wrapper's own
   * result. Mirrors `afterWriteIfRecorded`: a committed write offers the
   * opportunistic retention pass (the write path is the only prune trigger for an
   * install with no drain, so tx-API writes must offer it too, or `nextly_events`
   * grows unbounded), and a recorded event schedules the fast drain. No-ops when
   * the respective runner/scheduler is unwired.
   */
  async offerPostCommitTxMaintenance(opts: {
    committedWrite: boolean;
    recordedEvent: boolean;
  }): Promise<void> {
    if (opts.committedWrite) {
      await this.offerRetentionPass();
    }
    if (opts.recordedEvent) {
      this.fastDrainScheduler?.offer();
    }
  }

  async flushRevalidationIntents(intents: RevalidationIntent[]): Promise<void> {
    if (intents.length === 0) return;
    // Resolve at flush time so a Next cache adapter registered after this
    // service was constructed (at request time, well after boot) is honored.
    const revalidator = this.resolveCacheRevalidator?.();
    if (!revalidator) return;
    try {
      // Await so a Promise-returning revalidator finishes here; `revalidateTag`
      // is synchronous, so this adds no latency for the common case.
      await revalidator.flush(intents);
    } catch (error) {
      this.logger.error("Cache revalidation failed after a write", { error });
    }
  }

  async createEntry(
    params: {
      collectionName: string;
      /**
       * Skip cache revalidation for this write (the outbox drain still runs).
       * Set by callers that own their cache strategy — a CLI, seed, or
       * bulk-import write — so it does not fan out a revalidation per row.
       */
      disableRevalidate?: boolean;
      user?: UserContext;
      /** Who performed the write, recorded on the outbox event. */
      actor?: RequestActor;
      overrideAccess?: boolean;
      /**
       * Which collections a trusted read may reach as relationships are expanded.
       * Absent means every populated target inherits the caller's trust. Only ever
       * narrows, and never admits a target's drafts.
       */
      trusted?: TrustBound;
      /** Write locale (i18n M5) — translatable values stored for this language. */
      locale?: string;
      context?: Record<string, unknown>;
      /**
       * The caller's authenticated scope. For a scoped API-key REST create the
       * publish transition gate (create-as-published) judges the key's OWN grants.
       */
      authenticatedScope?: AuthenticatedScope;
    },
    body: Record<string, unknown>,
    depth?: number
  ) {
    const result = await this.mutationService.createEntry(params, body, depth);
    await this.afterWriteIfRecorded(result, params.disableRevalidate);
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
    /** API-key scope; judges the update gate on the key's own grant. */
    authenticatedScope?: AuthenticatedScope;
  }): Promise<boolean> {
    return this.mutationService.canUpdateEntry(params);
  }

  async updateEntry(
    params: {
      collectionName: string;
      /**
       * Skip cache revalidation for this write (the outbox drain still runs).
       * Set by callers that own their cache strategy — a CLI, seed, or
       * bulk-import write — so it does not fan out a revalidation per row.
       */
      disableRevalidate?: boolean;
      entryId: string;
      user?: UserContext;
      /** Who performed the write, recorded on the outbox event. */
      actor?: RequestActor;
      overrideAccess?: boolean;
      /**
       * Which collections a trusted read may reach as relationships are expanded.
       * Absent means every populated target inherits the caller's trust. Only ever
       * narrows, and never admits a target's drafts.
       */
      trusted?: TrustBound;
      /** Write locale (i18n M5) — translatable values updated for this language. */
      locale?: string;
      context?: Record<string, unknown>;
      /**
       * Set when this write restores an earlier version, recorded on the
       * version it captures.
       */
      sourceVersionNo?: number;
      /**
       * The caller's authenticated scope. For a scoped API-key REST write the
       * publish/unpublish transition gate judges the key's OWN grants.
       */
      authenticatedScope?: AuthenticatedScope;
    },
    body: Record<string, unknown>,
    depth?: number
  ) {
    const result = await this.mutationService.updateEntry(params, body, depth);
    await this.afterWriteIfRecorded(result, params.disableRevalidate);
    return result;
  }

  /** i18n M7: publish every language of an entry at once (spec §10). */
  async publishAllLocales(params: {
    collectionName: string;
    /**
     * Skip cache revalidation for this write (the outbox drain still runs).
     * Set by callers that own their cache strategy — a CLI, seed, or
     * bulk-import write — so it does not fan out a revalidation per row.
     */
    disableRevalidate?: boolean;
    entryId: string;
    user?: UserContext;
    overrideAccess?: boolean;
    /**
     * Which collections a trusted read may reach as relationships are expanded.
     * Absent means every populated target inherits the caller's trust. Only ever
     * narrows, and never admits a target's drafts.
     */
    trusted?: TrustBound;
    /**
     * Set by the REST dispatcher: the route already authorized this POST as
     * `update`, so the preliminary update gate skips its redundant RBAC re-check.
     */
    routeAuthorized?: boolean;
    /** API-key scope; gates the unconditional publish check. */
    authenticatedScope?: AuthenticatedScope;
  }) {
    const result = await this.mutationService.publishAllLocales(params);
    await this.afterWriteIfRecorded(result, params.disableRevalidate);
    return result;
  }

  /**
   * Take every language of an entry down at once.
   *
   * The counterpart publishing has had since i18n M7 and withdrawing never did.
   * Same shape deliberately: a caller that can publish every language should not
   * have to learn a different call to reverse it.
   */
  async unpublishAllLocales(params: {
    collectionName: string;
    /**
     * Skip cache revalidation for this write (the outbox drain still runs).
     * Set by callers that own their cache strategy — a CLI, seed, or
     * bulk-import write — so it does not fan out a revalidation per row.
     */
    disableRevalidate?: boolean;
    entryId: string;
    user?: UserContext;
    overrideAccess?: boolean;
    /**
     * Which collections a trusted read may reach as relationships are expanded.
     * Absent means every populated target inherits the caller's trust. Only ever
     * narrows, and never admits a target's drafts.
     */
    trusted?: TrustBound;
    /**
     * Set by the REST dispatcher: the route already authorized this POST as
     * `update`, so the preliminary update gate skips its redundant RBAC re-check.
     */
    routeAuthorized?: boolean;
    /** API-key scope; gates the unconditional unpublish check. */
    authenticatedScope?: AuthenticatedScope;
  }) {
    const result = await this.mutationService.unpublishAllLocales(params);
    await this.afterWriteIfRecorded(result, params.disableRevalidate);
    return result;
  }

  async deleteEntry(params: {
    collectionName: string;
    /**
     * Skip cache revalidation for this write (the outbox drain still runs).
     * Set by callers that own their cache strategy — a CLI, seed, or
     * bulk-import write — so it does not fan out a revalidation per row.
     */
    disableRevalidate?: boolean;
    entryId: string;
    user?: UserContext;
    /** Who performed the delete, recorded on the outbox event. */
    actor?: RequestActor;
    overrideAccess?: boolean;
    /**
     * Which collections a trusted read may reach as relationships are expanded.
     * Absent means every populated target inherits the caller's trust. Only ever
     * narrows, and never admits a target's drafts.
     */
    trusted?: TrustBound;
    routeAuthorized?: boolean;
    context?: Record<string, unknown>;
    /** API-key scope; judges the delete gate on the key's own grant. */
    authenticatedScope?: AuthenticatedScope;
  }) {
    const result = await this.mutationService.deleteEntry(params);
    await this.afterWriteIfRecorded(result, params.disableRevalidate);
    return result;
  }

  /**
   * Resolve this collection's localized companion verdicts on the pooled connection.
   *
   * Call it BEFORE opening a transaction whose body uses the `*InTransaction` methods below.
   * Those cannot do it themselves: resolving issues a query, a query against a missing relation
   * aborts the whole transaction on PostgreSQL, and a pooled probe taken while a transaction is
   * open waits for a connection that transaction will not release.
   *
   * Skipping it throws nothing. The write commits and its durable version snapshot and outbound
   * event silently omit every localized component value.
   */
  async warmLocalizedReadiness(collectionName: string): Promise<void> {
    return this.mutationService.warmLocalizedReadiness(collectionName);
  }

  /**
   * Remove a document's pending working-draft sidecar under the same parent-row
   * lock a draft save takes, so a discard cannot delete a draft that a
   * concurrent save committed after the discard's checks. The discard handler
   * has already authorized read and update on the document.
   */
  // Params are taken from the method being delegated to rather than restated,
  // for the reason the note below records: a restated list forwards the whole
  // object at runtime while the type denies the fields it omits, so a caller
  // naming the language of the pending change it is discarding could not say so.
  async discardWorkingDraft(
    params: Parameters<CollectionMutationService["discardWorkingDraft"]>[0]
  ): Promise<void> {
    return this.mutationService.discardWorkingDraft(params);
  }

  // Params are taken from the method being delegated to rather than restated here. Restating them
  // had already dropped `overrideAccess`, `routeAuthorized` and `transitionAuth`: the object is
  // forwarded whole, so those kept working at runtime while the type denied they existed, and a
  // caller doing a trusted server write through this facade could not say so without a cast.
  async createEntryInTransaction(
    tx: TransactionContext,
    params: Parameters<
      CollectionMutationService["createEntryInTransaction"]
    >[1],
    body: Record<string, unknown>
  ): Promise<CollectionServiceResult<unknown>> {
    return this.mutationService.createEntryInTransaction(tx, params, body);
  }

  async updateEntryInTransaction(
    tx: TransactionContext,
    params: Parameters<
      CollectionMutationService["updateEntryInTransaction"]
    >[1],
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
      /** Who performed the delete, recorded on the outbox event. */
      actor?: RequestActor;
    }
  ): Promise<CollectionServiceResult<{ deleted: boolean }>> {
    return this.mutationService.deleteEntryInTransaction(tx, params);
  }

  async duplicateEntry(params: {
    collectionName: string;
    /**
     * Skip cache revalidation for this write (the outbox drain still runs).
     * Set by callers that own their cache strategy — a CLI, seed, or
     * bulk-import write — so it does not fan out a revalidation per row.
     */
    disableRevalidate?: boolean;
    entryId: string;
    user?: UserContext;
    overrides?: Record<string, unknown>;
    overrideAccess?: boolean;
    /**
     * Which collections a trusted read may reach as relationships are expanded.
     * Absent means every populated target inherits the caller's trust. Only ever
     * narrows, and never admits a target's drafts.
     */
    trusted?: TrustBound;
    context?: Record<string, unknown>;
    /** Acting identity from the transport, forwarded to the recorded event. */
    actor?: RequestActor;
    /** API-key scope; judges the create-as-published on the key's own grant. */
    authenticatedScope?: AuthenticatedScope;
  }) {
    const result = await this.bulkService.duplicateEntry(params);
    await this.afterWriteIfRecorded(result, params.disableRevalidate);
    return result;
  }

  // Phase 4.5: bulk methods carry full records on update (caller needs
  // the post-mutation values) and minimal {id} records on delete.
  async bulkDeleteEntries(params: {
    collectionName: string;
    /**
     * Skip cache revalidation for this write (the outbox drain still runs).
     * Set by callers that own their cache strategy — a CLI, seed, or
     * bulk-import write — so it does not fan out a revalidation per row.
     */
    disableRevalidate?: boolean;
    ids: string[];
    user?: UserContext;
    /** Who performed the delete, recorded on each entry's outbox event. */
    actor?: RequestActor;
    overrideAccess?: boolean;
    /**
     * Which collections a trusted read may reach as relationships are expanded.
     * Absent means every populated target inherits the caller's trust. Only ever
     * narrows, and never admits a target's drafts.
     */
    trusted?: TrustBound;
    routeAuthorized?: boolean;
    context?: Record<string, unknown>;
    /** API-key scope; judges each per-id delete on the key's own grant. */
    authenticatedScope?: AuthenticatedScope;
  }): Promise<BulkOperationResult<{ id: string }>> {
    const result = await this.bulkService.bulkDeleteEntries(params);
    await this.afterWriteIfRecorded(result, params.disableRevalidate);
    return result;
  }

  async bulkUpdateEntries(params: {
    collectionName: string;
    /**
     * Skip cache revalidation for this write (the outbox drain still runs).
     * Set by callers that own their cache strategy — a CLI, seed, or
     * bulk-import write — so it does not fan out a revalidation per row.
     */
    disableRevalidate?: boolean;
    ids: string[];
    data: Record<string, unknown>;
    user?: UserContext;
    overrideAccess?: boolean;
    /**
     * Which collections a trusted read may reach as relationships are expanded.
     * Absent means every populated target inherits the caller's trust. Only ever
     * narrows, and never admits a target's drafts.
     */
    trusted?: TrustBound;
    routeAuthorized?: boolean;
    context?: Record<string, unknown>;
    /** Acting identity from the transport, forwarded to the recorded event. */
    actor?: RequestActor;
    /** API-key scope; judges each per-id transition on the key's own grant. */
    authenticatedScope?: AuthenticatedScope;
  }): Promise<BulkOperationResult<Record<string, unknown>>> {
    const result = await this.bulkService.bulkUpdateEntries(params);
    await this.afterWriteIfRecorded(result, params.disableRevalidate);
    return result;
  }

  async bulkUpdateByQuery(
    params: {
      collectionName: string;
      /**
       * Skip cache revalidation for this write (the outbox drain still runs).
       * Set by callers that own their cache strategy — a CLI, seed, or
       * bulk-import write — so it does not fan out a revalidation per row.
       */
      disableRevalidate?: boolean;
      where: WhereFilter;
      data: Record<string, unknown>;
      user?: UserContext;
      overrideAccess?: boolean;
      /**
       * Which collections a trusted read may reach as relationships are expanded.
       * Absent means every populated target inherits the caller's trust. Only ever
       * narrows, and never admits a target's drafts.
       */
      trusted?: TrustBound;
      /** Route auth already ran; response is still redacted for this user */
      routeAuthorized?: boolean;
      context?: Record<string, unknown>;
      /** Acting identity from the transport, forwarded to the recorded event. */
      actor?: RequestActor;
      /** API-key scope; judges the collection gate + transitions on the key's own grant. */
      authenticatedScope?: AuthenticatedScope;
    },
    options?: BulkOperationOptions & { limit?: number }
  ): Promise<BulkOperationResult<Record<string, unknown>>> {
    const result = await this.bulkService.bulkUpdateByQuery(params, options);
    await this.afterWriteIfRecorded(result, params.disableRevalidate);
    return result;
  }

  async bulkDeleteByQuery(
    params: {
      collectionName: string;
      /**
       * Skip cache revalidation for this write (the outbox drain still runs).
       * Set by callers that own their cache strategy — a CLI, seed, or
       * bulk-import write — so it does not fan out a revalidation per row.
       */
      disableRevalidate?: boolean;
      where: WhereFilter;
      user?: UserContext;
      /** Who performed the delete, recorded on each entry's outbox event. */
      actor?: RequestActor;
      /** Caller's authenticated scope; a scoped key is judged on its own grant. */
      authenticatedScope?: AuthenticatedScope;
      routeAuthorized?: boolean;
      overrideAccess?: boolean;
      /**
       * Which collections a trusted read may reach as relationships are expanded.
       * Absent means every populated target inherits the caller's trust. Only ever
       * narrows, and never admits a target's drafts.
       */
      trusted?: TrustBound;
      context?: Record<string, unknown>;
    },
    options?: { limit?: number }
  ): Promise<BulkOperationResult<{ id: string }>> {
    const result = await this.bulkService.bulkDeleteByQuery(params, options);
    await this.afterWriteIfRecorded(result, params.disableRevalidate);
    return result;
  }

  async createEntries(
    params: {
      collectionName: string;
      /**
       * Skip cache revalidation for this write (the outbox drain still runs).
       * Set by callers that own their cache strategy — a CLI, seed, or
       * bulk-import write — so it does not fan out a revalidation per row.
       */
      disableRevalidate?: boolean;
      user?: UserContext;
      overrideAccess?: boolean;
      /**
       * Which collections a trusted read may reach as relationships are expanded.
       * Absent means every populated target inherits the caller's trust. Only ever
       * narrows, and never admits a target's drafts.
       */
      trusted?: TrustBound;
      authenticatedScope?: AuthenticatedScope;
    },
    entries: Record<string, unknown>[],
    options?: BulkOperationOptions
  ): Promise<BatchOperationResult> {
    const result = await this.bulkService.createEntries(
      params,
      entries,
      options
    );
    await this.afterWriteIfRecorded(result, params.disableRevalidate);
    return result;
  }

  async createEntriesInTransaction(
    tx: TransactionContext,
    params: {
      collectionName: string;
      user?: UserContext;
      authenticatedScope?: AuthenticatedScope;
    },
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
    params: {
      collectionName: string;
      /**
       * Skip cache revalidation for this write (the outbox drain still runs).
       * Set by callers that own their cache strategy — a CLI, seed, or
       * bulk-import write — so it does not fan out a revalidation per row.
       */
      disableRevalidate?: boolean;
      user?: UserContext;
      authenticatedScope?: AuthenticatedScope;
    },
    entries: BulkUpdateEntry[],
    options?: BulkOperationOptions
  ): Promise<BatchOperationResult> {
    const result = await this.bulkService.updateEntries(
      params,
      entries,
      options
    );
    await this.afterWriteIfRecorded(result, params.disableRevalidate);
    return result;
  }

  async updateEntriesInTransaction(
    tx: TransactionContext,
    params: {
      collectionName: string;
      user?: UserContext;
      authenticatedScope?: AuthenticatedScope;
    },
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
    params: {
      collectionName: string;
      /**
       * Skip cache revalidation for this write (the outbox drain still runs).
       * Set by callers that own their cache strategy — a CLI, seed, or
       * bulk-import write — so it does not fan out a revalidation per row.
       */
      disableRevalidate?: boolean;
      user?: UserContext;
      /** Who performed the delete, recorded on each entry's outbox event. */
      actor?: RequestActor;
    },
    ids: string[],
    options?: BulkOperationOptions
  ): Promise<BatchOperationResult> {
    const result = await this.bulkService.deleteEntries(params, ids, options);
    await this.afterWriteIfRecorded(result, params.disableRevalidate);
    return result;
  }

  async deleteEntriesInTransaction(
    tx: TransactionContext,
    params: {
      collectionName: string;
      user?: UserContext;
      /** Who performed the delete, recorded on each entry's outbox event. */
      actor?: RequestActor;
    },
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
