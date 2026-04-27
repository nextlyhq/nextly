/**
 * useUpdateEntry Hook
 *
 * TanStack Query mutation hook for updating entries in a collection.
 * Includes optimistic updates for instant UI feedback with automatic
 * rollback on error.
 *
 * ## Cache Invalidation
 * Automatically invalidates:
 * - `["entries", "list", collectionSlug]` - Entry list queries
 * - `["entries", "detail", collectionSlug, entryId]` - Specific entry detail
 *
 * ## Optimistic Updates
 * The hook implements optimistic updates:
 * 1. Immediately updates the cached entry with new data
 * 2. If the mutation fails, rolls back to the previous data
 * 3. On success, invalidates queries to ensure fresh data
 *
 * ## Server Error Mapping
 * When `setError` is provided, server validation errors are automatically mapped
 * to form fields, enabling inline error display. Generic toast is only shown when
 * errors cannot be mapped to specific fields.
 *
 * @example
 * ```tsx
 * const { mutate: updateEntry, isPending } = useUpdateEntry({
 *   collectionSlug: 'posts',
 *   entryId: 'abc123',
 * });
 *
 * updateEntry({ title: 'Updated Title' });
 * ```
 *
 * @example With form error mapping
 * ```tsx
 * const form = useForm();
 * const { mutate: updateEntry } = useUpdateEntry({
 *   collectionSlug: 'posts',
 *   entryId: 'abc123',
 *   setError: form.setError,
 * });
 * ```
 *
 * @see hooks/queries/useCollections.ts - Reference pattern for mutation hooks
 * @see services/entryApi.ts - Entry API client
 * @see lib/errors/error-mapping.ts - Server error mapping utilities
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { UseFormSetError, FieldValues } from "react-hook-form";

import { toast } from "@admin/components/ui";
import {
  createServerErrorHandler,
  parseServerErrorMessage,
} from "@admin/lib/errors/error-mapping";
import {
  entryApi,
  entryKeys,
  type UpdateEntryPayload,
} from "@admin/services/entryApi";
import type { Entry } from "@admin/types/collection";

/**
 * Options for useUpdateEntry hook
 */
export interface UseUpdateEntryOptions<
  T = Entry,
  TFieldValues extends FieldValues = FieldValues,
> {
  /** The collection slug/name containing the entry */
  collectionSlug: string;
  /** The ID of the entry to update */
  entryId: string;
  /** Callback fired on successful update */
  onSuccess?: (data: T) => void;
  /** Callback fired on error */
  onError?: (error: Error) => void;
  /** Whether to show toast notifications (default: true) */
  showToast?: boolean;
  /** Whether to use optimistic updates (default: true) */
  optimistic?: boolean;
  /**
   * React Hook Form setError function for mapping server validation errors to form fields.
   * When provided, field-level errors from the server will be set on corresponding form fields.
   */
  setError?: UseFormSetError<TFieldValues>;
}

/**
 * Context for optimistic update rollback
 */
interface UpdateContext<T> {
  previousEntry: T | undefined;
}

