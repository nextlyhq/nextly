/**
 * useCreateEntry Hook
 *
 * TanStack Query mutation hook for creating new entries in a collection.
 * Follows the established pattern from useCreateCollection with proper
 * cache invalidation and toast notifications.
 *
 * ## Cache Invalidation
 * Automatically invalidates `["entries", "list", collectionSlug]` query keys on success,
 * causing entry list queries to refetch.
 *
 * ## Server Error Mapping
 * When `setError` is provided, server validation errors are automatically mapped
 * to form fields, enabling inline error display. Generic toast is only shown when
 * errors cannot be mapped to specific fields.
 *
 * @example
 * ```tsx
 * const { mutate: createEntry, isPending } = useCreateEntry({
 *   collectionSlug: 'posts',
 * });
 *
 * createEntry({ title: 'New Post', content: 'Hello World' });
 * ```
 *
 * @example With form error mapping
 * ```tsx
 * const form = useForm();
 * const { mutate: createEntry } = useCreateEntry({
 *   collectionSlug: 'posts',
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
  type CreateEntryPayload,
} from "@admin/services/entryApi";
import type { Entry } from "@admin/types/collection";

/**
 * Options for useCreateEntry hook
 */
export interface UseCreateEntryOptions<
  T = Entry,
  TFieldValues extends FieldValues = FieldValues,
> {
  /** The collection slug/name to create entry in */
  collectionSlug: string;
  /** Callback fired on successful creation */
  onSuccess?: (data: T) => void;
  /** Callback fired on error */
  onError?: (error: Error) => void;
  /** Whether to show toast notifications (default: true) */
  showToast?: boolean;
  /**
   * React Hook Form setError function for mapping server validation errors to form fields.
   * When provided, field-level errors from the server will be set on corresponding form fields.
   */
  setError?: UseFormSetError<TFieldValues>;
}

/**
 * useCreateEntry - Mutation hook for creating a new entry
 *
 * Creates a new entry in a collection and automatically invalidates the entry list cache.
 * Returns the created entry data from the API.
 *
 * ## Features
 * - Automatic cache invalidation for entry lists
 * - Toast notifications for success/error (configurable)
 * - Loading state management (isPending)
 * - TypeScript type safety with generic entry type
 * - Callbacks for success/error handling
 *
 * ## Cache Invalidation
 * Automatically invalidates:
 * - `["entries", "list", collectionSlug]` - Entry list queries for the collection
 * - `["entries", "count", collectionSlug]` - Entry count queries for the collection
 *
 * @template T - The entry type (defaults to Entry)
 * @param options - Hook options including collectionSlug and callbacks
 * @returns TanStack Mutation result with mutate function and states
 *
 * @example Basic usage
 * ```tsx
 * function CreatePostForm() {
 *   const { mutate: createPost, isPending } = useCreateEntry({
 *     collectionSlug: 'posts',
 *   });
 *
 *   const handleSubmit = (data: CreatePostData) => {
 *     createPost(data);
 *   };
 *
 *   return (
 *     <form onSubmit={handleSubmit}>
 *       <Button type="submit" disabled={isPending}>
 *         {isPending ? 'Creating...' : 'Create Post'}
 *       </Button>
 *     </form>
 *   );
 * }
 * ```
 *
 * @example With callbacks and navigation
 * ```tsx
 * function CreatePostPage() {
 *   const navigate = useNavigate();
 *   const { mutate: createPost, isPending } = useCreateEntry({
 *     collectionSlug: 'posts',
 *     onSuccess: (post) => {
 *       navigate(`/posts/${post.id}`);
 *     },
 *     onError: (error) => {
 *       console.error('Failed to create post:', error);
 *     },
 *   });
 *
 *   return <PostForm onSubmit={createPost} loading={isPending} />;
 * }
 * ```
 *
 * @example With custom entry type
 * ```tsx
 * interface Post extends Entry {
 *   title: string;
 *   content: string;
 * }
 *
 * function TypedCreatePost() {
 *   const { mutate: createPost } = useCreateEntry<Post>({
 *     collectionSlug: 'posts',
 *     onSuccess: (post) => {
 *       // post is typed as Post
 *       console.log('Created:', post.title);
 *     },
 *   });
 *
 *   return <PostForm onSubmit={createPost} />;
 * }
 * ```
 *
 * @example Without toast notifications
 * ```tsx
 * const { mutate } = useCreateEntry({
 *   collectionSlug: 'posts',
 *   showToast: false, // Handle notifications manually
 *   onSuccess: (post) => {
 *     toast.custom(<CustomSuccessToast post={post} />);
 *   },
 * });
 * ```
 *
 * @see https://tanstack.com/query/v5/docs/react/reference/useMutation
 */
export function useCreateEntry<
  T = Entry,
  TFieldValues extends FieldValues = FieldValues,
>({
  collectionSlug,
  onSuccess,
  onError,
  showToast = true,
  setError,
}: UseCreateEntryOptions<T, TFieldValues>) {
  const queryClient = useQueryClient();

  return useMutation<T, Error, CreateEntryPayload>({
    mutationFn: async (data: CreateEntryPayload) => {
      const result = await entryApi.create(collectionSlug, data);
      return result as T;
    },

    onSuccess: data => {
      // Invalidate entry list queries for this collection
      void queryClient.invalidateQueries({
        queryKey: entryKeys.listsByCollection(collectionSlug),
      });

      // Invalidate count queries for this collection
      void queryClient.invalidateQueries({
        queryKey: entryKeys.counts(),
      });

      // Invalidate dashboard caches so stats/recent-entries refresh immediately
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });

      if (showToast) {
        toast.success("Entry created successfully");
      }

      onSuccess?.(data);
    },

    onError: (error: Error) => {
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
          "Failed to create entry";
        toast.error(message);
      }

      onError?.(error);
    },
  });
}
