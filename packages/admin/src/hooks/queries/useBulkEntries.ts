/**
 * useBulkEntries hooks (server-bulk pattern).
 *
 * TanStack Query mutation hooks for bulk entry operations. Each hook
 * dispatches a single round-trip to the server's bulk endpoint
 * (`POST /api/collections/{slug}/entries/bulk-delete` or
 * `POST /api/collections/{slug}/entries/bulk-update`). The server
 * runs per-row deletes/updates concurrently via Promise.allSettled,
 * with full hooks + access-control pipeline preserved per row.
 *
 * Result shape (`BulkResponse<T>`):
 *   - `message`: server-authored toast string (e.g. "Deleted 4 of 5 entries.")
 *   - `items`:   successful records (full record for update; `{id}` for delete)
 *   - `errors`:  per-item failures with canonical NextlyErrorCode + message
 *
 * @see services/entryApi.ts for the underlying calls
 * @see lib/api/response-types.ts for `BulkResponse<T>` definition
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { toast } from "@admin/components/ui";
import type { BulkResponse, PerItemError } from "@admin/lib/api/response-types";
import {
  entryApi,
  entryKeys,
  type UpdateEntryPayload,
} from "@admin/services/entryApi";
import type { Entry } from "@admin/types/collection";

/**
 * Callback payload for bulk operation lifecycle hooks. Carries the
 * canonical `BulkResponse` shape so the consumer can render rich
 * partial-failure UX (per-item code + message) without losing the
 * scalar counts that older callers rely on.
 */
export interface BulkCallbackPayload<T> {
  /** Number of items that succeeded (mirrors `items.length`). */
  succeeded: number;
  /** Number of items that failed (mirrors `errors.length`). */
  failed: number;
  /** Total items attempted (`succeeded + failed`). */
  total: number;
  /** Server-authored summary message (e.g. "Deleted 4 of 5 entries."). */
  message: string;
  /** Successful records returned by the server. */
  items: T[];
  /** Per-item failures with canonical NextlyErrorCode + public message. */
  errors: PerItemError[];
}

/** Build the callback payload from a server `BulkResponse<T>`. */
function toCallbackPayload<T>(
  response: BulkResponse<T>
): BulkCallbackPayload<T> {
  return {
    succeeded: response.items.length,
    failed: response.errors.length,
    total: response.items.length + response.errors.length,
    message: response.message,
    items: response.items,
    errors: response.errors,
  };
}

// ============================================================================
// useBulkDeleteEntries
// ============================================================================

/**
 * Options for useBulkDeleteEntries hook.
 */
export interface UseBulkDeleteEntriesOptions {
  /** The collection slug/name containing the entries. */
  collectionSlug: string;
  /** Fired after the bulk request completes (success OR partial failure). */
  onComplete?: (result: BulkCallbackPayload<{ id: string }>) => void;
  /** Fired when the request resolved (regardless of partial failures). */
  onSuccess?: (result: BulkCallbackPayload<{ id: string }>) => void;
  /**
   * Fired when the request itself rejected (network error, 4xx, 5xx).
   * Per-item failures inside a 200 response do NOT trigger this callback;
   * use `onComplete` to inspect `result.errors` for partial failures.
   */
  onError?: (error: Error) => void;
  /** Whether to show a toast notification with `result.message` (default: true). */
  showToast?: boolean;
}

/**
 * Bulk-delete multiple entries in a single round-trip.
 *
 * Hits `POST /api/collections/{slug}/entries/bulk-delete`. Server runs
 * per-row delete concurrently with full hook + access-control pipeline.
 *
 * @example Bulk delete with confirmation dialog
 * ```tsx
 * const bulkDelete = useBulkDeleteEntries({
 *   collectionSlug: 'posts',
 *   onComplete: result => {
 *     if (result.failed > 0) {
 *       openPartialFailureModal(result.errors);
 *     }
 *   },
 * });
 * bulkDelete.mutate(selectedIds);
 * ```
 */
