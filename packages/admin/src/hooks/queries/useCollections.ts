"use client";

/**
 * Collection Query Hooks
 *
 * TanStack Query hooks for collection operations (fetch, create, update, delete).
 * Follows the established pattern from useUsers.ts and useRoles.ts with proper
 * cache invalidation and error handling.
 *
 * ## Query Keys
 *
 * - `["collections"]` - All collections list (base key for invalidation)
 * - `["collections", params]` - Paginated/filtered/sorted collections list
 * - `["collections", collectionName]` - Single collection detail
 *
 * @example
 * ```ts
 * // Invalidate all collection queries
 * queryClient.invalidateQueries({ queryKey: collectionKeys.all() });
 *
 * // Invalidate specific collection
 * queryClient.invalidateQueries({ queryKey: collectionKeys.detail(collectionName) });
 * ```
 *
 * @see hooks/queries/useUsers.ts - Reference pattern for query hooks
 * @see hooks/queries/useRoles.ts - Similar CRUD pattern
 */

import type { TableParams, ListResponse } from "@nextlyhq/ui";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { toast } from "@admin/components/ui";
import { fetcher } from "@admin/lib/api/fetcher";
import type { MutationResponse } from "@admin/lib/api/response-types";
import { collectionApi } from "@admin/services/collectionApi";
import { schemaFileApi } from "@admin/services/schemaFileApi";
import type {
  Collection,
  CreateCollectionPayload,
  UpdateCollectionPayload,
} from "@admin/types/collection";
import type { ApiCollection } from "@admin/types/entities";
import type {
  BulkMutationItemResult,
  BulkMutationOptions,
  BulkMutationResult,
  UseBulkMutationReturn,
} from "@admin/types/hooks/bulk-mutation";

import { useBulkMutation } from "../useBulkMutation";

/**
 * Default table parameters for collection queries
 */
const defaultParams: TableParams = {
  pagination: { page: 0, pageSize: 10 },
  sorting: [],
  filters: {},
};

/**
 * The collections list the sidebar asks for, and the dashboard's Collections card with it.
 *
 * One request, so one cache entry: the shell asks first, as it draws its navigation, and the
 * card then finds the list already there. That is what lets the card draw its tiles the moment
 * it is placed, instead of growing from a placeholder when a list of its own arrives.
 */
export const NAV_COLLECTIONS_PARAMS: TableParams = {
  pagination: { page: 0, pageSize: 100 },
  sorting: [{ field: "name", direction: "asc" }],
  filters: {},
};

/**
 * Query Key Factory for Collections
 *
 * Creates stable, hierarchical query keys that prevent cache misses due to
 * object reference changes. Follows TanStack Query best practices.
 *
 * @see https://tanstack.com/query/v5/docs/react/guides/query-keys
 *
 * @example
 * ```ts
 * collectionKeys.all()           // ["collections"]
 * collectionKeys.lists()         // ["collections", "list"]
 * collectionKeys.list(params)    // ["collections", "list", { page: 0, ... }]
 * collectionKeys.details()       // ["collections", "detail"]
 * collectionKeys.detail("posts") // ["collections", "detail", "posts"]
 * ```
 */
export const collectionKeys = {
  /** Base key for all collection queries - invalidates everything */
  all: () => ["collections"] as const,

  /** Base key for collection list queries */
  lists: (): readonly ["collections", "list"] =>
    [...collectionKeys.all(), "list"] as const,

  /**
   * Stable query key for paginated/filtered collection lists.
   * Flattens params to prevent object reference issues.
   */
  list: (
    params: TableParams
  ): readonly [
    "collections",
    "list",
    {
      readonly page: number;
      readonly pageSize: number;
      readonly search: string;
      readonly sorting: string;
    },
  ] =>
    [
      ...collectionKeys.lists(),
      {
        page: params.pagination.page,
        pageSize: params.pagination.pageSize,
        search: params.filters?.search || "",
        sorting: JSON.stringify(params.sorting), // Stable string representation
      },
    ] as const,

  /** Base key for collection detail queries */
  details: (): readonly ["collections", "detail"] =>
    [...collectionKeys.all(), "detail"] as const,

  /** Query key for a single collection by name */
  detail: (name: string): readonly ["collections", "detail", string] =>
    [...collectionKeys.details(), name] as const,

  /** Base key for collection schema queries (enriched with component fields) */
  schemas: (): readonly ["collections", "schema"] =>
    [...collectionKeys.all(), "schema"] as const,

  /** Query key for a collection's enriched schema by name */
  schema: (name: string): readonly ["collections", "schema", string] =>
    [...collectionKeys.schemas(), name] as const,
};

