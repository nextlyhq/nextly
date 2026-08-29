/**
 * CollectionBulkService — Bulk and batch operations for collection entries.
 *
 * Extracted from CollectionEntryService (6,490-line god file) to handle all
 * bulk/batch operations as a focused service.
 *
 * Responsibilities:
 * - Duplicate entries (fetch + create copy)
 * - Bulk delete/update by IDs (partial success pattern)
 * - Bulk update/delete by query (where clause matching)
 * - Batch create/update/delete in transactions (with rollback support)
 *
 * Delegates single-entry operations to CollectionQueryService and
 * CollectionMutationService, and access checks to CollectionAccessService.
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import type { AuthenticatedScope } from "../../../auth/authenticated-scope";
import type { RequestActor } from "../../../auth/request-actor";
import { errorFromServiceEnvelope } from "../../../errors/from-service-envelope";
import { NextlyError } from "../../../errors/nextly-error";
import type { RevalidationIntent } from "../../../revalidation/types";
import type { WhereFilter } from "../../../services/collections/query-operators";
import type { TrustBound } from "../../../services/collections/trust-grant";
import { narrows } from "../../../services/collections/trust-grant";
import type { Logger } from "../../../services/shared";
import { BaseService } from "../../../shared/base-service";
import { PAGINATION_DEFAULTS } from "../../../types/pagination";

import type { CollectionAccessService } from "./collection-access-service";
import type { CollectionMutationService } from "./collection-mutation-service";
import { isWriteIntegrityFailure } from "./collection-mutation-service";
import type { CollectionQueryService } from "./collection-query-service";
import type {
  BatchOperationResult,
  BulkOperationOptions,
  BulkOperationResult,
  BulkUpdateEntry,
  CollectionServiceResult,
  UserContext,
} from "./collection-types";

/**
 * Phase 4.5: decompose a legacy `{success, statusCode, message, data}`
 * service envelope into the new structured per-item failure shape.
 *
 * Mirrors the status-code-to-NextlyErrorCode mapping in
 * `dispatcher/helpers/service-envelope.ts#unwrapServiceResult` so the
 * single-item code path and the bulk per-item failure path agree on
 * codes for identical underlying conditions (404 to NOT_FOUND, etc.).
 *
 * Public messages here follow spec §13.8: generic per-code, no
 * identifier echo, no value leaking. The legacy `result.message` rides
 * to the operator log via the dispatcher's logger; it never enters the
 * wire `failures[]` (which would defeat the §13.8 rubric).
 */
function legacyEnvelopeToFailureFields(result: {
  statusCode?: number;
  code?: string;
  message?: string;
}): { code: string; message: string } {
  // Rebuilt through the shared converter so a per-item failure reports the same
  // code the single-item endpoint reports for the identical failure. This kept
  // its own status table, which sent anything outside 400/403/404/409 to
  // INTERNAL_ERROR -- so an item whose hook threw `rateLimited()` was a rate
  // limit on the single endpoint and an internal error in bulk.
  const rebuilt = errorFromServiceEnvelope(result);
  return { code: String(rebuilt.code), message: rebuilt.publicMessage };
}

/**
 * Discriminated outcome for one item inside a Promise.allSettled fan-out.
 *
 * Each per-id closure inside bulkDeleteEntries / bulkUpdateEntries returns
 * one of these so we can partition into the canonical successes/failures
 * arrays after all per-item promises settle. Keeping the side-effects out
 * of the per-item closure is the safe pattern for concurrent execution
 * (no shared-array mutation across N concurrent promises).
 */
type PerItemOutcome<T> =
  | {
      kind: "success";
      record: T;
      /**
       * Whether this item appended an outbox event. A normal write records; an
       * opted-out (`webhooks: false`) collection does not. Aggregated into the
       * batch result's `eventRecorded` so the wrapper drains only when at least
       * one item actually recorded.
       */
      eventRecorded?: boolean;
      /** The item's cache-revalidation intent, aggregated for the post-commit flush. */
      revalidationIntent?: RevalidationIntent;
    }
  | {
      kind: "failure";
      failure: { id: string; code: string; message: string };
      /**
       * Set when the item committed its row + outbox event but a post-commit
       * hook then threw, so it is reported as a failure yet still owes a
       * delivery. Aggregated into the batch result's `eventRecorded`.
       */
      eventRecorded?: boolean;
      /**
       * The item's cache-revalidation intent when it committed (even as a
       * reported failure), so its tags are still busted.
       */
      revalidationIntent?: RevalidationIntent;
    };

/**
 * Build a canonical per-item failure entry from a thrown error.
 *
 * NextlyError preserves its code + publicMessage. Anything else is
 * INTERNAL_ERROR with a generic public message; full detail goes to the
 * operator log via the outer dispatcher when it logs the cause chain.
 */
function failureFromThrown(
  id: string,
  error: unknown
): { id: string; code: string; message: string } {
  if (NextlyError.is(error)) {
    return {
      id,
      code: String(error.code),
      message: error.publicMessage,
    };
  }
  return {
    id,
    code: "INTERNAL_ERROR",
    message: "An unexpected error occurred.",
  };
}

/**
 * The most specific message an error carries, for operator logs that must
 * name WHAT failed. NextlyError keeps its own message public-facing and
 * moves the operational detail onto the cause chain, so this reads the
 * deepest cause's message and falls back to the thrown message. Cause
 * graphs are arbitrary — a driver can hand back a cycle — so the walk
 * tracks the errors it has visited rather than trusting the chain to end.
 */
function detailedErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const visited = new Set<Error>();
  let message = error.message;
  let cause: Error | undefined = error;
  while (cause.cause instanceof Error && !visited.has(cause.cause)) {
    visited.add(cause.cause);
    cause = cause.cause;
    message = cause.message;
  }
  return message;
}

/**
 * The message returned accounting may carry: a typed NextlyError's own
 * public message, because its cause may hold raw driver or adapter detail
 * that belongs in the operator log alone; and for anything untyped, the
 * deepest cause message — a bare error ships no envelope to protect.
 */
function batchErrorMessage(error: unknown): string {
  if (NextlyError.is(error)) return error.publicMessage;
  return detailedErrorMessage(error);
}

/**
 * Rebuild a rolled-back delete's accounting as exactly one error per
 * requested id, in index order. A `stopOnError` returned-failure pushes
 * both the item error and a thrown wrapper for the same index, so dedupe
 * (first wins) before filling the rolled-back ids that had no entry —
 * otherwise `errors` would exceed `failed` and give a client duplicate
 * detail for one id.
 */
function rebuildRolledBackDeleteErrors(
  state: LegacyBatchState,
  ids: string[],
  rollbackNote: string
): void {
  const byIndex = new Map<number, string>();
  for (const e of state.errors) {
    if (!byIndex.has(e.index)) byIndex.set(e.index, e.error);
  }
  state.errors = [];
  for (let i = 0; i < ids.length; i += 1) {
    state.errors.push({ index: i, error: byIndex.get(i) ?? rollbackNote });
  }
}

/**
 * Partition Promise.allSettled outcomes into the canonical
 * BulkOperationResult shape.
 *
 * Order is preserved (allSettled preserves input order). Total comes
 * from the original input length so callers can compute "succeeded N of
 * M" messages without re-counting.
 *
 * If a per-item closure itself rejects (which shouldn't happen since
 * each closure has a try/catch), we still surface it as a failure with
 * INTERNAL_ERROR. Defensive: prevents a single bug from corrupting the
 * whole bulk response.
 */
function partitionOutcomes<T>(
  outcomes: PromiseSettledResult<PerItemOutcome<T>>[],
  ids: string[]
): BulkOperationResult<T> {
  const result: BulkOperationResult<T> = {
    successes: [],
    failures: [],
    total: ids.length,
    successCount: 0,
    failedCount: 0,
  };
  const collectIntent = (intent: RevalidationIntent | undefined): void => {
    // Every committed item's tags are busted, whether it is reported a success
    // or a committed-then-hook-failed failure.
    if (intent) (result.revalidationIntents ??= []).push(intent);
  };
  outcomes.forEach((outcome, index) => {
    if (outcome.status === "fulfilled") {
      const value = outcome.value;
      if (value.kind === "success") {
        result.successes.push(value.record);
        result.successCount++;
        // Aggregate the outbox signal: a normal item records, an opted-out one
        // does not — the wrapper drains only when at least one item recorded.
        if (value.eventRecorded) result.eventRecorded = true;
        collectIntent(value.revalidationIntent);
      } else {
        result.failures.push(value.failure);
        result.failedCount++;
        // A "failure" that still committed its outbox event (a post-commit hook
        // threw) owes a delivery even though it is not a success.
        if (value.eventRecorded) result.eventRecorded = true;
        collectIntent(value.revalidationIntent);
      }
    } else {
      // Per-item closure rejected unexpectedly. Defensive: report as
      // INTERNAL_ERROR rather than silently swallowing the bug.
      result.failures.push(failureFromThrown(ids[index] ?? "", outcome.reason));
      result.failedCount++;
    }
  });
  return result;
}

