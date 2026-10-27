/**
 * Admin panel permission types for RBAC-based authorization.
 *
 * AdminCapabilities is computed from the user's resolved permission slugs
 * and drives sidebar filtering, route guards, and UI visibility.
 */

/**
 * What the current user may do with one collection or Single, as the server
 * decides it. A Single has no create or delete, so those are false for one.
 */
export interface CollectionCapabilities {
  canRead: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canPublish: boolean;
  canUnpublish: boolean;
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
  /** Has 'read-webhooks' or the 'update-webhooks' management umbrella */
  canViewWebhooks: boolean;
  /**
   * Has 'read-content-releases'.
   *
   * A flag of its own because `content-releases` is a SYSTEM resource, so it is
   * deliberately skipped when the per-collection map is built — and the generic
   * `action-resource` lookup then finds nothing and answers false. Without this,
   * a permission that IS held reads as absent and the section disappears for
   * everyone but a super-admin.
   */
  canViewReleases: boolean;

  // Per-collection and per-Single capabilities, keyed by slug, as the server
  // answers them
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

/** What the server says the user may do with one collection or Single. */
export interface EntityCapabilitiesAnswer {
  kind: "collection" | "single";
  read: boolean;
  update: boolean;
  publish: boolean;
  unpublish: boolean;
  /** Collections only. */
  create?: boolean;
  /** Collections only. */
  delete?: boolean;
  /**
   * The requests judged in languages other than the one asked about, each as
   * the server judges it. Absent from a server that predates them, where the
   * action's own cell stands in.
   */
  readTranslations?: boolean;
  readHistory?: boolean;
  publishEveryLanguage?: boolean;
  /** Collections only. */
  createInDefaultLanguage?: boolean;
  updateInDefaultLanguage?: boolean;
  /** Collections only. */
  duplicate?: boolean;
}

/**
 * Response shape from GET /api/me/capabilities: what the signed-in user may
 * do with each collection and Single, decided by the server's own route gates.
 */
export interface CapabilitiesResponse {
  isSuperAdmin: boolean;
  /** When the answer stops holding (epoch ms), or null when nothing expires. */
  validUntil: number | null;
  entities: Record<string, EntityCapabilitiesAnswer>;
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
  /**
   * When this list stops holding, in epoch ms, or null: the soonest end of a
   * role assignment it was read under. Absent from a server that predates it.
   */
  validUntil?: number | null;
}
