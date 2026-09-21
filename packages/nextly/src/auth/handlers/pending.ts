/**
 * GET /auth/pending — what the login page needs to resume an interrupted login.
 *
 * An external login that hits a second factor redirects the browser to the
 * login page, leaving the pending token in an HttpOnly cookie. The page cannot
 * read that cookie, so it asks here which challenge is outstanding.
 *
 * It answers with the challenge id and where the login was headed. It NEVER
 * returns the token: handing it to script would undo the reason it is in an
 * HttpOnly cookie at all.
 */
import { readOrGenerateRequestId } from "../../api/request-id";
import { readPendingCookie } from "../cookies/pending-cookie";
import { verifyPendingToken } from "../pipeline/pending-token";

export interface PendingHandlerDeps {
  secret: string;
}

export async function handlePending(
  request: Request,
  deps: PendingHandlerDeps
): Promise<Response> {
  const requestId = readOrGenerateRequestId(request);
  const headers = {
    "Content-Type": "application/json",
    // The answer describes one browser's half-finished login and must not be
    // stored by anything on the way back to it.
    "Cache-Control": "no-store",
    "x-request-id": requestId,
  };

  const token = readPendingCookie(request);
  if (!token) {
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "no-store", "x-request-id": requestId },
    });
  }

  try {
    const pending = await verifyPendingToken(token, deps.secret);
    return new Response(
      JSON.stringify({
        challengeId: pending.challengeId,
        next: pending.next ?? null,
      }),
      { status: 200, headers }
    );
  } catch {
    // An expired or tampered cookie is indistinguishable from none as far as
    // the page is concerned: there is nothing to resume either way.
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "no-store", "x-request-id": requestId },
    });
  }
}
