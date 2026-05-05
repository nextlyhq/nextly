"use client";

/**
 * Single Query Hooks
 *
 * TanStack Query hooks for Single operations (fetch, create, update, delete).
 * Follows the established pattern from useCollections.ts with proper
 * cache invalidation and error handling.
 *
 * ## Query Keys
 *
 * - `["singles"]` - All Singles list (base key for invalidation)
 * - `["singles", params]` - Paginated/filtered/sorted Singles list
 * - `["singles", slug]` - Single detail
 *
 * @example
 * ```ts
 * // Invalidate all Single queries
 * queryClient.invalidateQueries({ queryKey: singleKeys.all() });
 *
 * // Invalidate specific Single
 * queryClient.invalidateQueries({ queryKey: singleKeys.detail(slug) });
 * ```
 *
 * @see hooks/queries/useCollections.ts - Reference pattern for query hooks
 * @module hooks/queries/useSingles
 */

import type { TableParams, ListResponse } from "@revnixhq/ui";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";

import { singleApi, type SingleDocument } from "@admin/services/singleApi";
import type { ApiSingle } from "@admin/types/entities";

import { useBulkMutation } from "../useBulkMutation";

/**
 * Default table parameters for Single queries
 */
const defaultParams: TableParams = {
  pagination: { page: 0, pageSize: 10 },
  sorting: [],
  filters: {},
};

/**
 * Query Key Factory for Singles
 *
 * Creates stable, hierarchical query keys that prevent cache misses due to
 * object reference changes. Follows TanStack Query best practices.
 *
 * @see https://tanstack.com/query/v5/docs/react/guides/query-keys
 *
 * @example
 * ```ts
 * singleKeys.all()                  // ["singles"]
 * singleKeys.lists()                // ["singles", "list"]
 * singleKeys.list(params)           // ["singles", "list", { page: 0, ... }]
 * singleKeys.details()              // ["singles", "detail"]
 * singleKeys.detail("site-settings") // ["singles", "detail", "site-settings"]
 * ```
 */
export const singleKeys = {
  /** Base key for all Single queries - invalidates everything */
  all: () => ["singles"] as const,

  /** Base key for Single list queries */
  lists: () => [...singleKeys.all(), "list"] as const,

  /**
   * Stable query key for paginated/filtered Single lists.
   * Flattens params to prevent object reference issues.
   */
  list: (params: TableParams) =>
    [
      ...singleKeys.lists(),
      {
        page: params.pagination.page,
        pageSize: params.pagination.pageSize,
        search: params.filters?.search || "",
        sorting: JSON.stringify(params.sorting),
      },
    ] as const,

  /** Base key for Single detail queries */
  details: () => [...singleKeys.all(), "detail"] as const,

  /** Query key for a single Single by slug */
  detail: (slug: string) => [...singleKeys.details(), slug] as const,

  /** Base key for Single schema queries */
  schemas: () => [...singleKeys.all(), "schema"] as const,

  /** Query key for a Single's schema by slug */
  schema: (slug: string) => [...singleKeys.schemas(), slug] as const,
};

/**
 * useSingles - Query hook for fetching paginated Single list
 *
 * Fetches Singles with pagination, search, and sorting support.
 * Automatically caches results and provides loading/error states.
 *
 * ## Query Key Structure
 * `["singles", params]` - Hierarchical key for proper cache invalidation
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
 * @returns TanStack Query result with Single data, loading state, and error state
 *
 * @example
 * ```tsx
 * function SingleList() {
 *   const { data, isLoading, error } = useSingles({
 *     pagination: { page: 0, pageSize: 10 },
 *     filters: { search: 'settings' },
 *     sorting: [{ field: 'label', direction: 'asc' }],
 *   });
 *
 *   if (isLoading) return <Skeleton />;
 *   if (error) return <Alert>Error: {error.message}</Alert>;
 *
 *   return (
 *     <div>
 *       {data.items.map(single => (
 *         <SingleCard key={single.id} single={single} />
 *       ))}
 *       <Pagination meta={data.meta} />
 *     </div>
 *   );
 * }
 * ```
 *
 * @see https://tanstack.com/query/v5/docs/react/reference/useQuery
 */