// ============================================================
// Legacy batch loop (createEntries / updateEntries / deleteEntries
// and their InTransaction twins)
// ============================================================

/**
 * One item's verdict inside a legacy batch loop, already normalized so the
 * loop never has to know which worker shape produced it.
 */
type LegacyBatchVerdict =
  | {
      ok: true;
      id: string;
      eventRecorded?: boolean;
      revalidationIntent?: RevalidationIntent;
    }
  | {
      ok: false;
      message: string;
      eventRecorded?: boolean;
      revalidationIntent?: RevalidationIntent;
    };

/**
 * The accounting one legacy batch accumulates while its items run. Carried as
 * one mutable object so a mid-loop throw (stopOnError, an integrity abort)
 * leaves the partial state the surrounding envelope's rollback rewrite reads.
 */
interface LegacyBatchState {
  successful: number;
  failed: number;
  ids: string[];
  errors: Array<{ index: number; error: string }>;
  /**
   * Tri-state like the public field: unset until an item records, true once
   * one has, false after a rollback clears it.
   */
  eventRecorded: boolean | undefined;
  /** Every committed item's intent, including committed-then-failed ones. */
  intents: RevalidationIntent[];
  /** Set when the operation's abort policy fired on a thrown error. */
  integrityAbort: boolean;
}

function newLegacyBatchState(): LegacyBatchState {
  return {
    successful: 0,
    failed: 0,
    ids: [],
    errors: [],
    eventRecorded: undefined,
    intents: [],
    integrityAbort: false,
  };
}

/**
 * The batch options every legacy entry point accepts, defaulted — one
 * decision shared by all six methods rather than six identical destructures.
 */
function batchOptions(options?: BulkOperationOptions): {
  batchSize: number;
  stopOnError: boolean;
  skipHooks: boolean;
} {
  const {
    batchSize = 100,
    stopOnError = false,
    skipHooks = false,
  } = options ?? {};
  // A size that cannot advance the slice window (zero or negative) would
  // pin the loop, and a fractional one slices overlapping batches. The
  // option is developer configuration, so the refusal names the value it
  // received.
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw NextlyError.invalidInput({
      message: `batchSize must be a positive whole number, received ${batchSize}.`,
    });
  }
  return { batchSize, stopOnError, skipHooks };
}

/**
 * Run ONE item of a legacy batch: normalize the worker's verdict into the
 * shared accounting, and decide from the policies whether the batch may
 * continue. Throws to abort the surrounding transaction — never returns a
 * signal — so the caller's rollback rewrite is the only place an abort is
 * interpreted.
 *
 * The two subtle rules the six hand-rolled loops encoded live here once: an
 * item's outbox signal and revalidation intent are collected whether it is
 * reported a success or a committed-then-failed failure, and a returned
 * failure under stopOnError throws so the surrounding transaction rolls back.
 *
 * `abortOnError` is the operation's own policy for THROWN errors: create and
 * update re-throw only marked write-integrity failures, delete treats every
 * throw as one (the snapshot it builds is the last record of the row).
 */
async function runLegacyBatchItem<TItem>(
  index: number,
  item: TItem,
  options: { stopOnError: boolean },
  state: LegacyBatchState,
  worker: (item: TItem) => Promise<LegacyBatchVerdict>,
  abortOnError: (error: unknown) => boolean
): Promise<void> {
  try {
    const verdict = await worker(item);

    if (verdict.revalidationIntent) {
      state.intents.push(verdict.revalidationIntent);
    }
    if (verdict.eventRecorded) state.eventRecorded = true;

    if (verdict.ok) {
      state.successful++;
      state.ids.push(verdict.id);
    } else {
      state.failed++;
      state.errors.push({ index, error: verdict.message });

      if (options.stopOnError) {
        // Thrown inside the try on purpose: the catch below records it
        // like any unexpected error before re-throwing, which is the
        // accounting every legacy loop performed for this case. The
        // abort's message is caller-facing on purpose — the failing index
        // plus the worker's public failure reason, both of which the
        // per-item accounting already returns — and invalidInput is the
        // factory whose public message the caller supplies.
        throw NextlyError.invalidInput({
          message: `Entry at index ${index} failed: ${verdict.message}`,
        });
      }
    }
  } catch (error: unknown) {
    state.failed++;
    // Returned accounting carries only what the error's public contract
    // allows: a typed NextlyError's envelope message, never the driver
    // detail riding its cause.
    state.errors.push({
      index,
      error:
        error instanceof Error
          ? batchErrorMessage(error)
          : "Unknown error occurred",
    });

    if (abortOnError(error)) {
      state.integrityAbort = true;
      throw error;
    }

    if (options.stopOnError) {
      throw error;
    }
  }
}

/**
 * The per-item loop every legacy batch method shares: iterate the items in
 * batchSize slices and hand each to `runLegacyBatchItem`. Everything around
 * it — opening (or not) a transaction, pre-resolving authorization and
 * readiness, and the rollback rewrite — stays with each method.
 */
async function runLegacyBatch<TItem>(
  tx: TransactionContext,
  items: TItem[],
  options: { batchSize: number; stopOnError: boolean },
  state: LegacyBatchState,
  worker: (item: TItem) => Promise<LegacyBatchVerdict>,
  abortOnError: (error: unknown) => boolean
): Promise<void> {
  for (let i = 0; i < items.length; i += options.batchSize) {
    const batch = items.slice(i, Math.min(i + options.batchSize, items.length));

    for (let j = 0; j < batch.length; j++) {
      await runLegacyBatchItem(
        i + j,
        batch[j],
        options,
        state,
        worker,
        abortOnError
      );
    }
  }
}

/**
 * Project a run's accounting onto the public batch shape. The projection, not
 * the callers, owns which optional fields are present: `eventRecorded` and
 * `revalidationIntents` appear only when the run set them, matching the
 * field-by-field presence the six methods produced before the loop was shared.
 */
function toBatchResult(state: LegacyBatchState): BatchOperationResult {
  const result: BatchOperationResult = {
    successful: state.successful,
    failed: state.failed,
    ids: state.ids,
    errors: state.errors,
  };
  if (state.eventRecorded !== undefined) {
    result.eventRecorded = state.eventRecorded;
  }
  if (state.intents.length > 0) {
    result.revalidationIntents = state.intents;
  }
  return result;
}

export class CollectionBulkService extends BaseService {
  constructor(
    adapter: DrizzleAdapter,
    logger: Logger,
    private readonly accessService: CollectionAccessService,
    private readonly queryService: CollectionQueryService,
    private readonly mutationService: CollectionMutationService
  ) {
    super(adapter, logger);
  }

