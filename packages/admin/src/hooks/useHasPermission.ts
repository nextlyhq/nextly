/**
 * Whether the signed-in user holds a permission, for a page that renders only
 * on a private route.
 *
 * It reads the same query as `useCurrentUserPermissions`, without that hook's
 * route gate. The gate needs the router, and the router imports every page,
 * so a page that asks through it imports itself back.
 *
 * @module hooks/useHasPermission
 */
import { useQuery } from "@tanstack/react-query";

import type { UserPermissionsResponse } from "../types/permissions";

import {
  CURRENT_USER_PERMISSIONS_KEY,
  fetchCurrentUserPermissions,
} from "./current-user-permissions-query";

export function useHasPermission(): (slug: string) => boolean {
  const { data } = useQuery<UserPermissionsResponse>({
    queryKey: CURRENT_USER_PERMISSIONS_KEY,
    queryFn: fetchCurrentUserPermissions,
    staleTime: 0,
  });
  return slug =>
    data?.isSuperAdmin === true || (data?.permissions ?? []).includes(slug);
}
