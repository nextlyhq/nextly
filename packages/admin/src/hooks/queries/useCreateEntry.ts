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

import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import type { UseFormSetError, FieldValues } from "react-hook-form";

import { toast } from "@admin/components/ui/toaster";
import {
  parseServerErrorMessage,
  placeServerRefusal,
} from "@admin/lib/errors/error-mapping";
import {
  toastMutationResult,
  type MutationResult,
} from "@admin/lib/mutation-warnings";
import {
  entryApi,
  entryKeys,
  type CreateEntryPayload,
} from "@admin/services/entryApi";
import type { Entry } from "@admin/types/collection";

import { drawnFieldPath } from "./drawn-field-path";
import { refreshRemovedFromCodeSchema } from "./removed-from-code-refusal";

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
  /**
   * The entry's fields: a refusal's reason is put on a field only where the
   * form draws it, and said by the toast otherwise. Every path, if absent.
   */
  fields?: readonly { name?: string }[];
  /**
   * Reads the form's value at a path, for the conditions that decide whether
   * a field is drawn when a refusal arrives.
   */
  valueAt?: (path: string) => unknown;
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
  fields,
  valueAt,
}: UseCreateEntryOptions<T, TFieldValues>): UseMutationResult<
  MutationResult<T>,
  Error,
  CreateEntryPayload,
  unknown
> {
  const queryClient = useQueryClient();

  // The mutation resolves to the whole envelope so the success path can report
  // what failed after the row committed; consumers still receive the entry.
  return useMutation<MutationResult<T>, Error, CreateEntryPayload>({
    mutationFn: async (data: CreateEntryPayload) => {
      const result = await entryApi.create(collectionSlug, data);
      return result as MutationResult<T>;
    },

    onSuccess: result => {
      const data = result.item;
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
        // The row IS written even when a post-commit hook failed, so this stays
        // a success and names the follow-up failure beside it.
        toastMutationResult("Entry created successfully", result.warnings);
      }

      onSuccess?.(data);
    },

    onError: (error: Error) => {
      // A refusal because the collection was removed from code reads its
      // schema again, so a screen opened before the removal turns read-only.
      refreshRemovedFromCodeSchema(queryClient, error);

      // Each reason on the field it names, where the form draws that field;
      // the form keeps the author's values. Reasons no field can show are
      // said by the toast below instead.
      const placed = placeServerRefusal(error, setError, {
        isFormField: drawnFieldPath(fields, valueAt),
      });

      // Show a toast only for what the form's fields do not already say.
      if (showToast && !placed.handled) {
        const message =
          placed.toastMessage ??
          (parseServerErrorMessage(error) ||
            error.message ||
            "Failed to create entry");
        toast.error(message);
      }

      onError?.(error);
    },
  });
}
