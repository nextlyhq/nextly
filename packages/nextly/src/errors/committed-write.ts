/**
 * What a caller is told when a write committed and the request then failed.
 *
 * @module errors/committed-write
 */
import { NEXTLY_ERROR_STATUS } from "./error-codes";
import { NextlyError } from "./nextly-error";
import { retryAfterSeconds } from "./retry-after";

/**
 * The error to answer with for `failure`, raised after a write committed: a
 * post-commit hook, or the read that builds the response.
 *
 * A server failure, a 429, or any error carrying a retry hint is replaced. Each
 * reads to a caller as "the change did not happen", whatever its code says (a
 * DATABASE_ERROR for a lost connection tells the caller to try again in its
 * message alone), and the write is durable, so trying again makes the change a
 * second time. The caller is told instead that the change was saved and the
 * request still failed, with no retry hint; `failure` stays the cause, for the
 * operator. A refusal the caller can act on (any other 4xx with no retry hint)
 * is returned as it is.
 */
export function afterCommittedWrite(
  failure: NextlyError,
  logContext: Record<string, unknown> = {}
): NextlyError {
  if (!readsAsNotSaved(failure)) return failure;
  return new NextlyError({
    code: "INTERNAL_ERROR",
    publicMessage:
      "The change was saved, but the request could not be completed.",
    logContext: { ...logContext, committed: true },
    cause: failure,
  });
}

/**
 * Whether an error tells its caller the change did not happen: a server
 * failure of any code, a 429 (which says "try later" with or without a hint),
 * or an error carrying a retry hint. Decided by status and hint rather than by
 * a list of retryable codes, which would miss the next transient code to be
 * added. It covers every failure a client may send again on its own, the
 * admin's mutation retry included.
 */
function readsAsNotSaved(error: NextlyError): boolean {
  return (
    error.statusCode >= NEXTLY_ERROR_STATUS.INTERNAL_ERROR ||
    error.statusCode === NEXTLY_ERROR_STATUS.RATE_LIMITED ||
    retryAfterSeconds(error) !== undefined
  );
}
