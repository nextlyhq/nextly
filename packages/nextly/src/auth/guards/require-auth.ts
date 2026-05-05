/**
 * Authentication guard.
 * Verifies that a request has a valid session (access token).
 * Does NOT check permissions -- just authentication.
 *
 * Throws `NextlyError.authRequired()` on any failure leg. The boundary
 * wrapper (`withErrorHandler`) serialises it as `application/problem+json`.
 * Account state (e.g. expired vs. missing) lives in `logContext`, not on
 * the wire, so route handlers that need to distinguish the two should
 * expose state via `/api/auth/state` rather than peek at the failure code.
 */
import { NextlyError } from "../../errors/nextly-error";
import { getSession, type GetSessionResult } from "../session/get-session";
import type { SessionUser } from "../session/session-types";

/**
 * Require a valid session. Returns the session user or throws
 * `NextlyError.authRequired()`.
 */
export async function requireAuth(
  request: Request,
  secret: string
): Promise<SessionUser> {
  const result: GetSessionResult = await getSession(request, secret);

  if (!result.authenticated) {
    // The wire response is the canonical "Authentication required." for
    // every miss leg. The internal reason ("expired" vs. "no_token" vs.
    // "invalid") is preserved for operators in logContext.
    throw NextlyError.authRequired({
      logContext: { reason: result.reason },
    });
  }

  return result.user;
}
