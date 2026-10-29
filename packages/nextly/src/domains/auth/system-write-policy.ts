/**
 * What each write, and each read, of a system resource asks of its caller.
 *
 * Roles, permissions, users, settings, the Email hub and media are written
 * and read through more than one door, the REST routes and the Direct API when it is
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
  | {
      readonly anyOf: readonly SystemPermission[];
      /** What a refusal names, where the alternatives are about other things. */
      readonly names?: SystemPermission;
    };

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
 * `action` on `resource` alone, asked through the any-of check as a list of
 * one. The settings and Email hub routes have always asked the any-of check;
 * a list of one keeps them on it, and so keeps a `manage-` permission
 * counting as the plain one there, rather than moving them to the
 * single-grant check, which reads an entity's own rule where an entity of
 * that name exists.
 */
function only(
  action: string,
  resource: string
): { readonly anyOf: readonly SystemPermission[] } {
  return { anyOf: [{ action, resource }] };
}

/**
 * The grant each system write asks.
 *
 * - Roles: their own action on `roles`; changing what a role grants is
 *   updating the role.
 * - Permissions: their own action on `permissions`, or `manage-permissions`.
 * - Settings: the general settings, languages, image sizes, user fields,
 *   field groups, the sidebar's groups, a plugin's settings and the preview
 *   links all ask their own action on `settings`. Regenerating image sizes
 *   updates them. A role still holding `manage-settings` passes each, since
 *   it counts as the plain four on settings.
 * - Email providers and email templates: their own action on each. Sending
 *   a test through a provider, or previewing a template, creates nothing
 *   stored and asks create, as the routes have; making a provider the
 *   default updates it. `manage-` counts as on settings.
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
  settings: {
    update: only("update", "settings"),
  },
  imageSizes: {
    create: only("create", "settings"),
    update: only("update", "settings"),
    delete: only("delete", "settings"),
    regenerate: only("update", "settings"),
  },
  userFields: {
    create: only("create", "settings"),
    update: only("update", "settings"),
    delete: only("delete", "settings"),
  },
  fieldGroups: {
    create: only("create", "settings"),
    update: only("update", "settings"),
    delete: only("delete", "settings"),
  },
  emailProviders: {
    create: only("create", "email-providers"),
    update: only("update", "email-providers"),
    delete: only("delete", "email-providers"),
    sendTest: only("create", "email-providers"),
    makeDefault: only("update", "email-providers"),
  },
  emailTemplates: {
    create: only("create", "email-templates"),
    update: only("update", "email-templates"),
    delete: only("delete", "email-templates"),
    preview: only("create", "email-templates"),
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

/** What a refused read of permissions names, whichever grant it lacked. */
const READING_PERMISSIONS: SystemPermission = {
  action: "read",
  resource: "permissions",
};

/** `read-roles`, or `read-permissions`, either one. */
const ROLE_OR_PERMISSION_READ: RouteGrant = {
  anyOf: [
    { action: "read", resource: "roles" },
    { action: "read", resource: "permissions" },
  ],
  names: READING_PERMISSIONS,
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
 * - Settings: `read-settings`, for every settings page's read, the field
 *   groups' settings-gated list included.
 * - Email providers and templates: `read-` on each. The provider types are
 *   read to choose one to add, so `create-email-providers` reads them too.
 *
 * The Direct API asks field groups no grant: it reads them as the builder's
 * palette does, open to any signed-in caller.
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
    list: {
      anyOf: [{ action: "read", resource: "roles" }],
      names: READING_PERMISSIONS,
    },
    read: ROLE_OR_PERMISSION_READ,
  },
  media: {
    read: { action: "read", resource: "media" },
  },
  settings: {
    read: only("read", "settings"),
  },
  emailProviders: {
    read: only("read", "email-providers"),
    readTypes: {
      anyOf: [
        { action: "read", resource: "email-providers" },
        { action: "create", resource: "email-providers" },
      ],
    },
  },
  emailTemplates: {
    read: only("read", "email-templates"),
  },
} as const satisfies Record<string, Record<string, RouteGrant>>;

/**
 * What a change to the schema asks: a collection's or a Single's definition
 * created, changed or deleted, or a schema change previewed or applied. It
 * changes settings of every kind at once, so it asks all three of create,
 * update and delete on `settings`; updating settings alone, enough to rename
 * the site, does not reach the schema. A role still holding
 * `manage-settings` holds all three.
 */
export const SCHEMA_CHANGE_PERMISSIONS: readonly SystemPermission[] = [
  { action: "create", resource: "settings" },
  { action: "update", resource: "settings" },
  { action: "delete", resource: "settings" },
];
