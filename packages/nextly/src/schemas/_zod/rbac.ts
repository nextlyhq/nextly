import { z } from "zod";

export const IdSchema = z.string().min(1, "ID is required");

/**
 * System resources that are always available regardless of dynamic collections.
 * These represent core Nextly entities that exist in every installation.
 *
 * This list is not only an allowlist: `cleanupOrphanedPermissions` deletes any
 * owner-less permission whose resource is absent from here and is not a
 * collection, single or component, together with its role grants. Seeded system
 * permissions have no owner, so **every resource named in `SYSTEM_PERMISSIONS`
 * must appear here** or its permissions survive seeding and vanish on the next
 * cleanup pass, silently removing the access every non-super-admin role had to
 * that surface. A test in `seed-system-permissions.integration.test.ts` enforces
 * the pairing.
 */
export const SYSTEM_RESOURCES = [
  "users",
  "roles",
  "permissions",
  "media",
  "settings",
  "email-providers",
  "email-templates",
  "api-keys",
  "webhooks",
  // NOT "releases". Registering a system resource RESERVES its name, and
  // "releases" is a word real sites use for content — "press releases" is one
  // of the most common collections on a corporate site. The other reserved
  // names read as system concepts; this one reads as content, which is exactly
  // why it would collide. An existing collection called `releases` would fail
  // slug validation at boot, and a Schema-Builder one would have its
  // permissions reclassified as system permissions, silently costing preset
  // roles their access.
  "content-releases",
  // NOT "jobs", for the reason "content-releases" is not "releases": a system
  // resource RESERVES its name, and "jobs" is a word real sites use for
  // content — a careers page or a job board is an ordinary collection. This
  // one reads as a system concept and cannot be mistaken for content, which is
  // the whole test.
  "background-jobs",
] as const;

export type SystemResource = (typeof SYSTEM_RESOURCES)[number];

/**
 * Why a name that was legal in an earlier version is reserved in this one.
 *
 * A reserved slug is only ever a nuisance to somebody writing a NEW collection
 * — they pick another name. It is an upgrade failing at boot for somebody who
 * already has one, and to them "slug 'content-releases' is reserved" is a true
 * sentence that explains nothing: the config they are being refused is the
 * config that worked yesterday, and nothing on screen says the rule changed
 * rather than their collection.
 *
 * So a name added to {@link SYSTEM_RESOURCES} after 0.0.1 carries the sentence
 * an operator needs to act. Kept beside the list rather than in either
 * validator: collections and Singles both reject the slug, and a note that
 * lived in one of them would be missing from whichever half an operator hit.
 *
 * Nothing is grandfathered, deliberately. Letting a content collection keep the
 * name would leave two things answering to one resource, and permission seeding
 * would have to guess which — a rename is the only outcome that stays
 * unambiguous, so the error asks for one plainly instead of degrading quietly.
 */
export const NEWLY_RESERVED_SLUG_NOTES: ReadonlyMap<string, string> = new Map([
  [
    "content-releases",
    "This name became a reserved system resource when scheduled content releases were added. " +
      "An installation that already has a collection or Single with this slug must rename it: " +
      "the read-, create- and publish-content-releases permissions are seeded under this name, " +
      "so a content entity sharing it would have its own permissions treated as system-owned " +
      "and preset roles would silently lose access to it.",
  ],
  [
    "background-jobs",
    "This name became a reserved system resource when the background job runner gained its trigger. " +
      "An installation that already has a collection or Single with this slug must rename it: " +
      "the manage-background-jobs permission is seeded under this name, so a content entity " +
      "sharing it would have its own permissions treated as system-owned and preset roles " +
      "would silently lose access to it.",
  ],
]);

/**
 * Check if a resource is a built-in system resource.
 */
export function isSystemResource(resource: string): resource is SystemResource {
  return (SYSTEM_RESOURCES as readonly string[]).includes(resource);
}

