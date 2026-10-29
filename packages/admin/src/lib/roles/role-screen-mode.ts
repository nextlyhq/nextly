/**
 * How the roles screen shows a role, and what the Public role's rows offer.
 *
 * Super-admin and the Public role are told apart by the server's `builtIn`
 * marker, never by a slug, so the admin names neither.
 *
 * @module lib/roles/role-screen-mode
 */

import type { AccessLevel } from "@admin/lib/permissions/levels";
import type { Permission } from "@admin/types/ui/form";

/** The built-in roles the server marks. */
export type BuiltInRole = "public" | "super-admin";

/**
 * The roles screen's four faces: super-admin, which holds every permission
 * and is never edited; the Public role, whose permissions are what visitors
 * who aren't signed in may do; a preset, read-only and changed by copying
 * it; and every other role, edited as usual.
 */
export type RoleScreenMode = "super-admin" | "public" | "preset" | "editable";

/**
 * How the roles screen shows `role`: super-admin and Public by the server's
 * marker, any other built-in role as a preset, and every other role, or one
 * not made yet, as editable.
 */
export function roleScreenMode(
  role: {
    builtIn?: BuiltInRole;
    isSystemRole?: boolean;
    slug?: string;
  } | null
): RoleScreenMode {
  if (role?.builtIn === "super-admin") return "super-admin";
  if (role?.builtIn === "public") return "public";
  return role?.isSystemRole ? "preset" : "editable";
}

/**
 * Whether a role shown as `mode` is saved from the roles screen: super-admin
 * holds every permission, and a preset is changed by copying it.
 */
export function screenSaves(mode: RoleScreenMode): boolean {
  return mode === "editable" || mode === "public";
}

/**
 * The levels a Public role's row offers. A level that writes would open
 * entries to every visitor in one click, so writes are reached through a
 * row's switches alone, and warned about there.
 */
export const VISITOR_LEVELS: readonly AccessLevel[] = ["none", "view"];

/** What a visitor is never offered: a visitor never publishes. */
const NEVER_FOR_VISITORS = new Set(["publish", "unpublish"]);

/** The actions that change entries, warned about when visitors hold one. */
const VISITOR_WRITES = new Set(["create", "update", "delete"]);

/** The warning beside a row whose switches give visitors a write. */
export const VISITOR_WRITE_WARNING =
  "Visitors who aren't signed in can change these entries.";

/**
 * The switches a row offers among `permissions`: for the Public role's rows
 * (`visitors`), without the ones visitors are never offered.
 */
export function offeredSwitches(
  permissions: readonly Permission[],
  visitors: boolean
): readonly Permission[] {
  if (!visitors) return permissions;
  return permissions.filter(
    permission => !NEVER_FOR_VISITORS.has(permission.action)
  );
}

/** Whether `held` gives visitors a write among `permissions`. */
export function givesVisitorsAWrite(
  permissions: readonly Permission[],
  held: ReadonlySet<string>
): boolean {
  return permissions.some(
    permission =>
      VISITOR_WRITES.has(permission.action) && held.has(permission.id)
  );
}
