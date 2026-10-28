import { container } from "@nextly/di/container";
import type {
  ApiKeyRefusalCause,
  ApiKeyService,
} from "@nextly/domains/auth/services/api-key-service";
import type { RBACAccessControlService } from "@nextly/domains/auth/services/rbac-access-control-service";
import { env } from "@nextly/lib/env";

import { readOrGenerateRequestId } from "../../api/request-id";
import {
  isTruthyParam,
  parseWhereParam,
} from "../../dispatcher/helpers/validation";
import { EVERY_LOCALE } from "../../domains/i18n/locale-selector";
import {
  genericPublicMessage,
  NEXTLY_ERROR_STATUS,
} from "../../errors/error-codes";
import { NextlyError } from "../../errors/nextly-error";
import { presentedApiKey } from "../../middleware/rest-callers";
import { currentRestLimitGate } from "../../middleware/rest-limit-gate";
import { getNextlyLogger } from "../../observability/logger";
// getSession from ../session is a backward-compat wrapper that delegates
// to the new jose-based session/get-session.ts module internally.
import { answerForRefusal, type GateVerdict } from "../access/gate-adapters";
import {
  refusalMessageFor,
  type RefusalScope,
} from "../access/refusal-message";
import { rememberRouteVerdict } from "../access/request-memo";
import {
  anyPermissionVerdict,
  routeGateVerdict,
  routeGrantVerdict,
  type RouteRules,
} from "../access/route-gate-adapters";
import {
  everyLanguage,
  registeredReadLanguagesFor,
  registeredWriteAsNamedLanguagesFor,
  registeredWriteLanguagesFor,
  currentRuleLanguage,
  type RuleLanguage,
  withRuleLanguage,
} from "../access/rule-language";
import {
  apiKeyScopeFrom,
  type GrantedPermission,
} from "../authenticated-scope";
import { getSession } from "../session";
import { startServicesForAuthentication } from "../session/session-standing";

import { apiKeyRateLimitRefusal } from "./api-key-budget";
import { createErrorResponse, type ErrorResponse } from "./error-response";

export { apiKeyRateLimitRefusal } from "./api-key-budget";
export {
  createErrorResponse,
  createJsonErrorResponse,
  type ErrorResponse,
} from "./error-response";

/**
 * Safely get the RBACAccessControlService from the DI container.
 *
 * Returns `undefined` if the container is not yet initialized or the
 * service is not registered (e.g., during early bootstrap before
 * `registerServices()` completes). Callers must fall back to direct
 * `hasPermission()` checks when `undefined` is returned.
 */
function getRBACService(): RBACAccessControlService | undefined {
  try {
    if (container.has("rbacAccessControlService")) {
      return container.get<RBACAccessControlService>(
        "rbacAccessControlService"
      );
    }
  } catch {
    // DI container not initialized yet — safe to ignore
  }
  return undefined;
}

/**
 * Safely get the ApiKeyService from the DI container.
 *
 * Returns `undefined` if the container is not yet initialized or the
 * service is not registered (e.g., during early bootstrap before
 * `registerServices()` completes).
 */
function getApiKeyService(): ApiKeyService | undefined {
  try {
    if (container.has("apiKeyService")) {
      return container.get<ApiKeyService>("apiKeyService");
    }
  } catch {
    // DI container not initialized yet — safe to ignore
  }
  return undefined;
}

/**
 * The key service, with the services started first when this process has not
 * started them, through the same start the session check uses
 * (`startServicesForAuthentication`).
 *
 * A key was presented, so a service that cannot be had is answered as a
 * refusal rather than as "no key": falling through would treat a bearer token
 * as unauthenticated. The refusal is the typed error's own status and generic
 * message; why it happened goes to the log only, as a failed start can carry a
 * driver's message naming hosts and credentials.
 */
async function startedApiKeyService(
  req: Request
): Promise<ApiKeyService | ErrorResponse> {
  // A process whose key service is registered looks the key up with it, as
  // the REST limit's own lookup does: the start is for a process that has
  // none, and asking it of one already up only adds a wait to every request.
  const registered = getApiKeyService();
  if (registered) return registered;
  let failure: NextlyError;
  try {
    await startServicesForAuthentication();
    const service = getApiKeyService();
    if (service) return service;
    failure = NextlyError.serviceUnavailable({
      logContext: {
        reason: "api-key-read-before-nextly-initialised",
        remedy:
          "An API key was presented before Nextly was initialised in this " +
          "process, and nothing loaded here can start it, so the key cannot " +
          "be looked up. Call `await getNextly({ config })` before " +
          "authenticating, or initialise Nextly in `instrumentation.ts` " +
          "with `createRegister(config)`.",
      },
    });
  } catch (error) {
    // A typed error from the boot or its migrations gate already says what
    // went wrong; anything else is a start that failed for a reason only the
    // log may carry.
    failure = NextlyError.is(error)
      ? error
      : NextlyError.serviceUnavailable({
          cause: error instanceof Error ? error : undefined,
          logContext: { reason: "api-key-services-failed-to-start" },
        });
  }
  getNextlyLogger().error({
    kind: "api-key-auth-unavailable",
    ...failure.toLogJSON(readOrGenerateRequestId(req)),
  });
  return createErrorResponse(
    failure.statusCode,
    failure.publicMessage,
    failure.publicMessage,
    undefined,
    failure.code
  );
}

