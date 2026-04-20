/**
 * RBAC Access Control Types
 *
 * Type definitions for the hybrid access control system that merges
 * code-defined access functions with database role/permission checks.
 *
 * These types are used by:
 * - `RBACAccessControlService` for evaluating access
 * - `defineCollection({ access })` and `defineSingle({ access })` for code-first config
 * - Admin panel authorization hooks and guards
 *
 * @module shared/types/access
 * @since 1.0.0
 */

// ============================================================
// Minimal User Type
// ============================================================

/**
 * Minimal user information available in access control context.
 *
 * This is a subset of the full user object, containing only
 * the fields needed for access control decisions.
 */
export interface MinimalUser {
  /** Unique user identifier */
  id: string;
  /** User's email address (optional) */
  email?: string;
}

// ============================================================
// Access Control Context
// ============================================================

/**
 * Context passed to code-defined access control functions.
 *
 * Contains all information needed to make an authorization decision:
 * user identity, role memberships, resolved permissions, and the
 * operation being performed.
 *
 * @example
 * ```typescript
 * const ctx: AccessControlContext = {
 *   user: { id: 'user-123', email: 'user@example.com' },
 *   roles: ['editor', 'reviewer'],
 *   permissions: ['users:read', 'posts:create', 'posts:read', 'posts:update'],
 *   operation: 'create',
 *   collection: 'posts',
 * };
 * ```
 */
export interface AccessControlContext {
  /** The authenticated user (null for unauthenticated requests) */
  user: MinimalUser | null;
  /** The user's role slugs (resolved from DB, includes inherited roles) */
  roles: string[];
  /** The user's effective permission slugs in 'resource:action' format */
  permissions: string[];
  /** The CRUD operation being performed */
  operation: "create" | "read" | "update" | "delete";
  /** The collection or single slug */
  collection: string;
}

// ============================================================
// Access Control Function
// ============================================================

/**
 * Code-defined access control function.
 *
 * Returns `true` to allow access, `false` to deny.
 * Can be synchronous or asynchronous.
 *
 * @example
 * ```typescript
 * // Synchronous — role check
 * const editorOnly: AccessControlFunction = ({ roles }) =>
 *   roles.includes('admin') || roles.includes('editor');
 *
 * // Asynchronous — external check
 * const checkExternal: AccessControlFunction = async ({ user }) => {
 *   const response = await fetch(`/api/can-access/${user?.id}`);
 *   return response.ok;
 * };
 * ```
 */
export type AccessControlFunction = (
  ctx: AccessControlContext
) => boolean | Promise<boolean>;

// ============================================================
// Collection Access Control
// ============================================================

/**
 * Access control configuration for a collection.
 *
 * Each CRUD operation can be controlled with:
 * - A **function** for contextual rules (receives full `AccessControlContext`)
 * - A **boolean** for simple allow/deny
 * - **Omitted** to fall back to database role/permission checks
 *
 * Code-defined access always takes precedence over database permissions.
 * Super-admin always bypasses all access checks.
 *
 * @example
 * ```typescript
 * defineCollection({
 *   slug: 'posts',
 *   access: {
 *     // Only admins and editors can create
 *     create: ({ roles }) => roles.includes('admin') || roles.includes('editor'),
 *     // Any authenticated user can read
 *     read: true,
 *     // Only the user's own posts (checked via roles/permissions)
 *     update: ({ roles }) => roles.includes('admin') || roles.includes('editor'),
 *     // Only admins can delete
 *     delete: ({ roles }) => roles.includes('admin'),
 *   },
 *   fields: [...],
 * });
 * ```
 */
export interface CollectionAccessControl {
  /** Access rule for creating new documents */
  create?: AccessControlFunction | boolean;
  /** Access rule for reading/listing documents */
  read?: AccessControlFunction | boolean;
  /** Access rule for updating existing documents */
  update?: AccessControlFunction | boolean;
  /** Access rule for deleting documents */
  delete?: AccessControlFunction | boolean;
}

// ============================================================
// Single Access Control
// ============================================================

/**
 * Access control configuration for a single.
 *
 * Singles only support read and update operations — they are
 * auto-created on first access and cannot be deleted.
 *
 * @example
 * ```typescript
 * defineSingle({
 *   slug: 'site-settings',
 *   access: {
 *     read: true,
 *     update: ({ roles }) => roles.includes('admin'),
 *   },
 *   fields: [...],
 * });
 * ```
 */
export interface SingleAccessControl {
  /** Access rule for reading the single document */
  read?: AccessControlFunction | boolean;
  /** Access rule for updating the single document */
  update?: AccessControlFunction | boolean;
}

// ============================================================
// Check Access Parameters
// ============================================================

/**
 * Parameters for the `RBACAccessControlService.checkAccess()` method.
 */
export interface CheckAccessParams {
  /** The authenticated user's ID (null for unauthenticated requests) */
  userId: string | null;
  /** The CRUD operation being performed */
  operation: "create" | "read" | "update" | "delete";
  /** The collection or single slug (used as the permission resource) */
  resource: string;
  /** Optional code-defined access control from defineCollection/defineSingle */
  codeAccess?: CollectionAccessControl | SingleAccessControl;
}
