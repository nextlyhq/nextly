import { z } from "zod";

export const IdSchema = z.string().min(1, "ID is required");

/**
 * System resources that are always available regardless of dynamic collections.
 * These represent core Nextly entities that exist in every installation.
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
] as const;

export type SystemResource = (typeof SYSTEM_RESOURCES)[number];

/**
 * Check if a resource is a built-in system resource.
 */
export function isSystemResource(resource: string): resource is SystemResource {
  return (SYSTEM_RESOURCES as readonly string[]).includes(resource);
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

// Actions: standard CRUD + "manage" for broad resource control
export const PermissionActionSchema = z.enum(
  ["create", "read", "update", "delete", "manage"],
  {
    message: "Action must be one of: create, read, update, delete, manage",
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
