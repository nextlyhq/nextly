/**
 * Access Control Type Definitions
 *
 * This module provides type definitions for collection-level access control
 * that can be stored in the database (for UI-created collections) or defined
 * in code (for code-first collections).
 *
 * Access rules are evaluated at runtime by the AccessControlService to
 * determine whether a user can perform CRUD operations on a collection.
 *
 * @module services/access/types
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import type { CollectionAccessRules, StoredAccessRule } from '@nextly/services/access';
 *
 * // Public read, authenticated create, role-based update/delete
 * const accessRules: CollectionAccessRules = {
 *   read: { type: 'public' },
 *   create: { type: 'authenticated' },
 *   update: { type: 'role-based', allowedRoles: ['admin', 'editor'] },
 *   delete: { type: 'role-based', allowedRoles: ['admin'] },
 * };
 * ```
 */

/**
 * Predefined access rule types for UI collections.
 *
 * These types define how access is determined for each operation:
 *
 * - `public` - Anyone can access (no authentication required)
 * - `authenticated` - Only logged-in users can access
 * - `role-based` - Only users with specific roles can access (OR logic: any role matches)
 * - `owner-only` - Only the document owner can access (based on a field like `createdBy`)
 * - `custom` - Reference to a code-defined function (code-first collections only)
 *
 * @example
 * ```typescript
 * const ruleType: AccessRuleType = 'role-based';
 * ```
 */
export type AccessRuleType =
  | "public"
  | "authenticated"
  | "role-based"
  | "owner-only"
  | "custom";

/**
 * CRUD operations that can have access rules.
 *
 * These map to the four primary operations on a collection:
 * - `create` - Creating new documents
 * - `read` - Reading/listing documents
 * - `update` - Modifying existing documents
 * - `delete` - Removing documents
 *
 * @example
 * ```typescript
 * const operation: AccessOperation = 'read';
 * ```
 */
export type AccessOperation = "create" | "read" | "update" | "delete";

/**
 * A storable access rule configuration.
 *
 * This interface defines the structure of an access rule that can be
 * serialized to JSON and stored in the database. Each property is
 * relevant to specific rule types:
 *
 * - `type` - Required for all rules
 * - `allowedRoles` - Required for `role-based` type (OR logic: user needs ANY of these roles)
 * - `ownerField` - Optional for `owner-only` type (defaults to `'createdBy'`)
 * - `functionPath` - Required for `custom` type (code-first only)
 *
 * @example
 * ```typescript
 * // Public access - anyone can access
 * const publicRule: StoredAccessRule = { type: 'public' };
 *
 * // Authenticated access - logged-in users only
 * const authRule: StoredAccessRule = { type: 'authenticated' };
 *
 * // Role-based access - admin OR editor can access
 * const roleRule: StoredAccessRule = {
 *   type: 'role-based',
 *   allowedRoles: ['admin', 'editor'],
 * };
 *
 * // Owner-only access - only document owner can access
 * const ownerRule: StoredAccessRule = {
 *   type: 'owner-only',
 *   ownerField: 'authorId', // defaults to 'createdBy' if not specified
 * };
 *
 * // Custom access - code-defined function (code-first only)
 * const customRule: StoredAccessRule = {
 *   type: 'custom',
 *   functionPath: '@/access/isAdmin',
 * };
 * ```
 */
export interface StoredAccessRule {
  /**
   * The type of access rule.
   * Determines how access is evaluated.
   */
  type: AccessRuleType;

  /**
   * Roles that are allowed access.
   *
   * Only used when `type` is `'role-based'`.
   * Uses OR logic: user needs ANY of these roles to access.
   * Role values should match the role slugs in your RBAC system
   * (e.g., `'admin'`, `'editor'`, `'user'`).
   *
   * @example ['admin', 'editor']
   */
  allowedRoles?: string[];

  /**
   * Field name containing the document owner's user ID.
   *
   * Only used when `type` is `'owner-only'`.
   * The service compares the authenticated user's ID with the value
   * of this field to determine ownership.
   *
   * @default 'createdBy'
   * @example 'authorId'
   */
  ownerField?: string;

  /**
   * Path to a custom access function.
   *
   * Only used when `type` is `'custom'`.
   * This is only supported for code-first collections where the
   * function can be imported and executed at runtime.
   *
   * The function should follow the access function signature:
   * `(args: { req, id?, data?, doc? }) => boolean | Promise<boolean>`
   *
   * @example '@/access/isAdmin'
   * @example './access/canEditPosts'
   */
  functionPath?: string;
}

