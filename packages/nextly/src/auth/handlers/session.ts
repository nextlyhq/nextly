/**
 * GET /auth/session
 * Returns the current session user from the access token.
 * No database hit; purely stateless JWT verification.
 */
// Phase 4 (Task 10): respondData replaces the hand-rolled `{ data: ... }`
// envelope on the authenticated success path. Error legs continue to
// emit `{ error: { code, message } }` directly (refresh-coalescing
// consumers already special-case those codes).
import { respondData } from "../../api/response-shapes";
import {
  clearAccessTokenCookie,
  readAccessTokenCookie,
} from "../cookies/access-token-cookie";
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
    // Phase 4 / spec section 7.6: bare `{ user, accessToken }`. The access
    // token already verified successfully (it's how we got here), so reading
    // it back from the cookie is safe. We surface it in the body so
    // non-cookie SDK consumers (mobile, CLI) can pull the live token without
    // owning cookie storage.
    const accessToken = readAccessTokenCookie(request);
    return respondData({ user: result.user, accessToken });
  }

  // Only clear the access cookie when the JWT is tampered/malformed. For an
  // expired JWT we want the cookie to stay so the client can still receive
  // TOKEN_EXPIRED on parallel in-flight requests and participate in the
  // single coalesced refresh; clearing here forces sibling requests into
  // the no_token to AUTH_REQUIRED branch, which bypasses refresh.
  const clearCookies: string[] = [];
  if (result.reason === "invalid") {
    clearCookies.push(clearAccessTokenCookie());
  }

  const code =
    result.reason === "expired" ? "TOKEN_EXPIRED" : "AUTH_REQUIRED";
  const message =
    code === "TOKEN_EXPIRED" ? "Session expired" : "Not authenticated";

  if (clearCookies.length > 0) {
    return new Response(JSON.stringify({ error: { code, message } }), {
      status: 401,
      headers: buildCookieHeaders(clearCookies),
    });
  }

  return jsonResponse(401, { error: { code, message } });
}