/**
 * A permission's identity: what every authorization check looks up.
 *
 * Order is the whole content of this function, and it is not a matter of taste.
 * A permission row is found by its slug, so a producer that writes
 * `users-read` and a guard that reads `read-users` do not disagree loudly —
 * the lookup simply misses, and a grant that the admin panel shows as assigned
 * authorizes nothing. The failure is silent, and it is silent in the direction
 * of denial, which is safe but indistinguishable from the permission never
 * having been granted.
 *
 * It exists as a function because the convention was previously written out at
 * each of eleven call sites, and one of them had the two halves the wrong way
 * round. Composing the string by hand is what allows that, so the string is
 * composed here and nowhere else.
 */
export function permissionSlug(action: string, resource: string): string {
  return `${action}-${resource}`;
}

/**
 * A permission's display label, for the admin list and nothing else.
 *
 * Separate from {@link permissionSlug} on purpose: this one is free to change
 * without consequence, while the slug is an identity that existing rows and
 * grants are keyed on.
 */
export function permissionName(action: string, resource: string): string {
  const titleCase = (value: string): string =>
    value
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  return `${titleCase(action)} ${titleCase(resource)}`;
}

/**
 * Check if a resource is valid (either a system resource or a known collection slug).
 * The caller provides known collection slugs from the database.
 */
export function isValidResource(
  resource: string,
  knownCollectionSlugs: string[]
): boolean {
  return isSystemResource(resource) || knownCollectionSlugs.includes(resource);
}

/**
 * Whether a slug may not be used for a collection or single, because it would
 * collide with a system resource's permissions.
 *
 * Permission identity is `action-resource`, so a content type named after a
 * system resource seeds the exact rows that resource's routes check: a
 * `webhooks` single seeds `read-webhooks` / `update-webhooks` and reaches the
 * endpoint routes and their signing secrets; a `settings` single seeds
 * `read-settings` / `update-settings` and reaches the user-fields and component
 * admin surfaces (`routeHandler.ts` gates those on `{action, "settings"}`, not
 * only `manage`); a `media` collection seeds `*-media` and reaches the media
 * routes. Every system resource has at least one route enforcing a
 * create/read/update/delete action that content seeding produces, so any system
 * resource name is unsafe as a content slug.
 *
 * Defined as "is a system resource" rather than a hand-maintained subset so a
 * newly added system resource is protected automatically. Reserving a name that
 * turned out to be manage-only would merely forbid a content type no one should
 * create; leaving one out is a privilege-escalation.
 *
 * Components are intentionally NOT covered: a component definition does not seed
 * a permission under its own slug (the component admin routes are gated on the
 * `settings`/`components` resource), so a component name cannot mint a colliding
 * row and reserving it would only reject a harmless name.
 */
export function isReservedResourceSlug(slug: string): boolean {
  return isSystemResource(slug);
}

export const RoleSchema = z.object({
  id: IdSchema,
  name: z
    .string()
    .min(1, "Role name is required")
    .max(50, "Role name must be 50 characters or less"),
  slug: z
    .string()
    .min(1, "Role slug is required")
    .max(50, "Role slug must be 50 characters or less")
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Slug must be lowercase alphanumeric with hyphens"
    )
    .toLowerCase(),
  description: z
    .string()
    .max(255, "Description must be 255 characters or less")
    .nullable()
    .optional(),
  level: z.number().int().min(0, "Level must be non-negative").default(0),
  isSystem: z.boolean().default(false),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});

export const CreateRoleSchema = z.object({
  name: z
    .string()
    .min(1, "Role name is required")
    .max(50, "Role name must be 50 characters or less"),
  slug: z
    .string()
    .min(1, "Role slug is required")
    .max(50, "Role slug must be 50 characters or less")
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Slug must be lowercase alphanumeric with hyphens"
    )
    .toLowerCase(),
  description: z
    .string()
    .max(255, "Description must be 255 characters or less")
    .nullable()
    .optional(),
  level: z.number().int().min(0, "Level must be non-negative").default(0),
  isSystem: z.boolean().default(false),
  child: z.array(IdSchema).optional().default([]),
});

