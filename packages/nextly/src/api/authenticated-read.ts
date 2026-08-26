/**
 * The opening move every authenticated read endpoint makes.
 *
 * Four lines — require a session, convert a refusal into the canonical error,
 * then read the query string — repeated verbatim by each read handler. Repeated
 * text is not itself a problem; this one is, because the order carries a rule:
 * the refusal must be thrown BEFORE anything reads the request, so a handler
 * cannot accidentally act on parameters it has not yet earned the right to see.
 * A copy that drifts by one line loses that and still looks right.
 *
 * `api/dashboard` predates this and holds two copies of its own. They are left
 * alone here rather than swept in a change about something else; new read
 * endpoints should use this.
 *
 * @module api/authenticated-read
 */

import { isErrorResponse, requireAuthentication } from "../auth/middleware";
import { toNextlyAuthError } from "../auth/middleware/to-nextly-error";

/** Who is asking, and what they asked for. */
export interface AuthenticatedRead {
  userId: string;
  /** Role ids, needed wherever a role-based access rule is evaluated. */
  roles?: string[] | undefined;
  searchParams: URLSearchParams;
}

/**
 * Headers for a response shaped by WHO asked.
 *
 * `private, no-store` keeps a per-user answer out of any shared cache, and
 * `Vary: Cookie` keeps it out of a per-browser one too. Both, not either: the
 * first stops a proxy holding it, the second stops the reply to one session
 * being served to the next.
 */
export const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
} as const;

/**
 * Authenticate, then hand back the caller and their query string.
 *
 * Throws the canonical auth error rather than returning a response, so the
 * handler's `withErrorHandler` renders it the same way it renders every other
 * failure.
 */
export async function authenticatedRead(
  req: Request
): Promise<AuthenticatedRead> {
  const auth = await requireAuthentication(req);
  if (isErrorResponse(auth)) throw toNextlyAuthError(auth);
  return {
    userId: auth.userId,
    roles: auth.roles,
    searchParams: new URL(req.url).searchParams,
  };
}
