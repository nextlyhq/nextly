/**
 * What each write, and each read, of a system resource asks of its caller.
 *
 * Roles, permissions, users, field groups and media are written and read
 * through more than one door, the REST routes and the Direct API when it is
 * asked to be checked (and, for media writes, a plugin's
 * `ctx.services.media`), and every door must ask the same question. Declared
 * once here, as `API_KEY_ACTION_POLICY` is for API keys;
 * `system-write-policy.test.ts` holds the REST route gates to it, route by
 * route, so a change on either side that the other does not follow fails.
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
 * - Media: `create-media` to add a file or a folder, `update-media` to edit
 *   or move one, `delete-media` to delete one, as REST's media routes ask.
 *   A bulk upload has no REST route of its own and asks what one upload asks.
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
  users: {
    create: { action: "create", resource: "users" },
    update: { action: "update", resource: "users" },
    delete: { action: "delete", resource: "users" },
  },
  fieldGroups: {
    create: ownOrManage("create", "settings"),
    update: ownOrManage("update", "settings"),
    delete: ownOrManage("delete", "settings"),
  },
  media: {
    upload: { action: "create", resource: "media" },
    bulkUpload: { action: "create", resource: "media" },
    createFolder: { action: "create", resource: "media" },
    update: { action: "update", resource: "media" },
    moveToFolder: { action: "update", resource: "media" },
    updateFolder: { action: "update", resource: "media" },
    delete: { action: "delete", resource: "media" },
    bulkDelete: { action: "delete", resource: "media" },
    deleteFolder: { action: "delete", resource: "media" },
  },
} as const satisfies Record<string, Record<string, RouteGrant>>;

/** `read-roles`, or `read-permissions`, either one. */
const ROLE_OR_PERMISSION_READ: RouteGrant = {
  anyOf: [
    { action: "read", resource: "roles" },
    { action: "read", resource: "permissions" },
  ],
};

/**
 * The grant each system read asks, as REST's read routes ask it.
 *
 * - Users: `read-users`, for a list, a search or one user.
 * - Roles: `read-roles`; a role's permissions, `read-roles` or
 *   `read-permissions`.
 * - Permissions: `read-roles` to list them, which the role form needs, and
 *   `read-roles` or `read-permissions` for one.
 * - Media: `read-media`, for files and folders, as the admin's media routes
 *   ask; the public media mount serves reads without a check, but a call that
 *   asks to be checked is judged as the admin's are.
 *
 * Field groups ask no grant: REST serves their list and each one to any
 * signed-in caller, since the builder's palette reads them.
 */
export const SYSTEM_READ_POLICY = {
  users: {
    read: { action: "read", resource: "users" },
  },
  roles: {
    read: { action: "read", resource: "roles" },
    readPermissions: ROLE_OR_PERMISSION_READ,
  },
  permissions: {
    // Any of one, as REST asks it.
    list: { anyOf: [{ action: "read", resource: "roles" }] },
    read: ROLE_OR_PERMISSION_READ,
  },
  media: {
    read: { action: "read", resource: "media" },
  },
} as const satisfies Record<string, Record<string, RouteGrant>>;
