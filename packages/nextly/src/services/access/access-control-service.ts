/**
 * Access Control Service
 *
 * Evaluates access rules for collection operations (create, read, update, delete).
 * Supports predefined rule types for UI-created collections and custom functions
 * for code-first collections.
 *
 * This service is stateless and does not require database access. It evaluates
 * access based on the provided rules, context, and document data.
 *
 * @module services/access/access-control-service
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import { AccessControlService } from '@nextly/services/access';
 * import type { CollectionAccessRules } from '@nextly/services/access';
 *
 * const accessService = new AccessControlService();
 *
 * // Define access rules for a blog collection
 * const blogRules: CollectionAccessRules = {
 *   create: { type: 'authenticated' },
 *   read: { type: 'public' },
 *   update: { type: 'owner-only' },
 *   delete: { type: 'role-based', allowedRoles: ['admin'] },
 * };
 *
 * // Evaluate access for a read operation
 * const result = await accessService.evaluateAccess(
 *   blogRules,
 *   'read',
 *   { user: { id: 'user-123', role: 'editor' } }
 * );
 *
 * if (result.allowed) {
 *   // Proceed with operation
 *   if (result.query) {
 *     // Apply query constraint for filtering
 *   }
 * } else {
 *   // Access denied: result.reason
 * }
 * ```
 */

import type { RequestContext } from "@nextly/collections/fields/types/base";

import type {
  AccessOperation,
  StoredAccessRule,
  CollectionAccessRules,
  AccessEvaluationResult,
} from "./types";
import { DEFAULT_OWNER_FIELD } from "./types";

/**
 * Signature for custom access functions.
 *
 * Custom functions can return:
 * - `boolean` - Direct allow/deny
 * - `Promise<boolean>` - Async allow/deny
 * - `Record<string, unknown>` - Query constraint for filtering
 * - `Promise<Record<string, unknown>>` - Async query constraint
 *
 * @example
 * ```typescript
 * // Boolean access function
 * export const isAdmin: CustomAccessFunction = ({ req }) => {
 *   return req.user?.role === 'admin';
 * };
 *
 * // Query constraint access function
 * export const ownDocuments: CustomAccessFunction = ({ req }) => {
 *   return { createdBy: { equals: req.user?.id } };
 * };
 * ```
 */
export type CustomAccessFunction = (args: {
  /** Request context with user information */
  req: RequestContext;
  /** Document ID (available for read/update/delete operations) */
  id?: string;
  /** Document data */
  data?: Record<string, unknown>;
}) =>
  | boolean
  | Record<string, unknown>
  | Promise<boolean | Record<string, unknown>>;

/**
 * Service for evaluating collection-level access control rules.
 *
 * Handles five types of access rules:
 * - `public` - Anyone can access (no authentication required)
 * - `authenticated` - Only logged-in users can access
 * - `role-based` - Only users with specific roles can access (OR logic)
 * - `owner-only` - Only the document owner can access
 * - `custom` - Code-defined function (code-first collections only)
 *
 * ## Key Features
 *
 * - **Query Constraints**: For `owner-only` read operations, returns a query
 *   constraint to filter documents instead of denying access entirely
 * - **Custom Functions**: Supports dynamic import of custom access functions
 *   for code-first collections
 * - **No DB Required**: Stateless service that evaluates rules without database access
 *
 * @example Basic usage
 * ```typescript
 * const accessService = new AccessControlService();
 *
 * const rules: CollectionAccessRules = {
 *   create: { type: 'authenticated' },
 *   read: { type: 'public' },
 *   update: { type: 'owner-only' },
 *   delete: { type: 'role-based', allowedRoles: ['admin'] },
 * };
 *
 * // Check if user can create
 * const canCreate = await accessService.evaluateAccess(
 *   rules,
 *   'create',
 *   { user: { id: 'user-123' } }
 * );
 * // { allowed: true }
 *
 * // Check if anonymous user can create
 * const anonCreate = await accessService.evaluateAccess(
 *   rules,
 *   'create',
 *   {} // No user
 * );
 * // { allowed: false, reason: 'Authentication required' }
 * ```
 *
 * @example Owner-only with query constraint
 * ```typescript
 * const rules: CollectionAccessRules = {
 *   read: { type: 'owner-only', ownerField: 'authorId' },
 * };
 *
 * const result = await accessService.evaluateAccess(
 *   rules,
 *   'read',
 *   { user: { id: 'user-123' } }
 * );
 * // {
 * //   allowed: true,
 * //   query: { authorId: { equals: 'user-123' } }
 * // }
 * ```
 */
