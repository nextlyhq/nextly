/**
 * How much of a signed-in session's REST budget the admin's busiest pages
 * spend on one load.
 *
 * The REST limit counts a session against a budget of its own: by default
 * five times the per-address budgets (`SESSION_BUDGET_MULTIPLE` times
 * `RATE_LIMIT_DEFAULTS`, 100 reads and 30 writes a minute), so 500 reads and
 * 150 writes. The playground configures no limits, so it runs on these.
 * Each page here must spend no more than a tenth of that on a load, so a
 * person working quickly across pages never meets the limit. A page that
 * spends more means the session budget's default is too small, and that
 * default changes, not this bar. Every measured request must also have been
 * admitted: a limit that refused the page's data would load fewer requests and
 * pass the count while the page broke.
 *
 * Each load's counts are printed and attached to the report, so the measured
 * numbers can be recorded.
 */
import { expect, test, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";

/** A tenth of a window's session budget, at the default limits. */
const PAGE_BUDGET = { reads: 500 / 10, writes: 150 / 10 };

/** How long the admin must make no request before a load counts as done. */
const QUIET_MS = 1_500;
/** The longest a load is watched. */
const WATCH_MS = 20_000;

const PAGES = [
  { path: "", name: "Dashboard" },
  { path: "/collections/posts", name: "Posts list" },
  { path: "/collections/posts/create", name: "New post" },
  { path: "/collections/pages/create", name: "New page (builder)" },
  { path: "/singles/homepage", name: "Homepage single" },
  { path: "/media", name: "Media" },
  { path: "/users", name: "Users" },
  { path: "/security/roles", name: "Roles" },
  { path: "/settings", name: "Settings" },
];

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Count the admin API requests a page makes until it falls quiet. */
async function measureLoad(
  page: Page,
  path: string
): Promise<{ reads: number; writes: number; refused: string[] }> {
  const counts = { reads: 0, writes: 0, refused: [] as string[] };
  let last = Date.now();
  page.on("request", request => {
    if (!new URL(request.url()).pathname.startsWith("/admin/api/")) return;
    if (READ_METHODS.has(request.method())) counts.reads++;
    else counts.writes++;
    last = Date.now();
  });
  page.on("response", response => {
    const { pathname } = new URL(response.url());
    if (pathname.startsWith("/admin/api/") && response.status() === 429) {
      counts.refused.push(`${response.request().method()} ${pathname}`);
    }
  });

  const started = Date.now();
  await gotoAdmin(page, path);
  // Lazy panels fetch after the first paint, so the load is over only once
  // the admin has made no request for a while.
  while (Date.now() - last < QUIET_MS && Date.now() - started < WATCH_MS) {
    await page.waitForTimeout(250);
  }
  return counts;
}

for (const screen of PAGES) {
  test(`${screen.name} spends at most a tenth of a session's REST budget`, async ({
    page,
  }, testInfo) => {
    const counts = await measureLoad(page, screen.path);
    const line = `${screen.name} (/admin${screen.path}): ${counts.reads} reads, ${counts.writes} writes`;
    console.log(`[admin-request-budget] ${line}`);
    testInfo.annotations.push({
      type: "admin-api-requests",
      description: line,
    });

    expect(counts.refused, "admin API requests the limit refused").toEqual([]);
    expect(counts.reads, "admin API reads on one load").toBeLessThanOrEqual(
      PAGE_BUDGET.reads
    );
    expect(counts.writes, "admin API writes on one load").toBeLessThanOrEqual(
      PAGE_BUDGET.writes
    );
  });
}
