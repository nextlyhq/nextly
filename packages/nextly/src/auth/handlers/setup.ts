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
import { readCsrfCookie, readCsrfFromRequest } from "../csrf/csrf-cookie";
import { validateCsrf } from "../csrf/validate";
import { buildClaims } from "../jwt/claims";
import { signAccessTokenWithExpiry } from "../jwt/sign";
import type { SessionRoles } from "../session/session-roles";
// hashPassword not needed here -- seedSuperAdmin handles hashing internally

import {
  buildAuthErrorResponse,
  buildCookieHeaders,
  csrfFailure,
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
  createSuperAdmin: (data: {
    email: string;
    name: string;
    password: string;
  }) => Promise<{ id: string; email: string; name: string }>;
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

export async function handleSetupStatus(
  request: Request,
  deps: Pick<SetupHandlerDeps, "hasAdministrator">
): Promise<Response> {
  try {
    const isSetup = await deps.hasAdministrator();
    // Emit `{ isSetup, requiresInitialUser }` per spec §7.7. Both fields are
    // derived from whether an administrator exists: `isSetup` is true once
    // one does, `requiresInitialUser` is the inverse so the admin client can
    // drive the bootstrap-form redirect guard without reinterpreting the
    // same boolean. The pair also satisfies the section 5.1 "no Boolean-only
    // respondData payload" rule.
    return respondData({ isSetup, requiresInitialUser: !isSetup });
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

export async function handleSetup(
  request: Request,
  deps: SetupHandlerDeps
): Promise<Response> {
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
  if (administratorExists) {
    return jsonResponse(403, {
      error: {
        code: "SETUP_COMPLETE",
        message: "Setup already completed",
      },
    });
  }

  const body = await request.json();

  const csrfCookie = readCsrfCookie(request);
  const csrfToken = readCsrfFromRequest(body, request);
  const csrfResult = validateCsrf(
    request,
    csrfCookie,
    csrfToken,
    deps.allowedOrigins
  );
  if (!csrfResult.valid) {
    return jsonResponse(403, {
      error: csrfFailure(request, csrfResult),
    });
  }

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
  if (!strengthResult.ok) {
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

  // Create super admin (seeds permissions internally, hashes password internally)
  const user = await deps.createSuperAdmin({ email, name, password });

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
