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
 * An error that asks for a retry is replaced. The write is durable, so a caller
 * following the hint would make the change a second time. The caller is told
 * instead that the change was saved and the request still failed, with no
 * retry hint; `failure` stays the cause, for the operator. Any other error is
 * returned as it is.
 */
export function afterCommittedWrite(
  failure: NextlyError,
  logContext: Record<string, unknown> = {}
): NextlyError {
  if (!asksForRetry(failure)) return failure;
  return new NextlyError({
    code: "INTERNAL_ERROR",
    publicMessage:
      "The change was saved, but the request could not be completed.",
    logContext: { ...logContext, committed: true },
    cause: failure,
  });
}

/**
 * Whether an error tells its caller to send the request again: it carries a
 * retry hint, or answers 503, which says the same without one.
 */
function asksForRetry(error: NextlyError): boolean {
  return (
    retryAfterSeconds(error) !== undefined ||
    error.statusCode === NEXTLY_ERROR_STATUS.SERVICE_UNAVAILABLE
  );
}