export const UpdateRoleSchema = z.object({
  name: z
    .string()
    .min(1, "Role name is required")
    .max(50, "Role name must be 50 characters or less")
    .optional(),
  slug: z
    .string()
    .min(1, "Role slug is required")
    .max(50, "Role slug must be 50 characters or less")
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Slug must be lowercase alphanumeric with hyphens"
    )
    .toLowerCase()
    .optional(),
  description: z
    .string()
    .max(255, "Description must be 255 characters or less")
    .nullable()
    .optional(),
  level: z.number().int().min(0, "Level must be non-negative").optional(),
  isSystem: z.boolean().optional(),
  child: z.array(IdSchema).optional(),
});

export const GetRoleByIdSchema = z.object({
  roleId: IdSchema,
});

export const DeleteRoleSchema = z.object({
  roleId: IdSchema,
});

// Actions: standard CRUD, the publish lifecycle, and "manage" for broad
// resource control.
//
// `publish` and `unpublish` are separate rather than one verb: making content
// live and taking it down are different responsibilities, and a role that may
// withdraw a page in an emergency is not necessarily one that may put pages up.
// Granting them together is a role decision, not something the model should
// force. No action implies another — `roleSetHasPermission` matches the action
// column exactly — so both must be granted explicitly.
export const PermissionActionSchema = z.enum(
  ["create", "read", "update", "delete", "publish", "unpublish", "manage"],
  {
    message:
      "Action must be one of: create, read, update, delete, publish, unpublish, manage",
  }
);

// Resources: any valid kebab-case slug (system resources + dynamic collection slugs).
// Actual validation against existing collections happens in the service layer,
// not in the Zod schema, since collections are dynamic.
export const PermissionResourceSchema = z
  .string()
  .min(1, "Resource is required")
  .max(100, "Resource must be 100 characters or less")
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Resource must be lowercase alphanumeric with hyphens"
  );

export const PermissionSchema = z.object({
  id: IdSchema,
  name: z
    .string()
    .min(1, "Permission name is required")
    .max(100, "Permission name must be 100 characters or less"),
  slug: z
    .string()
    .min(1, "Permission slug is required")
    .max(100, "Permission slug must be 100 characters or less")
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Slug must be lowercase alphanumeric with hyphens"
    )
    .toLowerCase(),
  action: PermissionActionSchema,
  resource: PermissionResourceSchema,
  description: z
    .string()
    .max(255, "Description must be 255 characters or less")
    .nullable()
    .optional(),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});

export const CreatePermissionSchema = z.object({
  name: z
    .string()
    .min(1, "Permission name is required")
    .max(100, "Permission name must be 100 characters or less"),
  slug: z
    .string()
    .min(1, "Permission slug is required")
    .max(100, "Permission slug must be 100 characters or less")
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Slug must be lowercase alphanumeric with hyphens"
    )
    .toLowerCase(),
  action: PermissionActionSchema,
  resource: PermissionResourceSchema,
  description: z
    .string()
    .max(255, "Description must be 255 characters or less")
    .nullable()
    .optional(),
});

export const UpdatePermissionSchema = z.object({
  name: z
    .string()
    .min(1, "Permission name is required")
    .max(100, "Permission name must be 100 characters or less")
    .optional(),
  slug: z
    .string()
    .min(1, "Permission slug is required")
    .max(100, "Permission slug must be 100 characters or less")
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Slug must be lowercase alphanumeric with hyphens"
    )
    .toLowerCase()
    .optional(),
  action: PermissionActionSchema.optional(),
  resource: PermissionResourceSchema.optional(),
  description: z
    .string()
    .max(255, "Description must be 255 characters or less")
    .nullable()
    .optional(),
});

export const GetPermissionByIdSchema = z.object({
  permissionId: IdSchema,
});

export const DeletePermissionSchema = z.object({
  permissionId: IdSchema,
});

export const RolePermissionSchema = z.object({
  id: IdSchema,
  roleId: IdSchema,
  permissionId: IdSchema,
  createdAt: z.date().optional(),
});

export const AssignPermissionToRoleSchema = z.object({
  roleId: IdSchema,
  permissionId: IdSchema,
});

export const RemovePermissionFromRoleSchema = z.object({
  roleId: IdSchema,
  permissionId: IdSchema,
});

