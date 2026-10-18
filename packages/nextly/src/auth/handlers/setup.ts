// CSRF double-submit cookie + origin check. Setup is a one-time but
// state-changing bootstrap; CSRF guards against a malicious page racing
// the legitimate first-admin form. See docs/auth/csrf.md.
import { readOrGenerateRequestId } from "../../api/request-id";
import { respondAction, respondData } from "../../api/response-shapes";
import type { AuditLogWriter } from "../../domains/audit/audit-log-writer";
import { NextlyError } from "../../errors";
import { getNextlyLogger } from "../../observability/logger";
import { getTrustedClientIp } from "../../utils/get-trusted-client-ip";
import { sessionCookies } from "../cookies/session-cookies";
import { validatePasswordStrength } from "../credentials/password-strength";
import { buildClaims } from "../jwt/claims";
import { signAccessTokenWithExpiry } from "../jwt/sign";
import type { SessionRoles } from "../session/session-roles";
import type { TokenVerdict } from "../setup-token/setup-token";
// hashPassword not needed here -- seedSuperAdmin handles hashing internally

import {
  buildAuthErrorResponse,
  buildCookieHeaders,
  csrfRefusal,
  jsonResponse,
} from "./handler-utils";
import { storeNewRefreshToken } from "./issue-session";

/**
 * The strategy the first administrator's session is recorded under.
 *
 * Its own name rather than `password`: no password was checked, the account
 * was created on the spot by whoever reached the setup route of an empty
 * install. Recorded as `password`, the trail would point anyone asking which
 * door let the first administrator in at a credential check that never ran,
 * rather than at the setup route.
 */
const SETUP_STRATEGY = "setup";

export interface SetupHandlerDeps {
  /**
   * Records the session this hands out. Setup is account creation, but it
   * returns a working session, so the trail must show it like any other
   * completed login.
   */
  auditLog: AuditLogWriter;
  secret: string;
  isProduction: boolean;
  accessTokenTTL: number;
  refreshTokenTTL: number;
  allowedOrigins: string[];
  /**
   * Whether anyone holds the `super-admin` role: setup's gate. Not the user
   * count, since a role-less self-registered account can exist before the
   * install has an administrator, and setup must still create one.
   */
  hasAdministrator: () => Promise<boolean>;
  /** The production setup token, and the claim one setup holds at a time. */
  setupToken: {
    /** Whether setup needs a token: in production, until an administrator exists. */
    required: boolean;
    verify: (presented: unknown) => Promise<TokenVerdict>;
    /** The same judgement against the stored record read now, uncached. */
    confirm: (presented: unknown) => Promise<TokenVerdict>;
    /** Discard the stored token once the administrator exists. */
    spend: () => Promise<void>;
    claim: () => Promise<{ release: () => Promise<void> } | null>;
  };
  /**
   * Create the administrator's account, or answer null when another setup
   * created the administrator first: of setups racing on an empty install,
   * exactly one is made the administrator, and the others create nothing.
   */
  createSuperAdmin: (data: {
    email: string;
    name: string;
    password: string;
  }) => Promise<{ id: string; email: string; name: string } | null>;
  /** The roles in force, and when the first of them lapses; see `SessionRoles`. */
  fetchSessionRoles: (userId: string) => Promise<SessionRoles>;
  seedPermissions: () => Promise<void>;
  storeRefreshToken: (record: {
    id: string;
    userId: string;
    tokenHash: string;
    userAgent: string | null;
    ipAddress: string | null;
    expiresAt: Date;
  }) => Promise<void>;
  /** Gate XFF parsing on this. Default false. */
  trustProxy: boolean;
  /** CIDR list of proxy IPs (from TRUSTED_PROXY_IPS). */
  trustedProxyIps: string[];
}

/** The refusal once the install has its administrator, on every path here. */
function setupCompleteResponse(): Response {
  return jsonResponse(403, {
    error: {
      code: "SETUP_COMPLETE",
      message: "Setup already completed",
    },
  });
}

export async function handleSetupStatus(
  request: Request,
  deps: Pick<SetupHandlerDeps, "hasAdministrator" | "setupToken">
): Promise<Response> {
  try {
    const isSetup = await deps.hasAdministrator();
    // Emit `{ isSetup, requiresInitialUser }` per spec §7.7. Both fields are
    // derived from whether an administrator exists: `isSetup` is true once
    // one does, `requiresInitialUser` is the inverse so the admin client can
    // drive the bootstrap-form redirect guard without reinterpreting the
    // same boolean. The pair also satisfies the section 5.1 "no Boolean-only
    // respondData payload" rule.
    // `requiresSetupToken` tells the admin's setup form to ask for the token,
    // and where it is found; it says nothing about the token itself.
    return respondData({
      isSetup,
      requiresInitialUser: !isSetup,
      requiresSetupToken: !isSetup && deps.setupToken.required,
    });
  } catch (err) {
    // Surface a 503 rather than synthesising a default `isSetup` -- the
    // bootstrap-gate must never claim "no users exist" on incomplete data.
    const requestId = readOrGenerateRequestId(request);
    const nextlyErr = NextlyError.is(err)
      ? err
      : NextlyError.serviceUnavailable({
          logMessage: "setup-status: user-count lookup failed",
          cause: err as Error,
        });
    getNextlyLogger().error({
      kind: "setup-status-failed",
      ...nextlyErr.toLogJSON(requestId),
    });
    return buildAuthErrorResponse(nextlyErr, requestId);
  }
}

