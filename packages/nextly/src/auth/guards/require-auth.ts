/**
 * Authentication guard.
 * Verifies that a request has a valid session (access token).
 * Does NOT check permissions -- just authentication.
 */
import { getSession, type GetSessionResult } from "../session/get-session.js";
import type { SessionUser } from "../session/session-types.js";

export class AuthenticationError extends Error {
  public code: string;
  constructor(message: string, code: string = "UNAUTHENTICATED") {
    super(message);
    this.name = "AuthenticationError";
    this.code = code;
  }
}

/**
 * Require a valid session. Returns the session user or throws AuthenticationError.
 */
export async function requireAuth(
  request: Request,
  secret: string
): Promise<SessionUser> {
  const result: GetSessionResult = await getSession(request, secret);

  if (!result.authenticated) {
    throw new AuthenticationError(
      result.reason === "expired"
        ? "Session expired"
        : "Authentication required",
      result.reason === "expired" ? "TOKEN_EXPIRED" : "UNAUTHENTICATED"
    );
  }

  return result.user;
}
