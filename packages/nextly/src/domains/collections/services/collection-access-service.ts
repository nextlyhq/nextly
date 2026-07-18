/**
 * CollectionAccessService — Collection-level access control for entry operations.
 *
 * Extracted from CollectionEntryService (6,490-line god file) as a leaf dependency
 * with no deps on other new split services.
 *
 * Responsibilities:
 * - Evaluate collection-level access rules (public, authenticated, role-based, owner-only, custom)
 * - RBAC gate (super-admin bypass → code-defined → DB permissions)
 * - Query constraint generation for owner-only read filtering
 * - Request context building from UserContext
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { RequestContext } from "@nextly/collections/fields/types/base";

import type { RBACAccessControlService } from "../../../domains/auth/services/rbac-access-control-service";
import type {
  AccessControlService,
  CollectionAccessRules,
  AccessOperation,
} from "../../../services/access";
import type { Logger } from "../../../services/shared";
import { BaseService } from "../../../shared/base-service";
import type { DynamicCollectionService } from "../../dynamic-collections";

import type { CollectionServiceResult, UserContext } from "./collection-types";

/** Role slug that grants the full stored-rule bypass. */
const SUPER_ADMIN_SLUG = "super-admin";

/**
 * Whether the caller's AUTHORIZED role set makes them a super-admin.
 *
 * Keyed on the authorized role slugs (`user.roles`, the resolved session slugs
 * or the key-scoped slugs for API-key auth, plus the singular `user.role` that
 * the Direct API boundary forwards) rather than the account id: a scoped API
 * key owned by a super-admin must NOT inherit the owner's super-admin bypass —
 * the authorized scope is what matters. The singular `role` is folded in so a
 * caller reaching us through a surface that only carries `{ id, role }` (the
 * Direct API collection namespace) still gets the bypass the changeset promises
 * on every transport. Paths that populate neither simply don't get the bypass
 * (fail-safe), falling through to the normal RBAC + stored-rule checks.
 */
function isSuperAdminContext(user?: UserContext): boolean {
  if (!user) return false;
  if (user.role === SUPER_ADMIN_SLUG) return true;
  return Array.isArray(user.roles) && user.roles.includes(SUPER_ADMIN_SLUG);
}

export class CollectionAccessService extends BaseService {
  constructor(
    adapter: DrizzleAdapter,
    logger: Logger,
    private readonly collectionService: DynamicCollectionService,
    private readonly accessControlService: AccessControlService,
    private readonly rbacAccessControlService?: RBACAccessControlService
  ) {
    super(adapter, logger);
  }

  /**
   * Whether the caller's authorized role set makes them a super-admin.
   *
   * Public wrapper over the module predicate so other services (e.g. the
   * transaction owner-only safety nets) can honor the same "bypass stored
   * rules on every transport" contract without re-deriving super-admin
   * status. Keyed on authorized scope (`role`/`roles`), never the account id.
   */
  isSuperAdmin(user?: UserContext): boolean {
    return isSuperAdminContext(user);
  }

  /**
   * Build RequestContext from UserContext for access control evaluation.
   */
  buildRequestContext(user?: UserContext): RequestContext {
    if (!user) {
      return {};
    }

    return {
      user: {
        id: user.id,
        role: user.role,
        // Forward the full role set so role-based rules match on ANY role,
        // not just a single primary role (the user/role model is many-to-many).
        roles: user.roles,
        email: user.email,
      },
    };
  }

  /**
   * Extract access rules from collection metadata.
   *
   * Access rules can be stored in:
   * 1. `collection.accessRules` - Direct property (new format)
   * 2. `collection.schemaDefinition.accessRules` - Inside schema (legacy format)
   */
  getAccessRules(
    collection: Record<string, unknown>
  ): CollectionAccessRules | undefined {
    const collectionRecord = collection;

    // Try direct property first (new format)
    if (collectionRecord.accessRules) {
      return collectionRecord.accessRules;
    }

    // Fall back to schemaDefinition (legacy format)
    const schemaDef = collectionRecord.schemaDefinition as
      | Record<string, unknown>
      | undefined;
    if (schemaDef?.accessRules) {
      return schemaDef.accessRules;
    }

    // No access rules defined - will default to public access
    return undefined;
  }

