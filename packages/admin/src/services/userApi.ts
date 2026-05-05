import type { ListResponse, TableParams } from "@revnixhq/ui";

import { buildQuery as buildQueryUtil } from "../lib/api/buildQuery";
import { fetcher } from "../lib/api/fetcher";
import type { MutationResponse } from "../lib/api/response-types";
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
 */
export const fetchUsers = async (
  params: TableParams
): Promise<ListResponse<UserApiResponse>> => {
  const query = buildQuery(params);
  const url = `/users${query ? `?${query}` : ""}`;
  return fetcher<ListResponse<UserApiResponse>>(url, {}, true);
};

/**
 * Update a user. Caller expects void; we discard the response body.
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
 * Create a user. Returns `{ id }` to match the projection callers
 * expect.
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
 * Delete a user. Caller expects void; we discard the response body.
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
