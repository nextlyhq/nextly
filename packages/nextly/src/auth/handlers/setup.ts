// CSRF double-submit cookie + origin check. Setup is a one-time but
// state-changing bootstrap; CSRF guards against a malicious page racing
// the legitimate first-admin form. See docs/auth/csrf.md.
import { respondAction, respondData } from "../../api/response-shapes";
import { getTrustedClientIp } from "../../utils/get-trusted-client-ip";
import { setAccessTokenCookie } from "../cookies/access-token-cookie";
import { setRefreshTokenCookie } from "../cookies/refresh-token-cookie";
import { validatePasswordStrength } from "../credentials/password-strength";
import { readCsrfCookie, readCsrfFromRequest } from "../csrf/csrf-cookie";
import { validateCsrf } from "../csrf/validate";
import { buildClaims } from "../jwt/claims";
import { signAccessToken } from "../jwt/sign";
// hashPassword not needed here -- seedSuperAdmin handles hashing internally
import {
  generateRefreshToken,
  hashRefreshToken,
  generateRefreshTokenId,
} from "../session/refresh";


import { jsonResponse, buildCookieHeaders } from "./handler-utils";

export interface SetupHandlerDeps {
  secret: string;
  isProduction: boolean;
  accessTokenTTL: number;
  refreshTokenTTL: number;
  allowedOrigins: string[];
  getUserCount: () => Promise<number>;
  createSuperAdmin: (data: {
    email: string;
    name: string;
    password: string;
  }) => Promise<{ id: string; email: string; name: string }>;
  fetchRoleIds: (userId: string) => Promise<string[]>;
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
  _request: Request,
  deps: Pick<SetupHandlerDeps, "getUserCount">
): Promise<Response> {
  const count = await deps.getUserCount();
  // Emit `{ isSetup, requiresInitialUser }` per spec §7.7. Both
  // fields are derived from the user count: `isSetup` is true once a user
  // exists, `requiresInitialUser` is the inverse so the admin client can
  // drive the bootstrap-form redirect guard without reinterpreting the
  // same boolean. The pair also satisfies the section 5.1 "no Boolean-only
  // respondData payload" rule.
  const isSetup = count > 0;
  return respondData({ isSetup, requiresInitialUser: !isSetup });
}

export async function handleSetup(
  request: Request,
  deps: SetupHandlerDeps
): Promise<Response> {
  const userCount = await deps.getUserCount();
  if (userCount > 0) {
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
      error: { code: "CSRF_FAILED", message: csrfResult.error },
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
    return jsonResponse(400, {
      error: {
        code: "WEAK_PASSWORD",
        message: "Password does not meet requirements",
        details: strengthResult.errors,
      },
    });
  }

  // Create super admin (seeds permissions internally, hashes password internally)
  const user = await deps.createSuperAdmin({ email, name, password });

  const roleIds = await deps.fetchRoleIds(user.id);
  const claims = buildClaims({
    userId: user.id,
    email: user.email,
    name: user.name,
    image: null,
    roleIds,
  });
  const accessToken = await signAccessToken(
    claims,
    deps.secret,
    deps.accessTokenTTL
  );

  const rawRefreshToken = generateRefreshToken();
  await deps.storeRefreshToken({
    id: generateRefreshTokenId(),
    userId: user.id,
    tokenHash: hashRefreshToken(rawRefreshToken),
    userAgent: request.headers.get("user-agent"),
    ipAddress: getTrustedClientIp(request, {
      trustProxy: deps.trustProxy,
      trustedProxyIps: deps.trustedProxyIps,
    }),
    expiresAt: new Date(Date.now() + deps.refreshTokenTTL * 1000),
  });

  const cookies = [
    setAccessTokenCookie(accessToken, deps.refreshTokenTTL, deps.isProduction),
    setRefreshTokenCookie(
      rawRefreshToken,
      deps.refreshTokenTTL,
      deps.isProduction
    ),
  ];

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
      // Authoritative server-side exp = accessToken JWT exp claim, not cookie max-age.
      expiresAt: new Date(
        Date.now() + deps.accessTokenTTL * 1000
      ).toISOString(),
    },
    { status: 201, headers: buildCookieHeaders(cookies) }
  );
}