/**
 * Unified authentication context.
 *
 * Returned by `requireAuthentication()` for both session-based and
 * API key-based requests. Downstream middleware and handlers receive
 * an identical shape regardless of auth method.
 *
 * - `authMethod: "session"` — authenticated via cookie/JWT session.
 *   `permissions` is `[]`; permission checks use the RBAC service with `userId`.
 *   `roles` is populated from the JWT.
 *
 * - `authMethod: "api-key"` — authenticated via `Authorization: Bearer` header.
 *   `permissions` is pre-resolved by `ApiKeyService.resolveApiKeyPermissions()`.
 *   `roles` is pre-resolved by `ApiKeyService.resolveApiKeyRoles()`.
 *
 * Handlers that are session-only (e.g. create/revoke API keys) should check:
 * ```typescript
 * if (ctx.authMethod !== "session") return 403;
 * ```
 */
export interface AuthContext {
  userId: string;
  userName?: string;
  userEmail?: string;
  permissions: string[];
  /**
   * The permission ROWS behind `permissions`, present only for `api-key`.
   *
   * Both spellings a rule or a check may ask for are derived from these, so
   * they cannot disagree. See {@link GrantedPermission}.
   */
  grants?: readonly GrantedPermission[];
  roles: string[];
  authMethod: "session" | "api-key";
  /**
   * The authenticating API key's own id, present only for `api-key` requests.
   * Carried so a write can be attributed to the specific key rather than only
   * to the user that owns it.
   */
  apiKeyId?: string;
  /**
   * Verified non-canonical claims from the caller's token.
   *
   * A stored `custom` access rule may decide on a claim this framework knows
   * nothing about — a tenant, a plan, an entitlement. They are carried here so
   * the rule sees over HTTP what it sees through the Direct API; without them
   * an absence-tolerant rule admits the caller it was written to refuse.
   */
  claims?: Record<string, unknown>;
}

/** Why a presented key was refused, as the server's log says it. */
const KEY_REFUSED_BECAUSE: Readonly<Record<ApiKeyRefusalCause, string>> = {
  unknown: "the API key is not one this site issued",
  revoked: "the API key is revoked",
  expired: "the API key has expired",
  "creator-inactive": "the API key's creator is not active",
};

/**
 * API key authentication middleware.
 *
 * Validates an `Authorization: Bearer nx_live_...` header and resolves the
 * effective permission set for the authenticated key. Returns a three-state result:
 *
 * - `null` — no `Authorization: Bearer` header present (or header is malformed).
 *   The caller should treat this as "API key not attempted" and fall through to
 *   other auth checks or return a generic 401.
 *
 * - `ErrorResponse { statusCode: 401 }` — a Bearer header was present but the key
 *   is invalid, expired, or revoked. The caller MUST propagate this response
 *   immediately — do NOT fall through silently.
 *
 * - `ErrorResponse { statusCode: 429 }` — the key is valid but the per-key rate limit
 *   has been exceeded. Includes `Retry-After` (seconds), `X-RateLimit-Limit`, and
 *   `X-RateLimit-Remaining` headers. Callers MUST propagate this via
 *   `createJsonErrorResponse()` so headers are forwarded to the client.
 *
 * - `ErrorResponse { statusCode: 503 }` — the services a key is looked up
 *   through could not be started in this process. A cold process starts them
 *   first, as a session check does, so this answers only a start that failed
 *   or a process where nothing can start them.
 *
 * - `{ userId, permissions, roles }` — the key is valid and within rate limit.
 *   `permissions` is the resolved array of permission slugs for this key's token type.
 *   `roles` is the resolved array of role slugs (single role for role-based keys;
 *   creator's roles otherwise).
 *
 * @example
 * ```typescript
 * const apiKeyResult = await requireApiKeyAuth(req);
 * if (apiKeyResult === null)          return // no key attempted
 * if (isErrorResponse(apiKeyResult))  return apiKeyResult; // invalid key — 401
 * // valid key — apiKeyResult.userId, apiKeyResult.permissions, and apiKeyResult.roles are populated
 * ```
 */
