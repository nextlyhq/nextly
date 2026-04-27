import type { TableParams, TableResponse } from "@revnixhq/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createRole,
  deleteRole,
  fetchRoles,
  getRoleById,
  updateRole,
} from "@admin/services/roleApi";
import type { Role } from "@admin/types/entities";

import { useBulkMutation } from "../useBulkMutation";

/**
 * Query Keys:
 * - `["roles"]` - All roles list (base key for invalidation)
 * - `["roles", params]` - Paginated/filtered/sorted roles list
 * - `["roles", roleId]` - Single role detail with permissions and child roles
 *
 * @example
 * ```ts
 * queryClient.invalidateQueries({ queryKey: ["roles"] }); // Invalidates all role queries
 * queryClient.invalidateQueries({ queryKey: ["roles", roleId] }); // Invalidates specific role
 * ```
 */

/**
 * Default table parameters for role queries
 */
const defaultParams: TableParams = {
  pagination: { page: 0, pageSize: 10 },
  sorting: [],
  filters: {},
};

/**
 * useRoles - Query hook for fetching paginated role list
 *
 * Fetches roles with pagination, search, and sorting support.
 * Automatically caches results and provides loading/error states.
 *
 * ## Query Key Structure
 * `["roles", params]` - Hierarchical key for proper cache invalidation
 *
 * ## Features
 * - Automatic caching (5 minute staleTime from QueryClient config)
 * - Pagination support
 * - Search support (filters.search)
 * - Sorting support (sorting array)
 * - TypeScript type safety
 * - Automatic role transformation (API format → UI format)
 *
 * @param params - Table parameters for pagination, search, and sorting
 * @returns TanStack Query result with role data, loading state, and error state
 *
 * @example
 * ```tsx
 * function RoleList() {
 *   const { data, isLoading, error } = useRoles({
 *     pagination: { page: 0, pageSize: 10 },
 *     filters: { search: 'admin' },
 *     sorting: [{ field: 'name', direction: 'asc' }],
 *   });
 *
 *   if (isLoading) return <Skeleton />;
 *   if (error) return <Alert>Error: {error.message}</Alert>;
 *
 *   return (
 *     <div>
 *       {data.data.map(role => (
 *         <RoleCard key={role.id} role={role} />
 *       ))}
 *       <Pagination meta={data.meta} />
 *     </div>
 *   );
 * }
 * ```
 *
 * @see https://tanstack.com/query/v5/docs/react/reference/useQuery
 */
export function useRoles(params?: TableParams) {
  return useQuery<TableResponse<Role>, Error>({
    queryKey: ["roles", params],
    queryFn: async () => {
      return await fetchRoles(params || defaultParams);
    },
  });
}

/**
 * useRole - Query hook for fetching a single role by ID
 *
 * Fetches a single role's details. Only runs when roleId is provided.
 * Automatically caches result for fast navigation.
 *
 * ## Query Key Structure
 * `["roles", roleId]` - Hierarchical key for single role
 *
 * ## Features
 * - Conditional execution (only runs when roleId exists)
 * - Automatic caching (5 minute staleTime)
 * - TypeScript type safety
 * - Error handling built-in
 *
 * @param roleId - The ID of the role to fetch (optional)
 * @returns TanStack Query result with role data, loading state, and error state
 *
 * @example
 * ```tsx
 * function RoleDetail({ roleId }: { roleId?: string }) {
 *   const { data: role, isLoading, error } = useRole(roleId);
 *
 *   if (!roleId) return <div>No role selected</div>;
 *   if (isLoading) return <Skeleton />;
 *   if (error) return <Alert>Error: {error.message}</Alert>;
 *   if (!role) return <div>Role not found</div>;
 *
 *   return (
 *     <div>
 *       <h1>{role.roleName}</h1>
 *       <p>{role.description}</p>
 *       <Badge>{role.type}</Badge>
 *       <div>
 *         <h2>Permissions</h2>
 *         {role.permissions.map(perm => (
 *           <Badge key={perm}>{perm}</Badge>
 *         ))}
 *       </div>
 *     </div>
 *   );
 * }
 * ```
 *
 * @see https://tanstack.com/query/v5/docs/react/reference/useQuery
 */
export function useRole(roleId?: string) {
  return useQuery<Role, Error>({
    queryKey: ["roles", roleId],
    queryFn: async () => {
      // Safety check: This shouldn't execute due to `enabled` flag,
      // but provides defense against logic changes or direct queryFn calls
      if (!roleId) {
        throw new Error("Role ID is required");
      }
      return await getRoleById(roleId);
    },
    enabled: !!roleId, // Only run query if roleId is provided
  });
}

