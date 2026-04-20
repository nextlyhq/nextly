import { TableParams, TableResponse } from "@revnixhq/ui";

import { buildQuery as buildQueryUtil } from "../lib/api/buildQuery";
import { enhancedFetcher } from "../lib/api/enhancedFetcher";
import { normalizePagination } from "../lib/api/normalizePagination";
import { isUser } from "../types/guards";
import {
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
 * Fetch users with pagination, search, and sorting
 */
export const fetchUsers = async (
  params: TableParams
): Promise<TableResponse<UserApiResponse>> => {
  const query = buildQuery(params);
  const url = `/users${query ? `?${query}` : ""}`;

  const result = await enhancedFetcher<
    UserApiResponse[],
    Record<string, unknown>
  >(url, {}, true);

  const users = result.data;
  const { pageSize = 10 } = params.pagination;
  const meta = normalizePagination(result.meta, pageSize, users.length);

  return { data: users, meta };
};

/**
 * Update a user
 */
export const updateUser = async (
  userId: string,
  updates: Partial<User> | UpdateUserPayload
): Promise<void> => {
  await enhancedFetcher<null>(
    `/users/${userId}`,
    {
      method: "PATCH",
      body: JSON.stringify(updates),
    },
    true
  );
};

export const createUser = async (
  updates: CreateUserPayload
): Promise<{ id: string }> => {
  const result = await enhancedFetcher<{ id: string }>(
    `/users`,
    {
      method: "POST",
      body: JSON.stringify(updates),
    },
    true
  );
  return { id: result.data.id };
};

export const deleteUser = async (userId: string): Promise<void> => {
  await enhancedFetcher<null>(
    `/users/${userId}`,
    {
      method: "DELETE",
    },
    true
  );
};
/**
 * Get user by ID
 */

export const getUserById = async (userId: string): Promise<User> => {
  const result = await enhancedFetcher<User>(`/users/${userId}`, {}, true);

  // Validate the response data before returning
  if (!isUser(result.data)) {
    throw new Error("Invalid user data received from API");
  }

  return result.data;
};

export const userApi = {
  fetchUsers,
  updateUser,
  createUser,
  deleteUser,
  getUserById,
} as const;
