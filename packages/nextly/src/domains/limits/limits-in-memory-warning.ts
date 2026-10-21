/**
 * The warning a production start gives while its limits count in one
 * process's memory.
 *
 * In memory, each instance of a site counts a budget of its own, so a sign-in
 * limit of 30 an hour admits 30 an hour per instance. That is right for a site
 * that runs one instance and wrong by the instance count anywhere else, and
 * nothing at the limit can tell which, so the start says so until the site
 * either selects a shared store or says it runs one instance.
 *
 * @module domains/limits/limits-in-memory-warning
 */
import { isLimitStore } from "./limit-store";

const SETTINGS =
  'Select the shared database store (rateLimit.store: "database"), or set rateLimit.singleInstance: true if the site runs one instance.';

/** The `rateLimit` block of a sanitized config, as far as this reads it. */
function rateLimitOf(config: unknown): Record<string, unknown> | undefined {
  if (typeof config !== "object" || config === null) return undefined;
  const block = (config as Record<string, unknown>)["rateLimit"];
  return typeof block === "object" && block !== null
    ? (block as Record<string, unknown>)
    : undefined;
}

/**
 * The warning owed for this config, or null when none is.
 *
 * @param config - The sanitized config: `rateLimit.limitStore` is the
 *   selection, `rateLimit.store` an app's store of the older contract.
 * @param production - Whether the server is starting in production.
 */
export function limitsInMemoryWarning(
  config: unknown,
  production: boolean
): string | null {
  if (!production) return null;
  const rateLimit = rateLimitOf(config);
  if (rateLimit?.["singleInstance"] === true) return null;

  const selected = rateLimit?.["limitStore"];
  const shared =
    selected === "database" || (isLimitStore(selected) && selected.shared);
  if (shared) return null;

  // An app's store of the older contract serves core's own limits; the
  // plugin limiter needs the newer contract, so plugin limits stay in memory.
  if (rateLimit?.["store"] !== undefined) {
    return `[nextly] Plugin limits count in this process's memory: the app's rate limit store serves core's own limits, but plugin limits need a store of the limit store contract, so each instance counts its own plugin budgets. ${SETTINGS}`;
  }
  return `[nextly] Rate limits count in this process's memory, so each instance counts its own budget: sign-in, API and plugin limits each admit their number per instance. ${SETTINGS}`;
}
