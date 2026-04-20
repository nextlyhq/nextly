/**
 * Direct API RBAC Type Definitions
 *
 * Roles, permissions, access checks, and API key entity/argument types.
 *
 * @packageDocumentation
 */

import type { DirectAPIConfig } from "./shared";

export type {
  ApiKeyMeta,
  ApiKeyTokenType,
  ExpiresIn,
} from "../../services/auth/api-key-service";

/**
 * Role document returned by the Direct API.
 *
 * A role groups a set of permissions and can be assigned to users.
 * System roles (e.g., `super_admin`) are created on init and cannot be deleted.
 */
export interface Role {
  /** Unique identifier */
  id: string;
  /** Display name */
  name: string;
  /** URL-safe identifier (e.g., `"super-admin"`) */
  slug: string;
  /** Optional description */
  description?: string | null;
  /**
   * Hierarchy level for role ordering.
   * Higher values indicate higher privilege levels.
   */
  level: number;
  /** Whether this role is a built-in system role */
  isSystem: boolean;
}

/**
 * Permission document returned by the Direct API.
 *
 * A permission represents a specific action that can be performed on a resource.
 * Auto-generated permissions follow the pattern `{action}-{resource}` (e.g., `read-posts`).
 */
export interface Permission {
  /** Unique identifier */
  id: string;
  /** Display name (e.g., `"Read Posts"`) */
  name: string;
  /** URL-safe identifier (e.g., `"read-posts"`) */
  slug: string;
  /** The action being permitted (`"create"`, `"read"`, `"update"`, `"delete"`, `"manage"`) */
  action: string;
  /** The resource being protected (collection slug or system resource) */
  resource: string;
  /** Optional description */
  description?: string | null;
}

/**
 * Arguments for finding multiple roles.
 *
 * @example
 * ```typescript
 * const roles = await nextly.roles.find({ limit: 20, page: 1 });
 * ```
 */
export interface FindRolesArgs extends DirectAPIConfig {
  /** Search by name or slug */
  search?: string;
  /** Maximum roles per page. @default 10 */
  limit?: number;
  /** Page number (1-indexed). @default 1 */
  page?: number;
}

/**
 * Arguments for finding a role by ID.
 *
 * @example
 * ```typescript
 * const role = await nextly.roles.findByID({ id: 'role-123' });
 * ```
 */
export interface FindRoleByIDArgs extends DirectAPIConfig {
  /** Role ID (required) */
  id: string;
}

/**
 * Arguments for creating a new role.
 *
 * @example
 * ```typescript
 * const role = await nextly.roles.create({
 *   data: {
 *     name: 'Editor',
 *     slug: 'editor',
 *     description: 'Can create and update content',
 *     level: 10,
 *   },
 * });
 * ```
 */
export interface CreateRoleArgs extends DirectAPIConfig {
  /** Role data (required) */
  data: {
    /** Display name (required) */
    name: string;
    /** URL-safe identifier (required, e.g., `"editor"`) */
    slug: string;
    /** Optional description */
    description?: string;
    /**
     * Hierarchy level for role ordering.
     * @default 0
     */
    level?: number;
  };
}

/**
 * Arguments for updating a role.
 *
 * System roles (`isSystem: true`) cannot be deleted but can be updated
 * with restrictions (e.g., slug changes may be blocked).
 *
 * @example
 * ```typescript
 * const updated = await nextly.roles.update({
 *   id: 'role-123',
 *   data: { description: 'Updated description', level: 20 },
 * });
 * ```
 */
export interface UpdateRoleArgs extends DirectAPIConfig {
  /** Role ID (required) */
  id: string;
  /** Partial role data */
  data: {
    /** Updated display name */
    name?: string;
    /** Updated slug */
    slug?: string;
    /** Updated description (`null` to clear) */
    description?: string | null;
    /** Updated hierarchy level */
    level?: number;
  };
}

/**
 * Arguments for deleting a role.
 *
 * System roles (`isSystem: true`) cannot be deleted.
 *
 * @example
 * ```typescript
 * await nextly.roles.delete({ id: 'role-123' });
 * ```
 */
export interface DeleteRoleArgs extends DirectAPIConfig {
  /** Role ID (required) */
  id: string;
}

/**
 * Arguments for retrieving permissions assigned to a role.
 *
 * @example
 * ```typescript
 * const permissions = await nextly.roles.getPermissions({ id: 'role-123' });
 * console.log(permissions); // Permission[]
 * ```
 */
export interface GetRolePermissionsArgs extends DirectAPIConfig {
  /** Role ID (required) */
  id: string;
}

