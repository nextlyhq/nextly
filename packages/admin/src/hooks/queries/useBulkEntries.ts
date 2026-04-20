/**
 * useBulkEntries Hooks
 *
 * TanStack Query mutation hooks for bulk entry operations.
 * Uses the useBulkMutation hook for parallel execution with
 * partial failure handling.
 *
 * ## Available Hooks
 * - `useBulkDeleteEntries` - Delete multiple entries by IDs
 * - `useBulkUpdateEntries` - Update multiple entries with same data
 *
 * ## Features
 * - Parallel execution with Promise.allSettled()
 * - Partial failure handling (some succeed, some fail)
 * - Detailed results with success/failure counts
 * - Automatic cache invalidation
 * - Toast notifications with result summary
 *
 * @example
 * ```tsx
 * const { mutate: bulkDelete, isPending } = useBulkDeleteEntries({
 *   collectionSlug: 'posts',
 * });
 *
 * bulkDelete(['id1', 'id2', 'id3'], undefined);
 * ```
 *
 * @see hooks/useBulkMutation.ts - Generic bulk mutation hook
 * @see hooks/queries/useCollections.ts - Reference pattern for bulk hooks
 */

import { useQueryClient } from "@tanstack/react-query";

import { toast } from "@admin/components/ui";
import { useBulkMutation } from "@admin/hooks/useBulkMutation";
import {
  entryApi,
  entryKeys,
  type UpdateEntryPayload,
} from "@admin/services/entryApi";
import type { Entry } from "@admin/types/collection";

/**
 * Options for useBulkDeleteEntries hook
 */
export interface UseBulkDeleteEntriesOptions {
  /** The collection slug/name containing the entries */
  collectionSlug: string;
  /** Callback fired when operation completes (success or partial failure) */
  onComplete?: (result: { succeeded: number; failed: number }) => void;
  /** Callback fired when at least one entry was deleted */
  onSuccess?: (result: { succeeded: number; failed: number }) => void;
  /** Callback fired when at least one deletion failed */
  onError?: (result: { succeeded: number; failed: number }) => void;
  /** Whether to show toast notifications (default: true) */
  showToast?: boolean;
}

/**
 * useBulkDeleteEntries - Bulk mutation hook for deleting multiple entries
 *
 * Executes parallel delete operations for multiple entries using Promise.allSettled().
 * Allows partial failures where some deletions succeed while others fail.
 * Automatically invalidates the entry cache after all operations complete.
 *
 * ## Features
 * - Parallel execution with Promise.allSettled()
 * - Partial failure handling (some succeed, some fail)
 * - Detailed results with success/failure counts
 * - Automatic cache invalidation after completion
 * - Toast notifications with result summary
 * - TypeScript type safety
 *
 * ## Result Structure
 * ```ts
 * {
 *   succeeded: 8,        // Number of successful deletions
 *   failed: 2,           // Number of failed deletions
 *   total: 10,           // Total entries attempted
 *   succeededIds: [...], // IDs of successfully deleted entries
 *   failedIds: [...],    // IDs of entries that failed to delete
 *   results: [...]       // Individual results with error details
 * }
 * ```
 *
 * ## Cache Invalidation
 * Automatically invalidates:
 * - `["entries", "list", collectionSlug]` - Entry list queries
 * - `["entries", "count", collectionSlug]` - Entry count queries
 *
 * @param options - Hook options including collectionSlug and callbacks
 * @returns Bulk mutation interface with mutate function, isPending state, and result
 *
 * @example Basic usage - Delete selected entries
 * ```tsx
 * function EntryListActions({ selectedIds }: { selectedIds: string[] }) {
 *   const { mutate: bulkDelete, isPending } = useBulkDeleteEntries({
 *     collectionSlug: 'posts',
 *   });
 *
 *   const handleBulkDelete = async () => {
 *     if (confirm(`Delete ${selectedIds.length} entries?`)) {
 *       await bulkDelete(selectedIds, undefined);
 *     }
 *   };
 *
 *   return (
 *     <Button
 *       variant="destructive"
 *       onClick={handleBulkDelete}
 *       disabled={isPending || selectedIds.length === 0}
 *     >
 *       {isPending ? 'Deleting...' : `Delete ${selectedIds.length} Entries`}
 *     </Button>
 *   );
 * }
 * ```
 *
 * @example With callbacks
 * ```tsx
 * const { mutate: bulkDelete } = useBulkDeleteEntries({
 *   collectionSlug: 'posts',
 *   onSuccess: (result) => {
 *     console.log(`${result.succeeded} entries deleted`);
 *   },
 *   onError: (result) => {
 *     console.error(`${result.failed} entries failed to delete`);
 *   },
 *   onComplete: (result) => {
 *     setSelectedIds([]);
 *   },
 * });
 * ```
 *
 * @example With custom toast
 * ```tsx
 * const { mutate: bulkDelete } = useBulkDeleteEntries({
 *   collectionSlug: 'posts',
 *   showToast: false,
 *   onComplete: (result) => {
 *     if (result.failed > 0) {
 *       toast.custom(<PartialFailureToast result={result} />);
 *     } else {
 *       toast.custom(<SuccessToast count={result.succeeded} />);
 *     }
 *   },
 * });
 * ```
 *
 * @see useBulkMutation - Generic bulk mutation hook
 * @see useBulkDeleteCollections - Similar pattern for collections
 */