/**
 * useCollections - Query hook for fetching paginated collection list
 *
 * Fetches collections with pagination, search, and sorting support.
 * Automatically caches results and provides loading/error states.
 *
 * ## Query Key Structure
 * `["collections", params]` - Hierarchical key for proper cache invalidation
 *
 * ## Features
 * - Automatic caching (5 minute staleTime from QueryClient config)
 * - Pagination support
 * - Search support (filters.search)
 * - Sorting support (sorting array)
 * - TypeScript type safety
 * - Optional query options (e.g., enabled for conditional queries)
 *
 * @param params - Table parameters for pagination, search, and sorting
 * @param options - Optional TanStack Query options (enabled, staleTime, etc.)
 * @returns TanStack Query result with collection data, loading state, and error state
 *
 * @example
 * ```tsx
 * function CollectionList() {
 *   const { data, isLoading, error } = useCollections({
 *     pagination: { page: 0, pageSize: 10 },
 *     filters: { search: 'users' },
 *     sorting: [{ field: 'name', direction: 'asc' }],
 *   });
 *
 *   if (isLoading) return <Skeleton />;
 *   if (error) return <Alert>Error: {error.message}</Alert>;
 *
 *   return (
 *     <div>
 *       {data.items.map(collection => (
 *         <CollectionCard key={collection.id} collection={collection} />
 *       ))}
 *       <Pagination meta={data.meta} />
 *     </div>
 *   );
 * }
 * ```
 *
 * @see https://tanstack.com/query/v5/docs/react/reference/useQuery
 */
export function useCollections(
  params?: TableParams,
  options?: Omit<
    UseQueryOptions<ListResponse<ApiCollection>, Error>,
    "queryKey" | "queryFn"
  >
): UseQueryResult<ListResponse<ApiCollection>, Error> {
  const effectiveParams = params || defaultParams;
  return useQuery<ListResponse<ApiCollection>, Error>({
    queryKey: collectionKeys.list(effectiveParams), // Use query key factory for stable keys
    queryFn: async () => {
      return await collectionApi.fetchCollections(effectiveParams);
    },
    ...options,
  });
}

/**
 * useCollection - Query hook for fetching a single collection by name
 *
 * Fetches a single collection's details by its unique name.
 * Only runs when collectionName is provided.
 * Automatically caches result for fast navigation.
 *
 * ## Query Key Structure
 * `["collections", collectionName]` - Hierarchical key for single collection
 *
 * ## Features
 * - Conditional execution (only runs when collectionName exists)
 * - Automatic caching (5 minute staleTime)
 * - TypeScript type safety
 * - Error handling built-in
 *
 * @param collectionName - The unique name of the collection to fetch (optional)
 * @returns TanStack Query result with collection data, loading state, and error state
 *
 * @example
 * ```tsx
 * function CollectionDetail({ collectionName }: { collectionName?: string }) {
 *   const { data: collection, isLoading, error } = useCollection(collectionName);
 *
 *   if (!collectionName) return <div>No collection selected</div>;
 *   if (isLoading) return <Skeleton />;
 *   if (error) return <Alert>Error: {error.message}</Alert>;
 *   if (!collection) return <div>Collection not found</div>;
 *
 *   return (
 *     <div>
 *       <h1>{collection.label}</h1>
 *       <p>{collection.description}</p>
 *       <Badge>{collection.tableName}</Badge>
 *     </div>
 *   );
 * }
 * ```
 *
 * @see https://tanstack.com/query/v5/docs/react/reference/useQuery
 */