/**
 * Arguments for bulk-replacing the permissions assigned to a role.
 *
 * This is a **full replace** — all existing role-permission assignments are
 * removed and replaced with the provided list. Pass an empty array to clear
 * all permissions from the role.
 *
 * @example
 * ```typescript
 * // Replace all role permissions with a new set
 * await nextly.roles.setPermissions({
 *   roleId: 'role-123',
 *   permissionIds: ['perm-1', 'perm-2', 'perm-3'],
 * });
 *
 * // Clear all permissions from a role
 * await nextly.roles.setPermissions({
 *   roleId: 'role-123',
 *   permissionIds: [],
 * });
 * ```
 */
export interface SetRolePermissionsArgs extends DirectAPIConfig {
  /** Role ID (required) */
  roleId: string;
  /** Ordered list of permission IDs to assign (replaces all existing) */
  permissionIds: string[];
}

/**
 * Arguments for finding multiple permissions.
 *
 * @example
 * ```typescript
 * // List all permissions for a specific resource
 * const permissions = await nextly.permissions.find({ resource: 'posts' });
 *
 * // List all delete permissions
 * const deletePerms = await nextly.permissions.find({ action: 'delete' });
 * ```
 */
export interface FindPermissionsArgs extends DirectAPIConfig {
  /** Search by name or slug */
  search?: string;
  /** Filter by resource slug (e.g., `"posts"`, `"users"`) */
  resource?: string;
  /** Filter by action (e.g., `"create"`, `"read"`, `"update"`, `"delete"`, `"manage"`) */
  action?: string;
  /** Maximum permissions per page. @default 10 */
  limit?: number;
  /** Page number (1-indexed). @default 1 */
  page?: number;
}

/**
 * Arguments for finding a permission by ID.
 *
 * @example
 * ```typescript
 * const perm = await nextly.permissions.findByID({ id: 'perm-123' });
 * ```
 */
export interface FindPermissionByIDArgs extends DirectAPIConfig {
  /** Permission ID (required) */
  id: string;
}

/**
 * Arguments for creating a permission.
 *
 * In most cases, permissions are auto-generated when collections are created.
 * Use this for custom permissions not tied to a standard CRUD flow.
 *
 * @example
 * ```typescript
 * const perm = await nextly.permissions.create({
 *   data: {
 *     name: 'Publish Posts',
 *     slug: 'publish-posts',
 *     action: 'update',
 *     resource: 'posts',
 *     description: 'Ability to publish draft posts',
 *   },
 * });
 * ```
 */
export interface CreatePermissionArgs extends DirectAPIConfig {
  /** Permission data (required) */
  data: {
    /** Display name (required, e.g., `"Read Posts"`) */
    name: string;
    /** URL-safe identifier (required, e.g., `"read-posts"`) */
    slug: string;
    /** Action being permitted (required) */
    action: string;
    /** Resource being protected (collection slug or system resource) (required) */
    resource: string;
    /** Optional description */
    description?: string;
  };
}

/**
 * Arguments for deleting a permission.
 *
 * System permissions (permissions whose resource is a system resource like
 * `"users"`, `"roles"`, `"settings"`) cannot be deleted.
 *
 * @example
 * ```typescript
 * await nextly.permissions.delete({ id: 'perm-123' });
 * ```
 */
export interface DeletePermissionArgs extends DirectAPIConfig {
  /** Permission ID (required) */
  id: string;
}

/**
 * Arguments for programmatically checking whether a user has access to perform
 * an operation on a resource.
 *
 * Evaluates the full three-tier access chain:
 * 1. Super-admin bypass (always allowed)
 * 2. Code-defined access functions from `defineCollection({ access: {...} })` / `defineSingle({ access: {...} })`
 * 3. Database RBAC permission check (role → permissions)
 *
 * @example
 * ```typescript
 * // Check if a user can read posts
 * const canRead = await nextly.access.check({
 *   userId: 'user-123',
 *   resource: 'posts',
 *   operation: 'read',
 * });
 *
 * if (!canRead) {
 *   throw new Error('Access denied');
 * }
 * ```
 */
export interface CheckAccessArgs {
  /** ID of the user to check access for (required) */
  userId: string;
  /**
   * The resource to check access on.
   *
   * Can be a collection slug (e.g., `"posts"`), a single slug (e.g., `"site-settings"`),
   * or a system resource (e.g., `"users"`, `"roles"`, `"settings"`).
   */
  resource: string;
  /** The operation to check */
  operation: "create" | "read" | "update" | "delete";
}

/**
 * The result type returned by the Direct API for API key operations.
 *
 * Extends `ApiKeyMeta` with an optional `key` field that is ONLY present
 * when creating a new key. The raw key is shown once and never stored —
 * surface it to the user immediately.
 */
export type ApiKeyResult =
  import("../../services/auth/api-key-service").ApiKeyMeta & {
    /**
     * The full raw key value (e.g., `"sk_live_..."`).
     *
     * Only present on `apiKeys.create()` responses.
     * This is the only time the raw key is returned — store it safely.
     */
    key?: string;
  };

