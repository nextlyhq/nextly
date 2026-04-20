/**
 * useEntries Hook
 *
 * TanStack Query hook for fetching paginated entry lists from a collection.
 * Follows the established pattern from useCollections.ts with proper
 * cache invalidation and paginated response format.
 *
 * ## Query Keys
 *
 * - `["entries", "list", collectionSlug]` - Base key for collection entries
 * - `["entries", "list", collectionSlug, params]` - Filtered/sorted entries list
 *
 * @example
 * ```ts
 * // Invalidate all entries for a collection
 * queryClient.invalidateQueries({ queryKey: entryKeys.listsByCollection('posts') });
 *
 * // Invalidate specific list with filters
 * queryClient.invalidateQueries({ queryKey: entryKeys.list('posts', { page: 1 }) });
 * ```
 *
 * @see hooks/queries/useCollections.ts - Reference pattern for query hooks
 * @see services/entryApi.ts - Entry API client
 */

import {
  useQuery,
  keepPreviousData,
  type UseQueryOptions,
} from "@tanstack/react-query";

import {
  entryApi,
  entryKeys,
  type FindParams,
  type PaginatedDocs,
} from "@admin/services/entryApi";
import type { Entry } from "@admin/types/collection";

/**
 * Options for useEntries hook
 */
export interface UseEntriesOptions<T = Entry> {
  /** The collection slug/name to fetch entries from */
  collectionSlug: string;
  /** Query parameters */
  params?: FindParams;
  /** Whether the query should execute (default: true) */
  enabled?: boolean;
  /** Additional TanStack Query options */
  queryOptions?: Omit<
    UseQueryOptions<PaginatedDocs<T>, Error>,
    "queryKey" | "queryFn" | "enabled"
  >;
}

/**
 * useEntries - Query hook for fetching paginated entry list
 *
 * Fetches entries from a collection with pagination, search, and sorting support.
 * Automatically caches results and provides loading/error states.
 * Uses paginated response format with `docs`, `totalDocs`, `hasNextPage`, etc.
 *
 * ## Features
 * - Automatic caching with 30 second staleTime
 * - Pagination support (page, limit)
 * - Search support (search parameter)
 * - Sorting support (sort parameter: `-field` for desc)
 * - Filter support (where clause with Nextly query syntax)
 * - Relationship depth control (depth parameter)
 * - Previous data preservation during refetch (keepPreviousData)
 * - TypeScript type safety with generic entry type
 *
 * ## Query Key Structure
 * `["entries", "list", collectionSlug, params]` - Hierarchical key for proper cache invalidation
 *
 * @template T - The entry type (defaults to Entry)
 * @param options - Hook options including collectionSlug and query params
 * @returns TanStack Query result with paginated entries, loading state, and error state
 *
 * @example Basic usage
 * ```tsx
 * function PostList() {
 *   const { data, isLoading, error } = useEntries({
 *     collectionSlug: 'posts',
 *     params: { page: 1, limit: 10 },
 *   });
 *
 *   if (isLoading) return <Skeleton />;
 *   if (error) return <Alert>Error: {error.message}</Alert>;
 *
 *   return (
 *     <div>
 *       {data?.docs.map(post => (
 *         <PostCard key={post.id} post={post} />
 *       ))}
 *       <Pagination
 *         page={data?.page}
 *         totalPages={data?.totalPages}
 *         hasNextPage={data?.hasNextPage}
 *         hasPrevPage={data?.hasPrevPage}
 *       />
 *     </div>
 *   );
 * }
 * ```
 *
 * @example With sorting and filtering
 * ```tsx
 * function PublishedPosts() {
 *   const { data } = useEntries({
 *     collectionSlug: 'posts',
 *     params: {
 *       page: 1,
 *       limit: 20,
 *       sort: '-createdAt', // Descending by createdAt
 *       where: {
 *         status: { equals: 'published' },
 *       },
 *       depth: 2, // Populate relationships 2 levels deep
 *     },
 *   });
 *
 *   return <PostGrid posts={data?.docs ?? []} />;
 * }
 * ```
 *
 * @example With search
 * ```tsx
 * function SearchablePostList({ searchQuery }: { searchQuery: string }) {
 *   const { data, isLoading } = useEntries({
 *     collectionSlug: 'posts',
 *     params: {
 *       search: searchQuery,
 *       limit: 10,
 *     },
 *     enabled: searchQuery.length >= 2, // Only search with 2+ characters
 *   });
 *
 *   return <SearchResults results={data?.docs} loading={isLoading} />;
 * }
 * ```
 *
 * @example With custom entry type
 * ```tsx
 * interface Post extends Entry {
 *   title: string;
 *   content: string;
 *   status: 'draft' | 'published';
 * }
 *
 * function TypedPostList() {
 *   const { data } = useEntries<Post>({
 *     collectionSlug: 'posts',
 *   });
 *
 *   // data.docs is typed as Post[]
 *   return data?.docs.map(post => <h1>{post.title}</h1>);
 * }
 * ```
 *
 * @see https://tanstack.com/query/v5/docs/react/reference/useQuery
 */
export function useEntries<T = Entry>({
  collectionSlug,
  params,
  enabled = true,
  queryOptions,
}: UseEntriesOptions<T>) {
  return useQuery<PaginatedDocs<T>, Error>({
    queryKey: entryKeys.list(collectionSlug, params),
    queryFn: async () => {
      // Type assertion needed because entryApi.find returns PaginatedDocs<Entry>
      // but we want to support generic entry types
      const result = await entryApi.find(collectionSlug, params);
      return result as PaginatedDocs<T>;
    },
    enabled: enabled && !!collectionSlug,
    placeholderData: keepPreviousData,
    staleTime: 30_000, // 30 seconds
    ...queryOptions,
  });
}

/**
 * useEntryCount - Query hook for fetching entry count
 *
 * Fetches the count of entries in a collection, optionally filtered by a where clause.
 * Useful for displaying totals without fetching full entry data.
 *
 * @param collectionSlug - The collection slug/name
 * @param where - Optional where clause to filter counted entries
 * @param enabled - Whether the query should execute (default: true)
 * @returns TanStack Query result with count data
 *
 * @example
 * ```tsx
 * function PostStats() {
 *   const { data: total } = useEntryCount('posts');
 *   const { data: published } = useEntryCount('posts', {
 *     status: { equals: 'published' },
 *   });
 *
 *   return (
 *     <div>
 *       <span>Total: {total?.totalDocs}</span>
 *       <span>Published: {published?.totalDocs}</span>
 *     </div>
 *   );
 * }
 * ```
 */
export function useEntryCount(
  collectionSlug: string,
  where?: Record<string, unknown>,
  enabled = true
) {
  return useQuery({
    queryKey: entryKeys.count(collectionSlug, where),
    queryFn: () => entryApi.count(collectionSlug, { where }),
    enabled: enabled && !!collectionSlug,
    staleTime: 60_000, // 1 minute
  });
}