  /**
   * Duplicate an existing entry (create a copy).
   * Creates a new entry with the same field values as the source entry.
   * System fields (id, createdAt, updatedAt) and unique fields (slug) are automatically handled.
   * Title/name fields get " (Copy)" appended.
   *
   * @param params - Collection name, entry ID to duplicate, optional user context, and field overrides
   * @returns The newly created duplicate entry or error
   */
  async duplicateEntry(params: {
    collectionName: string;
    entryId: string;
    user?: UserContext;
    overrides?: Record<string, unknown>;
    /** When true, bypass all access control checks */
    overrideAccess?: boolean;
    /**
     * Which collections a trusted read may reach as relationships are expanded.
     * Absent means every populated target inherits the caller's trust. Only ever
     * narrows. See {@link RelatedRowReadContext.trusted}.
     */
    trusted?: TrustBound;
    /** Route auth already ran the create RBAC gate; skip only that re-check. */
    routeAuthorized?: boolean;
    /** Arbitrary data passed to hooks via context */
    context?: Record<string, unknown>;
    /** Acting identity from the transport, forwarded to the recorded event. */
    actor?: RequestActor;
    /**
     * The caller's authenticated scope. A duplicate is a create, so a
     * scoped API key that copies a published source into a published row is
     * judged on the key's OWN publish grant, not the key owner's.
     */
    authenticatedScope?: AuthenticatedScope;
  }): Promise<CollectionServiceResult> {
    try {
      // 1. Fetch the source entry with a REAL read check. Duplicating a row is
      // reading it plus creating a copy, and the route only authorized the
      // create — so the caller must genuinely be able to READ the source under
      // its own (key-scoped) access. `overrideAccess` stays as passed (false
      // for route/untrusted callers), so a create-only caller without read is
      // correctly denied rather than silently duplicating a row it can't see.
      // Draft visibility is limited to trusted (overrideAccess) callers: route
      // auth attested create, not the right to read unpublished rows, so a
      // route/untrusted duplicate keeps the default published-only visibility.
      // Scoped to the SOURCE ROW, not to what it points at. A bounded caller
      // must not have this reach expansion: `expansionStatusScope` cannot tell
      // a manufactured `"all"` from one the caller asked for, and would carry
      // it into every rejected target — whose drafts would then be COPIED into
      // the new row, outliving the refusal as data.
      const sourceStatus =
        params.overrideAccess && !narrows(params.trusted) ? "all" : undefined;
      const sourceResult = await this.queryService.getEntry({
        collectionName: params.collectionName,
        entryId: params.entryId,
        user: params.user,
        overrideAccess: params.overrideAccess,
        // The source read expands relationships, so the caller's bound has to
        // reach it: without this a duplicate COPIES rows out of a collection
        // the caller refused to trust, and the copy outlives the refusal.
        trusted: params.trusted,
        status: sourceStatus,
        context: params.context,
        // Judge the source read on the key's OWN read grant: a create-scoped key
        // that lacks read must not copy fields from a row it cannot see.
        authenticatedScope: params.authenticatedScope,
      });

      if (!sourceResult.success || !sourceResult.data) {
        return {
          // Forwarded whole rather than rebuilt from two of its fields: the
          // source read's failure is this operation's failure, and dropping its
          // code left a rate limit on the source arriving as an internal error
          // with no retry interval.
          ...sourceResult,
          success: false,
          statusCode: sourceResult.statusCode || 404,
          message: sourceResult.message || "Source entry not found",
          data: null,
        };
      }

      const sourceEntry = sourceResult.data;

      // 2. Create duplicate data by copying all fields except system fields
      const duplicateData: Record<string, unknown> = {};

      // System fields to exclude (auto-generated or need special handling)
      const excludedFields = new Set([
        "id",
        "createdAt",
        "updatedAt",
        "slug", // Unique field - should be cleared
      ]);

      // Copy all fields from source entry
      for (const [key, value] of Object.entries(sourceEntry)) {
        if (!excludedFields.has(key)) {
          duplicateData[key] = value;
        }
      }

      // 3. Append " (Copy)" to common title fields
      const titleFields = ["title", "name", "label", "subject"];
      for (const field of titleFields) {
        if (duplicateData[field] && typeof duplicateData[field] === "string") {
          duplicateData[field] = `${duplicateData[field]} (Copy)`;
        }
      }

      // 4. Apply field overrides if provided
      if (params.overrides) {
        Object.assign(duplicateData, params.overrides);
      }

      // 5. Create the new entry using createEntry (inherits all hooks and
      // validation). Forward routeAuthorized + overrideAccess so a route that
      // already authorized the create is not re-gated under the wrong scope,
      // matching the other route write paths.
      const createResult = await this.mutationService.createEntry(
        {
          collectionName: params.collectionName,
          user: params.user,
          // Duplicating reaches the instrumented create, so the event it records
          // must name the acting identity rather than falling back to the API
          // key's owner.
          actor: params.actor,
          overrideAccess: params.overrideAccess,
          routeAuthorized: params.routeAuthorized,
          // Judge the create-as-published on the key's own publish grant.
          authenticatedScope: params.authenticatedScope,
        },
        duplicateData
      );

      return createResult;
    } catch (error: unknown) {
      console.error("Error in duplicateEntry:", error);
      const errMsg =
        error instanceof Error ? error.message : "Failed to duplicate entry";
      const errStatus =
        error instanceof Error && "statusCode" in error
          ? (error as Error & { statusCode: number }).statusCode
          : 500;
      return {
        success: false,
        statusCode: errStatus,
        message: errMsg,
        data: null,
      };
    }
  }

  /**
   * Bulk delete multiple entries by IDs.
   * Uses partial success pattern - some entries may fail while others succeed.
   * Each deletion runs through the same hooks and access control as single deleteEntry.
   *
   * @param params - Collection name and array of entry IDs to delete
   * @returns Bulk operation result with success/failed arrays and detailed counts
   */
  async bulkDeleteEntries(params: {
    collectionName: string;
    ids: string[];
    user?: UserContext;
    /** Who performed the delete, recorded on each entry's outbox event. */
    actor?: RequestActor;
    /** When true, bypass all access control checks */
    overrideAccess?: boolean;
    /** When true, the route middleware already ran the RBAC gate; forwarded to
     * each per-entry delete so it isn't redundantly re-checked. */
    routeAuthorized?: boolean;
    /** Arbitrary data passed to hooks via context */
    context?: Record<string, unknown>;
    /**
     * The caller's authenticated scope. Forwarded to each per-id delete so a
     * scoped API key is judged on its OWN delete grant, not the key owner's.
     */
    authenticatedScope?: AuthenticatedScope;
  }): Promise<BulkOperationResult<{ id: string }>> {
    // Phase 4.5: result carries minimal `{id}` records for delete (the
    // entries are gone; no value in materializing more) and structured
    // per-item failures keyed by canonical NextlyErrorCode.
    //
    // Concurrency: per-id deletions run via Promise.allSettled so the
    // wall-time matches today's client-side fan-out pattern. Per-row
    // hooks and access control still fire (each closure calls the
    // single-item deleteEntry which preserves the full pipeline). The
    // db connection pool naturally throttles real DB concurrency.
    const outcomes = await Promise.allSettled(
      params.ids.map(
        async (entryId): Promise<PerItemOutcome<{ id: string }>> => {
          try {
            const deleteResult = await this.mutationService.deleteEntry({
              collectionName: params.collectionName,
              entryId,
              user: params.user,
              // Forward the acting identity so each bulk-deleted entry's
              // `entry.deleted` event is attributed to the API key/user that
              // performed the bulk delete, not the key owner or system.
              actor: params.actor,
              overrideAccess: params.overrideAccess,
              routeAuthorized: params.routeAuthorized,
              context: params.context,
              // Judge the key's own delete grant per row.
              authenticatedScope: params.authenticatedScope,
            });

            if (deleteResult.success) {
              return {
                kind: "success",
                record: { id: entryId },
                eventRecorded: deleteResult.eventRecorded,
                revalidationIntent: deleteResult.revalidationIntent,
              };
            }
            // Decompose the legacy envelope into the canonical per-item
            // failure shape. The legacy `message` would leak driver/value
            // text on the wire (§13.8 violation); we keep only the canonical
            // code-to-publicMessage mapping and let the operator log carry
            // the legacy text via the dispatcher's logger.
            const { code, message } =
              legacyEnvelopeToFailureFields(deleteResult);
            return {
              kind: "failure",
              failure: { id: entryId, code, message },
              // A delete that committed its row + event but failed a post-commit
              // hook still owes a delivery.
              eventRecorded: deleteResult.eventRecorded,
              revalidationIntent: deleteResult.revalidationIntent,
            };
          } catch (error: unknown) {
            // NextlyError thrown from below the boundary: preserve its code +
            // publicMessage. Anything else is INTERNAL_ERROR with a generic
            // public message; full detail goes to the operator log via the
            // outer dispatcher when it logs the cause chain.
            return {
              kind: "failure",
              failure: failureFromThrown(entryId, error),
            };
          }
        }
      )
    );

    return partitionOutcomes(outcomes, params.ids);
  }

  /**
   * Bulk update multiple entries with the same data.
   * Uses partial success pattern - some entries may fail while others succeed.
   * Each update runs through the same hooks, validation, and access control as single updateEntry.
   *
   * @param params - Collection name, array of entry IDs, and update data
   * @returns Bulk operation result with success/failed arrays and detailed counts
   */
  async bulkUpdateEntries(params: {
    collectionName: string;
    ids: string[];
    data: Record<string, unknown>;
    user?: UserContext;
    /** When true, bypass all access control checks */
    overrideAccess?: boolean;
    /**
     * Route-level auth already ran (REST dispatcher). Forwarded to updateEntry
     * so per-row success records are still redacted to what the user may read.
     */
    routeAuthorized?: boolean;
    /** Arbitrary data passed to hooks via context */
    context?: Record<string, unknown>;
    /** Acting identity from the transport, forwarded to the recorded event. */
    actor?: RequestActor;
    /**
     * The caller's authenticated scope. Forwarded to each per-id `updateEntry`
     * so a scoped API key's publish/unpublish transition is judged on the key's
     * OWN grants — a bulk update must not become a way around the single-write
     * gate for a key whose owner could publish but whose scope cannot.
     */
    authenticatedScope?: AuthenticatedScope;
  }): Promise<BulkOperationResult<Record<string, unknown>>> {
    // Phase 4.5: successes carry full mutated records (caller needs the
    // post-update values); failures carry canonical NextlyErrorCode.
    // Per-id updates run concurrently via Promise.allSettled. See
    // bulkDeleteEntries for the rationale on concurrency + per-row hooks.
    const outcomes = await Promise.allSettled(
      params.ids.map(
        async (entryId): Promise<PerItemOutcome<Record<string, unknown>>> => {
          try {
            const updateResult = await this.mutationService.updateEntry(
              {
                collectionName: params.collectionName,
                entryId,
                user: params.user,
                // These updates reach the instrumented path, so the event they
                // record must name the acting identity rather than falling back
                // to the API key's owner.
                actor: params.actor,
                overrideAccess: params.overrideAccess,
                routeAuthorized: params.routeAuthorized,
                context: params.context,
                // Judge the key's own publish/unpublish grant per row.
                authenticatedScope: params.authenticatedScope,
              },
              params.data
            );

            if (updateResult.success && updateResult.data) {
              // Carry the full mutated record back so the dispatcher can ship
              // it to the client without a re-fetch round-trip.
              return {
                kind: "success",
                record: updateResult.data as Record<string, unknown>,
                eventRecorded: updateResult.eventRecorded,
                revalidationIntent: updateResult.revalidationIntent,
              };
            }
            const { code, message } =
              legacyEnvelopeToFailureFields(updateResult);
            return {
              kind: "failure",
              failure: { id: entryId, code, message },
              // An update that committed its row + event but failed a post-commit
              // hook still owes a delivery.
              eventRecorded: updateResult.eventRecorded,
              revalidationIntent: updateResult.revalidationIntent,
            };
          } catch (error: unknown) {
            return {
              kind: "failure",
              failure: failureFromThrown(entryId, error),
            };
          }
        }
      )
    );

    return partitionOutcomes(outcomes, params.ids);
  }