export class AccessControlService {
  /**
   * Evaluate access for a given operation.
   *
   * Returns an `AccessEvaluationResult` indicating whether access is allowed,
   * an optional query constraint for filtering, and an optional denial reason.
   *
   * ## Behavior by Rule Type
   *
   * | Type | Behavior |
   * |------|----------|
   * | `public` | Always allowed |
   * | `authenticated` | Allowed if `context.user` exists |
   * | `role-based` | Allowed if user has ANY of the allowed roles |
   * | `owner-only` | Read: returns query constraint; Others: checks document ownership |
   * | `custom` | Executes custom function via dynamic import |
   *
   * ## Default Behavior
   *
   * If no rule is defined for an operation, access is allowed (public by default).
   * This ensures backward compatibility with collections that don't have access rules.
   *
   * @param rules - Collection access rules (or undefined for public access)
   * @param operation - The CRUD operation being performed
   * @param context - Request context with user information
   * @param documentId - Optional document ID (for read/update/delete)
   * @param document - Optional document data (for update/delete ownership checks)
   * @returns Promise resolving to access evaluation result
   *
   * @example
   * ```typescript
   * const result = await accessService.evaluateAccess(
   *   { read: { type: 'authenticated' } },
   *   'read',
   *   { user: { id: 'user-123', role: 'editor' } }
   * );
   *
   * if (result.allowed) {
   *   // Proceed with operation
   * } else {
   *   throw new Error(result.reason ?? 'Access denied');
   * }
   * ```
   */
  async evaluateAccess(
    rules: CollectionAccessRules | undefined,
    operation: AccessOperation,
    context: RequestContext,
    documentId?: string,
    document?: Record<string, unknown>
  ): Promise<AccessEvaluationResult> {
    const rule = rules?.[operation];

    // No rule = public access (for backward compatibility)
    if (!rule) {
      return { allowed: true };
    }

    switch (rule.type) {
      case "public":
        return this.evaluatePublicAccess();

      case "authenticated":
        return this.evaluateAuthenticatedAccess(context);

      case "role-based":
        return this.evaluateRoleBasedAccess(rule, context);

      case "owner-only":
        return this.evaluateOwnerAccess(rule, operation, context, document);

      case "custom":
        return this.evaluateCustomAccess(rule, context, documentId, document);

      default:
        return { allowed: false, reason: "Unknown access rule type" };
    }
  }

  private evaluatePublicAccess(): AccessEvaluationResult {
    return { allowed: true };
  }

  private evaluateAuthenticatedAccess(
    context: RequestContext
  ): AccessEvaluationResult {
    return {
      allowed: !!context.user,
      reason: context.user ? undefined : "Authentication required",
    };
  }

  private evaluateRoleBasedAccess(
    rule: StoredAccessRule,
    context: RequestContext
  ): AccessEvaluationResult {
    const userRole = context.user?.role;
    const allowedRoles = rule.allowedRoles ?? [];

    if (!context.user) {
      return { allowed: false, reason: "Authentication required" };
    }

    if (!userRole) {
      return { allowed: false, reason: "User has no role assigned" };
    }

    const allowed = allowedRoles.includes(userRole);

    return {
      allowed,
      reason: allowed
        ? undefined
        : `Insufficient permissions. Required roles: ${allowedRoles.join(", ")}`,
    };
  }

  private evaluateOwnerAccess(
    rule: StoredAccessRule,
    operation: AccessOperation,
    context: RequestContext,
    document?: Record<string, unknown>
  ): AccessEvaluationResult {
    const ownerField = rule.ownerField ?? DEFAULT_OWNER_FIELD;

    if (!context.user) {
      return { allowed: false, reason: "Authentication required" };
    }

    if (operation === "read") {
      return {
        allowed: true,
        query: { [ownerField]: { equals: context.user.id } },
      };
    }

    if (operation === "create") {
      return { allowed: true };
    }

    if (document) {
      const ownerId = document[ownerField];
      const isOwner = ownerId === context.user.id;

      return {
        allowed: isOwner,
        reason: isOwner ? undefined : "You can only modify your own documents",
      };
    }

    // No document provided for update/delete - allow (will be checked at DB level)
    return { allowed: true };
  }

  private async evaluateCustomAccess(
    rule: StoredAccessRule,
    context: RequestContext,
    documentId?: string,
    document?: Record<string, unknown>
  ): Promise<AccessEvaluationResult> {
    if (!rule.functionPath) {
      return { allowed: false, reason: "Custom access function not defined" };
    }

    try {
      const accessFn = await this.loadCustomAccessFunction(rule.functionPath);
      const result = await accessFn({
        req: context,
        id: documentId,
        data: document,
      });

      if (typeof result === "boolean") {
        return {
          allowed: result,
          reason: result ? undefined : "Access denied by custom function",
        };
      }

      return { allowed: true, query: result };
    } catch (error) {
      console.error(
        `Failed to execute custom access function at '${rule.functionPath}':`,
        error
      );
      return { allowed: false, reason: "Access check failed" };
    }
  }

  private async loadCustomAccessFunction(
    functionPath: string
  ): Promise<CustomAccessFunction> {
    const module = await import(functionPath);

    const fn = module.default ?? module;

    if (typeof fn !== "function") {
      throw new Error(`Module at '${functionPath}' does not export a function`);
    }

    return fn as CustomAccessFunction;
  }
}