export function useCollection(
  collectionName?: string,
  options?: Omit<UseQueryOptions<Collection, Error>, "queryKey" | "queryFn">
): UseQueryResult<Collection, Error> {
  return useQuery<Collection, Error>({
    queryKey: collectionName
      ? collectionKeys.detail(collectionName)
      : collectionKeys.details(), // Use query key factory
    queryFn: async () => {
      // Safety check: This shouldn't execute due to `enabled` flag,
      // but provides defense against logic changes or direct queryFn calls
      if (!collectionName) {
        throw new Error("Collection name is required");
      }
      return await collectionApi.get(collectionName);
    },
    enabled: !!collectionName, // Only run query if collectionName is provided
    ...options,
  });
}

/**
 * useCollectionSchema - Query hook for fetching a collection's enriched schema
 *
 * Fetches the collection schema via the `/collections/schema/[slug]` endpoint
 * which enriches component-type fields with inline component schemas
 * (`componentFields` / `componentSchemas`). Use this when rendering entry forms
 * that may contain component fields.
 *
 * @param collectionName - The unique name/slug of the collection
 * @param options - Optional TanStack Query options
 * @returns TanStack Query result with enriched collection schema
 */
export function useCollectionSchema(
  collectionName?: string,
  options?: Omit<UseQueryOptions<Collection, Error>, "queryKey" | "queryFn">
): UseQueryResult<Collection, Error> {
  return useQuery<Collection, Error>({
    queryKey: collectionName
      ? collectionKeys.schema(collectionName)
      : collectionKeys.schemas(),
    queryFn: async () => {
      if (!collectionName) {
        throw new Error("Collection name is required");
      }
      return await collectionApi.getSchema(collectionName);
    },
    enabled: !!collectionName,
    ...options,
  });
}

/**
 * useCreateCollection - Mutation hook for creating a new collection
 *
 * Creates a new collection and automatically invalidates the collections list cache.
 * Returns a success message from the API.
 *
 * ## Cache Invalidation
 * Automatically invalidates `["collections"]` query keys on success
 *
 * ## Features
 * - Automatic cache invalidation
 * - Returns API success message
 * - Loading state management
 * - Error handling
 * - TypeScript type safety
 *
 * @returns TanStack Mutation result with mutate function and states
 *
 * @example
 * ```tsx
 * function CreateCollectionForm() {
 *   const { mutate: createCollection, isPending, error } = useCreateCollection();
 *   const navigate = useNavigate();
 *
 *   const handleSubmit = (data: CreateCollectionPayload) => {
 *     createCollection(data, {
 *       onSuccess: (result) => {
 *         toast.success(result.message || 'Collection created successfully');
 *         navigate('/collections');
 *       },
 *       onError: (error) => {
 *         toast.error(`Failed to create collection: ${error.message}`);
 *       },
 *     });
 *   };
 *
 *   return (
 *     <form onSubmit={handleSubmit}>
 *       <Button type="submit" disabled={isPending}>
 *         {isPending ? 'Creating...' : 'Create Collection'}
 *       </Button>
 *     </form>
 *   );
 * }
 * ```
 *
 * @see https://tanstack.com/query/v5/docs/react/reference/useMutation
 */
export function useCreateCollection(): UseMutationResult<
  {
    message: string;
  },
  Error,
  CreateCollectionPayload,
  unknown
> {
  const queryClient = useQueryClient();

  return useMutation<{ message: string }, Error, CreateCollectionPayload>({
    mutationFn: async (collectionData: CreateCollectionPayload) => {
      return await collectionApi.create(collectionData);
    },
    onSuccess: () => {
      // Invalidate all collections queries using query key factory
      void queryClient.invalidateQueries({ queryKey: collectionKeys.all() });
    },
  });
}

