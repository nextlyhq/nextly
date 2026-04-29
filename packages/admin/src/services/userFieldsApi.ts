/**
 * User Fields API Service
 *
 * API client for managing user field definitions (custom fields on the user model).
 * Supports CRUD operations and drag-and-drop reordering.
 *
 * @example
 * ```ts
 * import { userFieldApi } from '@admin/services/userFieldsApi';
 *
 * const fields = await userFieldApi.listFields();
 * const field = await userFieldApi.getField('field-id');
 * await userFieldApi.reorderFields(['id-1', 'id-2', 'id-3']);
 * ```
 */

import { enhancedFetcher } from "../lib/api/enhancedFetcher";

// ============================================================
// Types
// ============================================================

export type UserFieldSource = "code" | "ui";

export type UserFieldType =
  | "text"
  | "textarea"
  | "number"
  | "email"
  | "select"
  | "radio"
  | "checkbox"
  | "date";

export interface UserFieldDefinitionRecord {
  id: string;
  name: string;
  label: string;
  type: UserFieldType;
  required: boolean;
  defaultValue: string | null;
  options: { label: string; value: string }[] | null;
  placeholder: string | null;
  description: string | null;
  sortOrder: number;
  source: UserFieldSource;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserFieldPayload {
  name: string;
  label: string;
  type: UserFieldType;
  required?: boolean;
  defaultValue?: string | null;
  options?: { label: string; value: string }[] | null;
  placeholder?: string | null;
  description?: string | null;
  isActive?: boolean;
}

export interface UpdateUserFieldPayload {
  name?: string;
  type?: UserFieldType;
  label?: string;
  required?: boolean;
  defaultValue?: string | null;
  options?: { label: string; value: string }[] | null;
  placeholder?: string | null;
  description?: string | null;
  isActive?: boolean;
}

export interface PaginationMeta {
  total: number;
}

export interface UserAdminConfig {
  listFields?: string[];
  group?: string;
}

export interface UserFieldsMeta extends PaginationMeta {
  adminConfig?: UserAdminConfig;
}

// ============================================================
// API Functions
// ============================================================

/**
 * List all user field definitions.
 *
 * Per spec §10.2 (handoff F14), the route now returns
 * `{ data: { fields: UserFieldDefinitionRecord[], adminConfig?: UserAdminConfig } }`.
 * The wire shape moved `adminConfig` out of `meta` (which is reserved for
 * pagination) into the structured `data` payload, so we unwrap and return
 * the inner object directly.
 */
export async function listFields(): Promise<{
  fields: UserFieldDefinitionRecord[];
  adminConfig?: UserAdminConfig;
}> {
  const result = await enhancedFetcher<{
    fields: UserFieldDefinitionRecord[];
    adminConfig?: UserAdminConfig;
  }>("/user-fields", {}, true);
  return result.data;
}

/**
 * Get a single user field definition by ID.
 */
export async function getField(id: string): Promise<UserFieldDefinitionRecord> {
  const result = await enhancedFetcher<UserFieldDefinitionRecord>(
    `/user-fields/${id}`,
    {},
    true
  );
  return result.data;
}

/**
 * Create a new user field definition.
 */
export async function createField(
  data: CreateUserFieldPayload
): Promise<UserFieldDefinitionRecord> {
  const result = await enhancedFetcher<UserFieldDefinitionRecord>(
    "/user-fields",
    { method: "POST", body: JSON.stringify(data) },
    true
  );
  return result.data;
}

/**
 * Update an existing user field definition.
 * Only UI-sourced fields can be updated (code-sourced fields return 422).
 */
export async function updateField(
  id: string,
  data: UpdateUserFieldPayload
): Promise<UserFieldDefinitionRecord> {
  const result = await enhancedFetcher<UserFieldDefinitionRecord>(
    `/user-fields/${id}`,
    { method: "PATCH", body: JSON.stringify(data) },
    true
  );
  return result.data;
}

/**
 * Delete a user field definition.
 * Only UI-sourced fields can be deleted (code-sourced fields return 422).
 */
export async function deleteField(id: string): Promise<void> {
  await enhancedFetcher<null>(`/user-fields/${id}`, { method: "DELETE" }, true);
}

/**
 * Reorder user field definitions.
 * Sends the full ordered array of field IDs; the backend updates sortOrder accordingly.
 */
export async function reorderFields(
  fieldIds: string[]
): Promise<{ data: UserFieldDefinitionRecord[] }> {
  return enhancedFetcher<UserFieldDefinitionRecord[]>(
    "/user-fields/reorder",
    {
      method: "PATCH",
      body: JSON.stringify({ fieldIds }),
    },
    true
  );
}

export const userFieldApi = {
  listFields,
  getField,
  createField,
  updateField,
  deleteField,
  reorderFields,
} as const;
