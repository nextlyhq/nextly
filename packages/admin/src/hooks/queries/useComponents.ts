"use client";

/**
 * Component Query Hooks
 *
 * TanStack Query hooks for Component operations (fetch, create, update, delete).
 * Follows the established pattern from useCollections.ts with proper
 * cache invalidation and error handling.
 *
 * ## Query Keys
 *
 * - `["components"]` - All components list (base key for invalidation)
 * - `["components", "list", params]` - Paginated/filtered/sorted components list
 * - `["components", "detail", componentSlug]` - Single component detail
 *
 * @example
 * ```ts
 * // Invalidate all component queries
 * queryClient.invalidateQueries({ queryKey: componentKeys.all() });
 *
 * // Invalidate specific component
 * queryClient.invalidateQueries({ queryKey: componentKeys.detail(componentSlug) });
 * ```
 *
 * @see hooks/queries/useCollections.ts - Reference pattern for query hooks
 */

import type { TableParams, TableResponse } from "@revnixhq/ui";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";

import {
  componentApi,
  type CreateComponentPayload,
  type UpdateComponentPayload,
} from "@admin/services/componentApi";
import type { ApiComponent } from "@admin/types/entities";

import { useBulkMutation } from "../useBulkMutation";

/**
 * Default table parameters for component queries
 */
const defaultParams: TableParams = {
  pagination: { page: 0, pageSize: 10 },
  sorting: [],
  filters: {},
};

/**
 * Query Key Factory for Components
 *
 * Creates stable, hierarchical query keys that prevent cache misses due to
 * object reference changes. Follows TanStack Query best practices.
 *
 * @see https://tanstack.com/query/v5/docs/react/guides/query-keys
 *
 * @example
 * ```ts
 * componentKeys.all()           // ["components"]
 * componentKeys.lists()         // ["components", "list"]
 * componentKeys.list(params)    // ["components", "list", { page: 0, ... }]
 * componentKeys.details()       // ["components", "detail"]
 * componentKeys.detail("seo")   // ["components", "detail", "seo"]
 * ```
 */
export const componentKeys = {
  /** Base key for all component queries - invalidates everything */
  all: () => ["components"] as const,

  /** Base key for component list queries */
  lists: () => [...componentKeys.all(), "list"] as const,

  /**
   * Stable query key for paginated/filtered component lists.
   * Flattens params to prevent object reference issues.
   */
  list: (params: TableParams) =>
    [
      ...componentKeys.lists(),
      {
        page: params.pagination.page,
        pageSize: params.pagination.pageSize,
        search: params.filters?.search || "",
        sorting: JSON.stringify(params.sorting), // Stable string representation
      },
    ] as const,

  /** Base key for component detail queries */
  details: () => [...componentKeys.all(), "detail"] as const,

  /** Query key for a single component by slug */
  detail: (slug: string) => [...componentKeys.details(), slug] as const,
};

/**
 * useComponents - Query hook for fetching paginated component list
 *
 * Fetches components with pagination, search, and sorting support.
 * Automatically caches results and provides loading/error states.
 *
 * ## Query Key Structure
 * `["components", "list", params]` - Hierarchical key for proper cache invalidation
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
 * @returns TanStack Query result with component data, loading state, and error state
 *
 * @example
 * ```tsx
 * function ComponentList() {
 *   const { data, isLoading, error } = useComponents({
 *     pagination: { page: 0, pageSize: 10 },
 *     filters: { search: 'seo' },
 *     sorting: [{ field: 'slug', direction: 'asc' }],
 *   });
 *
 *   if (isLoading) return <Skeleton />;
 *   if (error) return <Alert>Error: {error.message}</Alert>;
 *
 *   return (
 *     <div>
 *       {data.data.map(component => (
 *         <ComponentCard key={component.id} component={component} />
 *       ))}
 *       <Pagination meta={data.meta} />
 *     </div>
 *   );
 * }
 * ```
 */
export function useComponents(
  params?: TableParams,
  options?: Omit<
    UseQueryOptions<TableResponse<ApiComponent>, Error>,
    "queryKey" | "queryFn"
  >
) {
  const effectiveParams = params || defaultParams;
  return useQuery<TableResponse<ApiComponent>, Error>({
    queryKey: componentKeys.list(effectiveParams),
    queryFn: async () => {
      return await componentApi.fetchComponents(effectiveParams);
    },
    ...options,
  });
}

/**
 * useComponent - Query hook for fetching a single component by slug
 *
 * Fetches a single component's details by its unique slug.
 * Only runs when componentSlug is provided.
 * Automatically caches result for fast navigation.
 *
 * @param componentSlug - The unique slug of the component to fetch (optional)
 * @returns TanStack Query result with component data, loading state, and error state
 *
 * @example
 * ```tsx
 * function ComponentDetail({ componentSlug }: { componentSlug?: string }) {
 *   const { data: component, isLoading, error } = useComponent(componentSlug);
 *
 *   if (!componentSlug) return <div>No component selected</div>;
 *   if (isLoading) return <Skeleton />;
 *   if (error) return <Alert>Error: {error.message}</Alert>;
 *   if (!component) return <div>Component not found</div>;
 *
 *   return (
 *     <div>
 *       <h1>{component.label}</h1>
 *       <p>{component.description}</p>
 *     </div>
 *   );
 * }
 * ```
 */
export function useComponent(
  componentSlug?: string,
  options?: Omit<UseQueryOptions<ApiComponent, Error>, "queryKey" | "queryFn">
) {
  return useQuery<ApiComponent, Error>({
    queryKey: componentSlug
      ? componentKeys.detail(componentSlug)
      : componentKeys.details(),
    queryFn: async () => {
      if (!componentSlug) {
        throw new Error("Component slug is required");
      }
      return await componentApi.get(componentSlug);
    },
    enabled: !!componentSlug,
    ...options,
  });
}