/**
 * useCreateRole - Mutation hook for creating a new role
 *
 * Creates a new role and automatically invalidates the roles list cache.
 * Returns the ID of the created role for navigation/further actions.
 *
 * ## Cache Invalidation
 * Automatically invalidates `["roles"]` query keys on success
 *
 * ## Features
 * - Automatic cache invalidation
 * - Returns created role ID
 * - Loading state management
 * - Error handling
 * - TypeScript type safety
 *
 * @returns TanStack Mutation result with mutate function and states
 *
 * @example
 * ```tsx
 * function CreateRoleForm() {
 *   const { mutate: createRole, isPending, error } = useCreateRole();
 *   const navigate = useNavigate();
 *
 *   const handleSubmit = (data: Partial<Role>) => {
 *     createRole(data, {
 *       onSuccess: (result) => {
 *         toast.success('Role created successfully');
 *         navigate(`/roles/${result.id}`);
 *       },
 *       onError: (error) => {
 *         toast.error(`Failed to create role: ${error.message}`);
 *       },
 *     });
 *   };
 *
 *   return (
 *     <form onSubmit={handleSubmit}>
 *       <Button type="submit" disabled={isPending}>
 *         {isPending ? 'Creating...' : 'Create Role'}
 *       </Button>
 *     </form>
 *   );
 * }
 * ```
 *
 * @see https://tanstack.com/query/v5/docs/react/reference/useMutation
 */
export function useCreateRole() {
  const queryClient = useQueryClient();

  return useMutation<{ id: string }, Error, Partial<Role>>({
    mutationFn: async (roleData: Partial<Role>) => {
      return await createRole(roleData);
    },
    onSuccess: () => {
      // Invalidate all roles queries to refetch data
      queryClient.invalidateQueries({ queryKey: ["roles"] });
    },
  });
}

/**
 * useUpdateRole - Mutation hook for updating an existing role
 *
 * Updates a role's information and automatically invalidates relevant caches.
 * Implements optimistic updates for instant UI feedback with automatic rollback on error.
 * Handles permission updates, child role assignments, and metadata changes.
 *
 * ## Cache Invalidation
 * Automatically invalidates:
 * - `["roles"]` - All roles list queries
 * - `["roles", roleId]` - Specific role detail query
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
 * - Supports permission & child role updates
 *
 * @returns TanStack Mutation result with mutate function and states
 *
 * @example
 * ```tsx
 * function EditRoleForm({ roleId }: { roleId: string }) {
 *   const { data: role } = useRole(roleId);
 *   const { mutate: updateRole, isPending } = useUpdateRole();
 *
 *   const handleSubmit = (updates: Partial<Role>) => {
 *     updateRole(
 *       { roleId, updates },
 *       {
 *         onSuccess: () => {
 *           toast.success('Role updated successfully');
 *         },
 *         onError: (error) => {
 *           toast.error(`Failed to update role: ${error.message}`);
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
export function useUpdateRole() {
  const queryClient = useQueryClient();

  return useMutation<
    void,
    Error,
    { roleId: string; updates: Partial<Role> },
    { previousRole: unknown }
  >({
    mutationFn: async ({ roleId, updates }) => {
      return await updateRole(roleId, updates);
    },
    onMutate: async ({ roleId, updates }) => {
      // Cancel outgoing refetches (so they don't overwrite our optimistic update)
      await queryClient.cancelQueries({ queryKey: ["roles", roleId] });

      // Snapshot the previous value for rollback
      const previousRole = queryClient.getQueryData(["roles", roleId]);

      // Optimistically update the cache
      queryClient.setQueryData(["roles", roleId], (old: Role | undefined) => {
        if (!old) return old;
        return { ...old, ...updates };
      });

      // Return context with snapshot for potential rollback
      return { previousRole };
    },
    onError: (error, { roleId }, context) => {
      // Rollback to previous value on error
      if (context?.previousRole) {
        queryClient.setQueryData(["roles", roleId], context.previousRole);
      }
    },
    onSettled: (_, __, { roleId }) => {
      // Always refetch after mutation (success or error) to ensure cache is up-to-date
      queryClient.invalidateQueries({ queryKey: ["roles"] });
      queryClient.invalidateQueries({ queryKey: ["roles", roleId] });
    },
  });
}

/**
 * useDeleteRole - Mutation hook for deleting a role
 *
 * Deletes a role and automatically invalidates the roles list cache.
 * Handles system role protection and user reassignment on the server side.
 *
 * ## Cache Invalidation
 * Automatically invalidates `["roles"]` query keys on success
 *
 * ## Features
 * - Automatic cache invalidation
 * - Loading state management
 * - Error handling
 * - TypeScript type safety
 * - Server-side validation (system role protection)
 *
 * @returns TanStack Mutation result with mutate function and states
 *
 * @example
 * ```tsx
 * function DeleteRoleButton({ roleId, roleName }: { roleId: string; roleName: string }) {
 *   const { mutate: deleteRole, isPending } = useDeleteRole();
 *
 *   const handleDelete = () => {
 *     if (confirm(`Are you sure you want to delete the "${roleName}" role?`)) {
 *       deleteRole(roleId, {
 *         onSuccess: () => {
 *           toast.success('Role deleted successfully');
 *         },
 *         onError: (error) => {
 *           toast.error(`Failed to delete role: ${error.message}`);
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
 *       {isPending ? 'Deleting...' : 'Delete Role'}
 *     </Button>
 *   );
 * }
 * ```
 *
 * @see https://tanstack.com/query/v5/docs/react/reference/useMutation
 */