export function useSingles(
  params?: TableParams,
  options?: Omit<
    UseQueryOptions<ListResponse<ApiSingle>, Error>,
    "queryKey" | "queryFn"
  >
) {
  const effectiveParams = params || defaultParams;
  return useQuery<ListResponse<ApiSingle>, Error>({
    queryKey: singleKeys.list(effectiveParams),
    queryFn: async () => {
      return await singleApi.fetchSingles(effectiveParams);
    },
    ...options,
  });
}

/**
 * useSingle - Query hook for fetching a single Single by slug
 *
 * Fetches a single Single's details by its unique slug.
 * Only runs when slug is provided.
 * Automatically caches result for fast navigation.
 *
 * ## Query Key Structure
 * `["singles", slug]` - Hierarchical key for single Single
 *
 * @param slug - The unique slug of the Single to fetch (optional)
 * @returns TanStack Query result with Single data, loading state, and error state
 *
 * @example
 * ```tsx
 * function SingleDetail({ slug }: { slug?: string }) {
 *   const { data: single, isLoading, error } = useSingle(slug);
 *
 *   if (!slug) return <div>No Single selected</div>;
 *   if (isLoading) return <Skeleton />;
 *   if (error) return <Alert>Error: {error.message}</Alert>;
 *   if (!single) return <div>Single not found</div>;
 *
 *   return (
 *     <div>
 *       <h1>{single.label}</h1>
 *       <p>{single.description}</p>
 *     </div>
 *   );
 * }
 * ```
 */
export function useSingle(
  slug?: string,
  options?: Omit<UseQueryOptions<ApiSingle, Error>, "queryKey" | "queryFn">
) {
  return useQuery<ApiSingle, Error>({
    queryKey: slug ? singleKeys.detail(slug) : singleKeys.details(),
    queryFn: async () => {
      if (!slug) {
        throw new Error("Single slug is required");
      }
      return await singleApi.get(slug);
    },
    enabled: !!slug,
    ...options,
  });
}

/**
 * useCreateSingle - Mutation hook for creating a new Single
 *
 * Creates a new Single and automatically invalidates the Singles list cache.
 *
 * @returns TanStack Mutation result with mutate function and states
 *
 * @example
 * ```tsx
 * function CreateSingleForm() {
 *   const { mutate: createSingle, isPending } = useCreateSingle();
 *
 *   const handleSubmit = (data: Partial<ApiSingle>) => {
 *     createSingle(data, {
 *       onSuccess: (result) => {
 *         toast.success(result.message || 'Single created successfully');
 *       },
 *       onError: (error) => {
 *         toast.error(`Failed to create Single: ${error.message}`);
 *       },
 *     });
 *   };
 * }
 * ```
 */
export function useCreateSingle() {
  const queryClient = useQueryClient();

  return useMutation<
    { message: string; data: ApiSingle },
    Error,
    Partial<ApiSingle>
  >({
    mutationFn: async (singleData: Partial<ApiSingle>) => {
      return await singleApi.create(singleData);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: singleKeys.all() });
    },
  });
}

/**
 * useUpdateSingle - Mutation hook for updating an existing Single
 *
 * Updates a Single's information and automatically invalidates relevant caches.
 *
 * @returns TanStack Mutation result with mutate function and states
 *
 * @example
 * ```tsx
 * function EditSingleForm({ slug }: { slug: string }) {
 *   const { mutate: updateSingle, isPending } = useUpdateSingle();
 *
 *   const handleSubmit = (updates: Partial<ApiSingle>) => {
 *     updateSingle(
 *       { slug, updates },
 *       {
 *         onSuccess: () => {
 *           toast.success('Single updated successfully');
 *         },
 *       }
 *     );
 *   };
 * }
 * ```
 */
