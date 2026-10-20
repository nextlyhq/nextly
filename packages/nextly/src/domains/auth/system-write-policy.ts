/**
 * What each write to a system resource asks of its caller.
 *
 * Roles, permissions and field groups are written through two doors, the REST
 * routes and the Direct API when it is asked to be checked, and both must ask
 * the same question. Declared once here, as `API_KEY_ACTION_POLICY` is for API
 * keys; `system-write-policy.test.ts` holds the REST route gates to it, route
 * by route, so a change on either side that the other does not follow fails.
 *
 * @module domains/auth/system-write-policy
 */

/** One permission, as `action` on `resource`. */
export interface SystemPermission {
  readonly action: string;
  readonly resource: string;
}

/**
 * What a write asks: one permission (the REST routes' `requirePermission`), or
 * any one of several (`requireAnyPermission`).
 */
export type RouteGrant =
  | SystemPermission
  | { readonly anyOf: readonly SystemPermission[] };

/** The operation's own action on `resource`, or `manage` on it, either one. */
function ownOrManage(action: string, resource: string): RouteGrant {
  return {
    anyOf: [
      { action, resource },
      { action: "manage", resource },
    ],
  };
}

/**
 * The grant each system write asks.
 *
 * - Roles: their own action on `roles`; changing what a role grants is
 *   updating the role.
 * - Permissions: their own action on `permissions`, or `manage-permissions`.
 * - Field groups: their own action on `settings`, or `manage-settings`.
 */
export const SYSTEM_WRITE_POLICY = {
  roles: {
    create: { action: "create", resource: "roles" },
    update: { action: "update", resource: "roles" },
    delete: { action: "delete", resource: "roles" },
    setPermissions: { action: "update", resource: "roles" },
  },
  permissions: {
    create: ownOrManage("create", "permissions"),
    delete: ownOrManage("delete", "permissions"),
  },
  fieldGroups: {
    create: ownOrManage("create", "settings"),
    update: ownOrManage("update", "settings"),
    delete: ownOrManage("delete", "settings"),
  },
} as const satisfies Record<string, Record<string, RouteGrant>>;