/**
 * useCreateComponent - Mutation hook for creating a new component
 *
 * Creates a new component and automatically invalidates the components list cache.
 *
 * @returns TanStack Mutation result with mutate function and states
 *
 * @example
 * ```tsx
 * function CreateComponentForm() {
 *   const { mutate: createComponent, isPending, error } = useCreateComponent();
 *
 *   const handleSubmit = (data: CreateComponentPayload) => {
 *     createComponent(data, {
 *       onSuccess: (result) => {
 *         toast.success('Component created successfully');
 *         navigate('/admin/components');
 *       },
 *       onError: (error) => {
 *         toast.error(`Failed to create component: ${error.message}`);
 *       },
 *     });
 *   };
 *
 *   return (
 *     <form onSubmit={handleSubmit}>
 *       <Button type="submit" disabled={isPending}>
 *         {isPending ? 'Creating...' : 'Create Component'}
 *       </Button>
 *     </form>
 *   );
 * }
 * ```
 */
export function useCreateComponent() {
  const queryClient = useQueryClient();

  return useMutation<{ data: ApiComponent }, Error, CreateComponentPayload>({
    mutationFn: async (componentData: CreateComponentPayload) => {
      return await componentApi.create(componentData);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: componentKeys.all() });
    },
  });
}

/**
 * useUpdateComponent - Mutation hook for updating an existing component
 *
 * Updates a component's information and automatically invalidates relevant caches.
 *
 * @returns TanStack Mutation result with mutate function and states
 *
 * @example
 * ```tsx
 * function EditComponentForm({ componentSlug }: { componentSlug: string }) {
 *   const { data: component } = useComponent(componentSlug);
 *   const { mutate: updateComponent, isPending } = useUpdateComponent();
 *
 *   const handleSubmit = (updates: UpdateComponentPayload) => {
 *     updateComponent(
 *       { componentSlug, updates },
 *       {
 *         onSuccess: () => {
 *           toast.success('Component updated successfully');
 *         },
 *         onError: (error) => {
 *           toast.error(`Failed to update component: ${error.message}`);
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
 */
export function useUpdateComponent() {
  const queryClient = useQueryClient();

  return useMutation<
    { data: ApiComponent },
    Error,
    { componentSlug: string; updates: UpdateComponentPayload }
  >({
    mutationFn: async ({ componentSlug, updates }) => {
      return await componentApi.update(componentSlug, updates);
    },
    onSuccess: (_, { componentSlug }) => {
      void queryClient.invalidateQueries({ queryKey: componentKeys.all() });
      void queryClient.invalidateQueries({
        queryKey: componentKeys.detail(componentSlug),
      });
    },
  });
}

/**
 * useDeleteComponent - Mutation hook for deleting a component
 *
 * Deletes a component and automatically invalidates the components list cache.
 * Provides loading state for UI feedback.
 *
 * @returns TanStack Mutation result with mutate function and states
 *
 * @example
 * ```tsx
 * function DeleteComponentButton({ componentSlug }: { componentSlug: string }) {
 *   const { mutate: deleteComponent, isPending } = useDeleteComponent();
 *
 *   const handleDelete = () => {
 *     if (confirm(`Are you sure you want to delete the "${componentSlug}" component?`)) {
 *       deleteComponent(componentSlug, {
 *         onSuccess: () => {
 *           toast.success('Component deleted successfully');
 *         },
 *         onError: (error) => {
 *           toast.error(`Failed to delete component: ${error.message}`);
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
 *       {isPending ? 'Deleting...' : 'Delete Component'}
 *     </Button>
 *   );
 * }
 * ```
 */
export function useDeleteComponent() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: async (componentSlug: string) => {
      return await componentApi.deleteComponent(componentSlug);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: componentKeys.all() });
    },
  });
}

/**
 * useBulkDeleteComponents - Bulk mutation hook for deleting multiple components
 *
 * Executes parallel delete operations for multiple components using Promise.allSettled().
 * Allows partial failures where some deletions succeed while others fail.
 * Automatically invalidates the components cache after all operations complete.
 *
 * ## Features
 * - Parallel execution with Promise.allSettled()
 * - Partial failure handling (some succeed, some fail)
 * - Detailed results with success/failure counts
 * - Automatic cache invalidation after completion
 *
 * @returns Bulk mutation interface with mutate function, isPending state, and result
 *
 * @example
 * ```tsx
 * function ComponentListActions() {
 *   const { mutate: bulkDelete, isPending } = useBulkDeleteComponents();
 *   const [selectedIds, setSelectedIds] = useState<string[]>([]);
 *
 *   const handleBulkDelete = async () => {
 *     bulkDelete(selectedIds, undefined, {
 *       onSuccess: (result) => {
 *         if (result.failed > 0) {
 *           toast.error(`${result.failed} components failed to delete`);
 *         }
 *         if (result.succeeded > 0) {
 *           toast.success(`${result.succeeded} components deleted successfully`);
 *         }
 *       },
 *     });
 *   };
 *
 *   return (
 *     <Button onClick={handleBulkDelete} disabled={isPending}>
 *       {isPending ? 'Deleting...' : `Delete ${selectedIds.length} Components`}
 *     </Button>
 *   );
 * }
 * ```
 */
export function useBulkDeleteComponents() {
  const queryClient = useQueryClient();

  return useBulkMutation<string, void, Error, void>({
    mutationFn: async (componentSlug: string) => {
      await componentApi.deleteComponent(componentSlug);
    },
    defaultOptions: {
      onComplete: () => {
        void queryClient.invalidateQueries({ queryKey: componentKeys.all() });
      },
    },
  });
}
