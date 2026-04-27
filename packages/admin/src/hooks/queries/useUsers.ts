import type { TableParams, TableResponse } from "@revnixhq/ui";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";

import {
  createUser,
  deleteUser,
  fetchUsers,
  getUserById,
  updateUser,
} from "@admin/services/userApi";
import type {
  User,
  UserApiResponse,
  CreateUserPayload,
  UpdateUserPayload,
} from "@admin/types/user";

import { useBulkMutation } from "../useBulkMutation";

/**
 * Query Keys:
 * - `["users"]` - All users list (base key for invalidation)
 * - `["users", params]` - Paginated/filtered/sorted users list
 * - `["users", userId]` - Single user detail
 *
 * @example
 * ```ts
 * queryClient.invalidateQueries({ queryKey: ["users"] }); // Invalidates all user queries
 * queryClient.invalidateQueries({ queryKey: ["users", userId] }); // Invalidates specific user
 * ```
 */

/**
 * Default table parameters for user queries
 */
const defaultParams: TableParams = {
  pagination: { page: 0, pageSize: 10 },
  sorting: [],
  filters: {},
};

/**
 * useUsers - Query hook for fetching paginated user list
 *
 * Fetches users with pagination, search, and sorting support.
 * Automatically caches results and provides loading/error states.
 *
 * ## Query Key Structure
 * `["users", params]` - Hierarchical key for proper cache invalidation
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
 * @param options - Optional TanStack Query options (enabled, staleTime, refetchOnWindowFocus, etc.)
 * @returns TanStack Query result with user data, loading state, and error state
 *
 * @example
 * ```tsx
 * function UserList() {
 *   const { data, isLoading, error } = useUsers({
 *     pagination: { page: 0, pageSize: 10 },
 *     filters: { search: 'john' },
 *     sorting: [{ field: 'name', direction: 'asc' }],
 *   });
 *
 *   if (isLoading) return <Skeleton />;
 *   if (error) return <Alert>Error: {error.message}</Alert>;
 *
 *   return (
 *     <div>
 *       {data.data.map(user => (
 *         <UserCard key={user.id} user={user} />
 *       ))}
 *       <Pagination meta={data.meta} />
 *     </div>
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * // Conditional query execution with custom options
 * const { data } = useUsers(
 *   { filters: { search: searchQuery } },
 *   {
 *     enabled: searchQuery.length >= 2,
 *     staleTime: 60000, // 1 minute
 *     refetchOnWindowFocus: false,
 *   }
 * );
 * ```
 *
 * @see https://tanstack.com/query/v5/docs/react/reference/useQuery
 */
export function useUsers(
  params?: TableParams,
  options?: Omit<
    UseQueryOptions<TableResponse<UserApiResponse>, Error>,
    "queryKey" | "queryFn"
  >
) {
  return useQuery<TableResponse<UserApiResponse>, Error>({
    queryKey: ["users", params],
    queryFn: async () => {
      return await fetchUsers(params || defaultParams);
    },
    ...options,
  });
}

/**
 * useUser - Query hook for fetching a single user by ID
 *
 * Fetches a single user's details. Only runs when userId is provided.
 * Automatically caches result for fast navigation.
 *
 * ## Query Key Structure
 * `["users", userId]` - Hierarchical key for single user
 *
 * ## Features
 * - Conditional execution (only runs when userId exists)
 * - Automatic caching (5 minute staleTime)
 * - TypeScript type safety
 * - Error handling built-in
 *
 * @param userId - The ID of the user to fetch (optional)
 * @returns TanStack Query result with user data, loading state, and error state
 *
 * @example
 * ```tsx
 * function UserProfile({ userId }: { userId?: string }) {
 *   const { data: user, isLoading, error } = useUser(userId);
 *
 *   if (!userId) return <div>No user selected</div>;
 *   if (isLoading) return <Skeleton />;
 *   if (error) return <Alert>Error: {error.message}</Alert>;
 *   if (!user) return <div>User not found</div>;
 *
 *   return (
 *     <div>
 *       <h1>{user.name}</h1>
 *       <p>{user.email}</p>
 *       <Badge>{user.roles.join(', ')}</Badge>
 *     </div>
 *   );
 * }
 * ```
 *
 * @see https://tanstack.com/query/v5/docs/react/reference/useQuery
 */