/**
 * Arguments for listing API keys.
 *
 * @example
 * ```typescript
 * // List all keys for a specific user
 * const keys = await nextly.apiKeys.list({ userId: 'user-123' });
 *
 * // List all keys across all users (server-side / super-admin mode)
 * const allKeys = await nextly.apiKeys.list();
 * ```
 */
export interface ListApiKeysArgs extends DirectAPIConfig {
  /** Filter by owner user ID. Omit to list all keys (server-side / super-admin mode). */
  userId?: string;
  /** Maximum keys per page. @default 10 */
  limit?: number;
  /** Page number (1-indexed). @default 1 */
  page?: number;
}

/**
 * Arguments for finding a single API key by ID.
 *
 * @example
 * ```typescript
 * const key = await nextly.apiKeys.findByID({ id: 'key-123' });
 * ```
 */
export interface FindApiKeyByIDArgs extends DirectAPIConfig {
  /** API key ID (required) */
  id: string;
}

/**
 * Arguments for creating a new API key.
 *
 * The raw key is returned in the `key` field of the result exactly once.
 * It is NOT stored and cannot be retrieved again.
 *
 * @example
 * ```typescript
 * const { doc, key } = await nextly.apiKeys.create({
 *   userId: 'user-123',
 *   name: 'Frontend Integration',
 *   tokenType: 'read-only',
 *   expiresIn: '90d',
 * });
 * // key → "sk_live_abc123..." (show to user once, then discard)
 * ```
 */
export interface CreateApiKeyArgs extends DirectAPIConfig {
  /** ID of the user who will own this key (required). */
  userId: string;
  /** Human-readable label for the key (required). */
  name: string;
  /** Optional description of the key's intended use. */
  description?: string | null;
  /** Token type that controls permission resolution. */
  tokenType: import("../../services/auth/api-key-service").ApiKeyTokenType;
  /**
   * Role ID for role-based keys.
   *
   * Required when `tokenType` is `"role-based"`. Must be absent for other token types.
   */
  roleId?: string | null;
  /** How long until the key expires. Use `"unlimited"` for keys that never expire. */
  expiresIn: import("../../services/auth/api-key-service").ExpiresIn;
}

/**
 * Arguments for updating an API key's metadata.
 *
 * Only `name` and `description` can be changed after creation.
 * To change token type, role, or duration, revoke and create a new key.
 *
 * @example
 * ```typescript
 * const updated = await nextly.apiKeys.update({
 *   id: 'key-123',
 *   name: 'Renamed Key',
 * });
 * ```
 */
export interface UpdateApiKeyArgs extends DirectAPIConfig {
  /** API key ID (required) */
  id: string;
  /** New display name */
  name?: string;
  /** New description (`null` to clear) */
  description?: string | null;
}

/**
 * Arguments for revoking (soft-deleting) an API key.
 *
 * Revoked keys immediately stop working for authentication.
 * The key record is retained in the database with `isActive: false`.
 *
 * @example
 * ```typescript
 * await nextly.apiKeys.revoke({ id: 'key-123' });
 * ```
 */
export interface RevokeApiKeyArgs extends DirectAPIConfig {
  /** API key ID (required) */
  id: string;
}

/**
 * Arguments for programmatically validating an API key.
 *
 * @example
 * ```typescript
 * const result = await nextly.access.checkApiKey({ rawKey: 'sk_live_abc123...' });
 * if (!result.valid) return Response.json({ error: 'Unauthorized' }, { status: 401 });
 * ```
 */
export interface CheckApiKeyArgs {
  /** The raw API key value from the Authorization header (without `"Bearer "` prefix). */
  rawKey: string;
}

/**
 * Result of an API key validation check.
 *
 * When `valid` is `false`, all other fields are absent.
 * Never throws — returns `{ valid: false }` for invalid, expired, or revoked keys.
 *
 * @example
 * ```typescript
 * const { valid, userId, permissions } = await nextly.access.checkApiKey({ rawKey });
 *
 * if (!valid) {
 *   return Response.json({ error: 'Unauthorized' }, { status: 401 });
 * }
 * // userId, permissions, roles are populated for valid keys
 * ```
 */
export interface CheckApiKeyResult {
  /** Whether the key is valid and active. */
  valid: boolean;
  /** ID of the user who owns the key. Present when `valid` is `true`. */
  userId?: string;
  /** Token type of the key. Present when `valid` is `true`. */
  tokenType?: import("../../services/auth/api-key-service").ApiKeyTokenType;
  /** Resolved permission slugs (e.g., `["read-posts", "create-posts"]`). Present when `valid` is `true`. */
  permissions?: string[];
  /** Resolved role slugs for the key. Present when `valid` is `true` and roles are assigned. */
  roles?: string[];
  /** ISO 8601 expiry date, or `null` for unlimited keys. Present when `valid` is `true`. */
  expiresAt?: string | null;
}
