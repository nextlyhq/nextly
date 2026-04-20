// RBAC-specific database operation types for better type safety

import type { UserQueryResult } from "./database-operations";

export interface RoleInsertData {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  level: number;
  isSystem: boolean | number; // Can be boolean or number (0/1 for sqlite)
}

export interface RoleUpdateData {
  name?: string;
  slug?: string;
  description?: string | null;
  level?: number;
}

export interface RoleSelectResult {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  level: number;
  isSystem: boolean | number;
}

export interface RoleListSelectResult {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  level: number;
  isSystem: boolean | number;
}

export interface RoleBasicSelectResult {
  id: string;
}

export interface PermissionInsertData {
  id: string;
  name: string;
  slug: string;
  action: string;
  resource: string;
  description: string | null;
}

export interface PermissionUpdateData {
  name?: string;
  slug?: string;
  action?: string;
  resource?: string;
  description?: string;
}

export interface PermissionSelectResult {
  id: string;
  name: string;
  slug: string;
  action: string;
  resource: string;
  description: string | null;
}

export interface PermissionBasicSelectResult {
  id: string;
}

export interface RolePermissionInsertData {
  id: string;
  roleId: string;
  permissionId: string;
}

export interface RolePermissionSelectResult {
  id: string;
  roleId: string;
  permissionId: string;
  permission?: {
    action: string;
    resource: string;
  };
}

export interface UserRoleInsertData {
  id: string;
  userId: string;
  roleId: string;
  expiresAt: Date | string | null;
}

export interface UserRoleSelectResult {
  roleId: string;
  role?: {
    name: string;
  };
}

export interface RoleInheritanceInsertData {
  id: string;
  parentRoleId: string;
  childRoleId: string;
}

export interface RoleInheritanceSelectResult {
  id: string;
  parentRoleId: string;
  childRoleId: string;
}

export interface RoleInheritanceBasicSelectResult {
  parentRoleId: string;
  childRoleId: string;
}

// Database query result types
export interface RoleQueryResult {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  level: number;
  isSystem: boolean | number;
}

export interface PermissionQueryResult {
  id: string;
  name: string;
  slug: string;
  action: string;
  resource: string;
  description: string | null;
}

export interface RolePermissionQueryResult {
  id: string;
  roleId: string;
  permissionId: string;
  permission?: {
    action: string;
    resource: string;
  };
}

export interface UserRoleQueryResult {
  roleId: string;
  role?: {
    name: string;
  };
}

export interface RoleInheritanceQueryResult {
  parentRoleId: string;
  childRoleId: string;
}

// Database instance types for RBAC operations
export interface RBACDatabaseInstance {
  query: {
    roles: {
      findMany: (options: {
        columns: Record<string, boolean>;
        orderBy?: unknown[];
        where?: unknown;
      }) => Promise<RoleQueryResult[]>;
      findFirst: (options: {
        where: unknown;
        columns: Record<string, boolean>;
      }) => Promise<RoleQueryResult | undefined>;
    };
    permissions: {
      findMany: (options: {
        columns: Record<string, boolean>;
        orderBy?: unknown[];
        where?: unknown;
      }) => Promise<PermissionQueryResult[]>;
      findFirst: (options: {
        where: unknown;
        columns: Record<string, boolean>;
      }) => Promise<PermissionQueryResult | undefined>;
    };
    rolePermissions: {
      findMany: (options: {
        where: unknown;
        with?: {
          permission: {
            columns: Record<string, boolean>;
          };
        };
      }) => Promise<RolePermissionQueryResult[]>;
      findFirst: (options: {
        where: unknown;
        columns: Record<string, boolean>;
      }) => Promise<RolePermissionQueryResult | undefined>;
    };
    userRoles: {
      findMany: (options: {
        where: unknown;
        columns?: Record<string, boolean>;
        with?: {
          role: {
            columns: Record<string, boolean>;
          };
        };
      }) => Promise<UserRoleQueryResult[]>;
      findFirst: (options: {
        where: unknown;
        columns?: Record<string, boolean>;
        with?: {
          role: {
            columns: Record<string, boolean>;
          };
        };
      }) => Promise<UserRoleQueryResult | undefined>;
    };
    roleInherits: {
      findMany: (options: {
        where: unknown;
        columns: Record<string, boolean>;
      }) => Promise<RoleInheritanceQueryResult[]>;
      findFirst: (options: {
        where: unknown;
        columns: Record<string, boolean>;
      }) => Promise<RoleInheritanceQueryResult | undefined>;
    };
    users: {
      findMany: (options: {
        columns: Record<string, boolean>;
        where?: unknown;
      }) => Promise<UserQueryResult[]>;
      findFirst: (options: {
        where: unknown;
        columns: Record<string, boolean>;
      }) => Promise<UserQueryResult | undefined>;
    };
  };
  insert: (table: unknown) => {
    values: (data: unknown) => {
      onConflictDoNothing?: () => Promise<void>;
    } & Promise<void>;
  };
  update: (table: unknown) => {
    set: (data: unknown) => {
      where: (condition: unknown) => Promise<void>;
    };
  };
  delete: (table: unknown) => {
    where: (condition: unknown) => Promise<void>;
  };
}

// Transaction types for RBAC operations
export interface RBACTransaction {
  delete: (table: unknown) => {
    where: (condition: unknown) => Promise<void>;
  };
  insert: (table: unknown) => {
    values: (data: unknown) => {
      onConflictDoNothing?: () => Promise<void>;
    } & Promise<void>;
  };
}

// Error types
export interface DatabaseError {
  code?: string;
  message?: string;
}