export async function requireApiKeyAuth(req: Request): Promise<
  | {
      userId: string;
      permissions: string[];
      grants: readonly GrantedPermission[];
      roles: string[];
      apiKeyId: string;
    }
  | ErrorResponse
  | null
> {
  // No header, or an empty key after "Bearer ": no API key attempted.
  const rawKey = presentedApiKey(req);
  if (rawKey === null) return null;

  // The REST limit already looked this key up for this request, and spent its
  // budget when it resolved: its answer stands, so the key is neither looked
  // up again nor counted twice.
  const known = currentRestLimitGate(req)?.knownKey(rawKey);
  // A key can only be judged from the database, so a process that has not
  // started its services starts them here, as a session check does, rather
  // than refusing the first keyed request a cold instance receives.
  const apiKeyService = await startedApiKeyService(req);
  if ("statusCode" in apiKeyService) return apiKeyService;

  // 3. Hash and look up the key — returns null for not-found, revoked, or expired
  let cause: ApiKeyRefusalCause | undefined = known?.cause;
  const keyAuth = known
    ? known.resolved
    : await apiKeyService.authenticateApiKey(rawKey, refused => {
        cause = refused;
      });
  if (!keyAuth) {
    // Key was present but invalid/expired/revoked — explicit 401, do NOT fall through
    // Which way the key fails is for the server's log, not the caller.
    return {
      ...createErrorResponse(
        401,
        "Invalid API key",
        "Authentication required."
      ),
      reason: cause
        ? KEY_REFUSED_BECAUSE[cause]
        : "the API key did not resolve",
    };
  }

  // 4. Rate limit check — enforced after auth, before permission resolution.
  //    Limits come from defineConfig().apiKeys.rateLimit when available;
  //    module-level constants are the fallback for unconfigured deployments.
  if (!known?.debited) {
    const overLimit = await apiKeyRateLimitRefusal(keyAuth.id);
    if (overLimit) return overLimit;
  }

  // 5. Resolve effective permissions and roles for this token type
  const [grants, roles] = await Promise.all([
    apiKeyService.resolveApiKeyGrants(
      keyAuth.tokenType,
      keyAuth.roleId,
      keyAuth.userId,
      keyAuth.id
    ),
    apiKeyService.resolveApiKeyRoles(
      keyAuth.tokenType,
      keyAuth.roleId,
      keyAuth.userId
    ),
  ]);

  // The key's own id travels with the result so a write can be attributed to
  // the specific key, not just to the user that owns it.
  return {
    userId: keyAuth.userId,
    permissions: grants.map(grant => grant.slug),
    grants,
    roles,
    apiKeyId: keyAuth.id,
  };
}

/**
 * Authentication middleware — verifies the request is authenticated via
 * session or API key and returns a unified `AuthContext`.
 *
 * Flow:
 * 1. Check for a valid session (cookie/JWT). If found → `authMethod: "session"`.
 * 2. If no session, attempt API key auth via `Authorization: Bearer` header:
 *    - No header present → 401 (unauthenticated)
 *    - Header present but key is invalid/expired/revoked → propagate 401
 *    - Valid key → `authMethod: "api-key"` with pre-resolved `permissions`
 *
 * Session auth sets `permissions: []` (RBAC checks via `userId` on demand).
 * API key auth sets `permissions` to the pre-resolved set for the key's token type
 * and `roles` to the resolved role slugs for the key's token type.
 */
/**
 * The claims a token carried beyond the identity fields the framework defines.
 *
 * `getSession` already spreads them onto the session user, so this only has to
 * separate them from the canonical keys, which travel in their own fields and
 * must not be able to be restated (and so overridden) from a claim.
 */
const CANONICAL_SESSION_KEYS = new Set([
  "id",
  "name",
  "email",
  "image",
  "roleIds",
]);

function sessionClaims(
  user: Record<string, unknown>
): Record<string, unknown> | undefined {
  const claims: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(user)) {
    if (!CANONICAL_SESSION_KEYS.has(key)) claims[key] = value;
  }
  return Object.keys(claims).length > 0 ? claims : undefined;
}

