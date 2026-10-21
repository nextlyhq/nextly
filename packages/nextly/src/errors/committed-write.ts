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
 * A server failure, or any error that asks for a retry, is replaced. Either
 * reads to a caller as "the change did not happen", whatever its code says (a
 * DATABASE_ERROR for a lost connection tells the caller to try again in its
 * message alone), and the write is durable, so trying again makes the change a
 * second time. The caller is told instead that the change was saved and the
 * request still failed, with no retry hint; `failure` stays the cause, for the
 * operator. A refusal the caller can act on (a 4xx with no retry hint) is
 * returned as it is.
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
 * failure of any code, or an error carrying a retry hint. Decided by the
 * outcome rather than by a list of retryable codes, which would miss the next
 * transient code to be added.
 */
function readsAsNotSaved(error: NextlyError): boolean {
  return (
    error.statusCode >= NEXTLY_ERROR_STATUS.INTERNAL_ERROR ||
    retryAfterSeconds(error) !== undefined
  );
}
