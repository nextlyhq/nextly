import type { TableParams, ListResponse } from "@revnixhq/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  deletePermission,
  fetchPermissions,
  getPermissionById,
  updatePermission,
} from "@admin/services/permissionApi";
import type { Permission } from "@admin/types/entities";

/**
 * Query Keys:
 * - `["permissions"]` - All permissions list (base key for invalidation)
 * - `["permissions", params]` - Paginated/filtered/sorted permissions list
 * - `["permissions", permissionId]` - Single permission detail
 *
 * @example
 * ```ts
 * queryClient.invalidateQueries({ queryKey: ["permissions"] }); // Invalidates all permission queries
 * queryClient.invalidateQueries({ queryKey: ["permissions", permissionId] }); // Invalidates specific permission
 * ```
 */

/**
 * Default table parameters for permission queries
 */
const defaultParams: TableParams = {
  pagination: { page: 0, pageSize: 50 }, // Larger page size - permissions are often viewed all at once
  sorting: [],
  filters: {},
};

/**
 * usePermissions - Query hook for fetching paginated permission list
 *
 * Fetches permissions with pagination, search, and sorting support.
 * Automatically caches results and provides loading/error states.
 *
 * ## Query Key Structure
 * `["permissions", params]` - Hierarchical key for proper cache invalidation
 *
 * ## Features
 * - Automatic caching (5 minute staleTime from QueryClient config)
 * - Pagination support (default 50 items per page)
 * - Search support (filters.search)
 * - Sorting support (sorting array)
 * - TypeScript type safety
 *
 * @param params - Table parameters for pagination, search, and sorting
 * @returns TanStack Query result with permission data, loading state, and error state
 *
 * @example
 * ```tsx
 * function PermissionList() {
 *   const { data, isLoading, error } = usePermissions({
 *     pagination: { page: 0, pageSize: 50 },
 *     filters: { search: 'user' },
 *     sorting: [{ field: 'name', direction: 'asc' }],
 *   });
 *
 *   if (isLoading) return <Skeleton />;
 *   if (error) return <Alert>Error: {error.message}</Alert>;
 *
 *   return (
 *     <div>
 *       {data.items.map(permission => (
 *         <PermissionCard key={permission.id} permission={permission} />
 *       ))}
 *       <Pagination meta={data.meta} />
 *     </div>
 *   );
 * }
 * ```
 *
 * @see https://tanstack.com/query/v5/docs/react/reference/useQuery
 */
export function usePermissions(params?: TableParams) {
  return useQuery<ListResponse<Permission>, Error>({
    queryKey: ["permissions", params],
    queryFn: async () => {
      return await fetchPermissions(params || defaultParams);
    },
  });
}

/**
 * usePermission - Query hook for fetching a single permission by ID
 *
 * Fetches a single permission's details. Only runs when permissionId is provided.
 * Automatically caches result for fast navigation.
 *
 * ## Query Key Structure
 * `["permissions", permissionId]` - Hierarchical key for single permission
 *
 * ## Features
 * - Conditional execution (only runs when permissionId exists)
 * - Automatic caching (5 minute staleTime)
 * - TypeScript type safety
 * - Error handling built-in
 *
 * @param permissionId - The ID of the permission to fetch (optional)
 * @returns TanStack Query result with permission data, loading state, and error state
 *
 * @example
 * ```tsx
 * function PermissionDetail({ permissionId }: { permissionId?: string }) {
 *   const { data: permission, isLoading, error } = usePermission(permissionId);
 *
 *   if (!permissionId) return <div>No permission selected</div>;
 *   if (isLoading) return <Skeleton />;
 *   if (error) return <Alert>Error: {error.message}</Alert>;
 *   if (!permission) return <div>Permission not found</div>;
 *
 *   return (
 *     <div>
 *       <h1>{permission.name}</h1>
 *       <p>{permission.description}</p>
 *       <Badge>{permission.usage}</Badge>
 *     </div>
 *   );
 * }
 * ```
 *
 * @see https://tanstack.com/query/v5/docs/react/reference/useQuery
 */
export function usePermission(permissionId?: string) {
  return useQuery<Permission, Error>({
    queryKey: ["permissions", permissionId],
    queryFn: async () => {
      // Safety check: This shouldn't execute due to `enabled` flag,
      // but provides defense against logic changes or direct queryFn calls
      if (!permissionId) {
        throw new Error("Permission ID is required");
      }
      return await getPermissionById(permissionId);
    },
    enabled: !!permissionId, // Only run query if permissionId is provided
  });
}