export function useUpdateSingle() {
  const queryClient = useQueryClient();

  return useMutation<
    { message: string },
    Error,
    { slug: string; updates: Partial<ApiSingle> }
  >({
    mutationFn: async ({ slug, updates }) => {
      return await singleApi.update(slug, updates);
    },
    onSuccess: (_, { slug }) => {
      // Invalidate all Single caches including schema
      void queryClient.invalidateQueries({ queryKey: singleKeys.all() });
      void queryClient.invalidateQueries({ queryKey: singleKeys.detail(slug) });
      void queryClient.invalidateQueries({ queryKey: singleKeys.schema(slug) });
    },
  });
}

/**
 * useDeleteSingle - Mutation hook for deleting a Single
 *
 * Deletes a Single and automatically invalidates the Singles list cache.
 *
 * @returns TanStack Mutation result with mutate function and states
 *
 * @example
 * ```tsx
 * function DeleteSingleButton({ slug }: { slug: string }) {
 *   const { mutate: deleteSingle, isPending } = useDeleteSingle();
 *
 *   const handleDelete = () => {
 *     deleteSingle(slug, {
 *       onSuccess: () => {
 *         toast.success('Single deleted successfully');
 *       },
 *     });
 *   };
 * }
 * ```
 */
export function useDeleteSingle() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: async (slug: string) => {
      return await singleApi.deleteSingle(slug);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: singleKeys.all() });
    },
    // Disable retry for delete operations - if deletion succeeds on first attempt,
    // a retry would fail with 404 (already deleted) and incorrectly show an error
    retry: false,
  });
}

/**
 * useBulkDeleteSingles - Bulk mutation hook for deleting multiple Singles
 *
 * Executes parallel delete operations for multiple Singles using Promise.allSettled().
 *
 * @returns Bulk mutation interface with mutate function, isPending state, and result
 *
 * @example
 * ```tsx
 * function SingleListActions() {
 *   const { mutate: bulkDelete, isPending } = useBulkDeleteSingles();
 *   const [selectedSlugs, setSelectedSlugs] = useState<string[]>([]);
 *
 *   const handleBulkDelete = async () => {
 *     const result = await bulkDelete(selectedSlugs, undefined);
 *     if (result.succeeded > 0) {
 *       toast.success(`${result.succeeded} Singles deleted`);
 *     }
 *   };
 * }
 * ```
 */
export function useBulkDeleteSingles() {
  const queryClient = useQueryClient();

  return useBulkMutation<string, void, Error, void>({
    mutationFn: async (slug: string) => {
      await singleApi.deleteSingle(slug);
    },
    defaultOptions: {
      onComplete: () => {
        void queryClient.invalidateQueries({ queryKey: singleKeys.all() });
      },
    },
  });
}

// ============================================================
// DOCUMENT HOOKS
// These operate on Single document data (the actual content),
// distinct from metadata/schema operations above.
// ============================================================

/**
 * Query Key Factory for Single Documents
 *
 * Separate key hierarchy for document data to avoid conflicts with
 * schema/metadata queries.
 */
export const singleDocumentKeys = {
  /** Base key for all Single document queries */
  all: () => ["single-documents"] as const,

  /** Base key for Single document detail queries */
  details: () => [...singleDocumentKeys.all(), "detail"] as const,

  /** Query key for a Single document by slug */
  detail: (slug: string) => [...singleDocumentKeys.details(), slug] as const,
};

/**
 * Single document data type.
 * Re-export from singleApi for convenience.
 */
export type { SingleDocument } from "@admin/services/singleApi";

