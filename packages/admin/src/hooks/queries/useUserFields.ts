/**
 * User Fields Query Hooks
 *
 * TanStack Query hooks for user field definition CRUD and reorder operations.
 * Used by the Settings > User Fields pages and user create/edit forms.
 *
 * Query Keys:
 * - `["userFields"]` — base key for invalidation
 * - `["userFields", "list"]` — field list
 * - `["userFields", "detail", id]` — single field
 *
 * @example
 * ```ts
 * const { data } = useUserFields();
 * const { data: field } = useUserField('field-id');
 * const { mutate: create } = useCreateUserField();
 * const { mutate: reorder } = useReorderUserFields();
 * ```
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";

import {
  listFields,
  getField,
  createField,
  updateField,
  deleteField,
  reorderFields,
  type UserFieldDefinitionRecord,
  type CreateUserFieldPayload,
  type UpdateUserFieldPayload,
  type UserAdminConfig,
} from "@admin/services/userFieldsApi";

// ============================================================
// Query Key Factory
// ============================================================

export const userFieldKeys = {
  all: () => ["userFields"] as const,
  lists: () => [...userFieldKeys.all(), "list"] as const,
  details: () => [...userFieldKeys.all(), "detail"] as const,
  detail: (id: string) => [...userFieldKeys.details(), id] as const,
};

// ============================================================
// Query Hooks
// ============================================================

/**
 * useUserFields — Fetch all user field definitions.
 *
 * Returns `{ fields: UserFieldDefinitionRecord[], adminConfig?: UserAdminConfig }`.
 * Per spec §10.2 and handoff F14, `adminConfig` is part of the structured
 * `data` payload (not `meta`, which is reserved for pagination).
 * Client-side pagination/search is handled by the page component.
 */
export function useUserFields(
  options?: Omit<
    UseQueryOptions<
      { fields: UserFieldDefinitionRecord[]; adminConfig?: UserAdminConfig },
      Error
    >,
    "queryKey" | "queryFn"
  >
) {
  return useQuery<
    { fields: UserFieldDefinitionRecord[]; adminConfig?: UserAdminConfig },
    Error
  >({
    queryKey: userFieldKeys.lists(),
    queryFn: () => listFields(),
    ...options,
  });
}

/**
 * useUserField — Fetch a single user field definition by ID.
 * Only runs when `id` is provided (truthy).
 */
export function useUserField(
  id?: string,
  options?: Omit<
    UseQueryOptions<UserFieldDefinitionRecord, Error>,
    "queryKey" | "queryFn" | "enabled"
  >
) {
  return useQuery<UserFieldDefinitionRecord, Error>({
    queryKey: userFieldKeys.detail(id!),
    queryFn: () => {
      if (!id) throw new Error("Field ID is required");
      return getField(id);
    },
    enabled: !!id,
    ...options,
  });
}

// ============================================================
// Mutation Hooks
// ============================================================

/**
 * useCreateUserField — Create a new user field definition.
 * Invalidates all user field queries on success.
 */
export function useCreateUserField() {
  const queryClient = useQueryClient();

  return useMutation<UserFieldDefinitionRecord, Error, CreateUserFieldPayload>({
    mutationFn: data => createField(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: userFieldKeys.all(),
      });
    },
  });
}

/**
 * useUpdateUserField — Update an existing user field definition.
 * Invalidates all user field queries on success.
 */
export function useUpdateUserField() {
  const queryClient = useQueryClient();

  return useMutation<
    UserFieldDefinitionRecord,
    Error,
    { id: string; data: UpdateUserFieldPayload }
  >({
    mutationFn: ({ id, data }) => updateField(id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: userFieldKeys.all(),
      });
    },
  });
}

/**
 * useDeleteUserField — Delete a user field definition.
 * Invalidates all user field queries on success.
 */
export function useDeleteUserField() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: id => deleteField(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: userFieldKeys.all(),
      });
    },
  });
}

/**
 * useReorderUserFields — Reorder user field definitions.
 * Invalidates all user field queries on success.
 * The page component handles optimistic updates locally.
 */
export function useReorderUserFields() {
  const queryClient = useQueryClient();

  return useMutation<{ data: UserFieldDefinitionRecord[] }, Error, string[]>({
    mutationFn: fieldIds => reorderFields(fieldIds),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: userFieldKeys.all(),
      });
    },
  });
}
