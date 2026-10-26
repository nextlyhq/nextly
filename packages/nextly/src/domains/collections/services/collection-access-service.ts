/**
 * CollectionAccessService — Collection-level access control for entry operations.
 *
 * Extracted from CollectionEntryService (6,490-line god file) as a leaf dependency
 * with no deps on other new split services.
 *
 * Responsibilities:
 * - The collection-level access decision, asked of the one access decision
 *   (`auth/access`) through the adapter that keeps this gate's answers
 * - Wording each refusal as this gate always has
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import {
  collectionGateVerdict,
  type GateVerdict,
} from "../../../auth/access/gate-adapters";
import { refusalMessageFor } from "../../../auth/access/refusal-message";
import type { RuleFilter } from "../../../auth/access/rule-answer";
import type { AuthenticatedScope } from "../../../auth/authenticated-scope";
import { effectiveCallerScope } from "../../../auth/caller-scope";
import { currentPrincipal } from "../../../auth/principal-scope";
import type { RBACAccessControlService } from "../../../domains/auth/services/rbac-access-control-service";
import { NEXTLY_ERROR_STATUS } from "../../../errors/error-codes";
import { errorEnvelopeFields } from "../../../errors/from-service-envelope";
import type { AccessOperation } from "../../../services/access";
import { isSuperAdminContext } from "../../../services/access";
import { hasPermission } from "../../../services/lib/permissions";
import type { Logger } from "../../../services/shared";
import { BaseService } from "../../../shared/base-service";

import type { CollectionServiceResult, UserContext } from "./collection-types";

/** What the collection gate is asked about a caller and an operation. */
interface CollectionAccessParams {
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
  /**
   * The one entry the operation acts on, where it acts on one, so a
   * refusal names "this post" rather than the collection. It decides
   * nothing.
   */
  entryId?: string;
}

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
  async checkCollectionAccess<T>(
    params: CollectionAccessParams
  ): Promise<CollectionServiceResult<T> | null> {
    // Trusted-server / system write: bypass all access control checks.
    if (params.overrideAccess) {
      return null;
    }
    const verdict = await this.gateVerdict(params, false);
    return verdict.allowed ? null : this.refusalOf<T>(verdict, params);
  }

  /**
   * Check collection-level read access for a read that applies a read rule's
   * filter to the entries it reads: a list, a count and the aggregates built
   * on them. Allowed with no filter, allowed only for the entries `filter`
   * matches, or refused with the envelope to hand back.
   *
   * A read that cannot limit what it reads to the matching entries, such as a
   * read by id, asks {@link checkCollectionAccess}, which refuses a filter.
   */
  async checkCollectionRead<T>(
    params: Omit<CollectionAccessParams, "operation">
  ): Promise<
    | { readonly denied: CollectionServiceResult<T> }
    | { readonly denied: null; readonly filter?: RuleFilter }
  > {
    if (params.overrideAccess) return { denied: null };
    const asked = { ...params, operation: "read" as const };
    const verdict = await this.gateVerdict(asked, true);
    if (verdict.allowed) return { denied: null };
    if (verdict.refusal === "only-matching-entries") {
      return { denied: null, filter: verdict.filter };
    }
    return { denied: await this.refusalOf<T>(verdict, asked) };
  }

  /**
   * The gate's verdict for the caller, asked of the one access decision
   * through the adapter that keeps this gate's answers as they were
   * (`auth/access/gate-adapters`). `appliesFilter` says whether the asker
   * limits what it reads to the entries a read rule's filter matches.
   */
  private gateVerdict(
    params: CollectionAccessParams,
    appliesFilter: boolean
  ): Promise<GateVerdict> {
    const {
      collectionName,
      operation,
      user,
      routeAuthorized,
      authenticatedScope,
      executor,
    } = params;
    // The key scope is the caller's own, or the request's when this caller did
    // not name one. Two of this method's callers cannot name one: the
    // transaction entry points (`createEntryInTransaction` and its siblings)
    // take write params that declare no `authenticatedScope`, and the plugin
    // service facade exposes them, so an API-key request reaching a write
    // through a transaction would otherwise be judged on the key OWNER's roles
    // while the identical write through `createEntry` was held to the key's own
    // grants. An explicit argument still wins, so a caller may narrow.
    return collectionGateVerdict({
      slug: collectionName,
      action: operation,
      user,
      routeAuthorized,
      scope: effectiveCallerScope(authenticatedScope),
      principal: currentPrincipal(),
      executor,
      appliesFilter,
      rules: this.rbacAccessControlService,
      // On this service's own database, with its dialect's tables. Without
      // them the check reads through the global container and the process's
      // configured dialect, which a setup with no access-control service may
      // not have set, or may have set for another instance.
      permissionWithoutService: () =>
        hasPermission(
          user?.id ?? "",
          operation,
          collectionName,
          executor ?? this.db,
          this.dialect
        ),
    });
  }

  /** The envelope a refused verdict is handed back as, worded as always. */
  private async refusalOf<T>(
    verdict: Exclude<GateVerdict, { allowed: true }>,
    params: CollectionAccessParams
  ): Promise<CollectionServiceResult<T>> {
    const { collectionName, operation, user, executor } = params;
    if (verdict.refusal === "failed") {
      const error = verdict.error;
      this.logger.error("RBAC access check failed", {
        collectionName,
        operation,
        userId: user?.id,
        error: error instanceof Error ? error.message : String(error),
      });
      // Fail-secure: deny on unexpected RBAC errors. A typed refusal keeps
      // its own code and status (a busy database is DATABASE_BUSY, 503).
      return {
        success: false,
        statusCode: 500,
        message: "Failed to verify RBAC permissions",
        data: null as unknown as T,
        ...errorEnvelopeFields(error),
      };
    }
    // The caller is told what was refused in the site's words. Which check
    // refused rides along for the server's log, written where the refusal
    // reaches its caller: a caller asking only whether it may is not refused.
    return {
      success: false,
      statusCode: NEXTLY_ERROR_STATUS.FORBIDDEN,
      code: "FORBIDDEN",
      refusalReason:
        verdict.refusal === "unauthenticated"
          ? `${operation} on ${collectionName} requires an authenticated user`
          : `the caller may not ${operation} ${collectionName}`,
      // Named by the service's caller, so its slug is the site's own. Read
      // on the gate's own transaction, where it runs in one.
      message: await refusalMessageFor(
        operation,
        collectionName,
        params.entryId === undefined ? "all" : "one",
        { named: true, executor }
      ),
      data: null as unknown as T,
    };
  }
}
