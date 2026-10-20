/**
 * When a caller should try a refused request again.
 *
 * One reading of an error's retry hint for every boundary that answers over
 * HTTP: the shared error response and the REST dispatcher both set
 * `Retry-After` from it, so the two cannot disagree about which errors carry
 * one.
 */
import type { NextlyError } from "./nextly-error";

/**
 * Seconds a caller waits before retrying a request refused as DATABASE_BUSY.
 *
 * Short, because the wait it follows was already a full
 * `pool.connectionTimeoutMs`: a pool that stayed saturated that long is
 * usually draining by now, and a caller retrying at once would only join the
 * queue it just left.
 */
export const DATABASE_BUSY_RETRY_AFTER_SECONDS = 5;

/**
 * The seconds an error asks its caller to wait before retrying, or
 * `undefined` when it carries no retry hint.
 *
 * Read from the error's public data rather than from its code, so every error
 * that carries a hint is answered with the header, and a code that comes to
 * carry one needs no change here.
 */
export function retryAfterSeconds(error: NextlyError): number | undefined {
  const data = error.publicData;
  if (
    data &&
    typeof data === "object" &&
    "retryAfterSeconds" in data &&
    typeof data.retryAfterSeconds === "number"
  ) {
    return data.retryAfterSeconds;
  }
  return undefined;
}