export function useUser(userId?: string) {
  return useQuery<User, Error>({
    queryKey: ["users", userId],
    queryFn: async () => {
      // Safety check: This shouldn't execute due to `enabled` flag,
      // but provides defense against logic changes or direct queryFn calls
      if (!userId) {
        throw new Error("User ID is required");
      }
      return await getUserById(userId);
    },
    enabled: !!userId, // Only run query if userId is provided
  });
}

/**
 * useCreateUser - Mutation hook for creating a new user
 *
 * Creates a new user and automatically invalidates the users list cache.
 * Returns the ID of the created user for navigation or further actions.
 *
 * ## Cache Invalidation
 * Automatically invalidates `["users"]` query keys on success
 *
 * ## Features
 * - Returns created user ID
 * - Automatic cache invalidation
 * - Loading state management
 * - Error handling
 * - TypeScript type safety
 *
 * @returns TanStack Mutation result with mutate function and states
 *
 * @example
 * ```tsx
 * function CreateUserForm() {
 *   const { mutate: createUser, isPending, error } = useCreateUser();
 *   const navigate = useNavigate();
 *
 *   const handleSubmit = (data: Partial<User>) => {
 *     createUser(data, {
 *       onSuccess: (result) => {
 *         toast.success('User created successfully');
 *         navigate(`/users/${result.id}`);
 *       },
 *       onError: (error) => {
 *         toast.error(`Failed to create user: ${error.message}`);
 *       },
 *     });
 *   };
 *
 *   return (
 *     <form onSubmit={handleSubmit}>
 *       <Button type="submit" disabled={isPending}>
 *         {isPending ? 'Creating...' : 'Create User'}
 *       </Button>
 *     </form>
 *   );
 * }
 * ```
 *
 * @see https://tanstack.com/query/v5/docs/react/reference/useMutation
 */
export function useCreateUser() {
  const queryClient = useQueryClient();

  return useMutation<{ id: string }, Error, CreateUserPayload>({
    mutationFn: async (userData: CreateUserPayload) => {
      return await createUser(userData);
    },
    onSuccess: () => {
      // Invalidate all users queries to refetch data
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });
}

/**
 * useUpdateUser - Mutation hook for updating an existing user
 *
 * Updates a user's information and automatically invalidates relevant caches.
 * Implements optimistic updates for instant UI feedback with automatic rollback on error.
 *
 * ## Cache Invalidation
 * Automatically invalidates:
 * - `["users"]` - All users list queries
 * - `["users", userId]` - Specific user detail query
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
 *
 * @returns TanStack Mutation result with mutate function and states
 *
 * @example
 * ```tsx
 * function EditUserForm({ userId }: { userId: string }) {
 *   const { data: user } = useUser(userId);
 *   const { mutate: updateUser, isPending } = useUpdateUser();
 *
 *   const handleSubmit = (updates: Partial<User>) => {
 *     updateUser(
 *       { userId, updates },
 *       {
 *         onSuccess: () => {
 *           toast.success('User updated successfully');
 *         },
 *         onError: (error) => {
 *           toast.error(`Failed to update user: ${error.message}`);
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
export function useUpdateUser() {
  const queryClient = useQueryClient();

  return useMutation<
    void,
    Error,
    { userId: string; updates: Partial<User> },
    { previousUser: unknown }
  >({
    mutationFn: async ({ userId, updates }) => {
      return await updateUser(userId, updates);
    },
    onMutate: async ({ userId, updates }) => {
      // Cancel outgoing refetches (so they don't overwrite our optimistic update)
      await queryClient.cancelQueries({ queryKey: ["users", userId] });

      // Snapshot the previous value for rollback
      const previousUser = queryClient.getQueryData(["users", userId]);

      // Optimistically update the cache
      queryClient.setQueryData(["users", userId], (old: User | undefined) => {
        if (!old) return old;
        return { ...old, ...updates };
      });

      // Return context with snapshot for potential rollback
      return { previousUser };
    },
    onError: (error, { userId }, context) => {
      // Rollback to previous value on error
      if (context?.previousUser) {
        queryClient.setQueryData(["users", userId], context.previousUser);
      }
    },
    onSettled: (_, __, { userId }) => {
      // Always refetch after mutation (success or error) to ensure cache is up-to-date
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      void queryClient.invalidateQueries({ queryKey: ["users", userId] });
    },
  });
}

/**
 * useDeleteUser - Mutation hook for deleting a user
 *
 * Deletes a user and automatically invalidates the users list cache.
 * Provides loading state for UI feedback.
 *
 * ## Cache Invalidation
 * Automatically invalidates `["users"]` query keys on success
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
 * function DeleteUserButton({ userId }: { userId: string }) {
 *   const { mutate: deleteUser, isPending } = useDeleteUser();
 *
 *   const handleDelete = () => {
 *     if (confirm('Are you sure you want to delete this user?')) {
 *       deleteUser(userId, {
 *         onSuccess: () => {
 *           toast.success('User deleted successfully');
 *         },
 *         onError: (error) => {
 *           toast.error(`Failed to delete user: ${error.message}`);
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
 *       {isPending ? 'Deleting...' : 'Delete User'}
 *     </Button>
 *   );
 * }
 * ```
 *
 * @see https://tanstack.com/query/v5/docs/react/reference/useMutation
 */
export function useDeleteUser() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: async (userId: string) => {
      return await deleteUser(userId);
    },
    onSuccess: () => {
      // Invalidate all users queries to refetch data
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });
}

