import { randomUUID } from "crypto";

/**
 * Factory function to create role test data.
 * Provides sensible defaults with override capability.
 *
 * @param overrides - Fields to override
 * @returns Role test data
 */
export function roleFactory(overrides?: {
  id?: string;
  name?: string;
  slug?: string;
  description?: string | null;
  level?: number;
  isSystem?: boolean | number;
  createdAt?: Date;
  updatedAt?: Date;
}) {
  const id = overrides?.id ?? randomUUID();
  const name = overrides?.name ?? "Test Role";
  const slug = overrides?.slug ?? name.toLowerCase().replace(/\s+/g, "-");
  const now = new Date();

  return {
    id,
    name,
    slug,
    description:
      overrides?.description !== undefined
        ? overrides.description
        : `Description for ${name}`,
    level: overrides?.level ?? 50,
    isSystem: overrides?.isSystem ?? 0, // SQLite uses 0/1 for booleans
    createdAt: overrides?.createdAt ?? now,
    updatedAt: overrides?.updatedAt ?? now,
  };
}

/**
 * Factory for creating system roles.
 * System roles cannot be modified or deleted.
 *
 * @param overrides - Fields to override
 * @returns System role test data
 */
export function systemRoleFactory(overrides?: {
  id?: string;
  name?: string;
  slug?: string;
  description?: string | null;
  level?: number;
}) {
  return roleFactory({
    ...overrides,
    isSystem: 1, // SQLite boolean
  });
}

/**
 * Create multiple roles for bulk testing.
 *
 * @param count - Number of roles to create
 * @param overrides - Optional function to customize each role
 * @returns Array of role test data
 */
export function bulkRolesFactory(
  count: number,
  overrides?: (index: number) => Partial<ReturnType<typeof roleFactory>>
) {
  return Array.from({ length: count }, (_, i) =>
    roleFactory(overrides?.(i) ?? { name: `Role ${i}` })
  );
}

/**
 * Factory for creating the super admin role.
 * This is a special system role with maximum level.
 *
 * @returns Super admin role test data
 */
export function superAdminRoleFactory() {
  return systemRoleFactory({
    name: "Super Admin",
    slug: "super-admin",
    description: "Grants implicit access to all permissions",
    level: 1000,
  });
}