export async function requireAuthentication(
  req: Request
): Promise<AuthContext | ErrorResponse> {
  // getSession returns GetSessionResult; extract user or null for backward compat
  const sessionResult = await getSession(req, env.NEXTLY_SECRET || "");
  if (sessionResult.authenticated) {
    const { user } = sessionResult;
    return {
      userId: user.id,
      userName: user.name ?? undefined,
      userEmail: user.email ?? undefined,
      permissions: [],
      roles: user.roleIds,
      authMethod: "session",
      claims: sessionClaims(user),
    };
  }

  const apiKeyResult = await requireApiKeyAuth(req);

  // null → no Authorization header → truly unauthenticated.
  // If the session was expired, emit TOKEN_EXPIRED so the client can refresh
  // silently instead of bouncing the user to login.
  if (apiKeyResult === null) {
    if (sessionResult.reason === "expired") {
      // The code tells the admin to refresh; the message says no more than
      // any other request needing sign-in is told.
      return createErrorResponse(
        401,
        "Session expired",
        "Authentication required.",
        undefined,
        "TOKEN_EXPIRED"
      );
    }
    return createErrorResponse(
      401,
      "Authentication required",
      "Authentication required.",
      undefined,
      "AUTH_REQUIRED"
    );
  }

  // ErrorResponse → Bearer header was present but key is invalid — propagate
  if ("statusCode" in apiKeyResult) {
    return apiKeyResult;
  }

  return {
    userId: apiKeyResult.userId,
    permissions: apiKeyResult.permissions,
    grants: apiKeyResult.grants,
    roles: apiKeyResult.roles,
    authMethod: "api-key",
    apiKeyId: apiKeyResult.apiKeyId,
  };
}

/**
 * Permission-based authorization middleware.
 *
 * Authenticates the request, then asks the one access decision through the
 * route gate's adapter (`auth/access/route-gate-adapters`): a session as the
 * access-control service has always judged it (super-admin, then the entity's
 * code rule where one names the action, then the database permission), an
 * API key on its own grants and the entity's rule. Where today's answer
 * differs from the decision's, it is kept through a named deviation.
 *
 * Without the access-control service (early bootstrap), the permission alone.
 */
export async function requirePermission(
  req: Request,
  action: string,
  resource: string
): Promise<AuthContext | ErrorResponse> {
  const authResult = await requireAuthentication(req);

  if ("statusCode" in authResult) {
    return authResult;
  }

  return authorizeCaller(authResult, action, resource);
}

/**
 * `requirePermission`'s decision, for a caller a gate has already
 * authenticated.
 *
 * Authenticating a request again is not free: each authentication of an API
 * key spends a slot of the key's rate limit. A gate that must authenticate
 * before it can know which permission to ask for judges the caller it already
 * holds here, so the request is counted once.
 */
export function authorizeCaller(
  authResult: AuthContext,
  action: string,
  resource: string,
  // Whether the request names one entry, so the refusal says "this post".
  scope: RefusalScope = "all",
  // Whether the route's handler applies a read rule's filter to what it
  // reads, which lets a caller through whose rule answers one.
  appliesFilter = false
): Promise<AuthContext | ErrorResponse> {
  // The route gate's answer, asked of the one decision: a key on its own
  // grants and the entity's rule, a session through the access-control
  // service's rules and its permissions, as this gate has always judged them.
  // Told whether the route's handler applies a read rule's filter, so a rule
  // answering one is handed back to be kept rather than refused.
  return authorizeBy(
    (auth, asked, slug, rules) =>
      routeGateVerdict(auth, asked, slug, rules, appliesFilter),
    authResult,
    action,
    resource,
    scope,
    appliesFilter
  );
}

/**
 * {@link authorizeCaller} by the grant alone, its rule not read
 * ({@link routeGrantVerdict}): for a publish or an unpublish of every
 * language, whose rule the service asks in each language the change puts
 * live. Refused as `authorizeCaller` refuses, a caller who may not read the
 * entry it names answered as if it were missing.
 */
function authorizeCallerOnGrant(
  authResult: AuthContext,
  action: string,
  resource: string,
  scope: RefusalScope
): Promise<AuthContext | ErrorResponse> {
  return authorizeBy(routeGrantVerdict, authResult, action, resource, scope);
}