  /**
   * Bulk update entries matching a where clause.
   *
   * This method finds all entries matching the where clause and updates each one
   * individually with full hook execution (beforeChange, afterChange). Uses the
   * partial success pattern where some updates may succeed while others fail.
   *
   * Security checks are applied:
   * 1. Collection-level access control (update permission required)
   * 2. Per-entry access control during individual updates
   *
   * @param params - Collection name, where clause, update data, and optional user context
   * @param options - Bulk operation options (limit, skipHooks, etc.)
   * @returns BulkOperationResult with success/failed arrays and counts
   *
   * @example
   * ```typescript
   * // Update all draft posts to published
   * const result = await entryService.bulkUpdateByQuery({
   *   collectionName: 'posts',
   *   where: { status: { equals: 'draft' } },
   *   data: { status: 'published' },
   *   user: { id: 'user-123', role: 'editor' },
   * });
   *
   * console.log(result.successCount); // Number of updated entries
   * console.log(result.failed);       // Array of { id, error } for failures
   *
   * // With limit to prevent accidental mass updates
   * const result = await entryService.bulkUpdateByQuery(
   *   { collectionName: 'posts', where: {}, data: { featured: false } },
   *   { limit: 100 }
   * );
   * ```
   */
  async bulkUpdateByQuery(
    params: {
      collectionName: string;
      where: WhereFilter;
      data: Record<string, unknown>;
      user?: UserContext;
      /** When true, bypass all access control checks */
      overrideAccess?: boolean;
      /** Route auth already ran; response is still redacted for this user */
      routeAuthorized?: boolean;
      /** Arbitrary data passed to hooks via context */
      context?: Record<string, unknown>;
      /** Acting identity from the transport, forwarded to the recorded event. */
      actor?: RequestActor;
      /**
       * The caller's authenticated scope. Judges the collection-level gate and
       * each per-row transition on a scoped API key's OWN grants.
       */
      authenticatedScope?: AuthenticatedScope;
    },
    options?: BulkOperationOptions & {
      /**
       * Maximum number of entries to update.
       * Set to 0 for unlimited (use with caution).
       * @default 1000
       */
      limit?: number;
    }
  ): Promise<BulkOperationResult<Record<string, unknown>>> {
    const limit = options?.limit ?? 1000;

    const accessUser = params.overrideAccess ? undefined : params.user;

    // 1. Check collection-level access FIRST. Phase 4.5: a collection-wide
    // access denial is a request-level authorization failure, not a per-item
    // partial failure. Throw NextlyError.forbidden so the dispatcher emits
    // a 403 error envelope instead of a 200 with a synthetic empty-id row.
    const accessDenied = await this.accessService.checkCollectionAccess(
      params.collectionName,
      "update",
      accessUser,
      undefined,
      undefined,
      params.overrideAccess,
      params.routeAuthorized,
      // A scoped API key is judged on its own grants here too, so the session
      // super-admin bypass does not apply to it on the collection-level gate.
      params.authenticatedScope
    );
    if (accessDenied) {
      throw NextlyError.forbidden({
        logContext: {
          op: "bulkUpdateByQuery",
          collectionName: params.collectionName,
          legacyMessage: accessDenied.message,
        },
      });
    }

    // 2. Enumerate the target rows under the UPDATE rule. The collection-level
    // UPDATE access was already checked above, so this runs with overrideAccess
    // to skip the READ rules (a role allowed to update but not read must still
    // see its targets) and `status: "all"` to keep drafts enumerable — but it
    // is constrained to rows the caller may actually UPDATE via the update
    // owner constraint. That means an owner-only update enumerates only owned
    // rows, so non-updatable ids are never surfaced as per-id failures or
    // counted against the limit. getOwnerConstraint returns null for trusted /
    // super-admin callers and for non-owner-only rules, so those enumerate all
    // matching rows. Each row is still gated per-row in bulkUpdateEntries.
    const updateOwnerConstraint = await this.accessService.getOwnerConstraint(
      params.collectionName,
      "update",
      params.user,
      params.overrideAccess,
      // Scope the enumeration too: a super-admin-owned key on an owner-only
      // collection must enumerate only its own rows, so the response ids, counts,
      // and limit check never expose rows the owner constraint should hide.
      params.authenticatedScope
    );
    const updateEnumerationWhere: WhereFilter = updateOwnerConstraint
      ? {
          and: [
            params.where,
            {
              [updateOwnerConstraint.field]: {
                equals: updateOwnerConstraint.value,
              },
            },
          ],
        }
      : params.where;
    const listResult = await this.queryService.listEntries({
      collectionName: params.collectionName,
      where: updateEnumerationWhere,
      overrideAccess: true,
      status: "all",
      context: params.context,
      depth: 0, // Only need IDs, not full relationships
      limit: limit > 0 ? limit : PAGINATION_DEFAULTS.maxLimit, // Use limit or max allowed
    });

    if (!listResult.success || !listResult.data) {
      // Querying matched entries failed before any per-item work could
      // happen. This is a request-level failure (no items to partially
      // succeed on). Throw the canonical mapping so the dispatcher emits
      // an error envelope rather than a synthetic empty-id failure row.
      // The rebuilt error itself, not a reduction of it: taking only the code
      // and message dropped the status (so a plugin code fell back to 500) and
      // the public data a rate limit needs for `Retry-After`.
      throw errorFromServiceEnvelope(listResult, {
        op: "bulkUpdateByQuery",
        collectionName: params.collectionName,
        legacyMessage: listResult.message,
      });
    }

    // Extract docs from paginated response.
    const matchingEntries = listResult.data.docs as Array<{ id: string }>;
    const totalMatching = listResult.data.totalDocs;

    // 3. Apply limit safeguard - if the match count exceeds the configured
    // limit, refuse the operation. This is a request-validation failure
    // (the caller asked for too much); surface it as 400 VALIDATION_ERROR
    // so the wire shape matches every other malformed-bulk-request path.
    if (limit > 0 && totalMatching > limit) {
      throw NextlyError.validation({
        errors: [
          {
            path: "where",
            code: "BULK_LIMIT_EXCEEDED",
            message: "Too many matching entries for a bulk operation.",
          },
        ],
        logContext: {
          op: "bulkUpdateByQuery",
          collectionName: params.collectionName,
          totalMatching,
          limit,
        },
      });
    }

    // 4. Extract IDs and delegate to bulkUpdateEntries
    const ids = matchingEntries.map(entry => entry.id);

    if (ids.length === 0) {
      return {
        successes: [],
        failures: [],
        total: 0,
        successCount: 0,
        failedCount: 0,
      };
    }

    // 5. Use existing bulkUpdateEntries for per-entry updates with hooks.
    // Forward routeAuthorized so per-entry response redaction matches the
    // id-based path (route auth ran, but reads are still redacted per user).
    return this.bulkUpdateEntries({
      collectionName: params.collectionName,
      ids,
      data: params.data,
      user: params.user,
      actor: params.actor,
      overrideAccess: params.overrideAccess,
      routeAuthorized: params.routeAuthorized,
      context: params.context,
      // Carry the key's scope into the per-id transition gate.
      authenticatedScope: params.authenticatedScope,
    });
  }

