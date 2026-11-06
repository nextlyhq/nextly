/**
 * One load of the dashboard asks for each thing it reads once.
 *
 * A read asked twice costs every reader a request on every load, and spends the
 * session's REST read budget twice as fast: the card-tier spec, which loads the
 * dashboard a few dozen times in a minute, ran out of it. Three reads were asked
 * twice, each for its own reason: the collections under two query keys (the
 * Create card's and the navigation's), the permission list by every caller that
 * mounted after the first answer, and the layout by the Get started card, which
 * asked again as it mounted after the grid's read had answered.
 */
import { expect } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import { test } from "./support/test";

// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({ lock: [LOCK.dashboard] });

test("one dashboard load asks for each thing it reads once", async ({
  page,
}) => {
  const reads: string[] = [];
  page.on("request", request => {
    const url = new URL(request.url());
    // GETs by path AND query: the same path asked with other parameters is a
    // different question, not a second asking of this one.
    if (request.method() === "GET" && url.pathname.startsWith("/admin/api/")) {
      reads.push(`${url.pathname}${url.search}`);
    }
  });

  await gotoAdmin(page, "/");
  await page.getByTestId("dashboard-container").waitFor();
  // Every card has mounted and asked once the network is quiet.
  await page.waitForLoadState("networkidle");

  // The control: the reads that were asked twice are asked at all, so their
  // single count is the one load asking each once, not a load that skipped them.
  const paths = reads.map(read => read.split("?")[0]);
  for (const path of [
    "/admin/api/collections",
    "/admin/api/me/permissions",
    "/admin/api/dashboard/layout",
  ]) {
    expect(paths, path).toContain(path);
  }

  const asked = new Map<string, number>();
  for (const read of reads) asked.set(read, (asked.get(read) ?? 0) + 1);
  const twice = [...asked].filter(([, count]) => count > 1);
  expect(twice, `asked more than once: ${JSON.stringify(twice)}`).toEqual([]);
});