  /**
   * Check collection-level access for an operation.
   *
   * Called FIRST before any other security checks (hooks).
   * Returns early with 403 if access is denied.
   *
   * When `overrideAccess` is true (a trusted-server / system write), access
   * control is bypassed entirely (returns null).
   *
   * When `routeAuthorized` is true, the route middleware already ran the coarse
   * RBAC / code-access gate, so only THAT gate is skipped here — the stored
   * collection access rules (owner-only / role-based / authenticated / custom)
   * are still evaluated with the real user. This is why a route write cannot
   * skip owner-only enforcement: `overrideAccess` stays false, only the
   * redundant RBAC re-check is elided.
   */
  async checkCollectionAccess<T>(
    collectionName: string,
    operation: AccessOperation,
    user?: UserContext,
    documentId?: string,
    document?: Record<string, unknown>,
    overrideAccess?: boolean,
    routeAuthorized?: boolean
  ): Promise<CollectionServiceResult<T> | null> {
    // Trusted-server / system write: bypass all access control checks.
    if (overrideAccess) {
      return null;
    }

    // Super-admin bypasses BOTH the RBAC gate and the stored rules (including
    // owner-only) so an admin can act on any record on every transport. Keyed
    // on the authorized role set (see isSuperAdminContext), so a scoped API key
    // cannot inherit its owner's super-admin bypass.
    if (isSuperAdminContext(user)) {
      return null;
    }

    // RBAC coarse gate: super-admin bypass → code-defined access → DB
    // permissions. Skipped when routeAuthorized, because the route middleware
    // (requireCollectionAccess) already performed this exact check; the stored
    // rules below still run.
    if (!routeAuthorized && this.rbacAccessControlService && user) {
      try {
        const allowed = await this.rbacAccessControlService.checkAccess({
          userId: user.id,
          operation,
          resource: collectionName,
        });
        if (!allowed) {
          return {
            success: false,
            statusCode: 403,
            message: `Access denied: insufficient permissions for ${operation} on ${collectionName}`,
            data: null as unknown as T,
          };
        }
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error("RBAC access check failed", {
          collectionName,
          operation,
          userId: user.id,
          error: errorMessage,
        });
        // Fail-secure: deny on unexpected RBAC errors
        return {
          success: false,
          statusCode: 500,
          message: "Failed to verify RBAC permissions",
          data: null as unknown as T,
        };
      }
    }

    try {
      // Get collection metadata to retrieve access rules
      const collection =
        await this.collectionService.getCollection(collectionName);
      const accessRules = this.getAccessRules(
        collection as Record<string, unknown>
      );

      // Build request context from user
      const requestContext = this.buildRequestContext(user);

      // Evaluate access
      const result = await this.accessControlService.evaluateAccess(
        accessRules,
        operation,
        requestContext,
        documentId,
        document
      );

      if (!result.allowed) {
        return {
          success: false,
          statusCode: 403,
          message: result.reason || "Access denied",
          data: null as unknown as T,
        };
      }

      // Access allowed - return null to continue
      return null;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // If collection not found, let other code handle it
      if (errorMessage?.includes("not found")) {
        return null;
      }

      this.logger.error("Error checking collection access", {
        collectionName,
        operation,
        error: errorMessage,
      });

      // On unexpected errors, deny access for safety
      return {
        success: false,
        statusCode: 500,
        message: "Failed to verify access permissions",
        data: null as unknown as T,
      };
    }
  }

  /**
   * Get access query constraint for read operations.
   *
   * For owner-only access rules on read operations, the AccessControlService
   * returns a query constraint instead of a boolean.
   */
  async getAccessQueryConstraint(
    collectionName: string,
    user?: UserContext,
    overrideAccess?: boolean
  ): Promise<Record<string, unknown> | null> {
    // Super-admin reads are unfiltered too, matching the write-side bypass so
    // "super-admins bypass stored rules on every transport" holds for reads.
    if (overrideAccess || !user || isSuperAdminContext(user)) {
      return null;
    }

    try {
      const collection =
        await this.collectionService.getCollection(collectionName);
      const accessRules = this.getAccessRules(
        collection as Record<string, unknown>
      );
      const requestContext = this.buildRequestContext(user);

      const result = await this.accessControlService.evaluateAccess(
        accessRules,
        "read",
        requestContext
      );

      // Return query constraint if present
      return (result.query as Record<string, unknown>) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Resolve the owner-only constraint for a single
   * operation as a flat `{ field, value }` pair so callers can fold it
   * directly into a Drizzle `WHERE` clause. Returns `null` when the
   * rule is not `owner-only`, when the caller is bypassing access via
   * `overrideAccess`, or when no user context is present.
   *
   * Read uses get the constraint from the access-control service's
   * `query` channel; mutate operations (update / delete) read the rule
   * directly because the access service only emits the `query` channel
   * for reads. The result is the same for the consumer either way:
   * if non-null, the entry fetch / mutate must include this predicate
   * in its WHERE clause so a non-owner sees a 404, not a 403, and IDOR
   * by id-iteration returns nothing.
   *
   * Use the existing `evaluateAccess` flow for the boolean
   * (allowed / denied) decision; this helper is purely about the
   * predicate that goes into SQL.
   */
  async getOwnerConstraint(
    collectionName: string,
    operation: AccessOperation,
    user?: UserContext,
    overrideAccess?: boolean
  ): Promise<{ field: string; value: string } | null> {
    // Super-admin bypasses the owner predicate on the transactional paths too.
    if (overrideAccess || !user || isSuperAdminContext(user)) return null;

    try {
      const collection =
        await this.collectionService.getCollection(collectionName);
      const accessRules = this.getAccessRules(
        collection as Record<string, unknown>
      );
      const rule = accessRules?.[operation];
      if (!rule || rule.type !== "owner-only") return null;

      const field = rule.ownerField ?? "createdBy";
      return { field, value: user.id };
    } catch {
      return null;
    }
  }
}
