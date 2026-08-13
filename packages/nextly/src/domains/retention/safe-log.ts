/**
 * Reporting that cannot become the failure it is reporting.
 *
 * Retention passes are housekeeping offered from paths whose contract is that
 * they never fail for housekeeping reasons: a send that has already been
 * accepted by a provider must not be reported as failed because a prune query
 * timed out. Every layer therefore catches, and then LOGS.
 *
 * The logging is the hole. `logger` is supplied by the installing app —
 * `defineConfig({ logger })` — so it is arbitrary code running inside a catch
 * block. When it throws, it throws from the one place nothing is guarding,
 * because the guard is the block it is running in. The escape then travels up
 * through every careful `try` beneath it and surfaces as the exact failure the
 * whole arrangement existed to prevent.
 *
 * Nothing here decides whether to swallow an error; the callers already made
 * that decision. This only makes carrying it out incapable of failing.
 *
 * @module domains/retention/safe-log
 */

import type { Logger } from "../../shared/types";

/**
 * Report a swallowed failure, and never throw doing so.
 *
 * The empty catch is deliberate and is the whole point: there is no second
 * reporter to fall back to, since the only one available is the one that just
 * failed. A message lost here costs visibility into an already-degraded pass,
 * where the alternative costs the caller's contract.
 */
export function warnQuietly(
  logger: Logger | undefined,
  message: string,
  context?: Record<string, unknown>
): void {
  try {
    logger?.warn?.(message, context);
  } catch {
    /* a reporter that fails cannot be reported through itself */
  }
}
