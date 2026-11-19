/**
 * The REST limits the browser suite's own server runs with.
 *
 * The product's defaults, 100 reads and 30 writes a minute per address (and
 * five times that for a signed-in session), are sized for a person at the
 * admin. The suite is not one: its workers share one address and write far
 * faster, seeding pages, styles and fonts between steps, and a refused seed
 * reads as a test that hangs or fails far from its cause. So the suite's
 * server (`e2e/playwright.config.ts` sets `NEXTLY_E2E_RATE_LIMIT=1`) raises
 * both tenfold, and keeps limiting: the limiter's own paths still run.
 *
 * A plain `pnpm dev:app` keeps the defaults, and so does the production
 * suite's server (`e2e/playwright.production.config.ts`), which holds the
 * real limits on purpose. `e2e/tests/admin-request-budget.spec.ts` measures
 * the admin against the defaults themselves, not against this server's.
 *
 * @module e2e-rate-limit
 */
import type { RateLimitingConfig } from "nextly/config";

/** Ten times the product's per-address defaults, reads and writes. */
export const E2E_RATE_LIMIT: Readonly<
  Required<Pick<RateLimitingConfig, "readLimit" | "writeLimit">>
> = { readLimit: 1_000, writeLimit: 300 };

/**
 * The `rateLimit` block to spread into the playground's config: the suite's
 * limits when the switch reads "1", else nothing, so the defaults apply.
 * Compared to "1" so an empty or other value reads as off.
 *
 * @param flag - `NEXTLY_E2E_RATE_LIMIT` as the environment holds it
 */
export function e2eRateLimit(flag: string | undefined): {
  rateLimit?: RateLimitingConfig;
} {
  return flag === "1" ? { rateLimit: { ...E2E_RATE_LIMIT } } : {};
}