export const UserRoleSchema = z.object({
  id: IdSchema,
  userId: IdSchema,
  roleId: IdSchema,
  createdAt: z.date().optional(),
  expiresAt: z.date().nullable().optional(),
});

export const AssignRoleToUserSchema = z.object({
  userId: IdSchema,
  roleId: IdSchema,
  expiresAt: z.date().nullable().optional(),
});

export const RemoveRoleFromUserSchema = z.object({
  userId: IdSchema,
  roleId: IdSchema,
});

export const RoleInheritanceSchema = z.object({
  id: IdSchema,
  parentRoleId: IdSchema,
  childRoleId: IdSchema,
});

export const CreateRoleInheritanceSchema = z.object({
  parentRoleId: IdSchema,
  childRoleId: IdSchema,
});

export const DeleteRoleInheritanceSchema = z.object({
  parentRoleId: IdSchema,
  childRoleId: IdSchema,
});

export const GetUserRolesSchema = z.object({
  userId: IdSchema,
});

export const GetRolePermissionsSchema = z.object({
  roleId: IdSchema,
});

export const GetUserPermissionsSchema = z.object({
  userId: IdSchema,
});

export const CheckUserPermissionSchema = z.object({
  userId: IdSchema,
  action: PermissionActionSchema,
  resource: PermissionResourceSchema,
});

export const RoleListResponseSchema = z.array(RoleSchema);
export const PermissionListResponseSchema = z.array(PermissionSchema);
export const UserRoleListResponseSchema = z.array(UserRoleSchema);
export const RolePermissionListResponseSchema = z.array(RolePermissionSchema);
export const PermissionCheckResponseSchema = z.object({
  hasPermission: z.boolean(),
  reason: z.string().optional(),
});

export type Role = z.infer<typeof RoleSchema>;
export type CreateRole = z.infer<typeof CreateRoleSchema>;
export type UpdateRole = z.infer<typeof UpdateRoleSchema>;
export type GetRoleById = z.infer<typeof GetRoleByIdSchema>;
export type DeleteRole = z.infer<typeof DeleteRoleSchema>;

export type PermissionAction = z.infer<typeof PermissionActionSchema>;
export type PermissionResource = z.infer<typeof PermissionResourceSchema>;
export type Permission = z.infer<typeof PermissionSchema>;
export type CreatePermission = z.infer<typeof CreatePermissionSchema>;
export type UpdatePermission = z.infer<typeof UpdatePermissionSchema>;
export type GetPermissionById = z.infer<typeof GetPermissionByIdSchema>;
export type DeletePermission = z.infer<typeof DeletePermissionSchema>;

export type RolePermission = z.infer<typeof RolePermissionSchema>;
export type AssignPermissionToRole = z.infer<
  typeof AssignPermissionToRoleSchema
>;
export type RemovePermissionFromRole = z.infer<
  typeof RemovePermissionFromRoleSchema
>;

export type UserRole = z.infer<typeof UserRoleSchema>;
export type AssignRoleToUser = z.infer<typeof AssignRoleToUserSchema>;
export type RemoveRoleFromUser = z.infer<typeof RemoveRoleFromUserSchema>;

export type RoleInheritance = z.infer<typeof RoleInheritanceSchema>;
export type CreateRoleInheritance = z.infer<typeof CreateRoleInheritanceSchema>;
export type DeleteRoleInheritance = z.infer<typeof DeleteRoleInheritanceSchema>;

export type GetUserRoles = z.infer<typeof GetUserRolesSchema>;
export type GetRolePermissions = z.infer<typeof GetRolePermissionsSchema>;
export type GetUserPermissions = z.infer<typeof GetUserPermissionsSchema>;
export type CheckUserPermission = z.infer<typeof CheckUserPermissionSchema>;

export type RoleListResponse = z.infer<typeof RoleListResponseSchema>;
export type PermissionListResponse = z.infer<
  typeof PermissionListResponseSchema
>;
export type UserRoleListResponse = z.infer<typeof UserRoleListResponseSchema>;
export type RolePermissionListResponse = z.infer<
  typeof RolePermissionListResponseSchema
>;
export type PermissionCheckResponse = z.infer<
  typeof PermissionCheckResponseSchema
>;
