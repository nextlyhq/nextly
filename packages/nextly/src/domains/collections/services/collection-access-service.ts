/**
 * CollectionAccessService — Collection-level access control for entry operations.
 *
 * Extracted from CollectionEntryService (6,490-line god file) as a leaf dependency
 * with no deps on other new split services.
 *
 * Responsibilities:
 * - The RBAC gate (super-admin bypass → code-defined access → DB permissions),
 *   which is the whole collection-level access decision
 * - The secure-by-default refusal of an anonymous publish/unpublish
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import {
  apiKeyWriteAllowed,
  type AuthenticatedScope,
} from "../../../auth/authenticated-scope";
import { effectiveCallerScope } from "../../../auth/caller-scope";
import type { RBACAccessControlService } from "../../../domains/auth/services/rbac-access-control-service";
import type { AccessOperation } from "../../../services/access";
import { isSuperAdminContext } from "../../../services/access";
import type { Logger } from "../../../services/shared";
import { BaseService } from "../../../shared/base-service";

import type { CollectionServiceResult, UserContext } from "./collection-types";

export class CollectionAccessService extends BaseService {
  constructor(
    adapter: DrizzleAdapter,
    logger: Logger,
    private readonly rbacAccessControlService?: RBACAccessControlService
  ) {
    super(adapter, logger);
  }

  /**
   * Whether the caller's authorized role set makes them a super-admin.
   *
   * Public wrapper over the module predicate so other services honor the same
   * "bypass the gate on every transport" contract without re-deriving
   * super-admin status. Keyed on authorized scope (`role`/`roles`), never the
   * account id.
   */
  isSuperAdmin(user?: UserContext): boolean {
    return isSuperAdminContext(user);
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
   * When `routeAuthorized` is true, the route middleware already ran this same
   * coarse gate, so it is skipped here rather than run twice.
   *
   * Named parameters rather than positional ones: this used to carry ten,
   * three of which fed the stored-rule evaluation that no longer exists.
   * Removing them positionally would have let a caller's `undefined` rebind to
   * `overrideAccess` — type-compatible, invisible to the compiler, and on a
   * security gate.
   */
  async checkCollectionAccess<T>(params: {
    collectionName: string;
    operation: AccessOperation;
    user?: UserContext;
    overrideAccess?: boolean;
    routeAuthorized?: boolean;
    /**
     * The caller's authenticated scope. For a scoped API key the RBAC gate
     * judges the key's OWN stamped grants rather than the owner's permissions
     * (see auth/authenticated-scope). Undefined for session/system callers.
     */
    authenticatedScope?: AuthenticatedScope;
    /**
     * Optional transaction-bound Drizzle executor. Supplied when the caller is
     * already inside a write transaction (the caller-owned-tx bulk paths) so
     * the RBAC role/permission reads run on that transaction's own connection
     * instead of taking a second pooled one, which can stall against a small
     * pool. Defaults to the pooled connection.
     */
    executor?: unknown;
  }): Promise<CollectionServiceResult<T> | null> {
    const {
      collectionName,
      operation,
      user,
      overrideAccess,
      routeAuthorized,
      authenticatedScope,
      executor,
    } = params;
    // Trusted-server / system write: bypass all access control checks.
    if (overrideAccess) {
      return null;
    }

    // The scope the request arrived with, when this caller did not name one.
    //
    // Two of this method's callers cannot name one: the transaction entry
    // points (`createEntryInTransaction` and its siblings) take write params
    // that declare no `authenticatedScope`, and the plugin service facade
    // exposes them, so an API-key request reaching a write through a
    // transaction was judged on the key OWNER's roles while the identical write
    // through `createEntry` was held to the key's own grants. Widening those
    // params would fix the two that exist; reading the request's scope here
    // fixes the one written next as well.
    //
    // An explicit argument still wins, so a caller may narrow.
    const scope = effectiveCallerScope(authenticatedScope);

    // Super-admin bypasses the RBAC gate so an admin can act on any record on
    // every transport — EXCEPT via a scoped API key. The bypass belongs to the
    // session path: a key is authoritative on its OWN stamped scope, never on
    // the owner's roles, so a read/update-only key issued by an administrator
    // is not equivalent to their full account (mirrors canReadEntity). Applying
    // the bypass here would let a super-admin-owned, update-only key publish,
    // recreating the very hole this scope check closes.
    const isScopedApiKey = scope?.actorType === "apiKey";
    if (!isScopedApiKey && isSuperAdminContext(user)) {
      return null;
    }

    // `routeAuthorized` asserts the route middleware already authenticated AND
    // gated THIS user, so it may skip only the redundant RBAC re-check. Without
    // a user that assertion is invalid: a bare flag on an exported surface
    // (e.g. bulkUpdateByQuery) must not skip the gate and fall through to the
    // public default for a rule-less collection. Fail closed, mirroring the
    // Single helper's `routeAuthorized && user` guard.
    if (routeAuthorized && !user) {
      return {
        success: false,
        statusCode: 403,
        message: `Access denied: ${operation} on ${collectionName} requires an authenticated user`,
        data: null as unknown as T,
      };
    }

    // RBAC coarse gate: super-admin bypass → code-defined access → DB
    // permissions. Skipped when routeAuthorized, because the route middleware
    // (requireCollectionAccess) already performed this exact check.
    //
    // For a scoped API key the gate judges the key's OWN stamped grants, not the
    // owner's DB permissions: the route only authorized the write as `update`,
    // so this publish/unpublish re-check must consult the key's scope or an
    // update-only key owned by a publisher could publish. `apiKeyWriteAllowed`
    // evaluates both the key's permission grant AND the code-defined access rule
    // against that scope, and returns null for a non-API-key caller, which falls
    // through to RBAC.
    const scopeDecision =
      !routeAuthorized && user
        ? await apiKeyWriteAllowed(
            scope,
            operation,
            collectionName,
            user,
            this.rbacAccessControlService
          )
        : null;
    if (!routeAuthorized && user && scopeDecision !== null) {
      if (!scopeDecision) {
        return {
          success: false,
          statusCode: 403,
          message: `Access denied: insufficient permissions for ${operation} on ${collectionName}`,
          data: null as unknown as T,
        };
      }
    } else if (!routeAuthorized && this.rbacAccessControlService && user) {
      try {
        const allowed = await this.rbacAccessControlService.checkAccess({
          userId: user.id,
          operation,
          resource: collectionName,
          executor,
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
    } else if (!routeAuthorized && this.rbacAccessControlService && !user) {
      // A caller with NO session, judged against the collection's own
      // code-defined rule.
      //
      // Both branches above require a user, because everything they do resolves
      // roles and permissions from a user id. That left `access: { create:
      // false }` and `read: ({ user }) => !!user` accepted at boot, recorded in
      // the registry, and never consulted for the one caller they most clearly
      // describe — and with no other layer to ask, the declaration would be
      // silently inert.
      //
      // `undefined` means no code-defined rule governs this operation, and an
      // anonymous caller then falls through to the public default below. A
      // boolean is the rule's own verdict.
      const allowed =
        await this.rbacAccessControlService.checkAnonymousCodeAccess({
          operation,
          resource: collectionName,
        });
      if (allowed === false) {
        return {
          success: false,
          statusCode: 403,
          message: `Access denied: insufficient permissions for ${operation} on ${collectionName}`,
          data: null as unknown as T,
        };
      }
    }

    // Publishing is never anonymous: it moves a document into a privileged
    // published state. Even a code-defined rule that admits an anonymous
    // caller above does not lift this — the operation has no identity to stamp
    // — so an unauthenticated caller is refused outright rather than falling
    // through to the permission-less default below.
    if (!user && (operation === "publish" || operation === "unpublish")) {
      return {
        success: false,
        statusCode: 403,
        message: `Access denied: ${operation} on ${collectionName} requires an authenticated user`,
        data: null as unknown as T,
      };
    }

    // The RBAC/permission gate above is the whole decision. Code-defined
    // `access` from `defineCollection` is evaluated by that gate (see
    // `apiKeyWriteAllowed` / `rbacAccessControlService.checkAccess`, both of
    // which consult the registered access functions), so there is nothing
    // further to ask here.
    return null;
  }
}
