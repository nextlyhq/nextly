/**
 * Whether the signed-in user holds a permission, for a page that renders only
 * on a private route.
 *
 * It reads the same `/me/permissions` answer as `useCurrentUserPermissions`,
 * under the same key and in the same shape, without that hook's route gate.
 * The gate needs the router, and the router imports every page, so a page
 * that asks through it imports itself back.
 *
 * @module hooks/useHasPermission
 */
import { useQuery } from "@tanstack/react-query";

import { protectedApi } from "../lib/api/protectedApi";
import type { UserPermissionsResponse } from "../types/permissions";

import { CURRENT_USER_PERMISSIONS_KEY } from "./current-user-access";

/** The answer, stamped with when it was asked, as the shared entry holds it. */
async function askPermissions(): Promise<
  UserPermissionsResponse & { askedAt: number }
> {
  const askedAt = Date.now();
  const answer =
    await protectedApi.get<UserPermissionsResponse>("/me/permissions");
  return { ...answer, askedAt };
}

export function useHasPermission(): (slug: string) => boolean {
  const { data } = useQuery<UserPermissionsResponse & { askedAt: number }>({
    queryKey: CURRENT_USER_PERMISSIONS_KEY,
    queryFn: askPermissions,
    staleTime: 0,
  });
  return slug =>
    data?.isSuperAdmin === true || (data?.permissions ?? []).includes(slug);
}
