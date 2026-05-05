/**
 * TanStack Query Hooks
 *
 * This module exports all query and mutation hooks for data fetching and manipulation
 * in the admin application. All hooks use TanStack Query v5 for automatic caching,
 * loading states, error handling, and cache invalidation.
 *
 * ## Query Hooks (Data Fetching)
 * - useUsers, useUser - Fetch user data
 * - useRoles, useRole - Fetch role data
 * - usePermissions, usePermission - Fetch permission data
 * - useCollections, useCollection - Fetch collection data
 * - useEntries, useEntry, useEntryCount - Fetch collection entry data
 *
 * ## Mutation Hooks (Data Manipulation)
 * - useCreateUser, useUpdateUser, useDeleteUser - User CRUD operations
 * - useCreateRole, useUpdateRole, useDeleteRole - Role CRUD operations
 * - useUpdatePermission, useDeletePermission - Permission update/delete operations
 * - useCreateCollection, useUpdateCollection, useDeleteCollection - Collection CRUD operations
 * - useCreateEntry, useUpdateEntry, useDeleteEntry - Entry CRUD operations
 * - useBulkDeleteEntries, useBulkUpdateEntries - Bulk entry operations
 *
 * @module hooks/queries
 * @see https://tanstack.com/query/v5/docs/react/overview
 */

// User query and mutation hooks
export {
  useCreateUser,
  useDeleteUser,
  useUpdateUser,
  useUser,
  useUsers,
  // Bulk user mutation hooks
  useBulkUpdateUsers,
  useBulkDeleteUsers,
  useBulkAssignRole,
} from "./useUsers";

// Role query and mutation hooks
export {
  useCreateRole,
  useDeleteRole,
  useRole,
  useRoles,
  useUpdateRole,
  // Bulk role mutation hooks
  useBulkDeleteRoles,
  useBulkUpdateRoles,
} from "./useRoles";

// Permission query and mutation hooks
export {
  useDeletePermission,
  usePermission,
  usePermissions,
  useUpdatePermission,
} from "./usePermissions";

// Collection query and mutation hooks
export {
  collectionKeys, // Query key factory for stable caching
  useCollection,
  useCollectionSchema,
  useCollections,
  useCreateCollection,
  useDeleteCollection,
  useUpdateCollection,
  // Bulk collection mutation hooks
  useBulkDeleteCollections,
  useBulkUpdateCollections,
} from "./useCollections";

// Entry query and mutation hooks
export { useEntries, useEntryCount } from "./useEntries";
export { useEntry } from "./useEntry";
export { useCreateEntry } from "./useCreateEntry";
export { useUpdateEntry } from "./useUpdateEntry";
export { useDeleteEntry } from "./useDeleteEntry";
export { useBulkDeleteEntries, useBulkUpdateEntries } from "./useBulkEntries";

// Re-export entry keys from entryApi for query key management
export { entryKeys } from "@admin/services/entryApi";

// Single query and mutation hooks
export {
  singleKeys, // Query key factory for stable caching
  useSingle,
  useSingles,
  useCreateSingle,
  useDeleteSingle,
  useUpdateSingle,
  // Bulk Single mutation hooks
  useBulkDeleteSingles,
  // Document-specific hooks (for editing Single content)
  singleDocumentKeys,
  useSingleDocument,
  useSingleSchema,
  useUpdateSingleDocument,
  type SingleDocument,
} from "./useSingles";

// Component query and mutation hooks
export {
  componentKeys, // Query key factory for stable caching
  useComponent,
  useComponents,
  useCreateComponent,
  useDeleteComponent,
  useUpdateComponent,
  // Bulk Component mutation hooks
  useBulkDeleteComponents,
} from "./useComponents";

// Dashboard query hooks
export { useDashboardStats } from "./useDashboardStats";
export { useRecentEntries } from "./useRecentEntries";
export { useRecentActivity } from "./useRecentActivity";
export { useOnboardingProgress } from "./useOnboardingProgress";
export { useCollectionCounts } from "./useCollectionCounts";

// API Key query and mutation hooks
export {
  apiKeyKeys, // Query key factory for stable caching
  useApiKeys,
  useCreateApiKey,
  useUpdateApiKey,
  useRevokeApiKey,
} from "./useApiKeys";