async function authorizeBy(
  verdictOf: (
    auth: AuthContext,
    action: string,
    resource: string,
    rules: RouteRules,
    // Whether the route's handler applies a read rule's filter; a verdict on
    // the grant alone reads no rule, and has no filter to hand back.
    appliesFilter?: boolean
  ) => Promise<GateVerdict>,
  authResult: AuthContext,
  action: string,
  resource: string,
  scope: RefusalScope,
  // Whether the route's handler applies a read rule's filter: only such a
  // route keeps its verdict.
  appliesFilter = false
): Promise<AuthContext | ErrorResponse> {
  const answered = await verdictOf(
    authResult,
    action,
    resource,
    getRBACService()
  );
  // A route whose handler applies a read rule's filter keeps its verdict for
  // the request, every entry or the entries the filter matches, so the read
  // it authorizes applies it without asking the rule again. A request that
  // cannot keep a filter refuses the caller, as a route that applies no
  // filter does, rather than let the read run unfiltered. A route that
  // applies no filter keeps nothing: its rule is asked afresh, and an allow
  // kept from it could overwrite a filter another route in the request kept
  // for the same caller; no kept verdict already means every entry.
  const question = {
    userId: authResult.userId,
    // A key is kept apart from its user's other keys and sessions by the
    // scope its rule is told.
    ...(authResult.authMethod === "api-key"
      ? { scope: apiKeyScopeFrom(authResult) }
      : {}),
    slug: resource,
    action,
    language: currentRuleLanguage(),
  };
  if (appliesFilter && answered.allowed) {
    rememberRouteVerdict(question, { all: true });
  }
  if (
    appliesFilter &&
    !answered.allowed &&
    answered.refusal === "only-matching-entries"
  ) {
    const kept = rememberRouteVerdict(question, { filter: answered.filter });
    if (kept) return authResult;
  }
  const verdict: GateVerdict =
    !answered.allowed && answered.refusal === "only-matching-entries"
      ? { allowed: false, refusal: "insufficient" }
      : answered;
  if (!verdict.allowed) {
    // A caller naming one entry it may not read is answered exactly as if the
    // entry did not exist, whatever it asked to do: a 403 would confirm the
    // entry is there. A caller who may read it is told what it may not do.
    const answer = await answerForRefusal(
      verdict,
      action,
      scope === "one",
      asked => routeGateVerdict(authResult, asked, resource, getRBACService())
    );
    // A caller whose access could not be read is not a caller without the
    // permission: the read's error goes to the route's error handling, as it
    // always has, rather than being answered as a refusal.
    if (answer.answer === "failed") throw answer.error;
    if (answer.answer === "missing") {
      return entryAnsweredAsMissing(action, resource);
    }
    return {
      ...createErrorResponse(
        403,
        "Forbidden",
        await refusalMessageFor(action, resource, scope)
      ),
      // The one decision does not say whether the entity's own rule or a
      // missing grant refused, so the reason names both rather than guess.
      reason: `the access decision refused ${action} on ${resource}: its access rule, or no ${action}-${resource} grant`,
    };
  }
  return authResult;
}

/**
 * The answer a request naming one entry gets from a caller who may not read
 * it: what a missing entry gets, `NOT_FOUND` in the generic words, so the two
 * cannot be told apart. Which check refused goes to the log.
 */
function entryAnsweredAsMissing(
  action: string,
  resource: string
): ErrorResponse {
  return {
    ...createErrorResponse(
      NEXTLY_ERROR_STATUS.NOT_FOUND,
      "Not Found",
      genericPublicMessage("NOT_FOUND"),
      undefined,
      "NOT_FOUND"
    ),
    reason: `the caller may not read ${resource}, so the entry its ${action} names is answered as missing`,
  };
}

/**
 * Permission-based authorization middleware (any of multiple permissions).
 * Checks the authenticated caller holds at least one of them, a key by its
 * stored slugs and a session by its permissions. No code rule is read, which
 * is where it still differs from the one decision.
 */
export async function requireAnyPermission(
  req: Request,
  permissions: Array<{ action: string; resource: string }>,
  target?: RefusalTarget
): Promise<AuthContext | ErrorResponse> {
  const authResult = await requireAuthentication(req);

  if ("statusCode" in authResult) {
    return authResult;
  }

  return authorizeCallerForAny(authResult, permissions, target);
}

/**
 * What a refusal names as refused, where it is not what the permissions
 * asked for say: reading a permission may be granted by `read-roles`, and is
 * still the reading of a permission.
 */
export interface RefusalTarget {
  action: string;
  resource: string;
}

/**
 * What an any-of refusal names: the target given, else the one thing every
 * alternative is about. Alternatives about different things name nothing.
 */
function anyOfTarget(
  permissions: ReadonlyArray<{ action: string; resource: string }>,
  target: RefusalTarget | undefined
): RefusalTarget | undefined {
  if (target) return target;
  const [first] = permissions;
  return first && permissions.every(p => p.resource === first.resource)
    ? first
    : undefined;
}

/**
 * `requireAnyPermission`'s decision, for a caller a gate has already
 * authenticated, so the request is counted once (see `authorizeCaller`).
 */
