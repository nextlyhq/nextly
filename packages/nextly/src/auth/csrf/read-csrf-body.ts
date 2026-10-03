/**
 * Reading the request body a CSRF check may consult.
 *
 * One reader for every place a plugin request's CSRF token is checked: the
 * route dispatcher's `csrf` option and `ctx.auth.verifyCsrf`, which a route
 * handler calls itself. Both run before the token is validated, so both must
 * be bounded the same way — a second, unbounded reader is the path a forged
 * request would take.
 *
 * @module auth/csrf/read-csrf-body
 * @since 1.0.0
 */
import { readBoundedJsonBody } from "../../api/read-json-body";
import { NextlyError } from "../../errors/nextly-error";

/**
 * How much of a body may be read while looking for a CSRF token.
 *
 * The token is consulted only as a top-level `csrfToken` string, so a body
 * that needs more than this to reach it is one the `x-csrf-token` header
 * exists to serve.
 */
const MAX_CSRF_BODY_BYTES = 64 * 1024;

/**
 * The body fields the CSRF check may consult, read WITHOUT buffering whatever
 * the caller sent.
 *
 * Both bounds exist because this runs BEFORE the token is validated: a caller
 * about to be refused must not be able to decide how much the refusal costs.
 * `req.clone().json()` let an unauthenticated-in-effect request buffer a body
 * of any size — chunked, so no `Content-Length` announced it — and the caller
 * paid for all of it before deciding the request was forged.
 *
 *  - A request carrying `x-csrf-token` is not read at all. The header is what
 *    `readCsrfFromRequest` returns whenever it is present, so reading a body
 *    to find a value that would then be ignored was pure cost.
 *  - Otherwise the read stops at {@link MAX_CSRF_BODY_BYTES}.
 *
 * The read is on a CLONE so the handler still receives the body, and because
 * a clone tees the stream, bounding this read is also what bounds the copy
 * the original branch buffers behind it.
 */
export async function readCsrfBody(
  req: Request
): Promise<{ body?: Record<string, unknown>; tooLarge: boolean }> {
  if (req.headers.get("x-csrf-token")) return { tooLarge: false };

  try {
    const parsed: unknown = await readBoundedJsonBody(
      req.clone(),
      MAX_CSRF_BODY_BYTES
    );
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { body: parsed as Record<string, unknown>, tooLarge: false };
    }
    return { tooLarge: false };
  } catch (err) {
    // A body that is not JSON carries no token; the header is still checked.
    // The size refusal is reported separately — it is the one case where a
    // token may well have been present, so an operator reading the 403 needs
    // to see that nothing looked for it rather than that nothing was sent.
    // `body-too-large` is the reason `readBoundedJsonBody` documents for it.
    return {
      tooLarge:
        NextlyError.is(err) && err.logContext?.reason === "body-too-large",
    };
  }
}