export function useBulkDeleteEntries({
  collectionSlug,
  onComplete,
  onSuccess,
  onError,
  showToast = true,
}: UseBulkDeleteEntriesOptions) {
  const queryClient = useQueryClient();

  return useBulkMutation<string, Entry, Error, void>({
    mutationFn: async (entryId: string) => {
      return await entryApi.delete(collectionSlug, entryId);
    },
    defaultOptions: {
      onComplete: result => {
        // Invalidate entry queries
        queryClient.invalidateQueries({
          queryKey: entryKeys.listsByCollection(collectionSlug),
        });
        queryClient.invalidateQueries({
          queryKey: entryKeys.counts(),
        });

        // Remove deleted entries from cache
        result.succeededIds.forEach(id => {
          queryClient.removeQueries({
            queryKey: entryKeys.detail(collectionSlug, id),
          });
        });

        if (showToast) {
          if (result.failed > 0) {
            toast.warning(
              `Deleted ${result.succeeded} entries, ${result.failed} failed`
            );
          } else {
            toast.success(`Deleted ${result.succeeded} entries`);
          }
        }

        onComplete?.({ succeeded: result.succeeded, failed: result.failed });
      },
      onSuccess: result => {
        onSuccess?.({ succeeded: result.succeeded, failed: result.failed });
      },
      onError: result => {
        onError?.({ succeeded: result.succeeded, failed: result.failed });
      },
    },
  });
}

/**
 * Options for useBulkUpdateEntries hook
 */
export interface UseBulkUpdateEntriesOptions {
  /** The collection slug/name containing the entries */
  collectionSlug: string;
  /** Callback fired when operation completes (success or partial failure) */
  onComplete?: (result: { succeeded: number; failed: number }) => void;
  /** Callback fired when at least one entry was updated */
  onSuccess?: (result: { succeeded: number; failed: number }) => void;
  /** Callback fired when at least one update failed */
  onError?: (result: { succeeded: number; failed: number }) => void;
  /** Whether to show toast notifications (default: true) */
  showToast?: boolean;
}

/**
 * useBulkUpdateEntries - Bulk mutation hook for updating multiple entries
 *
 * Executes parallel update operations for multiple entries using Promise.allSettled().
 * All entries are updated with the same data (passed as context).
 * Allows partial failures where some updates succeed while others fail.
 *
 * ## Features
 * - Parallel execution with Promise.allSettled()
 * - Partial failure handling
 * - Apply same update to multiple entries
 * - Automatic cache invalidation
 * - Toast notifications with result summary
 *
 * ## Result Structure
 * Same as useBulkDeleteEntries
 *
 * ## Cache Invalidation
 * Automatically invalidates:
 * - `["entries", "list", collectionSlug]` - Entry list queries
 *
 * @param options - Hook options including collectionSlug and callbacks
 * @returns Bulk mutation interface with mutate function, isPending state, and result
 *
 * @example Bulk update status
 * ```tsx
 * function BulkStatusUpdate({ selectedIds }: { selectedIds: string[] }) {
 *   const { mutate: bulkUpdate, isPending } = useBulkUpdateEntries({
 *     collectionSlug: 'posts',
 *   });
 *
 *   const publishAll = () => {
 *     bulkUpdate(selectedIds, { status: 'published' });
 *   };
 *
 *   const archiveAll = () => {
 *     bulkUpdate(selectedIds, { status: 'archived' });
 *   };
 *
 *   return (
 *     <div>
 *       <Button onClick={publishAll} disabled={isPending}>
 *         Publish Selected
 *       </Button>
 *       <Button onClick={archiveAll} disabled={isPending}>
 *         Archive Selected
 *       </Button>
 *     </div>
 *   );
 * }
 * ```
 *
 * @example With callbacks
 * ```tsx
 * const { mutate: bulkUpdate } = useBulkUpdateEntries({
 *   collectionSlug: 'posts',
 *   onSuccess: (result) => {
 *     console.log(`${result.succeeded} entries updated`);
 *   },
 * });
 *
 * // Update all selected entries to published
 * bulkUpdate(selectedIds, { status: 'published' });
 * ```
 *
 * @see useBulkMutation - Generic bulk mutation hook
 * @see useBulkUpdateCollections - Similar pattern for collections
 */
export function useBulkUpdateEntries({
  collectionSlug,
  onComplete,
  onSuccess,
  onError,
  showToast = true,
}: UseBulkUpdateEntriesOptions) {
  const queryClient = useQueryClient();

  return useBulkMutation<string, Entry, Error, UpdateEntryPayload>({
    mutationFn: async (entryId: string, updates: UpdateEntryPayload) => {
      return await entryApi.update(collectionSlug, entryId, updates);
    },
    defaultOptions: {
      onComplete: result => {
        // Invalidate entry list queries
        queryClient.invalidateQueries({
          queryKey: entryKeys.listsByCollection(collectionSlug),
        });

        // Invalidate updated entries
        result.succeededIds.forEach(id => {
          queryClient.invalidateQueries({
            queryKey: entryKeys.detail(collectionSlug, id),
          });
        });

        if (showToast) {
          if (result.failed > 0) {
            toast.warning(
              `Updated ${result.succeeded} entries, ${result.failed} failed`
            );
          } else {
            toast.success(`Updated ${result.succeeded} entries`);
          }
        }

        onComplete?.({ succeeded: result.succeeded, failed: result.failed });
      },
      onSuccess: result => {
        onSuccess?.({ succeeded: result.succeeded, failed: result.failed });
      },
      onError: result => {
        onError?.({ succeeded: result.succeeded, failed: result.failed });
      },
    },
  });
}