  /**
   * Bulk delete entries matching a where clause.
   *
   * Finds entries matching the where clause (respecting access control),
   * then delegates to `bulkDeleteEntries()` for per-entry deletion with hooks.
   *
   * Uses partial success pattern - some entries may fail while others succeed.
   *
   * @param params - Collection name, where clause, and optional access control options
   * @param options - Optional limit for safety (default: 1000)
   * @returns Bulk operation result with success/failed arrays and counts
   *
   * @example
   * ```typescript
   * // Delete all draft posts
   * const result = await entryService.bulkDeleteByQuery({
   *   collectionName: 'posts',
   *   where: { status: { equals: 'draft' } },
   * });
   *
   * console.log(result.successCount); // Number of deleted entries
   * console.log(result.failed);       // Array of { id, error } for failures
   *
   * // With limit to prevent accidental mass deletions
   * const result = await entryService.bulkDeleteByQuery(
   *   { collectionName: 'posts', where: { archived: { equals: true } } },
   *   { limit: 100 }
   * );
   * ```
   */
  async bulkDeleteByQuery(
    params: {
      collectionName: string;
      where: WhereFilter;
      user?: UserContext;
      /** Who performed the delete, recorded on each entry's outbox event. */
      actor?: RequestActor;
      /**
       * The caller's authenticated scope. A scoped API key is judged on its own
       * delete grant for both the owner-predicate enumeration and each per-row
       * delete, not the key owner's session (super-admin) bypass.
       */
      authenticatedScope?: AuthenticatedScope;
      /** When true, bypass all access control checks */
      overrideAccess?: boolean;
      /** When true, the route middleware already ran the RBAC gate; stored
       * rules are still enforced. */
      routeAuthorized?: boolean;
      /** Arbitrary data passed to hooks via context */
      context?: Record<string, unknown>;
    },
    options?: {
      /**
       * Maximum number of entries to delete.
       * Set to 0 for unlimited (use with caution).
       * @default 1000
       */
      limit?: number;
    }
  ): Promise<BulkOperationResult<{ id: string }>> {
    const limit = options?.limit ?? 1000;

    const accessUser = params.overrideAccess ? undefined : params.user;

    // 1. Check collection-level access FIRST. Phase 4.5: collection-wide
    // access denial is a request-level error, not a per-item failure;
    // throw so the dispatcher emits a 403 error envelope.
    const accessDenied = await this.accessService.checkCollectionAccess(
      params.collectionName,
      "delete",
      accessUser,
      undefined,
      undefined,
      params.overrideAccess,
      params.routeAuthorized,
      // Judge a scoped API key on its own delete grant at the gate, so a
      // super-admin-owned key without delete fails fast rather than enumerating.
      params.authenticatedScope
    );
    if (accessDenied) {
      throw NextlyError.forbidden({
        logContext: {
          op: "bulkDeleteByQuery",
          collectionName: params.collectionName,
          legacyMessage: accessDenied.message,
        },
      });
    }

    // 2. Enumerate the target rows under the DELETE rule. overrideAccess skips
    // the READ rules (a role allowed to delete but not read must still see its
    // targets) and `status: "all"` keeps drafts enumerable, but the delete
    // owner constraint scopes it to rows the caller may actually DELETE, so an
    // owner-only delete enumerates only owned rows and never surfaces
    // non-deletable ids. Null for trusted / super-admin / non-owner-only rules
    // (enumerate all). Each row is still gated per-row in bulkDeleteEntries.
    const deleteOwnerConstraint = await this.accessService.getOwnerConstraint(
      params.collectionName,
      "delete",
      params.user,
      params.overrideAccess,
      // A scoped API key must keep the owner predicate even when owned by a
      // super-admin, so a where-clause delete only enumerates rows the key owns.
      params.authenticatedScope
    );
    const deleteEnumerationWhere: WhereFilter = deleteOwnerConstraint
      ? {
          and: [
            params.where,
            {
              [deleteOwnerConstraint.field]: {
                equals: deleteOwnerConstraint.value,
              },
            },
          ],
        }
      : params.where;
    const listResult = await this.queryService.listEntries({
      collectionName: params.collectionName,
      where: deleteEnumerationWhere,
      overrideAccess: true,
      status: "all",
      context: params.context,
      depth: 0, // Only need IDs, not full relationships
      limit: limit > 0 ? limit : PAGINATION_DEFAULTS.maxLimit,
    });

    if (!listResult.success || !listResult.data) {
      // The rebuilt error itself, not a reduction of it: taking only the code
      // and message dropped the status (so a plugin code fell back to 500) and
      // the public data a rate limit needs for `Retry-After`.
      throw errorFromServiceEnvelope(listResult, {
        op: "bulkDeleteByQuery",
        collectionName: params.collectionName,
        legacyMessage: listResult.message,
      });
    }

    // Extract docs from paginated response
    const matchingEntries = listResult.data.docs as Array<{ id: string }>;
    const totalMatching = listResult.data.totalDocs;

    // 3. Apply limit safeguard. Match count over the configured limit is
    // a request-validation failure (caller asked for too much); surface
    // as 400 VALIDATION_ERROR.
    if (limit > 0 && totalMatching > limit) {
      throw NextlyError.validation({
        errors: [
          {
            path: "where",
            code: "BULK_LIMIT_EXCEEDED",
            message: "Too many matching entries for a bulk operation.",
          },
        ],
        logContext: {
          op: "bulkDeleteByQuery",
          collectionName: params.collectionName,
          totalMatching,
          limit,
        },
      });
    }

    // 4. Extract IDs
    const ids = matchingEntries.map(entry => entry.id);

    if (ids.length === 0) {
      return {
        successes: [],
        failures: [],
        total: 0,
        successCount: 0,
        failedCount: 0,
      };
    }

    // 5. Use existing bulkDeleteEntries for per-entry deletion with hooks
    return this.bulkDeleteEntries({
      collectionName: params.collectionName,
      ids,
      user: params.user,
      // Carry the acting identity into the per-entry deletes so a where-clause
      // bulk delete attributes its events like the id-based one.
      actor: params.actor,
      // Judge each per-row delete on the key's own grant, not the owner session.
      authenticatedScope: params.authenticatedScope,
      overrideAccess: params.overrideAccess,
      routeAuthorized: params.routeAuthorized,
      context: params.context,
    });
  }

  // ============================================================
  // Bulk Operations
  // ============================================================

  /**
   * Create multiple entries in a single transaction.
   *
   * Processes entries in batches within a transaction. Each entry goes through
   * the same security checks and hook execution as single creates (unless hooks
   * are skipped). Provides detailed error tracking with entry indices.
   *
   * Security flow for each entry:
   * 1. Collection-level access (checked once at start)
   * 2. Field-level permissions (per entry)
   * 3. Hook execution (per entry, unless skipHooks is true)
   *
   * @param params - Collection name and optional user context
   * @param entries - Array of entry data to create
   * @param options - Bulk operation options (batchSize, stopOnError, skipHooks)
   * @returns BulkOperationResult with success/failure counts, errors, and created IDs
   *
   * @example
   * ```typescript
   * // Basic bulk create
   * const result = await entryService.createEntries(
   *   { collectionName: 'posts', user: { id: 'user-123' } },
   *   [
   *     { title: 'Post 1', content: 'Content 1' },
   *     { title: 'Post 2', content: 'Content 2' },
   *   ]
   * );
   *
   * // With options
   * const result = await entryService.createEntries(
   *   { collectionName: 'posts' },
   *   entries,
   *   { batchSize: 50, stopOnError: true, skipHooks: true }
   * );
   *
   * // Check results
   * console.log(`Created: ${result.successful}, Failed: ${result.failed}`);
   * result.errors.forEach(e => console.log(`Entry ${e.index}: ${e.error}`));
   * ```
   */
  async createEntries(
    params: {
      collectionName: string;
      user?: UserContext;
      overrideAccess?: boolean;
      // A scoped API key is judged on its OWN publish grant when the batch's
      // transition authorization is pre-resolved, not the key owner's RBAC.
      authenticatedScope?: AuthenticatedScope;
    },
    entries: Record<string, unknown>[],
    options?: BulkOperationOptions
  ): Promise<BatchOperationResult> {
    const { batchSize, stopOnError, skipHooks } = batchOptions(options);

    // Early return for empty input
    if (entries.length === 0) {
      return { successful: 0, failed: 0, errors: [], ids: [] };
    }

    // 1. Check collection-level access FIRST (once for all entries).
    // `overrideAccess` (D35 system elevation) bypasses the check — mirrors the
    // by-query bulk methods so `ctx.services.collections.createMany(..., {as:'system'})`
    // can seed without an ambient user.
    const accessUser = params.overrideAccess ? undefined : params.user;
    const accessDenied =
      await this.accessService.checkCollectionAccess<BatchOperationResult>(
        params.collectionName,
        "create",
        accessUser,
        undefined,
        undefined,
        params.overrideAccess,
        undefined,
        // Judge a scoped API key on its OWN create grant, not the key owner's:
        // otherwise a super-admin-owned key without create-<slug> could batch
        // create via this collection-level gate (the transition pre-resolve
        // below already carries the scope, but this gate ran without it).
        params.authenticatedScope
      );
    if (accessDenied) {
      // All entries fail due to access denial
      return {
        successful: 0,
        failed: entries.length,
        errors: entries.map((_, index) => ({
          index,
          error: accessDenied.message || "Access denied",
        })),
        ids: [],
      };
    }

    // Resolve the caller's publish authorization ONCE on the pooled connection
    // before the shared transaction, so each worker enforces the create-as-
    // published under its row without a permission read inside the transaction.
    const transitionAuth =
      await this.mutationService.resolveTransitionAuthorization({
        collectionName: params.collectionName,
        accessUser,
        overrideAccess: params.overrideAccess,
        authenticatedScope: params.authenticatedScope,
      });

    // Every companion verdict the batch needs, resolved here for the same reason the
    // authorization above is. Inside the transaction they can only be READ: resolving issues a
    // query, and a query against a missing relation aborts the whole transaction on PostgreSQL.
    // An unresolved verdict reads as unusable, so each row's durable version snapshot and its
    // outbound event would silently omit every localized component value.
    await this.mutationService.warmLocalizedReadiness(params.collectionName);

    // The shared batch loop accumulates into one mutable state so the rollback
    // rewrite below can read the partial accounting a mid-batch abort leaves
    // behind.
    const state = newLegacyBatchState();
    try {
      await this.adapter.transaction(async tx => {
        await this.runCreateBatch(
          tx,
          params,
          transitionAuth,
          entries,
          { batchSize, stopOnError, skipHooks },
          state
        );
      });
    } catch (error: unknown) {
      // Transaction was rolled back (stopOnError case). Any outbox events an
      // item recorded before the abort were rolled back too, so clear the
      // aggregated signal unconditionally — even when the first item recorded
      // and aborted before ANY item was counted successful, so the wrapper
      // never drains for events that never committed. The same is true of the
      // collected intents: a rolled-back row's tags must not be busted.
      state.eventRecorded = false;
      state.intents.length = 0;
      this.rewriteCreateUpdateRollback(
        state,
        entries,
        stopOnError,
        params.collectionName,
        "Bulk create",
        error
      );
    }
    // Reached with a committed transaction when the catch was skipped, so the
    // collected intents describe rows that actually persist.
    const result = toBatchResult(state);

    this.logger.info("Bulk create completed", {
      collectionName: params.collectionName,
      total: entries.length,
      successful: result.successful,
      failed: result.failed,
    });

    return result;
  }