/**
 * useUpdateCollection - Mutation hook for updating an existing collection
 *
 * Updates a collection's information and automatically invalidates relevant caches.
 * Handles field configuration updates, label changes, and description modifications.
 *
 * ## Cache Invalidation
 * Automatically invalidates:
 * - `["collections"]` - All collections list queries
 * - `["collections", collectionName]` - Specific collection detail query
 *
 * ## Features
 * - Automatic cache invalidation
 * - Loading state management
 * - Error handling
 * - TypeScript type safety
 *
 * @returns TanStack Mutation result with mutate function and states
 *
 * @example
 * ```tsx
 * function EditCollectionForm({ collectionName }: { collectionName: string }) {
 *   const { data: collection } = useCollection(collectionName);
 *   const { mutate: updateCollection, isPending } = useUpdateCollection();
 *
 *   const handleSubmit = (updates: UpdateCollectionPayload) => {
 *     updateCollection(
 *       { collectionName, updates },
 *       {
 *         onSuccess: () => {
 *           toast.success('Collection updated successfully');
 *         },
 *         onError: (error) => {
 *           toast.error(`Failed to update collection: ${error.message}`);
 *         },
 *       }
 *     );
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
 * @see https://tanstack.com/query/v5/docs/react/reference/useMutation
 */
export function useUpdateCollection(): UseMutationResult<
  {
    message: string;
  },
  Error,
  {
    collectionName: string;
    updates: UpdateCollectionPayload;
  },
  unknown
> {
  const queryClient = useQueryClient();

  return useMutation<
    { message: string },
    Error,
    { collectionName: string; updates: UpdateCollectionPayload }
  >({
    mutationFn: async ({ collectionName, updates }) => {
      return await collectionApi.update(collectionName, updates);
    },
    onSuccess: (_, { collectionName }) => {
      // Invalidate all collections queries using query key factory
      void queryClient.invalidateQueries({ queryKey: collectionKeys.all() });
      void queryClient.invalidateQueries({
        queryKey: collectionKeys.detail(collectionName),
      });
    },
  });
}

/**
 * useDeleteCollection - Mutation hook for deleting a collection
 *
 * Deletes a collection and automatically invalidates the collections list cache.
 * Provides loading state for UI feedback.
 *
 * ## Cache Invalidation
 * Automatically invalidates `["collections"]` query keys on success
 *
 * ## Features
 * - Automatic cache invalidation
 * - Loading state management
 * - Error handling
 * - TypeScript type safety
 *
 * @returns TanStack Mutation result with mutate function and states
 *
 * @example
 * ```tsx
 * function DeleteCollectionButton({ collectionName }: { collectionName: string }) {
 *   const { mutate: deleteCollection, isPending } = useDeleteCollection();
 *
 *   const handleDelete = () => {
 *     if (confirm(`Are you sure you want to delete the "${collectionName}" collection?`)) {
 *       deleteCollection(collectionName, {
 *         onSuccess: () => {
 *           toast.success('Collection deleted successfully');
 *         },
 *         onError: (error) => {
 *           toast.error(`Failed to delete collection: ${error.message}`);
 *         },
 *       });
 *     }
 *   };
 *
 *   return (
 *     <Button
 *       variant="destructive"
 *       onClick={handleDelete}
 *       disabled={isPending}
 *     >
 *       {isPending ? 'Deleting...' : 'Delete Collection'}
 *     </Button>
 *   );
 * }
 * ```
 *
 * @see https://tanstack.com/query/v5/docs/react/reference/useMutation
 */
export function useDeleteCollection(): UseMutationResult<
  void,
  Error,
  string,
  unknown
> {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: async (collectionName: string) => {
      const result = await collectionApi.deleteCollection(collectionName);
      // D-series: keep ui-schema.json in sync (best-effort, dev-only API).
      try {
        await schemaFileApi.deleteCollection(collectionName);
      } catch (mirrorError) {
        // The DB delete succeeded; a stale manifest entry silently diverges
        // the committed schema from the database, so the failure must be
        // visible even though it is non-fatal.
        toast.warning(
          `Collection deleted from the database, but ui-schema.json could not be updated: ${mirrorError instanceof Error ? mirrorError.message : String(mirrorError)}`
        );
      }
      return result;
    },
    onSuccess: () => {
      // Invalidate all collections queries using query key factory
      void queryClient.invalidateQueries({ queryKey: collectionKeys.all() });
    },
  });
}

/**
 * Delete `slugs` in one request: the first in the path, the rest in
 * `?together=`, which the server deletes in the same operation after checking
 * the whole set.
 */
