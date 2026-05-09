/**
 * useEntry Hook
 *
 * TanStack Query hook for fetching a single entry by ID from a collection.
 * Follows the established pattern from useCollection with proper
 * cache management.
 *
 * ## Query Keys
 *
 * - `["entries", "detail", collectionSlug]` - Base key for collection entry details
 * - `["entries", "detail", collectionSlug, entryId]` - Specific entry detail
 *
 * @example
 * ```ts
 * // Invalidate specific entry
 * queryClient.invalidateQueries({ queryKey: entryKeys.detail('posts', 'abc123') });
 *
 * // Invalidate all entries in a collection
 * queryClient.invalidateQueries({ queryKey: entryKeys.detailsByCollection('posts') });
 * ```
 *
 * @see hooks/queries/useCollections.ts - Reference pattern for query hooks
 * @see services/entryApi.ts - Entry API client
 */

import { useQuery, type UseQueryOptions } from "@tanstack/react-query";

import { entryApi, entryKeys, type FindParams } from "@admin/services/entryApi";
import type { Entry } from "@admin/types/collection";

/**
 * Options for useEntry hook
 */
export interface UseEntryOptions<T = Entry> {
  /** The collection slug/name to fetch the entry from */
  collectionSlug: string;
  /** The entry ID to fetch (optional - query won't run without it) */
  entryId?: string;
  /** Whether the query should execute (default: true when entryId is provided) */
  enabled?: boolean;
  /** Depth for relationship population (0-10) */
  depth?: number;
  /** Locale for localized fields */
  locale?: string;
  /** Fallback locale when translation is missing */
  fallbackLocale?: string;
  /** Whether to include draft content */
  draft?: boolean;
  /** Additional TanStack Query options */
  queryOptions?: Omit<
    UseQueryOptions<T, Error>,
    "queryKey" | "queryFn" | "enabled"
  >;
}

/**
 * useEntry - Query hook for fetching a single entry by ID
 *
 * Fetches a single entry's details from a collection by its unique ID.
 * Only runs when both collectionSlug and entryId are provided.
 * Automatically caches result for fast navigation.
 *
 * ## Features
 * - Conditional execution (only runs when entryId exists)
 * - Automatic caching with 1 minute staleTime
 * - Relationship depth control (depth parameter)
 * - Localization support (locale, fallbackLocale)
 * - Draft content support
 * - TypeScript type safety with generic entry type
 *
 * ## Query Key Structure
 * `["entries", "detail", collectionSlug, entryId]` - Hierarchical key for single entry
 *
 * @template T - The entry type (defaults to Entry)
 * @param options - Hook options including collectionSlug and entryId
 * @returns TanStack Query result with entry data, loading state, and error state
 *
 * @example Basic usage
 * ```tsx
 * function PostDetail({ postId }: { postId?: string }) {
 *   const { data: post, isLoading, error } = useEntry({
 *     collectionSlug: 'posts',
 *     entryId: postId,
 *   });
 *
 *   if (!postId) return <div>No post selected</div>;
 *   if (isLoading) return <Skeleton />;
 *   if (error) return <Alert>Error: {error.message}</Alert>;
 *   if (!post) return <div>Post not found</div>;
 *
 *   return (
 *     <article>
 *       <h1>{post.title}</h1>
 *       <div>{post.content}</div>
 *     </article>
 *   );
 * }
 * ```
 *
 * @example With relationship depth
 * ```tsx
 * function PostWithAuthor({ postId }: { postId: string }) {
 *   const { data: post } = useEntry({
 *     collectionSlug: 'posts',
 *     entryId: postId,
 *     depth: 2, // Populate author and author's role
 *   });
 *
 *   return (
 *     <article>
 *       <h1>{post?.title}</h1>
 *       <span>By: {post?.author?.name}</span>
 *     </article>
 *   );
 * }
 * ```
 *
 * @example With custom entry type
 * ```tsx
 * interface Post extends Entry {
 *   title: string;
 *   content: string;
 *   author: { id: string; name: string };
 * }
 *
 * function TypedPostDetail({ postId }: { postId: string }) {
 *   const { data: post } = useEntry<Post>({
 *     collectionSlug: 'posts',
 *     entryId: postId,
 *   });
 *
 *   // post is typed as Post | undefined
 *   return <h1>{post?.title}</h1>;
 * }
 * ```
 *
 * @example Edit form with prefetching
 * ```tsx
 * function EditPostPage({ postId }: { postId: string }) {
 *   const { data: post, isLoading } = useEntry({
 *     collectionSlug: 'posts',
 *     entryId: postId,
 *   });
 *
 *   if (isLoading) return <FormSkeleton />;
 *   if (!post) return <NotFound />;
 *
 *   return <PostForm defaultValues={post} />;
 * }
 * ```
 *
 * @see https://tanstack.com/query/v5/docs/react/reference/useQuery
 */
export function useEntry<T = Entry>({
  collectionSlug,
  entryId,
  enabled = true,
  depth,
  locale,
  fallbackLocale,
  draft,
  queryOptions,
}: UseEntryOptions<T>) {
  return useQuery<T, Error>({
    queryKey: entryId
      ? entryKeys.detail(collectionSlug, entryId)
      : entryKeys.detailsByCollection(collectionSlug),
    queryFn: async () => {
      // Safety check: This shouldn't execute due to `enabled` flag,
      // but provides defense against logic changes or direct queryFn calls
      if (!entryId) {
        throw new Error("Entry ID is required");
      }

      const options: Pick<
        FindParams,
        "depth" | "locale" | "fallbackLocale" | "draft"
      > = {};
      if (depth !== undefined) options.depth = depth;
      if (locale) options.locale = locale;
      if (fallbackLocale) options.fallbackLocale = fallbackLocale;
      if (draft !== undefined) options.draft = draft;

      // Type assertion needed because entryApi.findByID returns Entry
      // but we want to support generic entry types
      const result = await entryApi.findByID(
        collectionSlug,
        entryId,
        Object.keys(options).length > 0 ? options : undefined
      );
      return result as T;
    },
    enabled: enabled && !!collectionSlug && !!entryId,
    staleTime: 60_000, // 1 minute
    ...queryOptions,
  });
}
