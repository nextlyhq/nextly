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
 * - `["field-groups"]` - All field groups list (base key for invalidation)
 * - `["field-groups", "list", params]` - Paginated/filtered/sorted field groups list
 * - `["field-groups", "detail", fieldGroupSlug]` - Single field group detail
 *
 * @example
 * ```ts
 * // Invalidate all component queries
 * queryClient.invalidateQueries({ queryKey: fieldGroupKeys.all() });
 *
 * // Invalidate specific component
 * queryClient.invalidateQueries({ queryKey: fieldGroupKeys.detail(fieldGroupSlug) });
 * ```
 *
 * @see hooks/queries/useCollections.ts - Reference pattern for query hooks
 */

import type { TableParams, ListResponse } from "@nextlyhq/ui";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";

import { toast } from "@admin/components/ui";
import {
  fieldGroupApi,
  type CreateComponentPayload,
  type UpdateComponentPayload,
} from "@admin/services/fieldGroupApi";
import { schemaFileApi } from "@admin/services/schemaFileApi";
import type { ApiFieldGroup } from "@admin/types/entities";

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
 * fieldGroupKeys.all()           // ["field-groups"]
 * fieldGroupKeys.lists()         // ["field-groups", "list"]
 * fieldGroupKeys.list(params)    // ["field-groups", "list", { page: 0, ... }]
 * fieldGroupKeys.details()       // ["field-groups", "detail"]
 * fieldGroupKeys.detail("seo")   // ["field-groups", "detail", "seo"]
 * ```
 */
export const fieldGroupKeys = {
  /** Base key for all component queries - invalidates everything */
  all: () => ["field-groups"] as const,

  /** Base key for component list queries */
  lists: () => [...fieldGroupKeys.all(), "list"] as const,

  /**
   * Stable query key for paginated/filtered component lists.
   * Flattens params to prevent object reference issues.
   */
  list: (params: TableParams) =>
    [
      ...fieldGroupKeys.lists(),
      {
        page: params.pagination.page,
        pageSize: params.pagination.pageSize,
        search: params.filters?.search || "",
        // 🔴 Every filter the request carries has to be IN the key. `source` and `migrationStatus`
        // are applied by the server, so two selections produce two different result sets — and a key
        // that cannot tell them apart serves the previous selection's page from cache while the
        // control shows the new one. Stringified for the same reason `sorting` is: the key is
        // compared structurally, and a fresh object literal each render is a fresh key.
        filters: JSON.stringify(params.filters?.filters ?? {}),
        sorting: JSON.stringify(params.sorting), // Stable string representation
      },
    ] as const,

  /** Base key for component detail queries */
  details: () => [...fieldGroupKeys.all(), "detail"] as const,

  /** Query key for a single component by slug */
  detail: (slug: string) => [...fieldGroupKeys.details(), slug] as const,
};

/**
 * useFieldGroups - Query hook for fetching paginated component list
 *
 * Fetches components with pagination, search, and sorting support.
 * Automatically caches results and provides loading/error states.
 *
 * ## Query Key Structure
 * `["field-groups", "list", params]` - Hierarchical key for proper cache invalidation
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
 *   const { data, isLoading, error } = useFieldGroups({
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
 *       {data.items.map(component => (
 *         <ComponentCard key={component.id} component={component} />
 *       ))}
 *       <Pagination meta={data.meta} />
 *     </div>
 *   );
 * }
 * ```
 */
export function useFieldGroups(
  params?: TableParams,
  options?: Omit<
    UseQueryOptions<ListResponse<ApiFieldGroup>, Error>,
    "queryKey" | "queryFn"
  >
) {
  const effectiveParams = params || defaultParams;
  return useQuery<ListResponse<ApiFieldGroup>, Error>({
    queryKey: fieldGroupKeys.list(effectiveParams),
    queryFn: async () => {
      return await fieldGroupApi.fetchComponents(effectiveParams);
    },
    ...options,
  });
}

/**
 * useFieldGroup - Query hook for fetching a single component by slug
 *
 * Fetches a single component's details by its unique slug.
 * Only runs when fieldGroupSlug is provided.
 * Automatically caches result for fast navigation.
 *
 * @param fieldGroupSlug - The unique slug of the component to fetch (optional)
 * @returns TanStack Query result with component data, loading state, and error state
 *
 * @example
 * ```tsx
 * function ComponentDetail({ fieldGroupSlug }: { fieldGroupSlug?: string }) {
 *   const { data: component, isLoading, error } = useFieldGroup(fieldGroupSlug);
 *
 *   if (!fieldGroupSlug) return <div>No component selected</div>;
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
export function useFieldGroup(
  fieldGroupSlug?: string,
  options?: Omit<UseQueryOptions<ApiFieldGroup, Error>, "queryKey" | "queryFn">
) {
  return useQuery<ApiFieldGroup, Error>({
    queryKey: fieldGroupSlug
      ? fieldGroupKeys.detail(fieldGroupSlug)
      : fieldGroupKeys.details(),
    queryFn: async () => {
      if (!fieldGroupSlug) {
        throw new Error("Field group slug is required");
      }
      return await fieldGroupApi.get(fieldGroupSlug);
    },
    enabled: !!fieldGroupSlug,
    ...options,
  });
}

/**
 * useCreateFieldGroup - Mutation hook for creating a new component
 *
 * Creates a new component and automatically invalidates the components list cache.
 *
 * @returns TanStack Mutation result with mutate function and states
 *
 * @example
 * ```tsx
 * function CreateComponentForm() {
 *   const { mutate: createFieldGroup, isPending, error } = useCreateFieldGroup();
 *
 *   const handleSubmit = (data: CreateComponentPayload) => {
 *     createFieldGroup(data, {
 *       onSuccess: (result) => {
 *         toast.success('Field group created successfully');
 *         navigate('/admin/field-groups');
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
 *         {isPending ? 'Creating...' : 'Create Field Group'}
 *       </Button>
 *     </form>
 *   );
 * }
 * ```
 */