async function deleteCollectionsTogether(
  slugs: readonly string[]
): Promise<void> {
  const [first, ...rest] = slugs;
  const together =
    rest.length > 0 ? `?together=${encodeURIComponent(rest.join(","))}` : "";
  await fetcher<MutationResponse<ApiCollection>>(
    `/collections/${encodeURIComponent(first)}${together}`,
    { method: "DELETE" },
    true
  );
}

/**
 * Remove deleted collections from `ui-schema.json`, as the single delete does
 * (best-effort, dev-only API). The database delete has committed by now, so a
 * failure changes no result; it is named, because a stale entry silently
 * diverges the committed schema from the database.
 */
async function mirrorDeletes(ids: readonly string[]): Promise<void> {
  for (const id of ids) {
    try {
      await schemaFileApi.deleteCollection(id);
    } catch (mirrorError) {
      toast.warning(
        `Collections deleted from the database, but ui-schema.json could not be updated for ${id}: ${mirrorError instanceof Error ? mirrorError.message : String(mirrorError)}`
      );
    }
  }
}

/**
 * Delete `ids` together, as one result for every collection: the server
 * removed all of them or none.
 */
async function deleteAllOrNone(
  ids: readonly string[]
): Promise<BulkMutationResult<void, Error>> {
  let failure: Error | undefined;
  try {
    if (ids.length > 0) await deleteCollectionsTogether(ids);
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error));
  }
  if (failure === undefined) await mirrorDeletes(ids);
  const results: BulkMutationItemResult<void, Error>[] = ids.map(id =>
    failure === undefined
      ? { id, status: "fulfilled" as const, data: undefined }
      : { id, status: "rejected" as const, error: failure }
  );
  return {
    succeeded: failure === undefined ? ids.length : 0,
    failed: failure === undefined ? 0 : ids.length,
    total: ids.length,
    results,
    succeededIds: failure === undefined ? [...ids] : [],
    failedIds: failure === undefined ? [] : [...ids],
  };
}

/** The callbacks, in the order every other bulk hook calls them. */
function reportBulkResult(
  result: BulkMutationResult<void, Error>,
  options: BulkMutationOptions<void, Error> | undefined
): void {
  if (options?.onItemComplete) result.results.forEach(options.onItemComplete);
  options?.onComplete?.(result);
  if (result.succeeded > 0) options?.onSuccess?.(result);
  if (result.failed > 0) options?.onError?.(result);
}

/**
 * useBulkDeleteCollections - Delete several collections in one operation
 *
 * Sends ONE request naming every collection, rather than one delete each.
 * The server checks the whole set before anything is removed: a collection
 * that something outside the set depends on (a field pointing at it, a
 * plugin's foreign key, a plugin's column on its table) refuses the whole
 * delete, and collections that point only at one another go together, where
 * deleting each on its own would be refused. So the result is all or
 * nothing: every collection succeeded, or every one failed with the same
 * error, and none was removed. Once deleted, each is removed from
 * `ui-schema.json` too, as the single delete removes it.
 *
 * Returns the same shape as the other bulk hooks, so callers read
 * `succeeded`, `failed` and the per-collection results as before.
 *
 * @example
 * ```tsx
 * const { mutate: bulkDelete } = useBulkDeleteCollections();
 *
 * bulkDelete(['posts', 'comments', 'tags'], undefined, {
 *   onSuccess: (result) => {
 *     toast.success(`${result.succeeded} collections deleted`);
 *   },
 *   onError: (result) => {
 *     toast.error(`${result.failed} collections failed`);
 *   },
 * });
 * ```
 *
 * @see useDeleteCollection - The single delete
 */
export function useBulkDeleteCollections(): UseBulkMutationReturn<
  string,
  void,
  Error,
  void
> {
  const queryClient = useQueryClient();
  const [isPending, setIsPending] = useState(false);
  const [result, setResult] = useState<BulkMutationResult<void, Error> | null>(
    null
  );

  const mutateAsync = useCallback(
    async (
      ids: string[],
      _context: void,
      options?: BulkMutationOptions<void, Error>
    ): Promise<BulkMutationResult<void, Error>> => {
      setResult(null);
      setIsPending(true);
      try {
        const bulkResult = await deleteAllOrNone(ids);
        setResult(bulkResult);
        void queryClient.invalidateQueries({ queryKey: collectionKeys.all() });
        reportBulkResult(bulkResult, options);
        return bulkResult;
      } finally {
        setIsPending(false);
      }
    },
    [queryClient]
  );

  const reset = useCallback(() => {
    setIsPending(false);
    setResult(null);
  }, []);

  return {
    mutate: mutateAsync,
    mutateAsync,
    isPending,
    isIdle: !isPending && result === null,
    result,
    reset,
  };
}

