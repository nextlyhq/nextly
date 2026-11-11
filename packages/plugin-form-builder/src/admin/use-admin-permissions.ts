"use client";

/**
 * What the signed-in person may do, as the admin's permissions route answers
 * it: one reading of that answer for every Forms screen, so the editor and the
 * submissions list cannot come to disagree about what someone may see or do.
 *
 * @module admin/use-admin-permissions
 */
import { useQuery } from "@tanstack/react-query";

/** Whether the person holds a permission, spelled as stored (`read-forms`). */
export type PermissionCheck = (permission: string) => boolean;

/** The check the permissions route's answer gives; a super admin holds all. */
function permissionsFrom(body: unknown): PermissionCheck {
  if (typeof body !== "object" || body === null) return () => false;
  const superAdmin = "isSuperAdmin" in body && body.isSuperAdmin === true;
  const held = new Set<string>(
    "permissions" in body && Array.isArray(body.permissions)
      ? body.permissions.filter(
          (each): each is string => typeof each === "string"
        )
      : []
  );
  return permission => superAdmin || held.has(permission);
}

/** Reads the person's permissions; a refused read is an error. */
export async function readPermissions(): Promise<PermissionCheck> {
  const response = await fetch("/admin/api/me/permissions", {
    credentials: "include",
  });
  if (!response.ok) throw new Error(`permissions ${response.status}`);
  return permissionsFrom(await response.json());
}

/**
 * The person's permission check, or `undefined` while it is unknown (loading,
 * or the read failed). A screen offers what a permission gates only once the
 * answer says it may, so nothing is offered and then refused.
 */
export function useAdminPermissions(): PermissionCheck | undefined {
  const { data } = useQuery({
    queryKey: ["plugin-form-builder", "me-permissions"],
    queryFn: readPermissions,
    retry: false,
  });
  return data;
}