/** The refusal for a setup token that does not open setup now. */
function tokenRequiredResponse(): Response {
  return jsonResponse(403, {
    error: {
      code: "SETUP_TOKEN_REQUIRED",
      message:
        "A valid setup token is required. Find it in the server's output, or set NEXTLY_SETUP_TOKEN.",
    },
  });
}

/**
 * The refusal a token's verdict calls for, or null when setup may go on: a
 * valid token, or an install whose setup needs none. Wrong, missing and
 * expired tokens are answered alike.
 */
function setupTokenRefusal(verdict: SetupVerdict): Response | null {
  if (verdict === "closed") {
    return jsonResponse(403, {
      error: {
        code: "SETUP_TOKEN_REQUIRED",
        message:
          "Setup is closed: the setup token configured for this install is too weak. See the server's output.",
      },
    });
  }
  return verdict === "invalid" ? tokenRequiredResponse() : null;
}

/** A token's verdict, or that this install's setup needs none. */
type SetupVerdict = TokenVerdict | "not-required";

/**
 * The request's body and its token's verdict, read before setup does any
 * work. A request without a valid token is counted against the auth limit
 * here, so every refusal after it (setup already complete, a CSRF failure, a
 * weak or wrong token, a bad body) has spent the budget before the
 * administrator is looked up, while a valid token goes on whatever the budget
 * holds. A body that is not JSON is counted, then fails as it always did.
 */
async function readSetupRequest(
  request: Request,
  setupToken: SetupHandlerDeps["setupToken"],
  limit: (request: Request) => Promise<Response | null>
): Promise<
  | { body: Awaited<ReturnType<Request["json"]>>; verdict: SetupVerdict }
  | Response
> {
  const forLimiter = request.clone();
  let body: Awaited<ReturnType<Request["json"]>> = {};
  let malformed: Error | undefined;
  try {
    body = await request.json();
  } catch (error) {
    malformed =
      error instanceof Error
        ? error
        : NextlyError.validation({
            errors: [
              { path: "", code: "INVALID_JSON", message: "Invalid JSON" },
            ],
          });
  }
  const presented =
    body !== null && typeof body === "object" ? body.setupToken : undefined;
  const verdict: SetupVerdict = setupToken.required
    ? await setupToken.verify(presented)
    : "not-required";
  if (verdict !== "valid") {
    const limited = await limit(forLimiter);
    if (limited) return limited;
  }
  if (malformed !== undefined) throw malformed;
  return { body, verdict };
}

/**
 * The refusal for a setup body missing a field or carrying a weak password,
 * or null when the administrator can be created from it.
 */
function setupInputRefusal(
  body: { email?: string; name?: string; password?: string },
  request: Request
): Response | null {
  const { email, name, password } = body;
  if (!email || !name || !password) {
    return jsonResponse(400, {
      error: {
        code: "VALIDATION_ERROR",
        message: "Email, name, and password are required",
      },
    });
  }

  const strengthResult = validatePasswordStrength(password);
  if (strengthResult.ok) return null;
  // The rules a password failed are the only part of this a person can act
  // on, so they travel on `data.errors` -- the key the canonical envelope
  // defines and the only one the admin reads. Reasons put on any other key,
  // `details` included, reach the client and are dropped there in silence.
  // The mapping is the one `registerUser` applies to this same validator
  // output, so both paths describe a weak password identically.
  return buildAuthErrorResponse(
    NextlyError.validation({
      errors: strengthResult.errors.map(message => ({
        path: "password",
        code: "WEAK_PASSWORD",
        message,
      })),
    }),
    readOrGenerateRequestId(request)
  );
}

