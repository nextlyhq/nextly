/**
 * Mock roles data for testing
 *
 * Provides realistic role fixtures with various permission levels
 * and inheritance relationships.
 */

export interface MockRole {
  id: string;
  name: string;
  slug: string;
  description?: string;
  level: number;
  isSystem: boolean;
  isDefault: boolean;
  parentRoleId?: string | null;
  permissionIds?: string[];
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Mock roles array representing a typical CMS role hierarchy
 * Admin > Editor > Author > Viewer
 */
export const mockRoles: MockRole[] = [
  {
    id: "r1",
    name: "Super Admin",
    slug: "super-admin",
    description: "Full system access with all permissions",
    level: 100,
    isSystem: true,
    isDefault: false,
    parentRoleId: null,
    permissionIds: [
      "p1",
      "p2",
      "p3",
      "p4",
      "p5",
      "p6",
      "p7",
      "p8",
      "p9",
      "p10",
      "p11",
      "p12",
      "p13",
      "p14",
      "p15",
    ],
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
  },
  {
    id: "r2",
    name: "Editor",
    slug: "editor",
    description: "Can manage content and media",
    level: 75,
    isSystem: false,
    isDefault: false,
    parentRoleId: null,
    permissionIds: ["p1", "p2", "p3", "p4", "p9", "p10", "p11", "p12"],
    createdAt: new Date("2024-01-02"),
    updatedAt: new Date("2024-01-02"),
  },
  {
    id: "r3",
    name: "Author",
    slug: "author",
    description: "Can create and edit own content",
    level: 50,
    isSystem: false,
    isDefault: true,
    parentRoleId: "r2",
    permissionIds: ["p1", "p2", "p3", "p9", "p10"],
    createdAt: new Date("2024-01-03"),
    updatedAt: new Date("2024-01-03"),
  },
  {
    id: "r4",
    name: "Viewer",
    slug: "viewer",
    description: "Read-only access to content",
    level: 25,
    isSystem: false,
    isDefault: false,
    parentRoleId: null,
    permissionIds: ["p2", "p6", "p10", "p13", "p15"],
    createdAt: new Date("2024-01-04"),
    updatedAt: new Date("2024-01-04"),
  },
  {
    id: "r5",
    name: "Content Manager",
    slug: "content-manager",
    description: "Manages articles and media",
    level: 60,
    isSystem: false,
    isDefault: false,
    parentRoleId: null,
    permissionIds: ["p1", "p2", "p3", "p9", "p10", "p11"],
    createdAt: new Date("2024-01-05"),
    updatedAt: new Date("2024-01-05"),
  },
];

/**
 * Create a mock role with custom overrides
 *
 * @param overrides - Partial role properties to override defaults
 * @returns A complete mock role object
 *
 * @example
 * const role = createMockRole({ name: "Custom Role", level: 80 });
 */
export function createMockRole(overrides?: Partial<MockRole>): MockRole {
  const timestamp = Date.now();
  return {
    id: `role-${timestamp}-${Math.random().toString(36).substr(2, 9)}`,
    name: "Test Role",
    slug: "test-role",
    description: "A test role",
    level: 50,
    isSystem: false,
    isDefault: false,
    parentRoleId: null,
    permissionIds: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/**
 * Get system roles only
 *
 * @returns Array of system roles
 */
export function getSystemRoles(): MockRole[] {
  return mockRoles.filter(r => r.isSystem);
}

/**
 * Get non-system roles
 *
 * @returns Array of non-system roles
 */
export function getNonSystemRoles(): MockRole[] {
  return mockRoles.filter(r => !r.isSystem);
}

/**
 * Get default role
 *
 * @returns The default role or undefined
 */
export function getDefaultRole(): MockRole | undefined {
  return mockRoles.find(r => r.isDefault);
}

/**
 * Get roles sorted by level (descending)
 *
 * @returns Array of roles sorted by level
 */
export function getRolesByLevel(): MockRole[] {
  return [...mockRoles].sort((a, b) => b.level - a.level);
}

/**
 * Get child roles of a parent role
 *
 * @param parentId - The parent role ID
 * @returns Array of child roles
 */
export function getChildRoles(parentId: string): MockRole[] {
  return mockRoles.filter(r => r.parentRoleId === parentId);
}