export function useBulkDeleteEntries({
  collectionSlug,
  onComplete,
  onSuccess,
  onError,
  showToast = true,
}: UseBulkDeleteEntriesOptions) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (ids: string[]) => {
      return entryApi.deleteByIDs(collectionSlug, ids);
    },
    onSuccess: response => {
      // Invalidate list + count queries; remove deleted detail entries
      // from cache so any open detail page sees the canonical 404 from
      // the server next time it refetches rather than a stale read.
      void queryClient.invalidateQueries({
        queryKey: entryKeys.listsByCollection(collectionSlug),
      });
      void queryClient.invalidateQueries({
        queryKey: entryKeys.counts(),
      });
      response.items.forEach(({ id }) => {
        queryClient.removeQueries({
          queryKey: entryKeys.detail(collectionSlug, id),
        });
      });

      const payload = toCallbackPayload(response);

      if (showToast) {
        if (payload.failed > 0) {
          toast.warning(payload.message);
        } else {
          toast.success(payload.message);
        }
      }

      onComplete?.(payload);
      onSuccess?.(payload);
    },
    onError: error => {
      // Network / non-2xx error: the server-bulk request itself failed.
      // Partial-success failures (200 with errors[]) come through onSuccess.
      if (showToast) {
        toast.error(
          error instanceof Error ? error.message : "Bulk delete failed."
        );
      }
      onError?.(error instanceof Error ? error : new Error(String(error)));
    },
  });
}

// ============================================================================
// useBulkUpdateEntries
// ============================================================================

/**
 * Options for useBulkUpdateEntries hook.
 */
export interface UseBulkUpdateEntriesOptions {
  /** The collection slug/name containing the entries. */
  collectionSlug: string;
  /** Fired after the bulk request completes (success OR partial failure). */
  onComplete?: (result: BulkCallbackPayload<Entry>) => void;
  /** Fired when the request resolved (regardless of partial failures). */
  onSuccess?: (result: BulkCallbackPayload<Entry>) => void;
  /** Fired when the request itself rejected (network error, 4xx, 5xx). */
  onError?: (error: Error) => void;
  /** Whether to show a toast notification with `result.message` (default: true). */
  showToast?: boolean;
}

/**
 * Bulk-update multiple entries in a single round-trip.
 *
 * Hits `POST /api/collections/{slug}/entries/bulk-update`. Server runs
 * per-row update concurrently with full hook + validation + access-control
 * pipeline. Successes carry the full mutated record so the admin can
 * refresh local state without a re-fetch.
 *
 * @example Bulk publish selected drafts
 * ```tsx
 * const bulkUpdate = useBulkUpdateEntries({ collectionSlug: 'posts' });
 * bulkUpdate.mutate({ ids: selectedIds, data: { status: 'published' } });
 * ```
 */
export function useBulkUpdateEntries({
  collectionSlug,
  onComplete,
  onSuccess,
  onError,
  showToast = true,
}: UseBulkUpdateEntriesOptions) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (variables: {
      ids: string[];
      data: UpdateEntryPayload;
    }) => {
      return entryApi.updateByIDs(collectionSlug, variables);
    },
    onSuccess: response => {
      void queryClient.invalidateQueries({
        queryKey: entryKeys.listsByCollection(collectionSlug),
      });
      // Invalidate per-detail queries for updated entries so any open
      // detail view sees the new values on next refetch.
      response.items.forEach(item => {
        const id = (item as { id?: string }).id;
        if (id) {
          void queryClient.invalidateQueries({
            queryKey: entryKeys.detail(collectionSlug, id),
          });
        }
      });

      const payload = toCallbackPayload(response);

      if (showToast) {
        if (payload.failed > 0) {
          toast.warning(payload.message);
        } else {
          toast.success(payload.message);
        }
      }

      onComplete?.(payload);
      onSuccess?.(payload);
    },
    onError: error => {
      if (showToast) {
        toast.error(
          error instanceof Error ? error.message : "Bulk update failed."
        );
      }
      onError?.(error instanceof Error ? error : new Error(String(error)));
    },
  });
}
