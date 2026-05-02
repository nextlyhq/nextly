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

import { fetcher } from "../lib/api/fetcher";
import type {
  ActionResponse,
  MutationResponse,
} from "../lib/api/response-types";

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
 * Phase 4 (Task 19): the user-fields dispatcher emits
 * `respondData({ fields, total, adminConfig })`, a structured-data shape
 * that combines the field list with the admin-config siblings. We type
 * the fetcher with that bare shape and project the inner object the
 * existing callers expect.
 */
export async function listFields(): Promise<{
  fields: UserFieldDefinitionRecord[];
  adminConfig?: UserAdminConfig;
}> {
  const result = await fetcher<{
    fields: UserFieldDefinitionRecord[];
    total: number;
    adminConfig?: UserAdminConfig;
  }>("/user-fields", {}, true);
  return { fields: result.fields, adminConfig: result.adminConfig };
}

/**
 * Get a single user field definition by ID.
 *
 * Phase 4 (Task 19): findByID returns the bare doc via respondDoc.
 */
export async function getField(id: string): Promise<UserFieldDefinitionRecord> {
  return fetcher<UserFieldDefinitionRecord>(`/user-fields/${id}`, {}, true);
}

/**
 * Create a new user field definition.
 *
 * Phase 4 (Task 19): server returns
 * `MutationResponse<UserFieldDefinitionRecord>`; project `item` for the
 * bare-record public signature.
 */
export async function createField(
  data: CreateUserFieldPayload
): Promise<UserFieldDefinitionRecord> {
  const result = await fetcher<MutationResponse<UserFieldDefinitionRecord>>(
    "/user-fields",
    { method: "POST", body: JSON.stringify(data) },
    true
  );
  return result.item;
}

/**
 * Update an existing user field definition.
 * Only UI-sourced fields can be updated (code-sourced fields return 422).
 *
 * Phase 4 (Task 19): server returns
 * `MutationResponse<UserFieldDefinitionRecord>`; project `item`.
 */
export async function updateField(
  id: string,
  data: UpdateUserFieldPayload
): Promise<UserFieldDefinitionRecord> {
  const result = await fetcher<MutationResponse<UserFieldDefinitionRecord>>(
    `/user-fields/${id}`,
    { method: "PATCH", body: JSON.stringify(data) },
    true
  );
  return result.item;
}

/**
 * Delete a user field definition.
 * Only UI-sourced fields can be deleted (code-sourced fields return 422).
 *
 * Phase 4 (Task 19): the dispatcher emits
 * `respondAction("User field deleted.", { fieldId })` because the service
 * returns void; we discard the body since the caller expects void.
 */
export async function deleteField(id: string): Promise<void> {
  await fetcher<ActionResponse<{ fieldId: string }>>(
    `/user-fields/${id}`,
    { method: "DELETE" },
    true
  );
}

/**
 * Reorder user field definitions.
 * Sends the full ordered array of field IDs; the backend updates sortOrder accordingly.
 *
 * Phase 4 (Task 19): the dispatcher emits
 * `respondAction("User fields reordered.", { fields })`. We project to
 * the legacy `{ data: UserFieldDefinitionRecord[] }` shape so existing
 * callers keep working.
 */
export async function reorderFields(
  fieldIds: string[]
): Promise<{ data: UserFieldDefinitionRecord[] }> {
  const result = await fetcher<
    ActionResponse<{ fields: UserFieldDefinitionRecord[] }>
  >(
    "/user-fields/reorder",
    {
      method: "PATCH",
      body: JSON.stringify({ fieldIds }),
    },
    true
  );
  return { data: result.fields };
}

export const userFieldApi = {
  listFields,
  getField,
  createField,
  updateField,
  deleteField,
  reorderFields,
} as const;
