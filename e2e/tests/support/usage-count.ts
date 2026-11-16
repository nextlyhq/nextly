/**
 * The page builder's usage index, counted whole before a spec removes a design
 * variable.
 *
 * The site style refuses a write that drops a variable while the index cannot
 * answer for every page: "Some pages haven't been counted yet, so no variable
 * can be removed." The index covers the pages that existed before it only once
 * its backfill has walked them, and the backfill runs from a scheduler's jobs
 * pass or from the count route (Design's "Count now"). The suite's server has
 * no scheduler, so a fresh database is not counted until something asks, and a
 * spec that removes a variable without asking first passes only after another
 * spec has counted: it failed when run alone, and on its first attempt in a
 * full run.
 *
 * @module e2e/tests/support/usage-count
 */
import { expect, type APIRequestContext } from "@playwright/test";

const PLUGIN = "/admin/api/plugins/@nextlyhq/plugin-page-builder";

/** The CSRF token and origin a cookie-signed write to a plugin route needs. */
export async function writeHeaders(
  api: APIRequestContext
): Promise<Record<string, string>> {
  const csrf = await api.get("/admin/api/auth/csrf");
  const { token } = (await csrf.json()) as { token: string };
  // A plugin route checks a cookie-authenticated write's origin, which a
  // browser sends and an API request does not: named here as the site's own.
  return { "x-csrf-token": token, origin: new URL(csrf.url()).origin };
}

/**
 * Count every page into the usage index, so a removal answers on whole counts:
 * "free" or "in use", never "not counted yet". A count stops at its time
 * budget, so it is asked again until the index says it is whole.
 */
export async function countEveryPage(api: APIRequestContext): Promise<void> {
  const headers = await writeHeaders(api);
  await expect
    .poll(
      async () => {
        const counted = await api.post(`${PLUGIN}/shared-styles/count`, {
          headers,
          data: {},
        });
        expect(counted.ok(), await counted.text()).toBe(true);
        const body = (await counted.json()) as { item: { whole: boolean } };
        return body.item.whole;
      },
      { timeout: 60_000 }
    )
    .toBe(true);
}
