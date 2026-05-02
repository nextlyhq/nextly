import type { TableParams, TableResponse } from "@revnixhq/ui";

import { buildQuery as buildQueryUtil } from "../lib/api/buildQuery";
import { fetcher } from "../lib/api/fetcher";
import { normalizePagination } from "../lib/api/normalizePagination";
import type { ListResponse, MutationResponse } from "../lib/api/response-types";
import { isUser } from "../types/guards";
import type {
  User,
  UserApiResponse,
  CreateUserPayload,
  UpdateUserPayload,
} from "../types/user";

// Build query string for pagination and search using shared utility
const buildQuery = (params: TableParams): string => {
  return buildQueryUtil(params, {
    fieldMapping: {
      name: "name",
      email: "email",
      roles: "roles",
      created: "createdAt",
    },
    validSortFields: ["name", "email", "createdAt", "roles"],
  });
};

/**
 * Fetch users with pagination, search, and sorting.
 *
 * Phase 4 (Task 19): server now returns the canonical
 * `ListResponse<UserApiResponse>` shape (`{ items, meta }`); we map
 * `items` into the table component's `{ data, meta }` shape locally.
 */
export const fetchUsers = async (
  params: TableParams
): Promise<TableResponse<UserApiResponse>> => {
  const query = buildQuery(params);
  const url = `/users${query ? `?${query}` : ""}`;

  const result = await fetcher<ListResponse<UserApiResponse>>(url, {}, true);

  const users = result.items;
  const { pageSize = 10 } = params.pagination;
  // normalizePagination accepts the canonical { total, page, limit,
  // totalPages, ... } shape via its Record<string, unknown> input. Its
  // internal page-based detector keys on `pageSize`, so we widen the
  // canonical meta to a record before passing it through.
  const meta = normalizePagination(result.meta, pageSize, users.length);

  return { data: users, meta };
};

/**
 * Update a user.
 *
 * Phase 4 (Task 19): server returns `MutationResponse<User>`; we discard
 * the message + item here because the caller expects void.
 */
export const updateUser = async (
  userId: string,
  updates: Partial<User> | UpdateUserPayload
): Promise<void> => {
  await fetcher<MutationResponse<User>>(
    `/users/${userId}`,
    {
      method: "PATCH",
      body: JSON.stringify(updates),
    },
    true
  );
};

/**
 * Create a user.
 *
 * Phase 4 (Task 19): server returns `MutationResponse<User>` (`{ message,
 * item }`); we surface the legacy `{ id }` projection so existing callers
 * keep working.
 */
export const createUser = async (
  updates: CreateUserPayload
): Promise<{ id: string }> => {
  const result = await fetcher<MutationResponse<{ id: string }>>(
    `/users`,
    {
      method: "POST",
      body: JSON.stringify(updates),
    },
    true
  );
  return { id: result.item.id };
};

/**
 * Delete a user.
 *
 * Phase 4 (Task 19): server returns `MutationResponse<User>`; we discard.
 */
export const deleteUser = async (userId: string): Promise<void> => {
  await fetcher<MutationResponse<User>>(
    `/users/${userId}`,
    {
      method: "DELETE",
    },
    true
  );
};

/**
 * Get user by ID.
 *
 * Phase 4 (Task 19): findByID endpoints return the bare doc directly via
 * `respondDoc`, so we type the fetcher generic with the bare `User` shape.
 */
export const getUserById = async (userId: string): Promise<User> => {
  const result = await fetcher<User>(`/users/${userId}`, {}, true);

  // Validate the response data before returning
  if (!isUser(result)) {
    throw new Error("Invalid user data received from API");
  }

  return result;
};

export const userApi = {
  fetchUsers,
  updateUser,
  createUser,
  deleteUser,
  getUserById,
} as const;
