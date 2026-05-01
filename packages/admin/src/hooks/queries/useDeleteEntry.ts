"use client";

/**
 * useDeleteEntry Hook
 *
 * TanStack Query mutation hook for deleting entries from a collection.
 * Follows the established pattern from useDeleteCollection with proper
 * cache invalidation and toast notifications.
 *
 * ## Cache Invalidation
 * Automatically invalidates:
 * - `["entries", "list", collectionSlug]` - Entry list queries
 * - `["entries", "count", collectionSlug]` - Entry count queries
 *
 * @example
 * ```tsx
 * const { mutate: deleteEntry, isPending } = useDeleteEntry({
 *   collectionSlug: 'posts',
 * });
 *
 * deleteEntry('abc123');
 * ```
 *
 * @see hooks/queries/useCollections.ts - Reference pattern for mutation hooks
 * @see services/entryApi.ts - Entry API client
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { toast } from "@admin/components/ui";
import { entryApi, entryKeys } from "@admin/services/entryApi";
import type { Entry } from "@admin/types/collection";

/**
 * Options for useDeleteEntry hook
 */
export interface UseDeleteEntryOptions<T = Entry> {
  /** The collection slug/name containing the entry */
  collectionSlug: string;
  /** Callback fired on successful deletion */
  onSuccess?: (data: T) => void;
  /** Callback fired on error */
  onError?: (error: Error) => void;
  /** Whether to show toast notifications (default: true) */
  showToast?: boolean;
}

/**
 * useDeleteEntry - Mutation hook for deleting an entry
 *
 * Deletes an entry from a collection and automatically invalidates
 * the entry list and count caches. Returns the deleted entry data.
 *
 * ## Features
 * - Automatic cache invalidation for entry lists and counts
 * - Toast notifications for success/error (configurable)
 * - Loading state management (isPending)
 * - TypeScript type safety with generic entry type
 * - Callbacks for success/error handling
 *
 * ## Cache Invalidation
 * On success, automatically invalidates:
 * - `["entries", "list", collectionSlug]` - Entry list queries
 * - `["entries", "count", collectionSlug]` - Entry count queries
 *
 * @template T - The entry type (defaults to Entry)
 * @param options - Hook options including collectionSlug and callbacks
 * @returns TanStack Mutation result with mutate function and states
 *
 * @example Basic usage
 * ```tsx
 * function DeletePostButton({ postId }: { postId: string }) {
 *   const { mutate: deletePost, isPending } = useDeleteEntry({
 *     collectionSlug: 'posts',
 *   });
 *
 *   const handleDelete = () => {
 *     if (confirm('Are you sure you want to delete this post?')) {
 *       deletePost(postId);
 *     }
 *   };
 *
 *   return (
 *     <Button variant="destructive" onClick={handleDelete} disabled={isPending}>
 *       {isPending ? 'Deleting...' : 'Delete'}
 *     </Button>
 *   );
 * }
 * ```
 *
 * @example With callbacks and navigation
 * ```tsx
 * function PostActions({ postId }: { postId: string }) {
 *   const navigate = useNavigate();
 *   const { mutate: deletePost } = useDeleteEntry({
 *     collectionSlug: 'posts',
 *     onSuccess: () => {
 *       navigate('/posts');
 *     },
 *     onError: (error) => {
 *       console.error('Delete failed:', error);
 *     },
 *   });
 *
 *   return <DeleteButton onClick={() => deletePost(postId)} />;
 * }
 * ```
 *
 * @example With confirmation dialog
 * ```tsx
 * function PostRowActions({ postId }: { postId: string }) {
 *   const [showConfirm, setShowConfirm] = useState(false);
 *   const { mutate: deletePost, isPending } = useDeleteEntry({
 *     collectionSlug: 'posts',
 *     onSuccess: () => setShowConfirm(false),
 *   });
 *
 *   return (
 *     <>
 *       <Button onClick={() => setShowConfirm(true)}>Delete</Button>
 *       <ConfirmDialog
 *         open={showConfirm}
 *         onConfirm={() => deletePost(postId)}
 *         onCancel={() => setShowConfirm(false)}
 *         loading={isPending}
 *       />
 *     </>
 *   );
 * }
 * ```
 *
 * @example Without toast notifications
 * ```tsx
 * const { mutate: deletePost } = useDeleteEntry({
 *   collectionSlug: 'posts',
 *   showToast: false,
 *   onSuccess: () => {
 *     toast.custom(<CustomDeletedToast />);
 *   },
 * });
 * ```
 *
 * @see https://tanstack.com/query/v5/docs/react/reference/useMutation
 */
export function useDeleteEntry<T = Entry>({
  collectionSlug,
  onSuccess,
  onError,
  showToast = true,
}: UseDeleteEntryOptions<T>) {
  const queryClient = useQueryClient();

  return useMutation<T, Error, string>({
    mutationFn: async (entryId: string) => {
      const result = await entryApi.delete(collectionSlug, entryId);
      return result as T;
    },

    onSuccess: (data, entryId) => {
      // Invalidate entry list queries for this collection
      void queryClient.invalidateQueries({
        queryKey: entryKeys.listsByCollection(collectionSlug),
      });

      // Invalidate count queries
      void queryClient.invalidateQueries({
        queryKey: entryKeys.counts(),
      });

      // Remove the specific entry from cache
      queryClient.removeQueries({
        queryKey: entryKeys.detail(collectionSlug, entryId),
      });

      // Invalidate dashboard caches so stats/recent-entries refresh immediately
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });

      if (showToast) {
        toast.success("Entry deleted successfully");
      }

      onSuccess?.(data);
    },

    onError: (error: Error) => {
      if (showToast) {
        toast.error(`Failed to delete entry: ${error.message}`);
      }

      onError?.(error);
    },
  });
}