/**
 * useBulkUpdateCollections - Bulk mutation hook for updating multiple collections
 *
 * Executes parallel update operations for multiple collections using Promise.allSettled().
 * Allows partial failures where some updates succeed while others fail.
 * Automatically invalidates the collections cache after all operations complete.
 *
 * ## Features
 * - ✅ Parallel execution with Promise.allSettled()
 * - ✅ Partial failure handling (some succeed, some fail)
 * - ✅ Detailed results with success/failure counts
 * - ✅ Automatic cache invalidation after completion
 * - ✅ TypeScript type safety
 * - ✅ Accepts update payload via context parameter
 *
 * ## Architecture
 *
 * ```
 * useBulkUpdateCollections (Entity-Specific)
 *   ↓
 * useBulkMutation (Generic Hook)
 *   ↓
 * Promise.allSettled() (Parallel Execution)
 * ```
 *
 * ## Result Structure
 *
 * ```ts
 * {
 *   succeeded: 8,        // Number of successful updates
 *   failed: 2,           // Number of failed updates
 *   total: 10,           // Total collections attempted
 *   succeededIds: [...], // IDs of successfully updated collections
 *   failedIds: [...],    // IDs of collections that failed to update
 *   results: [...]       // Individual results with error details
 * }
 * ```
 *
 * ## Cache Invalidation
 * Automatically invalidates `["collections"]` query keys after all operations complete
 *
 * @returns Bulk mutation interface with mutate function, isPending state, and result
 *
 * @example Bulk update collection descriptions
 * ```tsx
 * function BulkUpdateDescriptions() {
 *   const { mutate: bulkUpdate, isPending } = useBulkUpdateCollections();
 *   const [selectedIds, setSelectedIds] = useState<string[]>([]);
 *
 *   const handleBulkUpdate = async () => {
 *     const updates: UpdateCollectionPayload = {
 *       description: 'Updated via bulk operation',
 *     };
 *
 *     const result = await bulkUpdate(selectedIds, updates);
 *
 *     if (result.failed > 0) {
 *       toast.error(`${result.failed} collections failed to update`);
 *     }
 *     if (result.succeeded > 0) {
 *       toast.success(`${result.succeeded} collections updated`);
 *     }
 *   };
 *
 *   return (
 *     <Button onClick={handleBulkUpdate} disabled={isPending}>
 *       {isPending ? 'Updating...' : `Update ${selectedIds.length} Collections`}
 *     </Button>
 *   );
 * }
 * ```
 *
 * @example With callbacks and progress tracking
 * ```tsx
 * const [progress, setProgress] = useState(0);
 * const { mutate: bulkUpdate } = useBulkUpdateCollections();
 *
 * bulkUpdate(['posts', 'comments'], updates, {
 *   onItemComplete: (itemResult) => {
 *     setProgress(prev => prev + 1);
 *     console.log(`Collection ${itemResult.id}: ${itemResult.status}`);
 *   },
 *   onSuccess: (result) => {
 *     toast.success(`${result.succeeded} collections updated`);
 *   },
 * });
 * ```
 *
 * @see useBulkMutation - Generic bulk mutation hook
 * @see useBulkUpdateUsers - Similar pattern for users
 */
export function useBulkUpdateCollections(): UseBulkMutationReturn<
  string,
  void,
  Error,
  UpdateCollectionPayload
> {
  const queryClient = useQueryClient();

  return useBulkMutation<string, void, Error, UpdateCollectionPayload>({
    mutationFn: async (
      collectionName: string,
      updates: UpdateCollectionPayload
    ) => {
      await collectionApi.update(collectionName, updates);
    },
    defaultOptions: {
      onComplete: () => {
        void queryClient.invalidateQueries({ queryKey: collectionKeys.all() });
      },
    },
  });
}