/**
 * useSingleDocument - Query hook for fetching a Single's document data
 *
 * Fetches the actual content/values of a Single (not the schema).
 * If the document doesn't exist, it will be auto-created with default values.
 *
 * ## Query Key Structure
 * `["single-documents", "detail", slug]` - Separate from schema queries
 *
 * @param slug - The unique slug of the Single
 * @param options - Optional query options (depth for relationship expansion)
 * @returns TanStack Query result with document data, loading state, and error state
 *
 * @example
 * ```tsx
 * function SiteSettingsEditor({ slug }: { slug: string }) {
 *   const { data: document, isLoading, error } = useSingleDocument(slug);
 *
 *   if (isLoading) return <Skeleton />;
 *   if (error) return <Alert>Error: {error.message}</Alert>;
 *
 *   return (
 *     <form>
 *       <input defaultValue={document?.siteName} />
 *       <input defaultValue={document?.tagline} />
 *     </form>
 *   );
 * }
 * ```
 */
export function useSingleDocument(
  slug?: string,
  options?: {
    depth?: number;
    queryOptions?: Omit<
      UseQueryOptions<SingleDocument, Error>,
      "queryKey" | "queryFn"
    >;
  }
) {
  return useQuery<SingleDocument, Error>({
    queryKey: slug
      ? singleDocumentKeys.detail(slug)
      : singleDocumentKeys.details(),
    queryFn: async () => {
      if (!slug) {
        throw new Error("Single slug is required");
      }
      return await singleApi.getDocument(slug, { depth: options?.depth });
    },
    enabled: !!slug,
    ...options?.queryOptions,
  });
}

/**
 * useSingleSchema - Query hook for fetching a Single's schema/metadata
 *
 * Fetches the field definitions and configuration of a Single.
 * Use this when you need to know the structure of a Single
 * (e.g., for rendering form fields).
 *
 * ## Query Key Structure
 * `["singles", "schema", slug]`
 *
 * @param slug - The unique slug of the Single
 * @param options - Optional TanStack Query options
 * @returns TanStack Query result with schema data, loading state, and error state
 *
 * @example
 * ```tsx
 * function SingleFormFields({ slug }: { slug: string }) {
 *   const { data: schema, isLoading } = useSingleSchema(slug);
 *
 *   if (isLoading) return <Skeleton />;
 *
 *   return (
 *     <div>
 *       {schema?.fields.map(field => (
 *         <FieldRenderer key={field.name} field={field} />
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export function useSingleSchema(
  slug?: string,
  options?: Omit<UseQueryOptions<ApiSingle, Error>, "queryKey" | "queryFn">
) {
  return useQuery<ApiSingle, Error>({
    queryKey: slug ? singleKeys.schema(slug) : singleKeys.schemas(),
    queryFn: async () => {
      if (!slug) {
        throw new Error("Single slug is required");
      }
      return await singleApi.getSchema(slug);
    },
    enabled: !!slug,
    ...options,
  });
}

/**
 * useUpdateSingleDocument - Mutation hook for updating a Single's document data
 *
 * Updates the actual content/values of a Single.
 * Automatically invalidates the document cache on success.
 *
 * @param slug - The slug of the Single to update
 * @returns TanStack Mutation result with mutate function and states
 *
 * @example
 * ```tsx
 * function SiteSettingsForm({ slug }: { slug: string }) {
 *   const { data: document } = useSingleDocument(slug);
 *   const { mutate: updateDocument, isPending } = useUpdateSingleDocument(slug);
 *
 *   const handleSubmit = (data: Record<string, unknown>) => {
 *     updateDocument(data, {
 *       onSuccess: () => {
 *         toast.success('Settings saved successfully');
 *       },
 *       onError: (error) => {
 *         toast.error(`Failed to save: ${error.message}`);
 *       },
 *     });
 *   };
 * }
 * ```
 */
export function useUpdateSingleDocument(slug: string) {
  const queryClient = useQueryClient();

  return useMutation<SingleDocument, Error, Record<string, unknown>>({
    mutationFn: async (data: Record<string, unknown>) => {
      return await singleApi.updateDocument(slug, data);
    },
    onSuccess: () => {
      // Invalidate the document cache
      void queryClient.invalidateQueries({
        queryKey: singleDocumentKeys.detail(slug),
      });
      // Also invalidate the general single documents list
      void queryClient.invalidateQueries({
        queryKey: singleDocumentKeys.all(),
      });
    },
  });
}