export async function authorizeCallerForAny(
  authResult: AuthContext,
  permissions: Array<{ action: string; resource: string }>,
  target?: RefusalTarget
): Promise<AuthContext | ErrorResponse> {
  // Any one of the permissions will do, judged on the key's own grants or the
  // session's permissions, asked of the one decision.
  const verdict = await anyPermissionVerdict(
    authResult,
    permissions,
    getRBACService()
  );
  if (!verdict.allowed) {
    const named = anyOfTarget(permissions, target);
    return {
      ...createErrorResponse(
        403,
        "Forbidden",
        named
          ? await refusalMessageFor(named.action, named.resource)
          : "You can't do that."
      ),
      reason: `the caller holds none of ${permissions
        .map(p => `${p.action}-${p.resource}`)
        .join(", ")}`,
    };
  }
  return authResult;
}

/** How a REST operation's languages are worked out from its request. */
type OperationLanguage =
  | "read"
  | "write"
  | "as-named"
  | "default-write"
  | "duplicate"
  | "filtered-history";

/**
 * The REST operations whose languages the request names, and how. Every
 * other operation, and a caller that names none, is judged in every language:
 * it acts on the whole entry, or on content the request does not choose.
 *
 * - `read`: a read of one language's content, the language `?locale=` names
 *   (every language for `all`) or the default, with the languages
 *   `?fallback-locale=` and the site's fallbacks add. A schema read is one,
 *   read in the language the admin shows it in. An autosave read is not: it
 *   returns the caller's latest autosave in whatever language it was saved.
 *   A read that also reads translation states, `?translation-status=` or a
 *   `_translated` filter, is told every language; see `readLanguagesFor`.
 * - `write`: a write of one language's content, `?locale=` (every language
 *   for `*`) or the default.
 * - `as-named`: an autosave, discarding a working draft, or sharing a preview
 *   link to one language, which keep the language as the request names it: a
 *   language the site does not configure is told every language, not the
 *   default a write resolves it to. A preview link naming no language is
 *   shared with no operation named, so it is told every language.
 * - `default-write`: a bulk update of named entries, which takes no locale
 *   and writes the default language. A bulk update by query is not one: its
 *   filter, in the request body, may choose its rows by any language's
 *   translation state, so it is told every language.
 * - `duplicate`: writes the default language, copying what a read of the
 *   source shows there, so it is told the default and its fallbacks.
 * - `filtered-history`: a history list, which `?locale=` filters to one
 *   language's versions; unfiltered, it lists every language's.
 */
const OPERATION_LANGUAGES: ReadonlyMap<string, OperationLanguage> = new Map([
  ["listEntries", "read"],
  ["getEntry", "read"],
  ["countEntries", "read"],
  ["getCollection", "read"],
  ["getSingleDocument", "read"],
  ["getSingleSchema", "read"],
  ["createEntry", "write"],
  ["updateEntry", "write"],
  ["discardWorkingDraft", "as-named"],
  ["autosaveEntry", "as-named"],
  ["updateSingleDocument", "write"],
  ["autosaveSingle", "as-named"],
  ["discardSingleWorkingDraft", "as-named"],
  ["sharePreviewLink", "as-named"],
  ["bulkUpdateEntries", "default-write"],
  ["duplicateEntry", "duplicate"],
  ["listEntryVersions", "filtered-history"],
  ["listSingleVersions", "filtered-history"],
]);

/** What a request names about its languages, as it is dispatched. */
interface RequestedLanguage {
  locale: string | undefined;
  fallbackLocale: string | undefined;
  translationStatus: boolean;
  /** Its filter, or `UNREADABLE` where the dispatcher will refuse it. */
  where: unknown;
}

const UNREADABLE = Symbol("unreadable filter");

/** The languages each kind of operation is told, from what its request names. */
const LANGUAGES_OF: Record<
  OperationLanguage,
  (asked: RequestedLanguage) => RuleLanguage
> = {
  // A filter the dispatcher refuses is never run, so it is told every
  // language rather than read a second way here.
  read: asked =>
    asked.where === UNREADABLE
      ? everyLanguage()
      : registeredReadLanguagesFor(asked.locale, asked.fallbackLocale, asked),
  write: asked => registeredWriteLanguagesFor(asked.locale),
  "as-named": asked => registeredWriteAsNamedLanguagesFor(asked.locale),
  "default-write": () => registeredWriteLanguagesFor(undefined),
  duplicate: () => registeredReadLanguagesFor(undefined),
  // A history list filters by language and falls back to none.
  "filtered-history": asked =>
    asked.locale === undefined
      ? everyLanguage()
      : registeredReadLanguagesFor(asked.locale, false),
};

