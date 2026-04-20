import { randomUUID } from "crypto";

/**
 * Factory function to create permission test data.
 * Provides sensible defaults with override capability.
 *
 * @param overrides - Fields to override
 * @returns Permission test data
 */
export function permissionFactory(overrides?: {
  id?: string;
  name?: string;
  slug?: string;
  action?: string;
  resource?: string;
  description?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}) {
  const action = overrides?.action ?? "read";
  const resource = overrides?.resource ?? "content";
  const name = overrides?.name ?? `${action}:${resource}`;
  const slug = overrides?.slug ?? `${action}-${resource}`;
  const now = new Date();

  return {
    id: overrides?.id ?? randomUUID(),
    name,
    slug,
    action,
    resource,
    description:
      overrides?.description ?? `Permission to ${action} ${resource}`,
    createdAt: overrides?.createdAt ?? now,
    updatedAt: overrides?.updatedAt ?? now,
  };
}

/**
 * Create multiple permissions for bulk testing.
 *
 * @param count - Number of permissions to create
 * @param overrides - Optional function to customize each permission
 * @returns Array of permission test data
 */
export function bulkPermissionsFactory(
  count: number,
  overrides?: (index: number) => Partial<ReturnType<typeof permissionFactory>>
) {
  return Array.from({ length: count }, (_, i) =>
    permissionFactory(
      overrides?.(i) ?? {
        action: `action${i}`,
        resource: `resource${i}`,
      }
    )
  );
}

/**
 * Factory for creating a standard set of CRUD permissions for a resource.
 *
 * @param resource - Resource name (e.g., "users", "content")
 * @returns Array of CRUD permission test data
 */
export function crudPermissionsFactory(resource: string) {
  const actions = ["create", "read", "update", "delete"];
  return actions.map(action =>
    permissionFactory({
      action,
      resource,
      name: `${action}:${resource}`,
    })
  );
}

/**
 * Predefined permission sets for common testing scenarios.
 */
export const PermissionSets = {
  /**
   * Basic content management permissions
   */
  contentManagement: () => [
    permissionFactory({ action: "read", resource: "content" }),
    permissionFactory({ action: "create", resource: "content" }),
    permissionFactory({ action: "update", resource: "content" }),
    permissionFactory({ action: "delete", resource: "content" }),
  ],

  /**
   * User management permissions
   */
  userManagement: () => [
    permissionFactory({ action: "read", resource: "users" }),
    permissionFactory({ action: "create", resource: "users" }),
    permissionFactory({ action: "update", resource: "users" }),
    permissionFactory({ action: "delete", resource: "users" }),
  ],

  /**
   * Role management permissions
   */
  roleManagement: () => [
    permissionFactory({ action: "read", resource: "roles" }),
    permissionFactory({ action: "create", resource: "roles" }),
    permissionFactory({ action: "update", resource: "roles" }),
    permissionFactory({ action: "delete", resource: "roles" }),
  ],
};