/**
 * useBulkUpdateUsers - Hook for updating multiple users in parallel
 *
 * Updates multiple users with the same data (e.g., enable/disable accounts, update fields).
 * Uses the generic `useBulkMutation` hook with `Promise.allSettled()` for parallel execution
 * and partial failure handling.
 *
 * ## Features
 * - ✅ Parallel execution for performance (all users updated simultaneously)
 * - ✅ Partial failure handling (some users succeed, some fail)
 * - ✅ Automatic cache invalidation after completion
 * - ✅ Detailed result tracking (succeeded/failed counts, individual errors)
 * - ✅ Loading state management via `isPending`
 *
 * ## Use Cases
 * - Bulk enable/disable user accounts
 * - Bulk update user status
 * - Bulk update any user field (except roles - use `useBulkAssignRole`)
 *
 * ## Architecture
 * ```
 * useBulkUpdateUsers (Entity-Specific)
 *   ↓ wraps
 * useBulkMutation (Generic)
 *   ↓ uses
 * Promise.allSettled()
 * ```
 *
 * @returns Bulk mutation hook with mutate function and loading state
 *
 * @example Bulk enable accounts
 * ```tsx
 * function BulkEnableButton({ userIds }: { userIds: string[] }) {
 *   const { mutate: bulkUpdateUsers, isPending } = useBulkUpdateUsers();
 *
 *   const handleBulkEnable = () => {
 *     bulkUpdateUsers(
 *       userIds,
 *       { isActive: true }, // updates to apply
 *       {
 *         onSuccess: (result) => {
 *           toast.success(`${result.succeeded} users enabled`);
 *         },
 *         onError: (result) => {
 *           toast.error(`${result.failed} users failed to enable`);
 *         },
 *       }
 *     );
 *   };
 *
 *   return (
 *     <Button onClick={handleBulkEnable} disabled={isPending}>
 *       {isPending ? 'Enabling...' : `Enable ${userIds.length} Users`}
 *     </Button>
 *   );
 * }
 * ```
 *
 * @example Bulk disable accounts
 * ```tsx
 * const { mutate: bulkUpdateUsers } = useBulkUpdateUsers();
 *
 * await bulkUpdateUsers(['user1', 'user2'], { isActive: false });
 * ```
 *
 * @see {@link useBulkMutation} - Generic bulk mutation hook
 * @see {@link useBulkAssignRole} - Specialized hook for role assignment
 */
