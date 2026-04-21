// CSRF double-submit cookie + origin check. Setup is a one-time but
// state-changing bootstrap — CSRF guards against a malicious page
// racing the legitimate first-admin form. See docs/auth/csrf.md.
import { setAccessTokenCookie } from "../cookies/access-token-cookie.js";
import { setRefreshTokenCookie } from "../cookies/refresh-token-cookie.js";
import { validatePasswordStrength } from "../credentials/password-strength.js";
import { readCsrfCookie, readCsrfFromRequest } from "../csrf/csrf-cookie.js";
import { validateCsrf } from "../csrf/validate.js";
import { buildClaims } from "../jwt/claims.js";
import { signAccessToken } from "../jwt/sign.js";
// hashPassword not needed here -- seedSuperAdmin handles hashing internally
import {
  generateRefreshToken,
  hashRefreshToken,
  generateRefreshTokenId,
} from "../session/refresh.js";

import {
  jsonResponse,
  buildCookieHeaders,
  getClientIp,
} from "./handler-utils.js";

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
}

export async function handleSetupStatus(
  _request: Request,
  deps: Pick<SetupHandlerDeps, "getUserCount">
): Promise<Response> {
  const count = await deps.getUserCount();
  // Response shape: { data: { data: { isSetupComplete } } }
  // The admin UI fetcher extracts json.data.data, so we need double nesting.
  // Field name is isSetupComplete to match the admin UI's expected type.
  return jsonResponse(200, {
    data: { data: { isSetupComplete: count > 0 } },
  });
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
    ipAddress: getClientIp(request),
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

  return new Response(
    JSON.stringify({
      data: {
        user: { id: user.id, email: user.email, name: user.name, roleIds },
      },
    }),
    { status: 201, headers: buildCookieHeaders(cookies) }
  );
}
