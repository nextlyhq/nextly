/**
 * GET /auth/session
 * Returns the current session user from the access token.
 * No database hit -- purely stateless JWT verification.
 * Handles backward compatibility for old Auth.js cookies.
 */
import { clearAccessTokenCookie } from "../cookies/access-token-cookie";
import {
  LEGACY_COOKIE_NAMES,
  serializeClearCookie,
} from "../cookies/cookie-config";
import { getSession } from "../session/get-session";

import { jsonResponse, buildCookieHeaders } from "./handler-utils";

export interface SessionHandlerDeps {
  secret: string;
}

export async function handleSession(
  request: Request,
  deps: SessionHandlerDeps
): Promise<Response> {
  const result = await getSession(request, deps.secret);

  if (result.authenticated) {
    return jsonResponse(200, { data: { user: result.user } });
  }

  // Check if this is a legacy Auth.js cookie (backward compatibility)
  const cookieHeader = request.headers.get("cookie") || "";
  const hasLegacyCookie = LEGACY_COOKIE_NAMES.some(name =>
    cookieHeader.includes(name)
  );

  const clearCookies: string[] = [];
  if (hasLegacyCookie) {
    clearCookies.push(
      ...LEGACY_COOKIE_NAMES.map(name => serializeClearCookie(name, "/admin"))
    );
  }
  // Only clear the access cookie when the JWT is tampered/malformed. For an
  // expired JWT we want the cookie to stay so the client can still receive
  // TOKEN_EXPIRED on parallel in-flight requests and participate in the
  // single coalesced refresh — clearing here forces sibling requests into
  // the no_token → AUTH_REQUIRED branch, which bypasses refresh.
  if (result.reason === "invalid") {
    clearCookies.push(clearAccessTokenCookie());
  }

  const code =
    hasLegacyCookie && result.reason === "no_token"
      ? "SESSION_UPGRADED"
      : result.reason === "expired"
        ? "TOKEN_EXPIRED"
        : "AUTH_REQUIRED";

  const message =
    code === "SESSION_UPGRADED"
      ? "Session upgraded. Please log in again."
      : code === "TOKEN_EXPIRED"
        ? "Session expired"
        : "Not authenticated";

  if (clearCookies.length > 0) {
    return new Response(JSON.stringify({ error: { code, message } }), {
      status: 401,
      headers: buildCookieHeaders(clearCookies),
    });
  }

  return jsonResponse(401, { error: { code, message } });
}