  /**
   * Create multiple entries within an existing transaction.
   *
   * Same as createEntries but uses an externally managed transaction.
   * Useful when bulk creates need to be part of a larger transaction.
   *
   * @param tx - Transaction context from adapter
   * @param params - Collection name and optional user context
   * @param entries - Array of entry data to create
   * @param options - Bulk operation options (batchSize, stopOnError, skipHooks)
   * @returns BulkOperationResult with success/failure counts, errors, and created IDs
   *
   * @example
   * ```typescript
   * // Resolve companion readiness before opening the transaction — inside one it can only be
   * // read, and an unresolved verdict silently strips localized component values from every
   * // version snapshot and outbound event this batch produces.
   * await entryService.warmLocalizedReadiness('children');
   * await adapter.transaction(async (tx) => {
   *   // Create parent entry
   *   const parent = await entryService.createEntryInTransaction(tx, parentParams, parentData);
   *
   *   // Bulk create children referencing parent
   *   const children = childrenData.map(c => ({ ...c, parentId: parent.data.id }));
   *   const result = await entryService.createEntriesInTransaction(
   *     tx,
   *     { collectionName: 'children' },
   *     children
   *   );
   *
   *   if (result.failed > 0) {
   *     throw new Error('Some children failed to create');
   *   }
   * });
   * ```
   */
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
    const { batchSize, stopOnError, skipHooks } = batchOptions(options);

    // Early return for empty input
    if (entries.length === 0) {
      return { successful: 0, failed: 0, errors: [], ids: [] };
    }

    // 1. Check collection-level access FIRST (once for all entries). This runs
    // inside the caller's transaction, so the RBAC/metadata reads are bound to
    // the transaction's connection (`tx.getDrizzle()`) rather than taking a
    // second pooled connection, which can stall against a small pool.
    const accessDenied =
      await this.accessService.checkCollectionAccess<BatchOperationResult>(
        params.collectionName,
        "create",
        params.user,
        undefined,
        undefined,
        undefined,
        undefined,
        // Judge a scoped API key on its OWN create grant, not the key owner's.
        params.authenticatedScope,
        undefined,
        tx.getDrizzle()
      );
    if (accessDenied) {
      return {
        successful: 0,
        failed: entries.length,
        errors: entries.map((_, index) => ({
          index,
          error: accessDenied.message,
        })),
        ids: [],
      };
    }

    // Resolve the caller's publish authorization ONCE before looping the workers,
    // so each create-as-published is enforced without a per-row permission read.
    // Bound to the caller's transaction connection so this resolution does not
    // re-enter the pool from inside the transaction.
    const transitionAuth =
      await this.mutationService.resolveTransitionAuthorization({
        collectionName: params.collectionName,
        accessUser: params.user,
        authenticatedScope: params.authenticatedScope,
        executor: tx.getDrizzle(),
      });

    // The shared batch loop. The intents and outbox signal it accumulates are
    // surfaced on the result for the CALLER to flush after ITS commit (as it
    // does for the webhook drain) — this method cannot flush pre-commit.
    const state = newLegacyBatchState();
    await this.runCreateBatch(
      tx,
      params,
      transitionAuth,
      entries,
      { batchSize, stopOnError, skipHooks },
      state
    );

