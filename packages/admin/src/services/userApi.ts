import type { ListResponse, TableParams } from "@nextlyhq/ui";

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
 * The set-password link returned when a user is created in invite mode
 * (no password). `expiresAt` arrives as an ISO string over the wire.
 */
export interface CreatedUserInvite {
  link: string;
  expiresAt: string;
}

/** What {@link createUser} projects for its callers. */
export interface CreatedUser {
  id: string;
  /** Present only when the account was created in invite mode. */
  invite?: CreatedUserInvite;
}

/**
 * Create a user. Returns `{ id }`, plus the invite link when the account was
 * created without a password (invite mode).
 */
export const createUser = async (
  updates: CreateUserPayload
): Promise<CreatedUser> => {
  const result = await fetcher<MutationResponse<CreatedUser>>(
    `/users`,
    {
      method: "POST",
      body: JSON.stringify(updates),
    },
    true
  );
  return { id: result.item.id, invite: result.item.invite };
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