/**
 * The reads that consume a translation overview or a filter, each read as its
 * handler reads it. Only these widen what the rule is told: a control a
 * handler ignores reads nothing, and told every language for it, a rule that
 * admits by what `locales` includes would pass a read it should refuse.
 */
/** How a read reads its overview and filter controls, where it reads them. */
interface ReadControls {
  translationStatus?: (params: Readonly<Record<string, string>>) => boolean;
  where?: true;
}

const READ_CONTROLS: ReadonlyMap<string, ReadControls> = new Map<
  string,
  ReadControls
>([
  [
    "listEntries",
    {
      translationStatus: params => isTruthyParam(params["translation-status"]),
      where: true,
    },
  ],
  ["countEntries", { where: true }],
  [
    "getEntry",
    {
      translationStatus: params => isTruthyParam(params["translation-status"]),
    },
  ],
  // The Single handler attaches its overview for `1` alone.
  [
    "getSingleDocument",
    { translationStatus: params => params["translation-status"] === "1" },
  ],
]);

/**
 * What the route's parameters name about its languages: the values the
 * dispatcher acts on, read the way it reads them, so a request that names a
 * language twice is judged in the one it is dispatched in.
 */
function requestedLanguage({
  method,
  params,
}: RouteOperation): RequestedLanguage {
  const controls = READ_CONTROLS.get(method);
  let where: unknown;
  try {
    where = controls?.where
      ? parseWhereParam(params.where, params.whereBrackets)
      : undefined;
  } catch {
    where = UNREADABLE;
  }
  return {
    // An empty value (`?locale=`) names nothing, as the handlers read it: a
    // history list then lists every language's versions.
    locale: params.locale || undefined,
    fallbackLocale: params["fallback-locale"] || undefined,
    translationStatus: controls?.translationStatus?.(params) ?? false,
    where,
  };
}

/** The languages the rule asked for a REST operation is told. */
export function requestLanguage(
  operation: RouteOperation | undefined
): RuleLanguage {
  if (operation === undefined) return everyLanguage();
  const kind = OPERATION_LANGUAGES.get(operation.method);
  if (kind === undefined) return everyLanguage();
  return LANGUAGES_OF[kind](requestedLanguage(operation));
}

/** A REST route's method name, and the parameters it is dispatched with. */
export interface RouteOperation {
  method: string;
  params: Readonly<Record<string, string>>;
  /**
   * The request names one entry or document: an entry its path names by id,
   * or a Single's own document. It is refused about that one, and a caller
   * who may not read it is answered as if it were missing. Set by the route,
   * which knows what its path names; the parameters cannot say, since a
   * query may carry an `entryId` that names nothing.
   */
  namesOne?: boolean;
  /**
   * The route's handler reads through the query service's filtered read,
   * which limits what it reads to the entries a read rule's filter matches,
   * so a caller whose rule answers one is let through. Set only by a route
   * that does: every other route refuses such a caller, as it cannot apply
   * the filter to what it reads.
   */
  appliesReadFilter?: boolean;
}

/**
 * Collection-specific authorization middleware.
 *
 * Like `requirePermission()` but explicitly scoped to a collection slug.
 * Evaluates code-defined access from `defineCollection({ access })` via the
 * RBAC service, then falls back to database permission checks.
 *
 * Use this for dynamic collection entry routes where the collection slug
 * is extracted from the URL (e.g., `/api/collections/:slug/entries`).
 *
 * `operation` is the route's method name and the parameters it is
 * dispatched with, which decide the languages the rule is told; see
 * {@link requestLanguage}. On REST this is the only place
 * an entry's rule is asked, so it is told them here.
 */
export async function requireCollectionAccess(
  req: Request,
  action: string,
  collectionSlug: string,
  operation?: RouteOperation
): Promise<AuthContext | ErrorResponse> {
  const authResult = await requireAuthentication(req);

  if ("statusCode" in authResult) {
    return authResult;
  }

  // Worked out after authentication, never before: on a cold worker the
  // first request's authentication is what registers the site's languages,
  // and worked out earlier a rule would be told none. Inside it, the same
  // question `requirePermission` asks, about the collection or Single the
  // URL names.
  return withRuleLanguage(requestLanguage(operation), () =>
    authorizeCaller(
      authResult,
      action,
      collectionSlug,
      // A route naming one entry is refused about that entry. Named by the
      // route, never by a parameter: a query can carry an `entryId` too.
      operation?.namesOne ? "one" : "all",
      action === "read" && operation?.appliesReadFilter === true
    )
  );
}

