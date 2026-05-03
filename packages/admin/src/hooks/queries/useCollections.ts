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

import type { TableParams, ListResponse } from "@revnixhq/ui";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";

import { collectionApi } from "@admin/services/collectionApi";
import type {
  Collection,
  CreateCollectionPayload,
  UpdateCollectionPayload,
} from "@admin/types/collection";
import type { ApiCollection } from "@admin/types/entities";

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
  lists: () => [...collectionKeys.all(), "list"] as const,

  /**
   * Stable query key for paginated/filtered collection lists.
   * Flattens params to prevent object reference issues.
   */
  list: (params: TableParams) =>
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
  details: () => [...collectionKeys.all(), "detail"] as const,

  /** Query key for a single collection by name */
  detail: (name: string) => [...collectionKeys.details(), name] as const,

  /** Base key for collection schema queries (enriched with component fields) */
  schemas: () => [...collectionKeys.all(), "schema"] as const,

  /** Query key for a collection's enriched schema by name */
  schema: (name: string) => [...collectionKeys.schemas(), name] as const,
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
) {
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
) {
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
) {
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
export function useCreateCollection() {
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
export function useUpdateCollection() {
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
export function useDeleteCollection() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: async (collectionName: string) => {
      return await collectionApi.deleteCollection(collectionName);
    },
    onSuccess: () => {
      // Invalidate all collections queries using query key factory
      void queryClient.invalidateQueries({ queryKey: collectionKeys.all() });
    },
  });
}

/**
 * useBulkDeleteCollections - Bulk mutation hook for deleting multiple collections
 *
 * Executes parallel delete operations for multiple collections using Promise.allSettled().
 * Allows partial failures where some deletions succeed while others fail.
 * Automatically invalidates the collections cache after all operations complete.
 *
 * ## Features
 * - ✅ Parallel execution with Promise.allSettled()
 * - ✅ Partial failure handling (some succeed, some fail)
 * - ✅ Detailed results with success/failure counts
 * - ✅ Automatic cache invalidation after completion
 * - ✅ TypeScript type safety
 *
 * ## Architecture
 *
 * ```
 * useBulkDeleteCollections (Entity-Specific)
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
 *   succeeded: 8,        // Number of successful deletions
 *   failed: 2,           // Number of failed deletions
 *   total: 10,           // Total collections attempted
 *   succeededIds: [...], // IDs of successfully deleted collections
 *   failedIds: [...],    // IDs of collections that failed to delete
 *   results: [...]       // Individual results with error details
 * }
 * ```
 *
 * ## Cache Invalidation
 * Automatically invalidates `["collections"]` query keys after all operations complete
 *
 * @returns Bulk mutation interface with mutate function, isPending state, and result
 *
 * @example Basic usage - Delete multiple collections
 * ```tsx
 * function CollectionListActions() {
 *   const { mutate: bulkDelete, isPending } = useBulkDeleteCollections();
 *   const [selectedIds, setSelectedIds] = useState<string[]>([]);
 *
 *   const handleBulkDelete = async () => {
 *     const result = await bulkDelete(selectedIds, undefined);
 *
 *     if (result.failed > 0) {
 *       toast.error(`${result.failed} collections failed to delete`);
 *     }
 *     if (result.succeeded > 0) {
 *       toast.success(`${result.succeeded} collections deleted successfully`);
 *     }
 *   };
 *
 *   return (
 *     <Button onClick={handleBulkDelete} disabled={isPending}>
 *       {isPending ? 'Deleting...' : `Delete ${selectedIds.length} Collections`}
 *     </Button>
 *   );
 * }
 * ```
 *
 * @example With callbacks
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
 * @see useBulkMutation - Generic bulk mutation hook
 * @see useBulkDeleteUsers - Similar pattern for users
 */
export function useBulkDeleteCollections() {
  const queryClient = useQueryClient();

  return useBulkMutation<string, void, Error, void>({
    mutationFn: async (collectionId: string) => {
      await collectionApi.deleteCollection(collectionId);
    },
    defaultOptions: {
      onComplete: () => {
        void queryClient.invalidateQueries({ queryKey: collectionKeys.all() });
      },
    },
  });
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
export function useBulkUpdateCollections() {
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
