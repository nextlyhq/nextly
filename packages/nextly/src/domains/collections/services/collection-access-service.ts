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
  answerForRefusal,
  collectionGateVerdict,
  type GateVerdict,
} from "../../../auth/access/gate-adapters";
import { refusalMessageFor } from "../../../auth/access/refusal-message";
import { actorForVisitor } from "../../../auth/access/resolve-actor";
import type { RuleFilter } from "../../../auth/access/rule-answer";
import type { AuthenticatedScope } from "../../../auth/authenticated-scope";
import { effectiveCallerScope } from "../../../auth/caller-scope";
import { currentPrincipal } from "../../../auth/principal-scope";
import type { RBACAccessControlService } from "../../../domains/auth/services/rbac-access-control-service";
import {
  genericPublicMessage,
  NEXTLY_ERROR_STATUS,
} from "../../../errors/error-codes";
import { errorEnvelopeFields } from "../../../errors/from-service-envelope";
import type { AccessOperation } from "../../../services/access";
import { hasPermission } from "../../../services/lib/permissions";
import type { Logger } from "../../../services/shared";
import { BaseService } from "../../../shared/base-service";
import type { VisitorGrantsLoader } from "../../../shared/lib/field-level-registry";
import { MetaService } from "../../meta/services/meta-service";

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
   * The visitor as this service's own database records it: the Public role
   * read there, its `nextly_meta` through a reader on this service's adapter,
   * on `executor` when the caller's work holds a transaction. The one loader
   * this gate, the relationship reads over the same database and the field
   * rules judged on it share, so none of them reads Public elsewhere.
   */
  readonly ownDatabaseVisitor: VisitorGrantsLoader = executor =>
    actorForVisitor({
      executor: executor ?? this.db,
      own: {
        meta: new MetaService(this.adapter, this.logger),
        dialect: this.dialect,
      },
    });

  /**
   * Where the field rules of a read or write through this service read a
   * visitor's Public grants, as this gate reads them (`visitorOf`): this
   * database without an access-control service, and with one undefined, so
   * they read the process's cached copy as the gate then does.
   */
  get fieldRuleVisitor(): VisitorGrantsLoader | undefined {
    return this.rbacAccessControlService ? undefined : this.ownDatabaseVisitor;
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
    const ask = this.gateFor(params, false);
    const verdict = await ask(params.operation);
    return verdict.allowed ? null : this.refusalOf<T>(verdict, params, ask);
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
    const ask = this.gateFor(asked, true);
    const verdict = await ask("read");
    if (verdict.allowed) return { denied: null };
    if (verdict.refusal === "only-matching-entries") {
      return { denied: null, filter: verdict.filter };
    }
    return { denied: await this.refusalOf<T>(verdict, asked, ask) };
  }

  /**
   * How the gate is asked about the caller, for any action: of the one access
   * decision, through the adapter that keeps this gate's answers as they were
   * (`auth/access/gate-adapters`). `appliesFilter` says whether the asker
   * limits what it reads to the entries a read rule's filter matches.
   *
   * The key scope is the caller's own, or the request's when this caller did
   * not name one. Two of this service's callers cannot name one: the
   * transaction entry points (`createEntryInTransaction` and its siblings)
   * take write params that declare no `authenticatedScope`, and the plugin
   * service facade exposes them, so an API-key request reaching a write
   * through a transaction would otherwise be judged on the key OWNER's roles
   * while the identical write through `createEntry` was held to the key's own
   * grants. An explicit argument still wins, so a caller may narrow.
   */
  private gateFor(
    params: CollectionAccessParams,
    appliesFilter: boolean
  ): (action: AccessOperation) => Promise<GateVerdict> {
    const { collectionName, user, routeAuthorized, authenticatedScope } =
      params;
    const { executor } = params;
    return action =>
      collectionGateVerdict({
        slug: collectionName,
        action,
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
            action,
            collectionName,
            executor ?? this.db,
            this.dialect
          ),
        // A visitor likewise: the Public role as this database records it.
        visitorWithoutService: () => this.ownDatabaseVisitor(executor),
      });
  }

  /** The envelope a refused verdict is handed back as. */
  private async refusalOf<T>(
    verdict: Exclude<GateVerdict, { allowed: true }>,
    params: CollectionAccessParams,
    ask: (action: AccessOperation) => Promise<GateVerdict>
  ): Promise<CollectionServiceResult<T>> {
    const { collectionName, operation, user, executor } = params;
    // A caller naming one entry it may not read is answered as if the entry
    // were missing. A caller with no identity, neither a user nor a plugin's
    // own principal, is left to the sign-in answer, which comes before this.
    const answer = await answerForRefusal(
      verdict,
      operation,
      params.entryId !== undefined &&
        (user !== undefined || currentPrincipal() !== null),
      ask
    );

    if (answer.answer === "failed") {
      return this.accessUnreadable<T>(answer.error, {
        collectionName,
        operation,
        userId: user?.id,
      });
    }
    if (answer.answer === "missing") {
      return answeredAsMissing<T>(collectionName, operation);
    }
    return refusedInWords<T>({
      collectionName,
      operation,
      unauthenticated: verdict.refusal === "unauthenticated",
      namesOne: params.entryId !== undefined,
      executor,
    });
  }

  /**
   * The answer when the caller's access could not be read. Fail-secure: the
   * request is refused, and a typed failure keeps its own code and status (a
   * busy database is DATABASE_BUSY, 503).
   */
  private accessUnreadable<T>(
    error: unknown,
    context: { collectionName: string; operation: string; userId?: string }
  ): CollectionServiceResult<T> {
    this.logger.error("RBAC access check failed", {
      ...context,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      statusCode: 500,
      message: "Failed to verify RBAC permissions",
      data: null,
      ...errorEnvelopeFields(error),
    };
  }
}

/**
 * The answer to a caller naming one entry it may not read: exactly what a
 * missing entry gets, NOT_FOUND in the generic words. Which check refused
 * rides along for the server's log.
 */
function answeredAsMissing<T>(
  collectionName: string,
  operation: string
): CollectionServiceResult<T> {
  return {
    success: false,
    statusCode: NEXTLY_ERROR_STATUS.NOT_FOUND,
    code: "NOT_FOUND",
    message: genericPublicMessage("NOT_FOUND"),
    refusalReason: `the caller may not read ${collectionName}, so the entry its ${operation} names is answered as missing`,
    data: null,
  };
}

/**
 * The refusal of a caller who may not do what it asked, told in the site's
 * words. Which check refused rides along for the server's log, written where
 * the refusal reaches its caller: a caller asking only whether it may is not
 * refused. Named by the service's caller, so its slug is the site's own, and
 * read on the gate's own transaction where it runs in one.
 */
async function refusedInWords<T>(refusal: {
  collectionName: string;
  operation: string;
  unauthenticated: boolean;
  namesOne: boolean;
  executor: unknown;
}): Promise<CollectionServiceResult<T>> {
  const { collectionName, operation } = refusal;
  return {
    success: false,
    statusCode: NEXTLY_ERROR_STATUS.FORBIDDEN,
    code: "FORBIDDEN",
    refusalReason: refusal.unauthenticated
      ? `${operation} on ${collectionName} requires an authenticated user`
      : `the caller may not ${operation} ${collectionName}`,
    message: await refusalMessageFor(
      operation,
      collectionName,
      refusal.namesOne ? "one" : "all",
      { named: true, executor: refusal.executor }
    ),
    data: null as unknown as T,
  };
}
