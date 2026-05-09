/**
 * Mock permissions data for testing
 *
 * Provides realistic permission fixtures covering CRUD operations
 * across different resource types (articles, users, media, settings).
 */

export interface MockPermission {
  id: string;
  name: string;
  resource: string;
  action: "create" | "read" | "update" | "delete";
  description?: string;
  category?: "collection-types" | "single-types" | "settings";
}

/**
 * Mock permissions array covering common CMS resources
 * Includes permissions for articles, users, media, and settings
 */
export const mockPermissions: MockPermission[] = [
  // Article permissions
  {
    id: "p1",
    name: "Create Articles",
    resource: "article",
    action: "create",
    description: "Can create new articles",
    category: "collection-types",
  },
  {
    id: "p2",
    name: "Read Articles",
    resource: "article",
    action: "read",
    description: "Can view articles",
    category: "collection-types",
  },
  {
    id: "p3",
    name: "Update Articles",
    resource: "article",
    action: "update",
    description: "Can edit existing articles",
    category: "collection-types",
  },
  {
    id: "p4",
    name: "Delete Articles",
    resource: "article",
    action: "delete",
    description: "Can delete articles",
    category: "collection-types",
  },
  // User permissions
  {
    id: "p5",
    name: "Create Users",
    resource: "user",
    action: "create",
    description: "Can create new users",
    category: "collection-types",
  },
  {
    id: "p6",
    name: "Read Users",
    resource: "user",
    action: "read",
    description: "Can view users",
    category: "collection-types",
  },
  {
    id: "p7",
    name: "Update Users",
    resource: "user",
    action: "update",
    description: "Can edit user profiles",
    category: "collection-types",
  },
  {
    id: "p8",
    name: "Delete Users",
    resource: "user",
    action: "delete",
    description: "Can delete users",
    category: "collection-types",
  },
  // Media permissions
  {
    id: "p9",
    name: "Upload Media",
    resource: "media",
    action: "create",
    description: "Can upload media files",
    category: "collection-types",
  },
  {
    id: "p10",
    name: "View Media",
    resource: "media",
    action: "read",
    description: "Can view media library",
    category: "collection-types",
  },
  {
    id: "p11",
    name: "Edit Media",
    resource: "media",
    action: "update",
    description: "Can edit media metadata",
    category: "collection-types",
  },
  {
    id: "p12",
    name: "Delete Media",
    resource: "media",
    action: "delete",
    description: "Can delete media files",
    category: "collection-types",
  },
  // Settings permissions
  {
    id: "p13",
    name: "Read Settings",
    resource: "settings",
    action: "read",
    description: "Can view system settings",
    category: "settings",
  },
  {
    id: "p14",
    name: "Update Settings",
    resource: "settings",
    action: "update",
    description: "Can modify system settings",
    category: "settings",
  },
  {
    id: "p15",
    name: "Read Homepage",
    resource: "homepage",
    action: "read",
    description: "Can view homepage content",
    category: "single-types",
  },
];

/**
 * Create a mock permission with custom overrides
 *
 * @param overrides - Partial permission properties to override defaults
 * @returns A complete mock permission object
 *
 * @example
 * const permission = createMockPermission({ name: "Custom Permission", action: "create" });
 */
export function createMockPermission(
  overrides?: Partial<MockPermission>
): MockPermission {
  return {
    id: `perm-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name: "Test Permission",
    resource: "test",
    action: "read",
    description: "A test permission",
    category: "collection-types",
    ...overrides,
  };
}

/**
 * Get permissions filtered by resource
 *
 * @param resource - The resource to filter by (e.g., "article", "user")
 * @returns Array of permissions for the specified resource
 */
export function getPermissionsByResource(resource: string): MockPermission[] {
  return mockPermissions.filter(p => p.resource === resource);
}

/**
 * Get permissions filtered by action
 *
 * @param action - The action to filter by (create, read, update, delete)
 * @returns Array of permissions for the specified action
 */
export function getPermissionsByAction(
  action: MockPermission["action"]
): MockPermission[] {
  return mockPermissions.filter(p => p.action === action);
}

/**
 * Get permissions filtered by category
 *
 * @param category - The category to filter by
 * @returns Array of permissions in the specified category
 */
export function getPermissionsByCategory(
  category: MockPermission["category"]
): MockPermission[] {
  return mockPermissions.filter(p => p.category === category);
}
