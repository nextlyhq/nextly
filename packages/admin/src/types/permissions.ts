/**
 * Admin panel permission types for RBAC-based authorization.
 *
 * AdminCapabilities is computed from the user's resolved permission slugs
 * and drives sidebar filtering, route guards, and UI visibility.
 */

/**
 * Per-collection CRUD capabilities.
 */
export interface CollectionCapabilities {
  canRead: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}

/**
 * Admin panel capabilities derived from the current user's permissions.
 *
 * Super-admin users have ALL capabilities set to `true`.
 * Other users have capabilities computed from their resolved permission slugs.
 */
export interface AdminCapabilities {
  /** Whether the user is a super-admin (bypasses all checks) */
  isSuperAdmin: boolean;

  // Sidebar visibility
  /** Has any collection read permission */
  canViewCollections: boolean;
  /** Has 'read-users' */
  canViewUsers: boolean;
  /** Has 'read-roles' */
  canViewRoles: boolean;
  /** Has 'read-media' */
  canViewMedia: boolean;
  /** Has 'manage-settings' */
  canViewSettings: boolean;

  // Per-collection visibility (keyed by collection slug)
  collections: Record<string, CollectionCapabilities>;

  // Action permissions
  /** Has 'create-users' or 'update-users' */
  canManageUsers: boolean;
  /** Has 'create-roles' or 'update-roles' */
  canManageRoles: boolean;
  /** Has 'manage-media' */
  canManageMedia: boolean;
  /** Has 'manage-settings' */
  canManageSettings: boolean;
  /** Has 'manage-email-providers' */
  canManageEmailProviders: boolean;
  /** Has 'manage-email-templates' */
  canManageEmailTemplates: boolean;
}

/**
 * Response shape from GET /api/me/permissions.
 */
export interface UserPermissionsResponse {
  /** Permission slugs (e.g., ['read-users', 'create-posts']) */
  permissions: string[];
  /** Whether the user has super-admin role */
  isSuperAdmin: boolean;
  /** User's role slugs (e.g., ['super-admin', 'editor']) */
  roles: string[];
}
