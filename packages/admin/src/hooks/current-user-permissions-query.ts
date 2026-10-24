/**
 * The signed-in user's permissions, as `/me/permissions` answers them: one
 * query, read by every hook that asks, so they share one cache entry.
 *
 * @module hooks/current-user-permissions-query
 */
import { protectedApi } from "../lib/api/protectedApi";
import type { UserPermissionsResponse } from "../types/permissions";

export const CURRENT_USER_PERMISSIONS_KEY: readonly ["currentUserPermissions"] =
  ["currentUserPermissions"];

export function fetchCurrentUserPermissions(): Promise<UserPermissionsResponse> {
  return protectedApi.get<UserPermissionsResponse>("/me/permissions");
}
