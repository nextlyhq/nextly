import { clearAccessTokenCookie } from "../cookies/access-token-cookie.js";
import {
  LEGACY_COOKIE_NAMES,
  serializeClearCookie,
} from "../cookies/cookie-config.js";
import {
  readRefreshTokenCookie,
  clearRefreshTokenCookie,
} from "../cookies/refresh-token-cookie.js";
import {
  clearCsrfCookie,
  readCsrfCookie,
  readCsrfFromRequest,
} from "../csrf/csrf-cookie.js";
import { validateCsrf } from "../csrf/validate.js";
import { hashRefreshToken } from "../session/refresh.js";

import {
  jsonResponse,
  parseJsonBody,
  buildCookieHeaders,
} from "./handler-utils.js";

export interface LogoutHandlerDeps {
  allowedOrigins: string[];
  deleteRefreshTokenByHash: (tokenHash: string) => Promise<void>;
}

export async function handleLogout(
  request: Request,
  deps: LogoutHandlerDeps
): Promise<Response> {
  const body = await parseJsonBody(request);
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

  const refreshToken = readRefreshTokenCookie(request);
  if (refreshToken) {
    const tokenHash = hashRefreshToken(refreshToken);
    await deps.deleteRefreshTokenByHash(tokenHash);
  }

  // Clear all cookies (current + legacy)
  const clearCookies = [
    clearAccessTokenCookie(),
    clearRefreshTokenCookie(),
    clearCsrfCookie(),
    ...LEGACY_COOKIE_NAMES.map(name => serializeClearCookie(name, "/admin")),
  ];

  return new Response(JSON.stringify({ data: { success: true } }), {
    status: 200,
    headers: buildCookieHeaders(clearCookies),
  });
}