/**
 * useUpdatePermission - Mutation hook for updating an existing permission
 *
 * Updates a permission's information and automatically invalidates relevant caches.
 * Implements optimistic updates for instant UI feedback with automatic rollback on error.
 * Handles name, description, and usage status updates.
 *
 * ## Cache Invalidation
 * Automatically invalidates:
 * - `["permissions"]` - All permissions list queries
 * - `["permissions", permissionId]` - Specific permission detail query
 *
 * ## Optimistic Updates
 * The UI updates immediately before the server responds. If the server request fails,
 * the previous data is automatically restored (rollback).
 *
 * ## Features
 * - Optimistic updates for instant UX
 * - Automatic rollback on error
 * - Automatic cache invalidation
 * - Loading state management
 * - Error handling
 * - TypeScript type safety
 * - Mock data with simulated network delay
 *
 * @returns TanStack Mutation result with mutate function and states
 *
 * @example
 * ```tsx
 * function EditPermissionForm({ permissionId }: { permissionId: string }) {
 *   const { data: permission } = usePermission(permissionId);
 *   const { mutate: updatePermission, isPending } = useUpdatePermission();
 *
 *   const handleSubmit = (updates: Partial<Permission>) => {
 *     updatePermission(
 *       { permissionId, updates },
 *       {
 *         onSuccess: () => {
 *           toast.success('Permission updated successfully');
 *         },
 *         onError: (error) => {
 *           toast.error(`Failed to update permission: ${error.message}`);
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
 * @see https://tanstack.com/query/v5/docs/react/guides/optimistic-updates
 */
export function useUpdatePermission() {
  const queryClient = useQueryClient();

  return useMutation<
    Permission,
    Error,
    { permissionId: string; updates: Partial<Permission> },
    { previousPermission: unknown }
  >({
    mutationFn: async ({ permissionId, updates }) => {
      return await updatePermission(permissionId, updates);
    },
    onMutate: async ({ permissionId, updates }) => {
      // Cancel outgoing refetches (so they don't overwrite our optimistic update)
      await queryClient.cancelQueries({
        queryKey: ["permissions", permissionId],
      });

      // Snapshot the previous value for rollback
      const previousPermission = queryClient.getQueryData([
        "permissions",
        permissionId,
      ]);

      // Optimistically update the cache
      queryClient.setQueryData(
        ["permissions", permissionId],
        (old: Permission | undefined) => {
          if (!old) return old;
          return { ...old, ...updates };
        }
      );

      // Return context with snapshot for potential rollback
      return { previousPermission };
    },
    onError: (error, { permissionId }, context) => {
      // Rollback to previous value on error
      if (context?.previousPermission) {
        queryClient.setQueryData(
          ["permissions", permissionId],
          context.previousPermission
        );
      }
    },
    onSettled: (_, __, { permissionId }) => {
      // Always refetch after mutation (success or error) to ensure cache is up-to-date
      void queryClient.invalidateQueries({ queryKey: ["permissions"] });
      void queryClient.invalidateQueries({
        queryKey: ["permissions", permissionId],
      });
    },
  });
}

/**
 * useDeletePermission - Mutation hook for deleting a permission
 *
 * Deletes a permission and automatically invalidates the permissions list cache.
 * This is a soft delete that marks the permission as deleted in mock data.
 *
 * ## Cache Invalidation
 * Automatically invalidates `["permissions"]` query keys on success
 *
 * ## Features
 * - Automatic cache invalidation
 * - Loading state management
 * - Error handling
 * - TypeScript type safety
 * - Mock data with simulated network delay
 *
 * @returns TanStack Mutation result with mutate function and states
 *
 * @example
 * ```tsx
 * function DeletePermissionButton({ permissionId, permissionName }: { permissionId: string; permissionName: string }) {
 *   const { mutate: deletePermission, isPending } = useDeletePermission();
 *
 *   const handleDelete = () => {
 *     if (confirm(`Are you sure you want to delete the "${permissionName}" permission?`)) {
 *       deletePermission(permissionId, {
 *         onSuccess: () => {
 *           toast.success('Permission deleted successfully');
 *         },
 *         onError: (error) => {
 *           toast.error(`Failed to delete permission: ${error.message}`);
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
 *       {isPending ? 'Deleting...' : 'Delete Permission'}
 *     </Button>
 *   );
 * }
 * ```
 *
 * @see https://tanstack.com/query/v5/docs/react/reference/useMutation
 */
export function useDeletePermission() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: async (permissionId: string) => {
      return await deletePermission(permissionId);
    },
    onSuccess: () => {
      // Invalidate all permissions queries to refetch data
      void queryClient.invalidateQueries({ queryKey: ["permissions"] });
    },
  });
}