export function useBulkUpdateUsers() {
  const queryClient = useQueryClient();

  return useBulkMutation<string, void, Error, Partial<User>>({
    mutationFn: async (userId, updates) => {
      await updateUser(userId, updates);
    },
    defaultOptions: {
      onComplete: () => {
        // Invalidate users cache after all mutations complete
        // This triggers a refetch of the users list to show updated data
        void queryClient.invalidateQueries({ queryKey: ["users"] });
      },
    },
  });
}

/**
 * useBulkDeleteUsers - Hook for deleting multiple users in parallel
 *
 * Deletes multiple users simultaneously using `Promise.allSettled()` for parallel execution.
 * Handles partial failures gracefully (some deletions succeed, some fail).
 *
 * ## Features
 * - ✅ Parallel execution for performance
 * - ✅ Partial failure handling (detailed error reporting)
 * - ✅ Automatic cache invalidation after completion
 * - ✅ Detailed result tracking (succeeded/failed counts, failed IDs for retry)
 * - ✅ Loading state management via `isPending`
 *
 * ## Use Cases
 * - Bulk delete selected users
 * - Cleanup inactive accounts
 * - Administrative user management
 *
 * ## Safety Considerations
 * - **Always show confirmation dialog** before calling this hook
 * - Deletion is permanent and cannot be undone
 * - Consider soft delete (isActive: false) for recoverability
 *
 * ## Architecture
 * ```
 * useBulkDeleteUsers (Entity-Specific)
 *   ↓ wraps
 * useBulkMutation (Generic)
 *   ↓ uses
 * Promise.allSettled()
 * ```
 *
 * @returns Bulk mutation hook with mutate function and loading state
 *
 * @example With confirmation dialog
 * ```tsx
 * function BulkDeleteButton({ userIds }: { userIds: string[] }) {
 *   const { mutate: bulkDeleteUsers, isPending } = useBulkDeleteUsers();
 *   const [dialogOpen, setDialogOpen] = useState(false);
 *
 *   const handleConfirmDelete = () => {
 *     bulkDeleteUsers(
 *       userIds,
 *       undefined, // no context needed for delete
 *       {
 *         onSuccess: (result) => {
 *           toast.success(`${result.succeeded} users deleted`);
 *           setDialogOpen(false);
 *         },
 *         onError: (result) => {
 *           toast.error(`${result.failed} users failed to delete`);
 *         },
 *       }
 *     );
 *   };
 *
 *   return (
 *     <>
 *       <Button variant="destructive" onClick={() => setDialogOpen(true)}>
 *         Delete {userIds.length} Users
 *       </Button>
 *       <BulkDeleteDialog
 *         open={dialogOpen}
 *         onOpenChange={setDialogOpen}
 *         userIds={userIds}
 *         onConfirm={handleConfirmDelete}
 *         isLoading={isPending}
 *       />
 *     </>
 *   );
 * }
 * ```
 *
 * @example Error handling with retry
 * ```tsx
 * const { mutate: bulkDeleteUsers } = useBulkDeleteUsers();
 *
 * const result = await bulkDeleteUsers(['user1', 'user2', 'user3'], undefined);
 *
 * if (result.failed > 0) {
 *   console.log('Failed to delete:', result.failedIds);
 *   // Optionally retry failed deletions
 *   await bulkDeleteUsers(result.failedIds, undefined);
 * }
 * ```
 *
 * @see {@link useBulkMutation} - Generic bulk mutation hook
 * @see {@link useDeleteUser} - Single user deletion hook
 */
export function useBulkDeleteUsers() {
  const queryClient = useQueryClient();

  return useBulkMutation<string, void, Error, void>({
    mutationFn: async userId => {
      await deleteUser(userId);
    },
    defaultOptions: {
      onComplete: () => {
        // Invalidate users cache after all mutations complete
        void queryClient.invalidateQueries({ queryKey: ["users"] });
      },
    },
  });
}

