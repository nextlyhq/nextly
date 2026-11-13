/**
 * When the admin sends a failed read again on its own.
 *
 * A read is sent again only when another try could answer differently. A
 * refusal (signed out, not allowed, not found, invalid) answers the same the
 * second time, so sending it again costs a round trip and a second wait
 * before the screen can show the refusal.
 */
import { QUERY_RETRY_COUNT } from "@admin/constants/query";

import { isApiError } from "./parseApiError";

/**
 * The client-error statuses that say the same request may succeed later: the
 * server timed out waiting for it, or asked for it to be sent less often.
 */
const RETRYABLE_CLIENT_STATUSES: ReadonlySet<number> = new Set([408, 429]);

/**
 * TanStack Query's `retry` for queries: `failureCount` failures so far, and
 * the latest `error`.
 *
 * - **Not retried:** an answer with a 4xx status, other than 408 and 429.
 * - **Retried, up to {@link QUERY_RETRY_COUNT} times:** 408, 429, a 5xx, and
 *   anything that is not the admin's API error: a network failure with no
 *   response (`fetch` rejects with a `TypeError`), or a failure the query
 *   function raised itself. A read changes nothing, so sending it again is
 *   safe, unlike a write (`shouldRetryMutation`).
 */
export function shouldRetryQuery(
  failureCount: number,
  error: unknown
): boolean {
  if (failureCount >= QUERY_RETRY_COUNT) return false;
  if (!isApiError(error)) return true;
  const { status } = error;
  if (status >= 400 && status < 500) {
    return RETRYABLE_CLIENT_STATUSES.has(status);
  }
  return true;
}
