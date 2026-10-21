/**
 * When the admin sends a failed write again on its own.
 *
 * A write is retried only when the server said that nothing ran and to try
 * again. Anything else may have changed data already: a 500 can come after
 * the change was saved, so sending it again makes the change a second time.
 */
import { MUTATION_RETRY_COUNT } from "@admin/constants/query";

import { isApiError } from "./parseApiError";

/**
 * The codes a server uses to refuse a request before doing any of it, and to
 * say it may be sent again.
 */
const REFUSED_BEFORE_RUNNING: ReadonlySet<string> = new Set([
  "DATABASE_BUSY",
  "RATE_LIMITED",
]);

/**
 * TanStack Query's `retry` for mutations: `failureCount` failures so far, and
 * the latest `error`.
 *
 * - **Retried:** `DATABASE_BUSY`, `RATE_LIMITED`, or any error carrying
 *   `retryAfterSeconds`, up to {@link MUTATION_RETRY_COUNT} times.
 * - **Not retried:** any other error, a 500 or a 4xx, including the answer for
 *   a change that was saved before the request failed.
 * - **Not retried:** a network failure with no response. The request may have
 *   reached the server and committed before its answer was lost.
 */
export function shouldRetryMutation(
  failureCount: number,
  error: unknown
): boolean {
  if (failureCount >= MUTATION_RETRY_COUNT) return false;
  if (!isApiError(error)) return false;
  return (
    (error.code !== undefined && REFUSED_BEFORE_RUNNING.has(error.code)) ||
    typeof error.data?.retryAfterSeconds === "number"
  );
}
