/**
 * Whether a failed read of one document means "there is nothing here for this
 * caller" rather than "the read broke". The Single route and the public
 * reader's Single read both ask it, so they answer one way; the content route,
 * a cached read and the build's scan of a restricted collection ask the
 * refusal half of it.
 *
 * @module runtime/routing/miss-or-denied
 */
import { NextlyError } from "../../errors/nextly-error";

/**
 * Whether a failed read means "this page is not here" rather than "the read
 * broke".
 *
 * A genuine miss, an access denial and a visitor asked to sign in all count
 * as not here, deliberately: a document the visitor may not see must not be
 * distinguishable from one that does not exist, or the answer reveals what
 * the access rule refused.
 *
 * Everything else RETHROWS. A database blip degraded to `null` would be
 * rendered as a 404 and — on a public route — cached as one, so a transient
 * fault would outlive itself as a permanent missing page.
 *
 * `NextlyError.is` rather than `instanceof`, because it matches across bundled
 * copies of the package; `statusCode` rather than the code name, because the
 * status is what the classification is actually about and one status covers
 * several codes.
 */
export function isMissOrDenied(error: unknown): boolean {
  return (
    (NextlyError.is(error) && error.statusCode === 404) || isReadRefusal(error)
  );
}

/**
 * Whether a failed read was refused by access: a denial (403), or a visitor
 * asked to sign in (`AUTH_REQUIRED`). The read policy hides what was asked
 * from this caller, which a route answers as not found and a cached read
 * keeps as its answer.
 *
 * The visitor refusal only: another 401, such as an invalid or expired
 * credential, is the caller's to fix, and like every other error it is not a
 * refusal.
 */
export function isReadRefusal(error: unknown): error is NextlyError {
  return (
    (NextlyError.is(error) && error.statusCode === 403) ||
    NextlyError.isCode(error, "AUTH_REQUIRED")
  );
}
