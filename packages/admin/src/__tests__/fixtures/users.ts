/**
 * Mock users data for testing
 *
 * Provides realistic user fixtures for testing user-related components
 * and features like user management, authentication, etc.
 */

export interface MockUser {
  id: string;
  email: string;
  username: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  avatar?: string;
  roleIds?: string[];
  isActive: boolean;
  isVerified: boolean;
  createdAt?: Date;
  updatedAt?: Date;
  lastLoginAt?: Date | null;
  // Index signature for Record<string, unknown> compatibility
  [key: string]: unknown;
}

/**
 * Mock users array with various roles and states
 */
export const mockUsers: MockUser[] = [
  {
    id: "u1",
    email: "admin@example.com",
    username: "admin",
    firstName: "Admin",
    lastName: "User",
    fullName: "Admin User",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=admin",
    roleIds: ["r1"], // Super Admin
    isActive: true,
    isVerified: true,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    lastLoginAt: new Date("2024-11-14"),
  },
  {
    id: "u2",
    email: "editor@example.com",
    username: "editor",
    firstName: "Jane",
    lastName: "Editor",
    fullName: "Jane Editor",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=editor",
    roleIds: ["r2"], // Editor
    isActive: true,
    isVerified: true,
    createdAt: new Date("2024-01-02"),
    updatedAt: new Date("2024-01-02"),
    lastLoginAt: new Date("2024-11-13"),
  },
  {
    id: "u3",
    email: "author@example.com",
    username: "author",
    firstName: "John",
    lastName: "Author",
    fullName: "John Author",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=author",
    roleIds: ["r3"], // Author
    isActive: true,
    isVerified: true,
    createdAt: new Date("2024-01-03"),
    updatedAt: new Date("2024-01-03"),
    lastLoginAt: new Date("2024-11-12"),
  },
  {
    id: "u4",
    email: "viewer@example.com",
    username: "viewer",
    firstName: "Bob",
    lastName: "Viewer",
    fullName: "Bob Viewer",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=viewer",
    roleIds: ["r4"], // Viewer
    isActive: true,
    isVerified: true,
    createdAt: new Date("2024-01-04"),
    updatedAt: new Date("2024-01-04"),
    lastLoginAt: new Date("2024-11-11"),
  },
  {
    id: "u5",
    email: "inactive@example.com",
    username: "inactive",
    firstName: "Inactive",
    lastName: "User",
    fullName: "Inactive User",
    roleIds: ["r4"], // Viewer
    isActive: false,
    isVerified: false,
    createdAt: new Date("2024-01-05"),
    updatedAt: new Date("2024-01-05"),
    lastLoginAt: null,
  },
];

/**
 * Create a mock user with custom overrides
 *
 * @param overrides - Partial user properties to override defaults
 * @returns A complete mock user object
 *
 * @example
 * const user = createMockUser({ email: "test@example.com", isActive: false });
 */
export function createMockUser(overrides?: Partial<MockUser>): MockUser {
  const timestamp = Date.now();
  const randomId = Math.random().toString(36).substr(2, 9);
  return {
    id: `user-${timestamp}-${randomId}`,
    email: `test-${randomId}@example.com`,
    username: `testuser-${randomId}`,
    firstName: "Test",
    lastName: "User",
    fullName: "Test User",
    roleIds: [],
    isActive: true,
    isVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastLoginAt: new Date(),
    ...overrides,
  };
}

/**
 * Get active users only
 *
 * @returns Array of active users
 */
export function getActiveUsers(): MockUser[] {
  return mockUsers.filter(u => u.isActive);
}

/**
 * Get inactive users only
 *
 * @returns Array of inactive users
 */
export function getInactiveUsers(): MockUser[] {
  return mockUsers.filter(u => !u.isActive);
}

/**
 * Get verified users only
 *
 * @returns Array of verified users
 */
export function getVerifiedUsers(): MockUser[] {
  return mockUsers.filter(u => u.isVerified);
}

/**
 * Get users by role ID
 *
 * @param roleId - The role ID to filter by
 * @returns Array of users with the specified role
 */
export function getUsersByRole(roleId: string): MockUser[] {
  return mockUsers.filter(u => u.roleIds?.includes(roleId));
}

/**
 * Get user by email
 *
 * @param email - The email to search for
 * @returns The user or undefined
 */
export function getUserByEmail(email: string): MockUser | undefined {
  return mockUsers.find(u => u.email === email);
}

/**
 * Get user by username
 *
 * @param username - The username to search for
 * @returns The user or undefined
 */
export function getUserByUsername(username: string): MockUser | undefined {
  return mockUsers.find(u => u.username === username);
}