/**
 * useBulkAssignRole - Specialized hook for assigning role to multiple users
 *
 * Assigns a single role to multiple users in parallel. This is a specialized version of
 * `useBulkUpdateUsers` optimized for the role assignment use case.
 *
 * ## Features
 * - ✅ Parallel execution for performance
 * - ✅ Partial failure handling (some assignments succeed, some fail)
 * - ✅ Automatic cache invalidation after completion
 * - ✅ Detailed result tracking with user names for better feedback
 * - ✅ Type-safe role assignment (requires ApiRole structure)
 *
 * ## Use Cases
 * - Bulk assign role to new users (e.g., 10 new users → "Editor" role)
 * - Change role for multiple users (e.g., promote 5 users to "Admin")
 * - Administrative role management workflows
 *
 * ## Role Assignment Logic
 * - **Replaces** existing roles (not additive)
 * - Use `roles: [{ id: roleId }]` format for API compatibility
 * - Role name is not required (backend looks up by ID)
 *
 * ## Architecture
 * ```
 * useBulkAssignRole (Specialized)
 *   ↓ wraps
 * useBulkMutation (Generic)
 *   ↓ uses
 * updateUser(userId, { roles: [{ id: roleId }] })
 * ```
 *
 * @returns Bulk mutation hook with mutate function and loading state
 *
 * @example Basic usage
 * ```tsx
 * function BulkAssignRoleButton({ userIds, roleId }: Props) {
 *   const { mutate: bulkAssignRole, isPending } = useBulkAssignRole();
 *
 *   const handleAssignRole = () => {
 *     bulkAssignRole(
 *       userIds,
 *       { roleId }, // context: which role to assign
 *       {
 *         onSuccess: (result) => {
 *           toast.success(`${result.succeeded} users assigned to role`);
 *         },
 *         onError: (result) => {
 *           toast.error(`${result.failed} users failed`);
 *         },
 *       }
 *     );
 *   };
 *
 *   return (
 *     <Button onClick={handleAssignRole} disabled={isPending}>
 *       {isPending ? 'Assigning...' : 'Assign Role'}
 *     </Button>
 *   );
 * }
 * ```
 *
 * @example With role selection dialog
 * ```tsx
 * function BulkRoleAssignment() {
 *   const { mutate: bulkAssignRole } = useBulkAssignRole();
 *   const { data: roles } = useRoles();
 *   const [selectedRole, setSelectedRole] = useState<string | null>(null);
 *
 *   const handleConfirm = () => {
 *     if (!selectedRole) return;
 *
 *     bulkAssignRole(['user1', 'user2'], { roleId: selectedRole });
 *   };
 *
 *   return (
 *     <RoleAssignDialog
 *       roles={roles?.data || []}
 *       selectedRole={selectedRole}
 *       onRoleChange={setSelectedRole}
 *       onConfirm={handleConfirm}
 *     />
 *   );
 * }
 * ```
 *
 * @example With detailed error reporting
 * ```tsx
 * const { mutate: bulkAssignRole } = useBulkAssignRole();
 *
 * const result = await bulkAssignRole(
 *   ['user1', 'user2', 'user3'],
 *   { roleId: 'editor' },
 *   {
 *     onItemComplete: (itemResult) => {
 *       if (itemResult.status === 'rejected') {
 *         console.error(`Failed for ${itemResult.id}:`, itemResult.error);
 *       }
 *     },
 *   }
 * );
 *
 * // Retry failed assignments
 * if (result.failedIds.length > 0) {
 *   await bulkAssignRole(result.failedIds, { roleId: 'editor' });
 * }
 * ```
 *
 * @see {@link useBulkMutation} - Generic bulk mutation hook
 * @see {@link useBulkUpdateUsers} - General-purpose bulk update hook
 */
export function useBulkAssignRole() {
  const queryClient = useQueryClient();

  return useBulkMutation<string, void, Error, { roleId: string }>({
    mutationFn: async (userId, context) => {
      // Update user with new role (replaces existing roles)
      // Use UpdateUserPayload which accepts roles as objects with id property
      await updateUser(userId, {
        roles: [{ id: context.roleId }],
      } satisfies UpdateUserPayload);
    },
    defaultOptions: {
      onComplete: () => {
        // Invalidate users cache after all mutations complete
        void queryClient.invalidateQueries({ queryKey: ["users"] });
      },
    },
  });
}