export function useCreateFieldGroup() {
  const queryClient = useQueryClient();

  return useMutation<ApiFieldGroup, Error, CreateComponentPayload>({
    mutationFn: async (componentData: CreateComponentPayload) => {
      return await fieldGroupApi.create(componentData);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: fieldGroupKeys.all() });
    },
  });
}

/**
 * useUpdateFieldGroup - Mutation hook for updating an existing component
 *
 * Updates a component's information and automatically invalidates relevant caches.
 *
 * @returns TanStack Mutation result with mutate function and states
 *
 * @example
 * ```tsx
 * function EditComponentForm({ fieldGroupSlug }: { fieldGroupSlug: string }) {
 *   const { data: component } = useFieldGroup(fieldGroupSlug);
 *   const { mutate: updateFieldGroup, isPending } = useUpdateFieldGroup();
 *
 *   const handleSubmit = (updates: UpdateComponentPayload) => {
 *     updateFieldGroup(
 *       { fieldGroupSlug, updates },
 *       {
 *         onSuccess: () => {
 *           toast.success('Field group updated successfully');
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
export function useUpdateFieldGroup() {
  const queryClient = useQueryClient();

  return useMutation<
    ApiFieldGroup,
    Error,
    { fieldGroupSlug: string; updates: UpdateComponentPayload }
  >({
    mutationFn: async ({ fieldGroupSlug, updates }) => {
      return await fieldGroupApi.update(fieldGroupSlug, updates);
    },
    onSuccess: (_, { fieldGroupSlug }) => {
      void queryClient.invalidateQueries({ queryKey: fieldGroupKeys.all() });
      void queryClient.invalidateQueries({
        queryKey: fieldGroupKeys.detail(fieldGroupSlug),
      });
    },
  });
}

/**
 * useDeleteFieldGroup - Mutation hook for deleting a component
 *
 * Deletes a component and automatically invalidates the components list cache.
 * Provides loading state for UI feedback.
 *
 * @returns TanStack Mutation result with mutate function and states
 *
 * @example
 * ```tsx
 * function DeleteComponentButton({ fieldGroupSlug }: { fieldGroupSlug: string }) {
 *   const { mutate: deleteFieldGroup, isPending } = useDeleteFieldGroup();
 *
 *   const handleDelete = () => {
 *     if (confirm(`Are you sure you want to delete the "${fieldGroupSlug}" component?`)) {
 *       deleteFieldGroup(fieldGroupSlug, {
 *         onSuccess: () => {
 *           toast.success('Field group deleted successfully');
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
 *       {isPending ? 'Deleting...' : 'Delete Field Group'}
 *     </Button>
 *   );
 * }
 * ```
 */
export function useDeleteFieldGroup() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: async (fieldGroupSlug: string) => {
      const result = await fieldGroupApi.deleteFieldGroup(fieldGroupSlug);
      // D-series: keep ui-schema.json in sync (best-effort, dev-only API).
      try {
        await schemaFileApi.deleteFieldGroup(fieldGroupSlug);
      } catch (mirrorError) {
        // The DB delete succeeded; a stale manifest entry silently diverges
        // the committed schema from the database, so the failure must be
        // visible even though it is non-fatal.
        toast.warning(
          `Field group deleted from the database, but ui-schema.json could not be updated: ${mirrorError instanceof Error ? mirrorError.message : String(mirrorError)}`
        );
      }
      return result;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: fieldGroupKeys.all() });
    },
  });
}

/**
 * useBulkDeleteFieldGroups - Bulk mutation hook for deleting multiple components
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
 *   const { mutate: bulkDelete, isPending } = useBulkDeleteFieldGroups();
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
export function useBulkDeleteFieldGroups() {
  const queryClient = useQueryClient();

  return useBulkMutation<string, void, Error, void>({
    mutationFn: async (fieldGroupSlug: string) => {
      await fieldGroupApi.deleteFieldGroup(fieldGroupSlug);
    },
    defaultOptions: {
      onComplete: () => {
        void queryClient.invalidateQueries({ queryKey: fieldGroupKeys.all() });
      },
    },
  });
}
