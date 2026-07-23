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

import {
  apiKeyWriteAllowed,
  type AuthenticatedScope,
} from "../../../auth/authenticated-scope";
import type { RBACAccessControlService } from "../../../domains/auth/services/rbac-access-control-service";
import type {
  AccessControlService,
  CollectionAccessRules,
  AccessOperation,
} from "../../../services/access";
import {
  DEFAULT_OWNER_FIELD,
  isSuperAdminContext,
} from "../../../services/access";
import type { Logger } from "../../../services/shared";
import { BaseService } from "../../../shared/base-service";
import type { DynamicCollectionService } from "../../dynamic-collections";

import type { CollectionServiceResult, UserContext } from "./collection-types";

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

    // Direct property first (new format), then schemaDefinition (legacy format).
    const raw = (collectionRecord.accessRules ??
      (collectionRecord.schemaDefinition as Record<string, unknown> | undefined)
        ?.accessRules) as CollectionAccessRules | undefined;

    // No access rules defined - will default to public access.
    return this.normalizeCollectionOwnerFields(raw);
  }

  /**
   * Point owner-only rules at the collection system owner column.
   *
   * A collection stores the owner in the auto-stamped `created_by` column, and
   * both `created_by` and its camelCase alias `createdBy` are reserved as field
   * names — so a rule naming `createdBy` (the old documented default) can only
   * mean that column. Rewrite either spelling to DEFAULT_OWNER_FIELD so every
   * downstream owner check (read query filter, document compare, tx safety net)
   * targets the column the create path actually stamps; any other `ownerField`
   * is a genuine custom field and is left untouched. Returns a shallow clone
   * only when a rewrite is needed, so the stored collection is never mutated.
   */
  private normalizeCollectionOwnerFields(
    rules: CollectionAccessRules | undefined
  ): CollectionAccessRules | undefined {
    if (!rules) return rules;
    // Keyed off the interface so a new rule kind (publish, unpublish) cannot be
    // added there and silently skipped here — leaving an owner-only rule of that
    // kind with an unnormalized owner field, which then checks the wrong column.
    const opFlags: Record<keyof CollectionAccessRules, true> = {
      create: true,
      read: true,
      update: true,
      delete: true,
      publish: true,
      unpublish: true,
    };
    const ops = Object.keys(opFlags) as (keyof CollectionAccessRules)[];
    let cloned: CollectionAccessRules | undefined;
    for (const op of ops) {
      const rule = rules[op];
      if (
        rule?.type === "owner-only" &&
        (rule.ownerField === "createdBy" || rule.ownerField === "created_by")
      ) {
        cloned ??= { ...rules };
        cloned[op] = { ...rule, ownerField: DEFAULT_OWNER_FIELD };
      }
    }
    return cloned ?? rules;
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
    routeAuthorized?: boolean,
    // The caller's authenticated scope. For a scoped API key the RBAC gate
    // judges the key's OWN stamped grants rather than the owner's permissions
    // (see auth/authenticated-scope). Undefined for session/system callers.
    authenticatedScope?: AuthenticatedScope,
    // Skip the stored-rule evaluation (owner-only/custom/role-based/...) and
    // return after only the RBAC/permission gate. The transition pre-resolve uses
    // this so a document-dependent stored rule (owner-only or custom) is NOT
    // judged against an absent document here — a custom rule that denies on
    // missing data would otherwise cache a denial that pre-empts the under-lock
    // recheck. The rule is instead evaluated against the row-locked document via
    // {@link evaluateTransitionDocumentRule}.
    deferStoredRuleEval?: boolean,
    // Optional transaction-bound Drizzle executor. Supplied when the caller is
    // already inside a write transaction (the caller-owned-tx bulk paths) so the
    // RBAC role/permission reads and the collection-metadata read run on that
    // transaction's own connection instead of taking a second pooled one, which
    // can stall against a small pool. Defaults to the pooled connection.
    executor?: unknown
  ): Promise<CollectionServiceResult<T> | null> {
    // Trusted-server / system write: bypass all access control checks.
    if (overrideAccess) {
      return null;
    }

    // Super-admin bypasses BOTH the RBAC gate and the stored rules (including
    // owner-only) so an admin can act on any record on every transport — EXCEPT
    // via a scoped API key. The bypass belongs to the session path: a key is
    // authoritative on its OWN stamped scope, never on the owner's roles, so a
    // read/update-only key issued by an administrator is not equivalent to their
    // full account (mirrors canReadEntity). Applying the bypass here would let a
    // super-admin-owned, update-only key publish, recreating the very hole this
    // scope check closes.
    const isScopedApiKey = authenticatedScope?.actorType === "apiKey";
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
    // (requireCollectionAccess) already performed this exact check; the stored
    // rules below still run.
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
            authenticatedScope,
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
    }

    // The caller (transition pre-resolve) will evaluate the document-dependent
    // stored rule against the row-locked document itself, so the docless
    // evaluation here is skipped: the RBAC/permission gate above stands, but a
    // custom rule is not run with an absent document.
    if (deferStoredRuleEval) {
      return null;
    }

    try {
      // Get collection metadata to retrieve access rules. Runs on the caller's
      // transaction executor when supplied so this read does not re-enter the pool.
      const collection = await this.collectionService.getCollection(
        collectionName,
        executor
      );
      const accessRules = this.getAccessRules(
        collection as Record<string, unknown>
      );

      // Secure-by-default publish gate (Option A): an unauthenticated caller may
      // publish/unpublish ONLY when an explicit rule grants it. With no explicit
      // publish/unpublish rule the operation would otherwise fall through to the
      // rule-less public default below (evaluateAccess allows), letting an
      // anonymous caller publish a publicly-writable collection. An explicit rule
      // (public/authenticated/role-based/owner-only/custom) is still evaluated
      // below and decides on its own — only the implicit default denies here.
      if (
        !user &&
        (operation === "publish" || operation === "unpublish") &&
        !accessRules?.[operation]
      ) {
        return {
          success: false,
          statusCode: 403,
          message: `Access denied: ${operation} on ${collectionName} requires an authenticated user`,
          data: null as unknown as T,
        };
      }

      // Build request context from user
      const requestContext = this.buildRequestContext(user);

      // Evaluate access. Collections carry the auto-stamped `created_by` system
      // column, so pass it as the owner-only default (the shared service
      // otherwise falls back to the generic `createdBy` used by singles).
      const result = await this.accessControlService.evaluateAccess(
        accessRules,
        operation,
        requestContext,
        documentId,
        document,
        DEFAULT_OWNER_FIELD
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
   * Whether a stored access rule's decision depends on the specific document —
   * `owner-only` (compares the owner column) or `custom` (a function that may
   * inspect `id`/`data`). These must be re-judged against the row-locked row, not
   * the docless pre-resolve. `public`/`authenticated`/`role-based` are fully
   * decided without a document, so they are excluded.
   */
  isDocumentDependentRule(rule: { type?: string } | undefined): boolean {
    return rule?.type === "owner-only" || rule?.type === "custom";
  }

  /**
   * Pre-resolve whether a collection has a document-dependent (owner-only or
   * custom) publish/unpublish rule that must be judged against the specific row
   * being transitioned. Runs on the pooled connection BEFORE a write transaction,
   * so the in-transaction check needs no metadata read (mirrors the permission
   * pre-resolve used by the transaction/batch paths).
   *
   * Returns the already-fetched rules + user when such a rule applies, or null
   * when it does not: a super-admin SESSION bypasses stored rules — but NOT a
   * scoped API key it owns (matching {@link checkCollectionAccess}) — and a
   * collection with no document-dependent publish/unpublish rule has nothing to
   * re-enforce. role-based/authenticated/public rules are fully decided by the
   * docless permission pre-resolve, so they are intentionally excluded here. The
   * caller is responsible for skipping this on an `overrideAccess` write.
   */
  resolveTransitionDocumentRule(
    collection: Record<string, unknown>,
    user: UserContext | undefined,
    authenticatedScope?: AuthenticatedScope
  ): {
    accessRules: CollectionAccessRules;
    user: UserContext | undefined;
  } | null {
    const isScopedApiKey = authenticatedScope?.actorType === "apiKey";
    if (!isScopedApiKey && isSuperAdminContext(user)) {
      return null;
    }
    const accessRules = this.getAccessRules(collection);
    if (!accessRules) return null;
    const documentDependent =
      this.isDocumentDependentRule(accessRules.publish) ||
      this.isDocumentDependentRule(accessRules.unpublish);
    return documentDependent ? { accessRules, user } : null;
  }

  /**
   * Evaluate the stored document-dependent (owner-only or custom) publish/
   * unpublish rule for a transition against an ALREADY-FETCHED (row-locked)
   * document, with no metadata or permission read — safe to call inside a
   * transaction. Returns a 403 result when the rule denies, or null when it
   * allows or no document-dependent rule governs the operation.
   *
   * This closes the gap where the docless permission pre-resolve lets a
   * document-dependent publish/unpublish through: owner checks defer without a
   * document, and a custom rule is judged on empty `id`/`data`. So a caller who
   * may update another user's row could otherwise batch-publish or unpublish it
   * under the transaction. The row's own `id` is passed so a custom rule that
   * keys off the document id sees the real value.
   */
  async evaluateTransitionDocumentRule<T = unknown>(
    accessRules: CollectionAccessRules,
    operation: "publish" | "unpublish",
    user: UserContext | undefined,
    document: Record<string, unknown>
  ): Promise<CollectionServiceResult<T> | null> {
    if (!this.isDocumentDependentRule(accessRules[operation])) {
      return null;
    }
    const documentId =
      typeof document.id === "string" ? document.id : undefined;
    const result = await this.accessControlService.evaluateAccess(
      accessRules,
      operation,
      this.buildRequestContext(user),
      documentId,
      document,
      DEFAULT_OWNER_FIELD
    );
    if (result.allowed) return null;
    return {
      success: false,
      statusCode: 403,
      message: result.reason || "Access denied",
      data: null as unknown as T,
    };
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
        requestContext,
        undefined,
        undefined,
        // Collection owner-only reads filter on the `created_by` system column.
        DEFAULT_OWNER_FIELD
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
    overrideAccess?: boolean,
    // The caller's authenticated scope. A scoped API key is judged on its OWN
    // grant, so the session super-admin bypass does not lift the owner predicate
    // for a super-admin-owned key — mirrors checkCollectionAccess.
    authenticatedScope?: AuthenticatedScope
  ): Promise<{ field: string; value: string } | null> {
    // Super-admin bypasses the owner predicate on the transactional paths too —
    // EXCEPT via a scoped API key, which must still obey stored owner rules.
    const isScopedApiKey = authenticatedScope?.actorType === "apiKey";
    if (
      overrideAccess ||
      !user ||
      (!isScopedApiKey && isSuperAdminContext(user))
    ) {
      return null;
    }

    try {
      const collection =
        await this.collectionService.getCollection(collectionName);
      const accessRules = this.getAccessRules(
        collection as Record<string, unknown>
      );
      const rule = accessRules?.[operation];
      if (!rule || rule.type !== "owner-only") return null;

      const field = rule.ownerField ?? DEFAULT_OWNER_FIELD;
      return { field, value: user.id };
    } catch {
      return null;
    }
  }
}