/**
 * Complete access rules configuration for a collection.
 *
 * Defines access rules for all four CRUD operations. If a rule is not
 * specified for an operation, the default behavior is determined by
 * the AccessControlService (typically public access for backward compatibility).
 *
 * @example
 * ```typescript
 * // Blog posts: public read, authenticated create, owner can update/delete
 * const blogAccessRules: CollectionAccessRules = {
 *   create: { type: 'authenticated' },
 *   read: { type: 'public' },
 *   update: { type: 'owner-only' },
 *   delete: { type: 'owner-only' },
 * };
 *
 * // Admin-only collection
 * const adminAccessRules: CollectionAccessRules = {
 *   create: { type: 'role-based', allowedRoles: ['admin'] },
 *   read: { type: 'role-based', allowedRoles: ['admin'] },
 *   update: { type: 'role-based', allowedRoles: ['admin'] },
 *   delete: { type: 'role-based', allowedRoles: ['admin'] },
 * };
 *
 * // Mixed permissions
 * const contentAccessRules: CollectionAccessRules = {
 *   create: { type: 'role-based', allowedRoles: ['admin', 'editor'] },
 *   read: { type: 'public' },
 *   update: { type: 'role-based', allowedRoles: ['admin', 'editor'] },
 *   delete: { type: 'role-based', allowedRoles: ['admin'] },
 * };
 * ```
 */
export interface CollectionAccessRules {
  /**
   * Access rule for creating new documents.
   * If not specified, defaults to public access.
   */
  create?: StoredAccessRule;

  /**
   * Access rule for reading/listing documents.
   * If not specified, defaults to public access.
   *
   * For `owner-only` type, read operations return a query constraint
   * to filter documents by ownership instead of returning a boolean.
   */
  read?: StoredAccessRule;

  /**
   * Access rule for updating existing documents.
   * If not specified, defaults to public access.
   */
  update?: StoredAccessRule;

  /**
   * Access rule for deleting documents.
   * If not specified, defaults to public access.
   */
  delete?: StoredAccessRule;
}

/**
 * Result of evaluating an access rule.
 *
 * Used by AccessControlService to return the result of access evaluation.
 * Contains:
 * - `allowed` - Whether access is granted
 * - `query` - Optional query constraint for filtering (used with `owner-only` read)
 * - `reason` - Optional explanation for denial (useful for debugging/logging)
 *
 * @example
 * ```typescript
 * // Access granted
 * const allowed: AccessEvaluationResult = { allowed: true };
 *
 * // Access denied with reason
 * const denied: AccessEvaluationResult = {
 *   allowed: false,
 *   reason: 'Authentication required',
 * };
 *
 * // Access granted with query constraint (owner-only read)
 * const filtered: AccessEvaluationResult = {
 *   allowed: true,
 *   query: { createdBy: { equals: 'user-123' } },
 * };
 * ```
 */
export interface AccessEvaluationResult {
  /**
   * Whether access is allowed.
   */
  allowed: boolean;

  /**
   * Optional query constraint for filtering documents.
   *
   * Used primarily for `owner-only` read operations where the service
   * needs to filter documents by ownership rather than deny access entirely.
   * The query follows the Nextly Where query format.
   */
  query?: Record<string, unknown>;

  /**
   * Optional reason for denial.
   *
   * Populated when `allowed` is `false` to provide context for
   * logging, debugging, or user-facing error messages.
   */
  reason?: string;
}

/**
 * All supported access rule types.
 *
 * Useful for validation and iteration.
 *
 * @example
 * ```typescript
 * if (ACCESS_RULE_TYPES.includes(ruleType)) {
 *   // Valid rule type
 * }
 * ```
 */
export const ACCESS_RULE_TYPES: readonly AccessRuleType[] = [
  "public",
  "authenticated",
  "role-based",
  "owner-only",
  "custom",
] as const;

/**
 * All supported access operations.
 *
 * Useful for validation and iteration.
 *
 * @example
 * ```typescript
 * for (const op of ACCESS_OPERATIONS) {
 *   const rule = accessRules[op];
 *   // ...
 * }
 * ```
 */
export const ACCESS_OPERATIONS: readonly AccessOperation[] = [
  "create",
  "read",
  "update",
  "delete",
] as const;

/**
 * Default owner field name for owner-only access rules.
 *
 * Used when `ownerField` is not specified in an `owner-only` rule.
 */
export const DEFAULT_OWNER_FIELD = "createdBy";
