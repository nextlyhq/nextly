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
import type { RequestContext } from "../../collections/fields/types/base";
import type { Principal } from "../../plugins/principals/types";

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
// Access Rule Context
// ============================================================

/** What a rule is asked about: one of the six access operations. */
export type AccessRuleOperation =
  | "create"
  | "read"
  | "update"
  | "delete"
  | "publish"
  | "unpublish";

/**
 * What a rule is judging: a collection, a Single, or a component a field
 * belongs to, by its slug. Collection and Single rules are only ever asked
 * about a collection or a Single; a field rule is asked about the entity its
 * field is declared on.
 */
export interface AccessRuleTarget {
  kind: "collection" | "single" | "component";
  slug: string;
}

/**
 * The one context every access rule is handed: a collection's, a Single's and
 * a field's alike, so a rule reads the same names wherever it is written.
 *
 * It holds everything each kind of rule received before they shared one
 * shape, so a rule written against either earlier shape reads what it read:
 * a collection rule's `user`, `roles`, `permissions`, `principal`,
 * `operation` and `collection`, and a field rule's `req`, `id` and `data`.
 *
 * @example
 * ```typescript
 * const ctx: AccessRuleContext = {
 *   user: { id: 'user-123', email: 'user@example.com' },
 *   req: { user: { id: 'user-123', email: 'user@example.com' } },
 *   roles: ['editor', 'reviewer'],
 *   permissions: ['read-users', 'create-posts', 'read-posts', 'update-posts'],
 *   principal: null,
 *   operation: 'create',
 *   target: { kind: 'collection', slug: 'posts' },
 *   collection: 'posts',
 * };
 * ```
 */
export interface AccessRuleContext {
  /**
   * The authenticated staff user: `null` for unauthenticated requests, and
   * for a call made as a plugin-defined person, who is never a staff user.
   * For an API key, the user who made the key.
   */
  user: MinimalUser | null;
  /**
   * The request the rule is judged for. `req.user` is absent wherever `user`
   * is `null`. A field rule judged for a request gets the user object that
   * request carries; any other rule gets the caller's `id`, `email` where
   * known, and `roles`, and nothing else. Decide by `permissions` rather
   * than by anything on `req.user`.
   */
  req: RequestContext;
  /**
   * The user's role slugs (resolved from DB, includes inherited roles). Empty
   * for a plugin-defined person, who holds no role.
   */
  roles: string[];
  /**
   * The caller's permissions, spelled as the role screen and the database
   * spell them: `<action>-<resource>`, such as `read-posts`. Empty for a
   * visitor and for a plugin-defined person, who hold none.
   *
   * For one release the list also carries each
   * permission's earlier rule spelling, `<resource>:<action>` (`posts:read`),
   * after the others, so an existing rule keeps its answer. A rule that
   * checks that spelling is warned once; it stops being accepted in a later
   * release.
   */
  permissions: string[];
  /**
   * @experimental The plugin-defined signed-in person this call is made as,
   * with their kind, id and declared attributes, or `null` for any other
   * caller.
   *
   * A rule is the only way such a person is admitted: database permissions
   * and the super-admin bypass never apply to one, and a collection with no
   * rule for the operation refuses them. A rule written as
   * `({ user }) => !!user` therefore refuses a person, as it should; one
   * that admits a person names them, e.g.
   * `({ principal }) => principal?.kind === "accounts:account"`.
   */
  principal: Principal | null;
  /** The operation being performed */
  operation: AccessRuleOperation;
  /** What the operation is performed on. */
  target: AccessRuleTarget;
  /** The target's slug, the same as `target.slug`. */
  collection: string;
  /**
   * The entry's id, where the rule is judging a known entry. A collection's or
   * a Single's rule is asked before any entry is read, so it has none; a
   * field rule judging a stored entry has one.
   */
  id?: string;
  /** The entry's data, where the rule is judging a known entry. */
  data?: Record<string, unknown>;
  /**
   * The one language this answer is for: the language a read reads or a
   * write writes (an unknown or absent one being the default it resolves
   * to), or, where a publish puts several languages live at once, the one
   * being asked about, since it asks once for each. Absent where the
   * operation involves every language, or the site has none.
   */
  locale?: string;
  /**
   * Every language the operation involves: `[locale]` for a read or a write
   * in one language, a read's followed by each language a missing value
   * falls back to, in the order it tries them (a bulk or transactional
   * create or update writes the default; a duplicate, the default and each
   * language it falls back to); every configured language for a read of
   * every translation, a write to every language, an operation on the whole
   * entry such as a delete, and any operation on content stored the same in
   * every language.
   * A publish that puts several languages live at once is asked once for
   * each of them, with `locales` the languages it puts live: every
   * configured language where its content reaches a localized field group.
   * Empty only where the site has no languages. A rule that limits someone
   * to some languages checks all of these, so it refuses an operation that
   * reaches beyond them.
   */
  locales: string[];
}

/**
 * The context a collection or Single rule is handed: the one
 * {@link AccessRuleContext}, under the name it has always had.
 */
export type AccessControlContext = AccessRuleContext;

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
 * A signed-in user or an API key needs the database permission first;
 * code-defined access only narrows it, allowing only on `true`.
 * Super-admin always bypasses all access checks.
 *
 * @example
 * ```typescript
 * defineCollection({
 *   slug: 'posts',
 *   access: {
 *     // Only admins and editors can create
 *     create: ({ roles }) => roles.includes('admin') || roles.includes('editor'),
 *     // Visitors can read, and signed-in callers holding read-posts
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
  /**
   * Access rule for moving a document INTO published (publishing). Evaluated on
   * top of `update`, so a caller must satisfy both to publish. Absent means the
   * publish permission is resolved from DB grants alone (`publish-<slug>`).
   */
  publish?: AccessControlFunction | boolean;
  /**
   * Access rule for moving a document OUT of published (unpublishing). Evaluated
   * on top of `update`. Absent means it is resolved from DB grants alone
   * (`unpublish-<slug>`).
   */
  unpublish?: AccessControlFunction | boolean;
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
  /**
   * Access rule for moving the single INTO published (publishing). Evaluated on
   * top of `update`. Absent means it is resolved from DB grants alone
   * (`publish-<slug>`).
   */
  publish?: AccessControlFunction | boolean;
  /**
   * Access rule for moving the single OUT of published (unpublishing). Evaluated
   * on top of `update`. Absent means it is resolved from DB grants alone
   * (`unpublish-<slug>`).
   */
  unpublish?: AccessControlFunction | boolean;
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
  /** The operation being performed */
  operation: "create" | "read" | "update" | "delete" | "publish" | "unpublish";
  /** The collection or single slug (used as the permission resource) */
  resource: string;
  /** Optional code-defined access control from defineCollection/defineSingle */
  codeAccess?: CollectionAccessControl | SingleAccessControl;
  /**
   * Optional transaction-bound Drizzle executor. Supplied when the caller is
   * already inside a write transaction so the role/permission reads run on that
   * transaction's own connection rather than taking a second pooled one, which
   * can stall against a small pool. Defaults to the pooled connection.
   */
  executor?: unknown;
}