/**
 * The access check for a route that publishes or unpublishes every language
 * of an entry or a Single: by the grant alone, since the service asks the
 * rule once in each language the change puts live, which the route cannot
 * know. Told every language here, a rule refusing a language that does not go
 * live would refuse what the service allows.
 */
export async function requireLifecycleAccess(
  req: Request,
  action: "publish" | "unpublish",
  collectionSlug: string,
  operation?: RouteOperation
): Promise<AuthContext | ErrorResponse> {
  const authResult = await requireAuthentication(req);
  if ("statusCode" in authResult) return authResult;
  // The languages still matter to the read a refusal is answered by.
  return withRuleLanguage(requestLanguage(operation), async () => {
    const scope = operation?.namesOne ? "one" : "all";
    const onGrant = await authorizeCallerOnGrant(
      authResult,
      action,
      collectionSlug,
      scope
    );
    if (!isErrorResponse(onGrant)) return onGrant;
    // A target with no lifecycle has nothing to publish, and the service
    // tells a caller who may update so; one with a lifecycle still asks the
    // lifecycle gate whoever the route admitted. So update admits too, and a
    // caller neither admits is refused as the lifecycle grant refuses them.
    const asUpdate = await authorizeCaller(
      authResult,
      "update",
      collectionSlug,
      scope
    );
    return isErrorResponse(asUpdate) ? onGrant : asUpdate;
  });
}

/** The action a write route admitted each caller on, where it accepts several. */
const admittedActions = new WeakMap<
  AuthContext,
  "update" | "publish" | "unpublish"
>();

/**
 * The action {@link requireCollectionWriteAccess} admitted `caller` on, or
 * `undefined` where the route asked one action.
 */
export function admittedActionOf(caller: AuthContext): string | undefined {
  return admittedActions.get(caller);
}

/**
 * The access check for a write route a caller may reach on update, or on
 * publish or unpublish alone. A write that changes only an entry's status is
 * a publish or an unpublish, which the service judges by that gate, and the
 * service asks update of any other write, so admitting a caller here on
 * publish lets them edit nothing. Each action is asked in turn, its rule
 * included; the first that admits the caller is recorded for the dispatch
 * ({@link admittedActionOf}). A caller none admits is refused in the words
 * of the action the write asks, which `actionAsked` reads from the request
 * only then; without it, or where it names update, as update refuses them.
 */
export async function requireCollectionWriteAccess(
  req: Request,
  collectionSlug: string,
  operation?: RouteOperation,
  actionAsked?: () => Promise<"update" | "publish" | "unpublish">
): Promise<AuthContext | ErrorResponse> {
  const authResult = await requireAuthentication(req);
  if ("statusCode" in authResult) return authResult;
  return withRuleLanguage(requestLanguage(operation), async () => {
    // A route naming one entry is refused about it, as in requireCollectionAccess.
    const scope = operation?.namesOne ? "one" : "all";
    const asUpdate = await authorizeCaller(
      authResult,
      "update",
      collectionSlug,
      scope
    );
    if (!isErrorResponse(asUpdate)) {
      admittedActions.set(asUpdate, "update");
      return asUpdate;
    }
    // A write to every language (`?locale=*`) changes only the status, and
    // its publish rule is asked by the service in each language it puts live;
    // here, by the grant alone. Any other write's rule is asked here too.
    const authorize =
      operation?.params.locale === EVERY_LOCALE
        ? authorizeCallerOnGrant
        : authorizeCaller;
    const refusals = new Map<"publish" | "unpublish", ErrorResponse>();
    for (const action of ["publish", "unpublish"] as const) {
      const answer = await authorize(authResult, action, collectionSlug, scope);
      if (!isErrorResponse(answer)) {
        admittedActions.set(answer, action);
        return answer;
      }
      refusals.set(action, answer);
    }
    return refusalForActionAsked(asUpdate, refusals, actionAsked);
  });
}

/**
 * The refusal a write every action refused is answered with. A write that
 * changes only the status asked to publish or unpublish, so it is told that,
 * with the refusal that action's own check gave; any other write is told it
 * may not edit.
 */
async function refusalForActionAsked(
  asUpdate: ErrorResponse,
  refusals: ReadonlyMap<"publish" | "unpublish", ErrorResponse>,
  actionAsked?: () => Promise<"update" | "publish" | "unpublish">
): Promise<ErrorResponse> {
  const asked = actionAsked ? await actionAsked() : "update";
  return asked === "update" ? asUpdate : (refusals.get(asked) ?? asUpdate);
}

/**
 * Helper to check if a result is an error response
 */
export function isErrorResponse(
  result: AuthContext | ErrorResponse
): result is ErrorResponse {
  return "statusCode" in result;
}
