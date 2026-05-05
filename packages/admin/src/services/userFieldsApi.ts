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
 * List all user field definitions. The dispatcher returns
 * `{ fields, total, adminConfig }` — a combined shape with the field
 * list and its admin-config siblings; we project to the inner object
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
 */
export async function getField(id: string): Promise<UserFieldDefinitionRecord> {
  return fetcher<UserFieldDefinitionRecord>(`/user-fields/${id}`, {}, true);
}

/**
 * Create a new user field definition.
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
 * Caller expects void; we discard the response body.
 */
export async function deleteField(id: string): Promise<void> {
  await fetcher<ActionResponse<{ fieldId: string }>>(
    `/user-fields/${id}`,
    { method: "DELETE" },
    true
  );
}

/**
 * Reorder user field definitions. Sends the full ordered array of
 * field IDs; the backend updates sortOrder accordingly. Returns the
 * legacy `{ data }` projection that existing callers consume.
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