export async function handleSetup(
  request: Request,
  deps: SetupHandlerDeps,
  hooks: {
    /**
     * Count a setup request against the auth rate limit, answering 429 once
     * it is spent. Called for every request without a valid setup token,
     * before setup does any work: a valid token opens setup whatever the
     * limit holds.
     */
    limitWithoutValidToken?: (request: Request) => Promise<Response | null>;
  } = {}
): Promise<Response> {
  const read = await readSetupRequest(
    request,
    deps.setupToken,
    limited => hooks.limitWithoutValidToken?.(limited) ?? Promise.resolve(null)
  );
  if (read instanceof Response) return read;
  const { body, verdict } = read;
  // Fail closed: an unknown answer must not be treated as "no administrator",
  // otherwise a transient DB failure could allow a second super-admin to be
  // created while the real one is invisible to the query.
  let administratorExists: boolean;
  try {
    administratorExists = await deps.hasAdministrator();
  } catch (err) {
    const requestId = readOrGenerateRequestId(request);
    const nextlyErr = NextlyError.is(err)
      ? err
      : NextlyError.serviceUnavailable({
          logMessage: "setup: administrator pre-check failed",
          cause: err as Error,
        });
    getNextlyLogger().error({
      kind: "setup-precheck-failed",
      ...nextlyErr.toLogJSON(requestId),
    });
    return buildAuthErrorResponse(nextlyErr, requestId);
  }
  if (administratorExists) return setupCompleteResponse();

  const csrfRefused = csrfRefusal(
    request,
    body,
    deps,
    readOrGenerateRequestId(request)
  );
  if (csrfRefused) return csrfRefused;

  const tokenRefused = setupTokenRefusal(verdict);
  if (tokenRefused) return tokenRefused;

  const inputRefused = setupInputRefusal(body, request);
  if (inputRefused) return inputRefused;
  const { email, name, password } = body;

  // One setup at a time: of any number arriving together, exactly one creates
  // the administrator and the rest are refused as setup having completed. The
  // gate is asked again under the claim, for a setup that finished just
  // before this one claimed.
  const claim = await deps.setupToken.claim();
  if (!claim) return setupCompleteResponse();
  let user: { id: string; email: string; name: string };
  try {
    if (await deps.hasAdministrator()) return setupCompleteResponse();
    // The token again, against the stored record as it is now rather than a
    // cached read: one replaced after this request was judged, because it
    // leaked, must not open setup.
    if (
      verdict !== "not-required" &&
      (await deps.setupToken.confirm(body.setupToken)) !== "valid"
    ) {
      return tokenRequiredResponse();
    }
    // Create super admin (seeds permissions internally, hashes password internally)
    const created = await deps.createSuperAdmin({ email, name, password });
    // Another setup made the administrator while this one was creating it.
    if (!created) return setupCompleteResponse();
    user = created;
    // Spent with the administrator's creation: no token opens setup again.
    await deps.setupToken.spend();
  } finally {
    await claim.release();
  }

  const sessionRoles = await deps.fetchSessionRoles(user.id);
  const { roleIds } = sessionRoles;
  const claims = buildClaims({
    userId: user.id,
    email: user.email,
    name: user.name,
    image: null,
    roleIds,
    // The account was created just now, so no change has ended its sessions.
    sessionEpoch: 0,
  });
  const { token: accessToken, expiresAt: accessTokenExpiresAt } =
    // Capped as every session's token is, by the first of its roles to lapse.
    await signAccessTokenWithExpiry(
      claims,
      deps.secret,
      deps.accessTokenTTL,
      "session",
      sessionRoles.validUntil
    );

  const rawRefreshToken = await storeNewRefreshToken(deps, user.id, request);

  // The shared account-state gate does not run here, because this session is
  // handed to the account setup just created: active, and verified by the
  // operator who reached the setup route at all. There is no earlier state for
  // the gate to refuse.
  //
  // Setup issues a real session, so it is a completed login and belongs in the
  // trail like any other. It does not route through `issueSession` because it
  // is account creation rather than authentication — different status, message,
  // and no login hooks — but the session it hands out is the same thing.
  await deps.auditLog.write({
    kind: "login-succeeded",
    actorUserId: user.id,
    ipAddress: getTrustedClientIp(request, {
      trustProxy: deps.trustProxy,
      trustedProxyIps: deps.trustedProxyIps,
    }),
    userAgent: request.headers.get("user-agent"),
    // Which way in, as every other success row says: here, the setup route.
    metadata: { strategy: SETUP_STRATEGY },
  });

  const cookies = sessionCookies(accessToken, rawRefreshToken, deps);

  // Action message is "Setup complete." plus the freshly-issued user +
  // tokens (spec §7.6). Tokens still travel as HttpOnly cookies;
  // surfacing them in the body matches login-handler shape so SDK
  // consumers can pick them up uniformly.
  return respondAction(
    "Setup complete.",
    {
      user: { id: user.id, email: user.email, name: user.name, roleIds },
      accessToken,
      refreshToken: rawRefreshToken,
      // Authoritative server-side exp = the accessToken JWT's own exp claim,
      // not cookie max-age and not a fresh clock reading taken after the
      // awaited work above.
      expiresAt: accessTokenExpiresAt.toISOString(),
    },
    { status: 201, headers: buildCookieHeaders(cookies) }
  );
}
