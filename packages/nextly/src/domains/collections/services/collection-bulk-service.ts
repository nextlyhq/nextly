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

import type { RequestActor } from "../../../auth/request-actor";
import { NextlyError } from "../../../errors/nextly-error";
import type { WhereFilter } from "../../../services/collections/query-operators";
import type { Logger } from "../../../services/shared";
import { BaseService } from "../../../shared/base-service";
import { PAGINATION_DEFAULTS } from "../../../types/pagination";

import type { CollectionAccessService } from "./collection-access-service";
import type { CollectionMutationService } from "./collection-mutation-service";
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
  const status = result.statusCode ?? 500;
  if (status === 404) {
    return { code: "NOT_FOUND", message: "Not found." };
  }
  if (status === 403) {
    return {
      code: "FORBIDDEN",
      message: "You don't have permission to perform this action.",
    };
  }
  if (status === 409) {
    // Same disambiguation as unwrapServiceResult: 409 covers both a
    // unique-constraint duplicate and an optimistic-concurrency conflict,
    // and only the envelope's code can tell them apart. Staleness is the
    // conservative default for a code-less envelope.
    if (result.code === "DUPLICATE") {
      return { code: "DUPLICATE", message: "Resource already exists." };
    }
    return {
      code: "CONFLICT",
      message:
        "The resource has changed since you last loaded it. Please refresh and try again.",
    };
  }
  if (status === 400) {
    return { code: "VALIDATION_ERROR", message: "Validation failed." };
  }
  return { code: "INTERNAL_ERROR", message: "An unexpected error occurred." };
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
  | { kind: "success"; record: T }
  | {
      kind: "failure";
      failure: { id: string; code: string; message: string };
      /**
       * Set when the item committed its row + outbox event but a post-commit
       * hook then threw, so it is reported as a failure yet still owes a
       * delivery. Aggregated into the batch result's `eventRecorded`.
       */
      eventRecorded?: boolean;
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
  outcomes.forEach((outcome, index) => {
    if (outcome.status === "fulfilled") {
      const value = outcome.value;
      if (value.kind === "success") {
        result.successes.push(value.record);
        result.successCount++;
      } else {
        result.failures.push(value.failure);
        result.failedCount++;
        // A "failure" that still committed its outbox event (a post-commit hook
        // threw) owes a delivery even though it is not a success.
        if (value.eventRecorded) result.eventRecorded = true;
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
    /** Route auth already ran the create RBAC gate; skip only that re-check. */
    routeAuthorized?: boolean;
    /** Arbitrary data passed to hooks via context */
    context?: Record<string, unknown>;
    /** Acting identity from the transport, forwarded to the recorded event. */
    actor?: RequestActor;
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
      const sourceStatus = params.overrideAccess ? "all" : undefined;
      const sourceResult = await this.queryService.getEntry({
        collectionName: params.collectionName,
        entryId: params.entryId,
        user: params.user,
        overrideAccess: params.overrideAccess,
        status: sourceStatus,
        context: params.context,
      });

      if (!sourceResult.success || !sourceResult.data) {
        return {
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
            });

            if (deleteResult.success) {
              return { kind: "success", record: { id: entryId } };
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
              },
              params.data
            );

            if (updateResult.success && updateResult.data) {
              // Carry the full mutated record back so the dispatcher can ship
              // it to the client without a re-fetch round-trip.
              return {
                kind: "success",
                record: updateResult.data as Record<string, unknown>,
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
      params.routeAuthorized
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
      params.overrideAccess
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
      const { code, message } = legacyEnvelopeToFailureFields(listResult);
      throw new NextlyError({
        code,
        publicMessage: message,
        logContext: {
          op: "bulkUpdateByQuery",
          collectionName: params.collectionName,
          legacyMessage: listResult.message,
        },
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
      params.routeAuthorized
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
      params.overrideAccess
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
      const { code, message } = legacyEnvelopeToFailureFields(listResult);
      throw new NextlyError({
        code,
        publicMessage: message,
        logContext: {
          op: "bulkDeleteByQuery",
          collectionName: params.collectionName,
          legacyMessage: listResult.message,
        },
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
    },
    entries: Record<string, unknown>[],
    options?: BulkOperationOptions
  ): Promise<BatchOperationResult> {
    const {
      batchSize = 100,
      stopOnError = false,
      skipHooks = false,
    } = options ?? {};

    // Initialize result tracking
    const result: BatchOperationResult = {
      successful: 0,
      failed: 0,
      errors: [],
      ids: [],
    };

    // Early return for empty input
    if (entries.length === 0) {
      return result;
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
        params.overrideAccess
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

    // Process all entries within a single transaction
    try {
      await this.adapter.transaction(async tx => {
        // Process in batches for memory efficiency
        for (let i = 0; i < entries.length; i += batchSize) {
          const batch = entries.slice(
            i,
            Math.min(i + batchSize, entries.length)
          );

          // Process each entry in the batch
          for (let j = 0; j < batch.length; j++) {
            const entryIndex = i + j;
            const entryData = batch[j];

            try {
              // Create entry using transaction method
              const createResult =
                await this.mutationService.createSingleEntryInTransaction(
                  tx,
                  params,
                  entryData,
                  skipHooks
                );

              if (createResult.success && createResult.data) {
                result.successful++;
                result.ids.push(
                  (createResult.data as Record<string, unknown>).id as string
                );
              } else {
                result.failed++;
                result.errors.push({
                  index: entryIndex,
                  error: createResult.message,
                });

                // If stopOnError, throw to trigger transaction rollback
                if (stopOnError) {
                  throw new Error(
                    `Entry at index ${entryIndex} failed: ${createResult.message}`
                  );
                }
              }
            } catch (error: unknown) {
              // Handle unexpected errors during entry creation
              result.failed++;
              result.errors.push({
                index: entryIndex,
                error:
                  error instanceof Error
                    ? error.message
                    : "Unknown error occurred",
              });

              if (stopOnError) {
                throw error; // Re-throw to trigger transaction rollback
              }
            }
          }
        }
      });
    } catch (error: unknown) {
      // Transaction was rolled back (stopOnError case)
      // Reset successful count since transaction rolled back
      if (stopOnError && result.successful > 0) {
        this.logger.warn("Bulk create rolled back due to stopOnError", {
          collectionName: params.collectionName,
          successfulBeforeRollback: result.successful,
          error: error instanceof Error ? error.message : String(error),
        });
        // Clear successful entries since they were rolled back
        const rolledBackCount = result.successful;
        result.successful = 0;
        result.ids = [];
        // Add rollback info to first error
        if (result.errors.length > 0) {
          result.errors[0].error += ` (${rolledBackCount} successful entries were rolled back)`;
        }
      }
    }

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
    params: { collectionName: string; user?: UserContext },
    entries: Record<string, unknown>[],
    options?: BulkOperationOptions
  ): Promise<BatchOperationResult> {
    const {
      batchSize = 100,
      stopOnError = false,
      skipHooks = false,
    } = options ?? {};

    // Initialize result tracking
    const result: BatchOperationResult = {
      successful: 0,
      failed: 0,
      errors: [],
      ids: [],
    };

    // Early return for empty input
    if (entries.length === 0) {
      return result;
    }

    // 1. Check collection-level access FIRST (once for all entries)
    const accessDenied =
      await this.accessService.checkCollectionAccess<BatchOperationResult>(
        params.collectionName,
        "create",
        params.user
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

    // Process in batches for memory efficiency
    for (let i = 0; i < entries.length; i += batchSize) {
      const batch = entries.slice(i, Math.min(i + batchSize, entries.length));

      // Process each entry in the batch
      for (let j = 0; j < batch.length; j++) {
        const entryIndex = i + j;
        const entryData = batch[j];

        try {
          const createResult =
            await this.mutationService.createSingleEntryInTransaction(
              tx,
              params,
              entryData,
              skipHooks
            );

          if (createResult.success && createResult.data) {
            result.successful++;
            result.ids.push(
              (createResult.data as Record<string, unknown>).id as string
            );
          } else {
            result.failed++;
            result.errors.push({
              index: entryIndex,
              error: createResult.message,
            });

            if (stopOnError) {
              throw new Error(
                `Entry at index ${entryIndex} failed: ${createResult.message}`
              );
            }
          }
        } catch (error: unknown) {
          result.failed++;
          result.errors.push({
            index: entryIndex,
            error:
              error instanceof Error ? error.message : "Unknown error occurred",
          });

          if (stopOnError) {
            throw error; // Caller's transaction will be rolled back
          }
        }
      }
    }

    return result;
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
    params: { collectionName: string; user?: UserContext },
    entries: BulkUpdateEntry[],
    options?: BulkOperationOptions
  ): Promise<BatchOperationResult> {
    const {
      batchSize = 100,
      stopOnError = false,
      skipHooks = false,
    } = options ?? {};

    // Initialize result tracking
    const result: BatchOperationResult = {
      successful: 0,
      failed: 0,
      errors: [],
      ids: [],
    };

    // Early return for empty input
    if (entries.length === 0) {
      return result;
    }

    // 1. Check collection-level access FIRST (once for all entries)
    // Note: For update, we check access without document since we don't have it yet
    // Owner-only checks will be done per-entry when we fetch the document
    const accessDenied =
      await this.accessService.checkCollectionAccess<BatchOperationResult>(
        params.collectionName,
        "update",
        params.user
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

    // Process all entries within a single transaction
    try {
      await this.adapter.transaction(async tx => {
        // Process in batches for memory efficiency
        for (let i = 0; i < entries.length; i += batchSize) {
          const batch = entries.slice(
            i,
            Math.min(i + batchSize, entries.length)
          );

          // Process each entry in the batch
          for (let j = 0; j < batch.length; j++) {
            const entryIndex = i + j;
            const { id, data } = batch[j];

            try {
              // Update entry using transaction method
              const updateResult =
                await this.mutationService.updateSingleEntryInTransaction(
                  tx,
                  params,
                  id,
                  data,
                  skipHooks
                );

              if (updateResult.success && updateResult.data) {
                result.successful++;
                result.ids.push(
                  (updateResult.data as Record<string, unknown>).id as string
                );
              } else {
                result.failed++;
                result.errors.push({
                  index: entryIndex,
                  error: updateResult.message,
                });

                // If stopOnError, throw to trigger transaction rollback
                if (stopOnError) {
                  throw new Error(
                    `Entry at index ${entryIndex} failed: ${updateResult.message}`
                  );
                }
              }
            } catch (error: unknown) {
              // Handle unexpected errors during entry update
              result.failed++;
              result.errors.push({
                index: entryIndex,
                error:
                  error instanceof Error
                    ? error.message
                    : "Unknown error occurred",
              });

              if (stopOnError) {
                throw error; // Re-throw to trigger transaction rollback
              }
            }
          }
        }
      });
    } catch (error: unknown) {
      // Transaction was rolled back (stopOnError case)
      // Reset successful count since transaction rolled back
      if (stopOnError && result.successful > 0) {
        this.logger.warn("Bulk update rolled back due to stopOnError", {
          collectionName: params.collectionName,
          successfulBeforeRollback: result.successful,
          error: error instanceof Error ? error.message : String(error),
        });
        // Clear successful entries since they were rolled back
        const rolledBackCount = result.successful;
        result.successful = 0;
        result.ids = [];
        // Add rollback info to first error
        if (result.errors.length > 0) {
          result.errors[0].error += ` (${rolledBackCount} successful entries were rolled back)`;
        }
      }
    }

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
    params: { collectionName: string; user?: UserContext },
    entries: BulkUpdateEntry[],
    options?: BulkOperationOptions
  ): Promise<BatchOperationResult> {
    const {
      batchSize = 100,
      stopOnError = false,
      skipHooks = false,
    } = options ?? {};

    // Initialize result tracking
    const result: BatchOperationResult = {
      successful: 0,
      failed: 0,
      errors: [],
      ids: [],
    };

    // Early return for empty input
    if (entries.length === 0) {
      return result;
    }

    // 1. Check collection-level access FIRST (once for all entries)
    const accessDenied =
      await this.accessService.checkCollectionAccess<BatchOperationResult>(
        params.collectionName,
        "update",
        params.user
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

    // Process in batches for memory efficiency
    for (let i = 0; i < entries.length; i += batchSize) {
      const batch = entries.slice(i, Math.min(i + batchSize, entries.length));

      // Process each entry in the batch
      for (let j = 0; j < batch.length; j++) {
        const entryIndex = i + j;
        const { id, data } = batch[j];

        try {
          const updateResult =
            await this.mutationService.updateSingleEntryInTransaction(
              tx,
              params,
              id,
              data,
              skipHooks
            );

          if (updateResult.success && updateResult.data) {
            result.successful++;
            result.ids.push(
              (updateResult.data as Record<string, unknown>).id as string
            );
          } else {
            result.failed++;
            result.errors.push({
              index: entryIndex,
              error: updateResult.message,
            });

            if (stopOnError) {
              throw new Error(
                `Entry at index ${entryIndex} failed: ${updateResult.message}`
              );
            }
          }
        } catch (error: unknown) {
          result.failed++;
          result.errors.push({
            index: entryIndex,
            error:
              error instanceof Error ? error.message : "Unknown error occurred",
          });

          if (stopOnError) {
            throw error; // Caller's transaction will be rolled back
          }
        }
      }
    }

    return result;
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
    const {
      batchSize = 100,
      stopOnError = false,
      skipHooks = false,
    } = options ?? {};

    // Initialize result tracking
    const result: BatchOperationResult = {
      successful: 0,
      failed: 0,
      errors: [],
      ids: [],
    };

    // Early return for empty input
    if (ids.length === 0) {
      return result;
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

    // Whether any item appended an outbox event in the shared transaction. Read
    // back onto the result only after the transaction commits (below), so a
    // rollback — which undoes every delete and its event — never reports a
    // durable event that isn't there.
    let anyRecorded = false;
    // Process all entries within a single transaction
    try {
      await this.adapter.transaction(async tx => {
        // Process in batches for memory efficiency
        for (let i = 0; i < ids.length; i += batchSize) {
          const batch = ids.slice(i, Math.min(i + batchSize, ids.length));

          // Process each entry in the batch
          for (let j = 0; j < batch.length; j++) {
            const entryIndex = i + j;
            const entryId = batch[j];

            try {
              // Delete entry using transaction method
              const deleteResult =
                await this.mutationService.deleteSingleEntryInTransaction(
                  tx,
                  params,
                  entryId,
                  skipHooks
                );
              // A committed item owes a delivery even if its afterDelete hook
              // then threw (returned success:false).
              if (deleteResult.eventRecorded) anyRecorded = true;

              if (deleteResult.success) {
                result.successful++;
                result.ids.push(entryId);
              } else {
                result.failed++;
                result.errors.push({
                  index: entryIndex,
                  error: deleteResult.message,
                });

                // If stopOnError, throw to trigger transaction rollback
                if (stopOnError) {
                  throw new Error(
                    `Entry at index ${entryIndex} failed: ${deleteResult.message}`
                  );
                }
              }
            } catch (error: unknown) {
              // A THROWN error (as opposed to a returned {success:false}) is
              // unexpected and may have left a partial write in this SHARED
              // transaction — e.g. the row was deleted but its entry.deleted
              // outbox event failed to insert. A shared transaction cannot
              // partially roll back, so committing would break the outbox
              // guarantee (a delete with no event). Abort the whole batch rather
              // than soft-failing this item and committing the rest. Expected
              // per-item failures (access denied, not found) are RETURNED above,
              // not thrown, so partial success is unaffected.
              result.failed++;
              result.errors.push({
                index: entryIndex,
                error:
                  error instanceof Error
                    ? error.message
                    : "Unknown error occurred",
              });

              throw error; // Roll the whole batch back.
            }
          }
        }
      });
      // The transaction committed (this line is skipped if it rejected), so any
      // events it recorded are durable; surface that for the post-write drain.
      result.eventRecorded = anyRecorded;
    } catch (error: unknown) {
      // The shared transaction rolled back — either stopOnError tripped on a
      // returned failure, or an unexpected error (e.g. a failed outbox insert
      // after a row delete) aborted the batch. Every delete in the transaction
      // was undone, so nothing committed: report ALL requested ids as failed
      // (not just those processed before the abort) and surface the batch error,
      // so a caller is not told 0 succeeded / 1 failed for a 3-id request.
      const rolledBackCount = result.successful;
      if (rolledBackCount > 0) {
        this.logger.warn("Bulk delete rolled back", {
          collectionName: params.collectionName,
          successfulBeforeRollback: rolledBackCount,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      result.successful = 0;
      result.ids = [];
      result.failed = ids.length;
      const batchError = error instanceof Error ? error.message : String(error);
      const rollbackNote = `Batch rolled back; no entries were deleted: ${batchError}`;
      // Rebuild errors as exactly one entry per requested id, in index order.
      // A `stopOnError` returned-failure pushes both the item error and a thrown
      // wrapper for the same index, so dedupe (first wins) before filling the
      // rolled-back ids that had no entry — otherwise `errors` would exceed
      // `failed` and give a client duplicate detail for one id.
      const byIndex = new Map<number, string>();
      for (const e of result.errors) {
        if (!byIndex.has(e.index)) byIndex.set(e.index, e.error);
      }
      result.errors = [];
      for (let i = 0; i < ids.length; i += 1) {
        result.errors.push({ index: i, error: byIndex.get(i) ?? rollbackNote });
      }
    }

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
    const {
      batchSize = 100,
      stopOnError = false,
      skipHooks = false,
    } = options ?? {};

    // Initialize result tracking
    const result: BatchOperationResult = {
      successful: 0,
      failed: 0,
      errors: [],
      ids: [],
    };

    // Early return for empty input
    if (ids.length === 0) {
      return result;
    }

    // 1. Check collection-level access FIRST (once for all entries)
    const accessDenied =
      await this.accessService.checkCollectionAccess<BatchOperationResult>(
        params.collectionName,
        "delete",
        params.user
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

    // Process in batches for memory efficiency
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, Math.min(i + batchSize, ids.length));

      // Process each entry in the batch
      for (let j = 0; j < batch.length; j++) {
        const entryIndex = i + j;
        const entryId = batch[j];

        try {
          const deleteResult =
            await this.mutationService.deleteSingleEntryInTransaction(
              tx,
              params,
              entryId,
              skipHooks
            );

          if (deleteResult.success) {
            result.successful++;
            result.ids.push(entryId);
          } else {
            result.failed++;
            result.errors.push({
              index: entryIndex,
              error: deleteResult.message,
            });

            if (stopOnError) {
              throw new Error(
                `Entry at index ${entryIndex} failed: ${deleteResult.message}`
              );
            }
          }
        } catch (error: unknown) {
          // A THROWN error may have left a partial write in the CALLER'S
          // transaction — e.g. a row deleted but its entry.deleted outbox event
          // failed to insert. Propagate it so the caller's transaction rolls
          // back rather than committing a delete with no event. Expected per-item
          // failures are RETURNED above, not thrown, so partial success stands.
          result.failed++;
          result.errors.push({
            index: entryIndex,
            error:
              error instanceof Error ? error.message : "Unknown error occurred",
          });

          throw error; // Caller's transaction will be rolled back.
        }
      }
    }

    return result;
  }
}