export function useDeleteRole() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: async (roleId: string) => {
      return await deleteRole(roleId);
    },
    onSuccess: () => {
      // Invalidate all roles queries to refetch data
      queryClient.invalidateQueries({ queryKey: ["roles"] });
    },
  });
}

/**
 * useBulkDeleteRoles - Bulk mutation hook for deleting multiple roles
 *
 * Executes parallel delete operations for multiple roles using Promise.allSettled().
 * Allows partial failures where some deletions succeed while others fail.
 * Automatically invalidates the roles cache after all operations complete.
 *
 * ## Features
 * - ✅ Parallel execution with Promise.allSettled()
 * - ✅ Partial failure handling (some succeed, some fail)
 * - ✅ Detailed results with success/failure counts
 * - ✅ Automatic cache invalidation after completion
 * - ✅ TypeScript type safety
 * - ✅ Server-side validation (system role protection)
 *
 * ## Architecture
 *
 * ```
 * useBulkDeleteRoles (Entity-Specific)
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
 *   total: 10,           // Total roles attempted
 *   succeededIds: [...], // IDs of successfully deleted roles
 *   failedIds: [...],    // IDs of roles that failed to delete
 *   results: [...]       // Individual results with error details
 * }
 * ```
 *
 * ## Cache Invalidation
 * Automatically invalidates `["roles"]` query keys after all operations complete
 *
 * ## Safety Considerations
 * - System roles cannot be deleted (server-side validation)
 * - User reassignment handled on server side
 * - Always show confirmation dialog before calling this hook
 *
 * @returns Bulk mutation interface with mutate function, isPending state, and result
 *
 * @example Basic usage - Delete multiple roles
 * ```tsx
 * function RoleListActions() {
 *   const { mutate: bulkDelete, isPending } = useBulkDeleteRoles();
 *   const [selectedIds, setSelectedIds] = useState<string[]>([]);
 *
 *   const handleBulkDelete = async () => {
 *     const result = await bulkDelete(selectedIds, undefined);
 *
 *     if (result.failed > 0) {
 *       toast.error(`${result.failed} roles failed to delete`);
 *     }
 *     if (result.succeeded > 0) {
 *       toast.success(`${result.succeeded} roles deleted successfully`);
 *     }
 *   };
 *
 *   return (
 *     <Button onClick={handleBulkDelete} disabled={isPending}>
 *       {isPending ? 'Deleting...' : `Delete ${selectedIds.length} Roles`}
 *     </Button>
 *   );
 * }
 * ```
 *
 * @example With callbacks and error handling
 * ```tsx
 * const { mutate: bulkDelete } = useBulkDeleteRoles();
 *
 * bulkDelete(['role1', 'role2', 'role3'], undefined, {
 *   onSuccess: (result) => {
 *     toast.success(`${result.succeeded} roles deleted`);
 *   },
 *   onError: (result) => {
 *     // Show which roles failed (may include system roles)
 *     toast.error(`${result.failed} roles failed to delete`);
 *     console.error('Failed role IDs:', result.failedIds);
 *   },
 * });
 * ```
 *
 * @see useBulkMutation - Generic bulk mutation hook
 * @see useDeleteRole - Single role deletion hook
 * @see useBulkDeleteUsers - Similar pattern for users
 */