/**
 * useUpdateEntry - Mutation hook for updating an existing entry
 *
 * Updates an entry in a collection with optimistic UI updates.
 * The UI is immediately updated with the new data, providing instant
 * feedback. If the mutation fails, the changes are rolled back.
 *
 * ## Features
 * - Optimistic updates for instant UI feedback (configurable)
 * - Automatic rollback on error
 * - Cache invalidation on success
 * - Toast notifications for success/error (configurable)
 * - Loading state management (isPending)
 * - TypeScript type safety with generic entry type
 *
 * ## Optimistic Update Flow
 * 1. Cancel any in-flight queries for the entry
 * 2. Snapshot the current entry data
 * 3. Immediately update the cache with new data
 * 4. Execute the API call
 * 5. On error: Rollback to snapshot
 * 6. On success: Invalidate queries for fresh data
 *
 * ## Cache Invalidation
 * On success, automatically invalidates:
 * - `["entries", "list", collectionSlug]` - Entry list queries
 * - `["entries", "detail", collectionSlug, entryId]` - Entry detail query
 *
 * @template T - The entry type (defaults to Entry)
 * @param options - Hook options including collectionSlug, entryId, and callbacks
 * @returns TanStack Mutation result with mutate function and states
 *
 * @example Basic usage
 * ```tsx
 * function EditPostForm({ postId }: { postId: string }) {
 *   const { mutate: updatePost, isPending } = useUpdateEntry({
 *     collectionSlug: 'posts',
 *     entryId: postId,
 *   });
 *
 *   const handleSubmit = (data: UpdatePostData) => {
 *     updatePost(data);
 *   };
 *
 *   return (
 *     <form onSubmit={handleSubmit}>
 *       <Button type="submit" disabled={isPending}>
 *         {isPending ? 'Saving...' : 'Save Changes'}
 *       </Button>
 *     </form>
 *   );
 * }
 * ```
 *
 * @example With callbacks
 * ```tsx
 * function PostEditor({ postId }: { postId: string }) {
 *   const { mutate: updatePost } = useUpdateEntry({
 *     collectionSlug: 'posts',
 *     entryId: postId,
 *     onSuccess: (post) => {
 *       console.log('Post updated:', post);
 *     },
 *     onError: (error) => {
 *       console.error('Update failed:', error);
 *     },
 *   });
 *
 *   return <PostForm onSubmit={updatePost} />;
 * }
 * ```
 *
 * @example Without optimistic updates
 * ```tsx
 * const { mutate: updatePost } = useUpdateEntry({
 *   collectionSlug: 'posts',
 *   entryId: postId,
 *   optimistic: false, // Wait for server confirmation
 * });
 * ```
 *
 * @example Inline field update
 * ```tsx
 * function StatusToggle({ postId, status }: { postId: string; status: string }) {
 *   const { mutate: updatePost, isPending } = useUpdateEntry({
 *     collectionSlug: 'posts',
 *     entryId: postId,
 *   });
 *
 *   const toggleStatus = () => {
 *     updatePost({
 *       status: status === 'published' ? 'draft' : 'published',
 *     });
 *   };
 *
 *   return (
 *     <Button onClick={toggleStatus} disabled={isPending}>
 *       {status === 'published' ? 'Unpublish' : 'Publish'}
 *     </Button>
 *   );
 * }
 * ```
 *
 * @see https://tanstack.com/query/v5/docs/react/reference/useMutation
 * @see https://tanstack.com/query/v5/docs/react/guides/optimistic-updates
 */
export function useUpdateEntry<
  T = Entry,
  TFieldValues extends FieldValues = FieldValues,
>({
  collectionSlug,
  entryId,
  onSuccess,
  onError,
  showToast = true,
  optimistic = true,
  setError,
}: UseUpdateEntryOptions<T, TFieldValues>) {
  const queryClient = useQueryClient();

  return useMutation<T, Error, UpdateEntryPayload, UpdateContext<T>>({
    mutationFn: async (data: UpdateEntryPayload) => {
      const result = await entryApi.update(collectionSlug, entryId, data);
      return result as T;
    },

    // Optimistic update: immediately update cache before server responds
    onMutate: async newData => {
      if (!optimistic) {
        return { previousEntry: undefined };
      }

      // Cancel outgoing queries to prevent race conditions
      await queryClient.cancelQueries({
        queryKey: entryKeys.detail(collectionSlug, entryId),
      });

      // Snapshot previous value for rollback
      const previousEntry = queryClient.getQueryData<T>(
        entryKeys.detail(collectionSlug, entryId)
      );

      // Optimistically update cache
      if (previousEntry) {
        queryClient.setQueryData<T>(
          entryKeys.detail(collectionSlug, entryId),
          old => {
            if (!old) return old;
            return { ...old, ...newData } as T;
          }
        );
      }

      // Return context for rollback
      return { previousEntry };
    },

    // Rollback on error
    onError: (error: Error, _variables, context) => {
      // Rollback to previous value
      if (optimistic && context?.previousEntry) {
        queryClient.setQueryData(
          entryKeys.detail(collectionSlug, entryId),
          context.previousEntry
        );
      }

      // Try to map server errors to form fields
      let handledByForm = false;

      if (setError) {
        const errorHandler = createServerErrorHandler(setError);
        handledByForm = errorHandler(error);
      }

      // Show generic toast only if errors weren't mapped to form
      if (showToast && !handledByForm) {
        const message =
          parseServerErrorMessage(error) ||
          error.message ||
          "Failed to update entry";
        toast.error(message);
      }

      onError?.(error);
    },

    // On success, invalidate queries to ensure fresh data
    onSuccess: data => {
      // Invalidate entry list queries for this collection
      queryClient.invalidateQueries({
        queryKey: entryKeys.listsByCollection(collectionSlug),
      });

      // Invalidate this specific entry detail
      queryClient.invalidateQueries({
        queryKey: entryKeys.detail(collectionSlug, entryId),
      });

      // Invalidate dashboard caches so recent-entries refresh immediately
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });

      if (showToast) {
        toast.success("Entry updated successfully");
      }

      onSuccess?.(data);
    },
  });
}