    return toBatchResult(state);
  }

  /**
   * Update multiple entries in a single transaction.
   *
   * Processes entries in batches within a transaction. Each entry goes through
   * the same security checks and hook execution as single updates (unless hooks
   * are skipped). Provides detailed error tracking with entry indices.
   *
   * Security flow for each entry:
   * 1. Collection-level access (checked once at start)
   * 2. Entry existence check (per entry)
   * 3. Field-level permissions (per entry)
   * 4. Hook execution (per entry, unless skipHooks is true)
   *
   * @param params - Collection name and optional user context
   * @param entries - Array of { id, data } objects to update
   * @param options - Bulk operation options (batchSize, stopOnError, skipHooks)
   * @returns BulkOperationResult with success/failure counts, errors, and updated IDs
   *
   * @example
   * ```typescript
   * // Basic bulk update
   * const result = await entryService.updateEntries(
   *   { collectionName: 'posts', user: { id: 'user-123' } },
   *   [
   *     { id: 'post-1', data: { status: 'published' } },
   *     { id: 'post-2', data: { status: 'published', featured: true } },
   *   ]
   * );
   *
   * // With options
   * const result = await entryService.updateEntries(
   *   { collectionName: 'posts' },
   *   entries,
   *   { batchSize: 50, stopOnError: true, skipHooks: true }
   * );
   *
   * // Check results
   * console.log(`Updated: ${result.successful}, Failed: ${result.failed}`);
   * result.errors.forEach(e => console.log(`Entry ${e.index}: ${e.error}`));
   * ```
   */
  async updateEntries(
    params: {
      collectionName: string;
      user?: UserContext;
      authenticatedScope?: AuthenticatedScope;
    },
    entries: BulkUpdateEntry[],
    options?: BulkOperationOptions
  ): Promise<BatchOperationResult> {
    const { batchSize, stopOnError, skipHooks } = batchOptions(options);

    // Early return for empty input
    if (entries.length === 0) {
      return { successful: 0, failed: 0, errors: [], ids: [] };
    }

    // 1. Check collection-level access FIRST (once for all entries)
    // Note: For update, we check access without document since we don't have it yet
    // Owner-only checks will be done per-entry when we fetch the document
    const accessDenied =
      await this.accessService.checkCollectionAccess<BatchOperationResult>(
        params.collectionName,
        "update",
        params.user,
        undefined,
        undefined,
        undefined,
        undefined,
        // Judge a scoped API key on its OWN update grant, not the key owner's:
        // otherwise a super-admin-owned key without update-<slug> could
        // batch-update via this collection-level gate (the transition
        // pre-resolve below already carries the scope, but this gate ran without
        // it).
        params.authenticatedScope
      );
    if (accessDenied) {
      // All entries fail due to access denial
      return {
        successful: 0,
        failed: entries.length,
        errors: entries.map((_, index) => ({
          index,
          error: accessDenied.message,
        })),
        ids: [],
      };
    }

    // Resolve the caller's publish/unpublish authorization ONCE on the pooled
    // connection before the shared transaction, so each worker enforces its
    // transition under the row lock without a permission read inside the batch's
    // transaction.
    const transitionAuth =
      await this.mutationService.resolveTransitionAuthorization({
        collectionName: params.collectionName,
        accessUser: params.user,
        authenticatedScope: params.authenticatedScope,
      });

    // Every companion verdict the batch needs, resolved here for the same reason the
    // authorization above is. Inside the transaction they can only be READ: resolving issues a
    // query, and a query against a missing relation aborts the whole transaction on PostgreSQL.
    // An unresolved verdict reads as unusable, so each row's previous/post version snapshots and
    // its outbound event would silently omit every localized component value.
    await this.mutationService.warmLocalizedReadiness(params.collectionName);

    // The shared batch loop accumulates into one mutable state so the rollback
    // rewrite below can read the partial accounting a mid-batch abort leaves
    // behind.
    const state = newLegacyBatchState();
    try {
      await this.adapter.transaction(async tx => {
        await this.runUpdateBatch(
          tx,
          params,
          transitionAuth,
          entries,
          { batchSize, stopOnError, skipHooks },
          state
        );
      });
    } catch (error: unknown) {
      // Transaction was rolled back (stopOnError case). Clear the aggregated
      // outbox signal unconditionally — an item can record before the abort even
      // when none is counted successful — so the wrapper never drains for events
      // that never committed. The collected intents go with it: a rolled-back
      // row's tags must not be busted.
      state.eventRecorded = false;
      state.intents.length = 0;
      this.rewriteCreateUpdateRollback(
        state,
        entries,
        stopOnError,
        params.collectionName,
        "Bulk update",
        error
      );
    }
    // Reached with a committed transaction when the catch was skipped, so the
    // collected intents describe rows that actually persist.
    const result = toBatchResult(state);

    this.logger.info("Bulk update completed", {
      collectionName: params.collectionName,
      total: entries.length,
      successful: result.successful,
      failed: result.failed,
    });

    return result;
  }

  /**
   * Update multiple entries within an existing transaction.
   *
   * Same as updateEntries but uses an externally managed transaction.
   * Useful when bulk updates need to be part of a larger transaction.
   *
   * @param tx - Transaction context from adapter
   * @param params - Collection name and optional user context
   * @param entries - Array of { id, data } objects to update
   * @param options - Bulk operation options (batchSize, stopOnError, skipHooks)
   * @returns BulkOperationResult with success/failure counts, errors, and updated IDs
   *
   * @example
   * ```typescript
   * // Resolve companion readiness before opening the transaction — inside one it can only be
   * // read, and an unresolved verdict silently strips localized component values from every
   * // version snapshot and outbound event this batch produces.
   * await entryService.warmLocalizedReadiness('children');
   * await adapter.transaction(async (tx) => {
   *   // Update parent entry
   *   await entryService.updateEntryInTransaction(tx, parentParams, parentData);
   *
   *   // Bulk update children
   *   const result = await entryService.updateEntriesInTransaction(
   *     tx,
   *     { collectionName: 'children' },
   *     childUpdates
   *   );
   *
   *   if (result.failed > 0) {
   *     throw new Error('Some children failed to update');
   *   }
   * });
   * ```
   */
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
    const { batchSize, stopOnError, skipHooks } = batchOptions(options);

    // Early return for empty input
    if (entries.length === 0) {
      return { successful: 0, failed: 0, errors: [], ids: [] };
    }

    // 1. Check collection-level access FIRST (once for all entries). This runs
    // inside the caller's transaction, so the RBAC/metadata reads are bound to
    // the transaction's connection (`tx.getDrizzle()`) rather than taking a
    // second pooled connection, which can stall against a small pool.
    const accessDenied =
      await this.accessService.checkCollectionAccess<BatchOperationResult>(
        params.collectionName,
        "update",
        params.user,
        undefined,
        undefined,
        undefined,
        undefined,
        // Judge a scoped API key on its OWN update grant, not the key owner's.
        params.authenticatedScope,
        undefined,
        tx.getDrizzle()
      );
    if (accessDenied) {
      return {
        successful: 0,
        failed: entries.length,
        errors: entries.map((_, index) => ({
          index,
          error: accessDenied.message,
        })),
        ids: [],
      };
    }

    // Resolve the caller's publish/unpublish authorization ONCE before looping
    // the workers, so each transition is enforced under the row lock without a
    // per-row permission read. Bound to the caller's transaction connection so
    // this resolution does not re-enter the pool from inside the transaction.
    const transitionAuth =
      await this.mutationService.resolveTransitionAuthorization({
        collectionName: params.collectionName,
        accessUser: params.user,
        authenticatedScope: params.authenticatedScope,
        executor: tx.getDrizzle(),
      });

    // The shared batch loop. The intents and outbox signal it accumulates are
    // surfaced on the result for the CALLER to flush after ITS commit — this
    // method cannot flush pre-commit.
    const state = newLegacyBatchState();
    await this.runUpdateBatch(
      tx,
      params,
      transitionAuth,
      entries,
      { batchSize, stopOnError, skipHooks },
      state
    );

    return toBatchResult(state);
  }

  /**
   * Delete multiple entries in a single transaction.
   *
   * Processes entries in batches within a transaction. Each entry goes through
   * the same security checks and hook execution as single deletes (unless hooks
   * are skipped). Provides detailed error tracking with entry indices.
   *
   * Security flow for each entry:
   * 1. Collection-level access (checked once at start)
   * 2. Entry existence check (per entry)
   * 3. Owner-only access check (per entry, if applicable)
   * 4. Hook execution (per entry, unless skipHooks is true)
   *
   * @param params - Collection name and optional user context
   * @param ids - Array of entry IDs to delete
   * @param options - Bulk operation options (batchSize, stopOnError, skipHooks)
   * @returns BulkOperationResult with success/failure counts, errors, and deleted IDs
   *
   * @example
   * ```typescript
   * // Basic bulk delete
   * const result = await entryService.deleteEntries(
   *   { collectionName: 'posts', user: { id: 'user-123' } },
   *   ['post-1', 'post-2', 'post-3']
   * );
   *
   * // With options
   * const result = await entryService.deleteEntries(
   *   { collectionName: 'posts' },
   *   ids,
   *   { batchSize: 50, stopOnError: true, skipHooks: true }
   * );
   *
   * // Check results
   * console.log(`Deleted: ${result.successful}, Failed: ${result.failed}`);
   * result.errors.forEach(e => console.log(`Entry ${e.index}: ${e.error}`));
   * ```
   */
  async deleteEntries(
    params: {
      collectionName: string;
      user?: UserContext;
      /** Who performed the delete, recorded on each entry's outbox event. */
      actor?: RequestActor;
    },
    ids: string[],
    options?: BulkOperationOptions
  ): Promise<BatchOperationResult> {
    const { batchSize, stopOnError, skipHooks } = batchOptions(options);

    // Early return for empty input
    if (ids.length === 0) {
      return { successful: 0, failed: 0, errors: [], ids: [] };
    }

    // 1. Check collection-level access FIRST (once for all entries)
    // Note: For delete, we check access without document since we don't have it yet
    // Owner-only checks will be done per-entry when we fetch the document
    const accessDenied =
      await this.accessService.checkCollectionAccess<BatchOperationResult>(
        params.collectionName,
        "delete",
        params.user
      );
    if (accessDenied) {
      // All entries fail due to access denial
      return {
        successful: 0,
        failed: ids.length,
        errors: ids.map((_, index) => ({
          index,
          error: accessDenied.message,
        })),
        ids: [],
      };
    }

    // Every companion verdict the batch needs, resolved on the pool before the shared
    // transaction opens. Inside it they can only be READ: resolving issues a query, and a query
    // against a missing relation aborts the whole transaction on PostgreSQL. An unresolved verdict
    // reads as unusable, so the snapshot describing each deleted row — the last record of it
    // there will ever be — would silently omit every localized component value.
    await this.mutationService.warmLocalizedReadiness(params.collectionName);

    // The shared batch loop accumulates into one mutable state so the rollback
    // rewrite below can read the partial accounting a mid-batch abort leaves
    // behind.
    const state = newLegacyBatchState();
    try {
      await this.adapter.transaction(async tx => {
        await this.runDeleteBatch(
          tx,
          params,
          ids,
          { batchSize, stopOnError, skipHooks },
          state
        );
      });
    } catch (error: unknown) {
      // The shared transaction rolled back — either stopOnError tripped on a
      // returned failure, or an unexpected error (e.g. a failed outbox insert
      // after a row delete) aborted the batch. Every delete in the transaction
      // was undone, so nothing committed: report ALL requested ids as failed
      // (not just those processed before the abort) and surface the batch error,
      // so a caller is not told 0 succeeded / 1 failed for a 3-id request.
      const rolledBackCount = state.successful;
      if (rolledBackCount > 0) {
        this.logger.warn("Bulk delete rolled back", {
          collectionName: params.collectionName,
          successfulBeforeRollback: rolledBackCount,
          error: detailedErrorMessage(error),
        });
      }
      state.successful = 0;
      state.ids = [];
      state.failed = ids.length;
      // The rolled-back deletes recorded no committed events, so clear the
      // aggregated signal to keep the wrapper from draining uncommitted events;
      // their intents go with them — an undone delete busts no tags.
      state.eventRecorded = false;
      state.intents.length = 0;
      // The note names the failing index but stays on the error's public
      // contract — this result is returned to callers, so a typed
      // NextlyError contributes its envelope message, not its cause.
      const batchError = batchErrorMessage(error);
      const rollbackNote = `Batch rolled back; no entries were deleted: ${batchError}`;
      rebuildRolledBackDeleteErrors(state, ids, rollbackNote);
    }
    // Delete always reports the outbox signal, even when nothing recorded:
    // the previous shape read its own flag back after commit (true) or after
    // rollback (false), never left it absent.
    state.eventRecorded = state.eventRecorded ?? false;
    const result = toBatchResult(state);

    this.logger.info("Bulk delete completed", {
      collectionName: params.collectionName,
      total: ids.length,
      successful: result.successful,
      failed: result.failed,
    });

    return result;
  }

  /**
   * Delete multiple entries within an existing transaction.
   *
   * Same as deleteEntries but uses an externally managed transaction.
   * Useful when bulk deletes need to be part of a larger transaction.
   *
   * @param tx - Transaction context from adapter
   * @param params - Collection name and optional user context
   * @param ids - Array of entry IDs to delete
   * @param options - Bulk operation options (batchSize, stopOnError, skipHooks)
   * @returns BulkOperationResult with success/failure counts, errors, and deleted IDs
   *
   * @example
   * ```typescript
   * // Resolve companion readiness before opening the transaction — inside one it can only be
   * // read, and an unresolved verdict silently strips localized component values from the
   * // snapshot describing each deleted row, which is the last record of it there will ever be.
   * await entryService.warmLocalizedReadiness('children');
   * await adapter.transaction(async (tx) => {
   *   // Delete parent entry
   *   await entryService.deleteEntryInTransaction(tx, parentParams);
   *
   *   // Bulk delete children
   *   const result = await entryService.deleteEntriesInTransaction(
   *     tx,
   *     { collectionName: 'children' },
   *     childIds
   *   );
   *
   *   if (result.failed > 0) {
   *     throw new Error('Some children failed to delete');
   *   }
   * });
   * ```
   */
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
    const { batchSize, stopOnError, skipHooks } = batchOptions(options);

    // Early return for empty input
    if (ids.length === 0) {
      return { successful: 0, failed: 0, errors: [], ids: [] };
    }

    // 1. Check collection-level access FIRST (once for all entries). This runs
    // inside the caller's transaction, so the RBAC/metadata reads are bound to
    // the transaction's connection (`tx.getDrizzle()`) rather than taking a
    // second pooled connection, which can stall against a small pool.
    const accessDenied =
      await this.accessService.checkCollectionAccess<BatchOperationResult>(
        params.collectionName,
        "delete",
        params.user,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        tx.getDrizzle()
      );
    if (accessDenied) {
      return {
        successful: 0,
        failed: ids.length,
        errors: ids.map((_, index) => ({
          index,
          error: accessDenied.message,
        })),
        ids: [],
      };
    }

    // The shared batch loop. The intents and outbox signal it accumulates are
    // surfaced on the result for the CALLER to flush after ITS commit — this
    // method cannot flush pre-commit.
    const state = newLegacyBatchState();
    await this.runDeleteBatch(
      tx,
      params,
      ids,
      { batchSize, stopOnError, skipHooks },
      state
    );
    // Unlike the self-transaction twin, a caller-owned batch reports the
    // outbox signal only when an item recorded one: the caller owns the
    // commit, so absence — not a coerced false — is what it reads back.
    return toBatchResult(state);
  }

  // ============================================================
  // Per-operation batch workers — one loop per operation, called
  // by both of its entry points
  // ============================================================

  /**
   * Rewrite a self-transaction create/update batch's accounting after its
   * transaction rolled back, shared by both operations — their rollback
   * policies are one decision, differing only in the operation name their log
   * lines carry. An integrity abort reports every requested item as failed
   * with one generic error per index (the public contract maps errors to
   * input indices, and the raw operational detail stays in the log); a
   * stopOnError abort clears the provisional successes and annotates the
   * first recorded error with how many were rolled back.
   */
  private rewriteCreateUpdateRollback(
    state: LegacyBatchState,
    items: unknown[],
    stopOnError: boolean,
    collectionName: string,
    operationLabel: string,
    error: unknown
  ): void {
    // Log lines name WHAT aborted the batch, so read the abort's cause
    // chain: a typed NextlyError's own message is the wire-generic text.
    const errorText = detailedErrorMessage(error);
    if (state.integrityAbort) {
      this.logger.warn(`${operationLabel} rolled back`, {
        collectionName,
        successfulBeforeRollback: state.successful,
        error: errorText,
      });
      state.successful = 0;
      state.ids = [];
      state.failed = items.length;
      const message = "The write could not be completed and was rolled back.";
      state.errors = items.map((_, index) => ({ index, error: message }));
    } else if (stopOnError && state.successful > 0) {
      this.logger.warn(`${operationLabel} rolled back due to stopOnError`, {
        collectionName,
        successfulBeforeRollback: state.successful,
        error: errorText,
      });
      const rolledBackCount = state.successful;
      state.successful = 0;
      state.ids = [];
      if (state.errors.length > 0) {
        state.errors[0].error += ` (${rolledBackCount} successful entries were rolled back)`;
      }
    }
  }

  /**
   * The create batch's per-item worker and abort policy, shared by both entry
   * points so the operation's loop exists exactly once. Only marked
   * write-integrity failures abort a create batch; every other throw
   * soft-fails its item unless stopOnError says otherwise.
   */
  private async runCreateBatch(
    tx: TransactionContext,
    params: {
      collectionName: string;
      user?: UserContext;
      authenticatedScope?: AuthenticatedScope;
      overrideAccess?: boolean;
    },
    transitionAuth: Awaited<
      ReturnType<CollectionMutationService["resolveTransitionAuthorization"]>
    >,
    entries: Record<string, unknown>[],
    options: { batchSize: number; stopOnError: boolean; skipHooks: boolean },
    state: LegacyBatchState
  ): Promise<void> {
    await runLegacyBatch(
      tx,
      entries,
      options,
      state,
      async entryData => {
        const createResult =
          await this.mutationService.createSingleEntryInTransaction(
            tx,
            { ...params, transitionAuth },
            entryData,
            options.skipHooks
          );
        return createResult.success && createResult.data
          ? {
              ok: true,
              id: (createResult.data as Record<string, unknown>).id as string,
              eventRecorded: createResult.eventRecorded,
              revalidationIntent: createResult.revalidationIntent,
            }
          : {
              ok: false,
              message: createResult.message,
              eventRecorded: createResult.eventRecorded,
              revalidationIntent: createResult.revalidationIntent,
            };
      },
      isWriteIntegrityFailure
    );
  }

  /**
   * The update batch's per-item worker and abort policy, shared by both entry
   * points so the operation's loop exists exactly once. Only marked
   * write-integrity failures abort an update batch; every other throw
   * soft-fails its item unless stopOnError says otherwise.
   */
  private async runUpdateBatch(
    tx: TransactionContext,
    params: {
      collectionName: string;
      user?: UserContext;
      authenticatedScope?: AuthenticatedScope;
    },
    transitionAuth: Awaited<
      ReturnType<CollectionMutationService["resolveTransitionAuthorization"]>
    >,
    entries: BulkUpdateEntry[],
    options: { batchSize: number; stopOnError: boolean; skipHooks: boolean },
    state: LegacyBatchState
  ): Promise<void> {
    await runLegacyBatch(
      tx,
      entries,
      options,
      state,
      async ({ id, data }) => {
        const updateResult =
          await this.mutationService.updateSingleEntryInTransaction(
            tx,
            { ...params, transitionAuth },
            id,
            data,
            options.skipHooks
          );
        return updateResult.success && updateResult.data
          ? {
              ok: true,
              id: (updateResult.data as Record<string, unknown>).id as string,
              eventRecorded: updateResult.eventRecorded,
              revalidationIntent: updateResult.revalidationIntent,
            }
          : {
              ok: false,
              message: updateResult.message,
              eventRecorded: updateResult.eventRecorded,
              revalidationIntent: updateResult.revalidationIntent,
            };
      },
      isWriteIntegrityFailure
    );
  }

  /**
   * The delete batch's per-item worker and abort policy, shared by both entry
   * points so the operation's loop exists exactly once. A THROWN error (as
   * opposed to a returned {success:false}) may have left a partial write in
   * the shared transaction — e.g. the row was deleted but its entry.deleted
   * outbox event failed to insert — so every throw aborts the batch. Expected
   * per-item failures (access denied, not found) are RETURNED by the worker,
   * not thrown, so partial success is unaffected.
   */
  private async runDeleteBatch(
    tx: TransactionContext,
    params: {
      collectionName: string;
      user?: UserContext;
      /** Who performed the delete, recorded on each entry's outbox event. */
      actor?: RequestActor;
    },
    ids: string[],
    options: { batchSize: number; stopOnError: boolean; skipHooks: boolean },
    state: LegacyBatchState
  ): Promise<void> {
    await runLegacyBatch(
      tx,
      ids,
      options,
      state,
      async entryId => {
        const deleteResult =
          await this.mutationService.deleteSingleEntryInTransaction(
            tx,
            params,
            entryId,
            options.skipHooks
          );
        return deleteResult.success
          ? {
              ok: true,
              id: entryId,
              eventRecorded: deleteResult.eventRecorded,
              revalidationIntent: deleteResult.revalidationIntent,
            }
          : {
              ok: false,
              message: deleteResult.message,
              eventRecorded: deleteResult.eventRecorded,
              revalidationIntent: deleteResult.revalidationIntent,
            };
      },
      () => true
    );
  }
}