export function useBulkDeleteRoles() {
  const queryClient = useQueryClient();

  return useBulkMutation<string, void, Error, void>({
    mutationFn: async (roleId: string) => {
      await deleteRole(roleId);
    },
    defaultOptions: {
      onComplete: () => {
        queryClient.invalidateQueries({ queryKey: ["roles"] });
      },
    },
  });
}

/**
 * useBulkUpdateRoles - Bulk mutation hook for updating multiple roles
 *
 * Executes parallel update operations for multiple roles using Promise.allSettled().
 * Allows partial failures where some updates succeed while others fail.
 * Automatically invalidates the roles cache after all operations complete.
 *
 * ## Features
 * - ✅ Parallel execution with Promise.allSettled()
 * - ✅ Partial failure handling (some succeed, some fail)
 * - ✅ Detailed results with success/failure counts
 * - ✅ Automatic cache invalidation after completion
 * - ✅ TypeScript type safety
 * - ✅ Accepts Partial<Role> via context parameter
 * - ✅ Supports permission & child role updates
 *
 * ## Architecture
 *
 * ```
 * useBulkUpdateRoles (Entity-Specific)
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
 *   total: 10,           // Total roles attempted
 *   succeededIds: [...], // IDs of successfully updated roles
 *   failedIds: [...],    // IDs of roles that failed to update
 *   results: [...]       // Individual results with error details
 * }
 * ```
 *
 * ## Cache Invalidation
 * Automatically invalidates `["roles"]` query keys after all operations complete
 *
 * ## Use Cases
 * - Bulk assign child roles
 * - Bulk update descriptions
 * - Bulk update permissions
 * - Bulk modify role metadata
 *
 * @returns Bulk mutation interface with mutate function, isPending state, and result
 *
 * @example Bulk update role descriptions
 * ```tsx
 * function BulkUpdateDescriptions() {
 *   const { mutate: bulkUpdate, isPending } = useBulkUpdateRoles();
 *   const [selectedIds, setSelectedIds] = useState<string[]>([]);
 *
 *   const handleBulkUpdate = async () => {
 *     const updates: Partial<Role> = {
 *       description: 'Updated via bulk operation',
 *     };
 *
 *     const result = await bulkUpdate(selectedIds, updates);
 *
 *     if (result.failed > 0) {
 *       toast.error(`${result.failed} roles failed to update`);
 *     }
 *     if (result.succeeded > 0) {
 *       toast.success(`${result.succeeded} roles updated`);
 *     }
 *   };
 *
 *   return (
 *     <Button onClick={handleBulkUpdate} disabled={isPending}>
 *       {isPending ? 'Updating...' : `Update ${selectedIds.length} Roles`}
 *     </Button>
 *   );
 * }
 * ```
 *
 * @example Bulk assign child roles with progress tracking
 * ```tsx
 * const [progress, setProgress] = useState(0);
 * const { mutate: bulkUpdate } = useBulkUpdateRoles();
 *
 * bulkUpdate(['role1', 'role2'], { childRoleIds: ['child-role-id'] }, {
 *   onItemComplete: (itemResult) => {
 *     setProgress(prev => prev + 1);
 *     console.log(`Role ${itemResult.id}: ${itemResult.status}`);
 *   },
 *   onSuccess: (result) => {
 *     toast.success(`${result.succeeded} roles updated`);
 *   },
 * });
 * ```
 *
 * @example Bulk update with detailed error logging
 * ```tsx
 * const { mutate: bulkUpdate } = useBulkUpdateRoles();
 *
 * bulkUpdate(roleIds, updates, {
 *   onComplete: (result) => {
 *     // Log failed items for debugging
 *     result.results
 *       .filter(r => r.status === 'rejected')
 *       .forEach(r => {
 *         console.error(`Failed to update role ${r.id}:`, r.error);
 *       });
 *
 *     // Show summary
 *     if (result.failed > 0) {
 *       toast.error(
 *         `${result.failed} of ${result.total} role updates failed. Check console for details.`
 *       );
 *     }
 *   },
 * });
 * ```
 *
 * @see useBulkMutation - Generic bulk mutation hook
 * @see useUpdateRole - Single role update hook with optimistic updates
 * @see useBulkUpdateUsers - Similar pattern for users
 */
export function useBulkUpdateRoles() {
  const queryClient = useQueryClient();

  return useBulkMutation<string, void, Error, Partial<Role>>({
    mutationFn: async (roleId: string, updates: Partial<Role>) => {
      await updateRole(roleId, updates);
    },
    defaultOptions: {
      onComplete: () => {
        queryClient.invalidateQueries({ queryKey: ["roles"] });
      },
    },
  });
}
