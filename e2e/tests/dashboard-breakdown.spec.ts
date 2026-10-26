/**
 * The Breakdown card in a browser: set to a collection with a draft and
 * published lifecycle, it divides the entries by status, each bar labelled as
 * the entry form names the status and counted as the list counts it.
 *
 * Placed by the test through the layout, set to posts and to no grouping, so
 * the grouping is the one the collection gives it. Other specs add posts to the
 * shared database, so each count is read back from the list rather than
 * assumed.
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import { ok } from "./support/releases-api";
import { test } from "./support/test";

// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({ lock: [LOCK.dashboard] });

const API = "/admin/api";
const CARD = "core/breakdown";

interface Layout {
  version: number;
  scope: string;
  placements: Array<{ widgetId: string }>;
}

/** Put one Breakdown card, set to posts and nothing else, on the reader's dashboard. */
async function placeBreakdown(page: Page): Promise<void> {
  const layout = await ok<Layout>(
    await page.request.get(`${API}/dashboard/layout`)
  );
  const others = layout.placements.filter(p => p.widgetId !== CARD);
  await ok(
    await page.request.put(`${API}/dashboard/layout`, {
      data: {
        placements: [
          {
            id: "e2e-breakdown",
            widgetId: CARD,
            width: "half",
            removed: false,
            config: { collection: "posts" },
          },
          ...others,
        ],
        version: layout.version,
        scope: layout.scope,
      },
    })
  );
}

/** How many posts the list holds under `query`, as the card's reader. */
async function listed(page: Page, query: string): Promise<number> {
  const { meta } = await ok<{ meta: { total: number } }>(
    await page.request.get(`${API}/collections/posts/entries?limit=1&${query}`)
  );
  return meta.total;
}

test("the Breakdown card divides a collection with a lifecycle by status", async ({
  page,
}) => {
  const stamp = Date.now().toString(36);
  for (const status of ["published", "draft"]) {
    await ok(
      await page.request.post(`${API}/collections/posts/entries`, {
        data: {
          title: `Breakdown e2e ${status} ${stamp}`,
          slug: `breakdown-e2e-${status}-${stamp}`,
          status,
        },
      })
    );
  }
  await gotoAdmin(page, "/");
  await placeBreakdown(page);
  await gotoAdmin(page, "/");

  const card = page.getByTestId(`widget-cell-${CARD}`);
  await expect(card).toBeVisible();
  // One bar per status, named as the entry form names it, counted as the
  // list counts it: the grouping came from the collection, not the card.
  for (const [label, status] of [
    ["Published", "published"],
    ["Draft", "draft"],
  ] as const) {
    const group = card
      .getByTestId("chart-group")
      .filter({ hasText: new RegExp(`^${label}`) });
    await expect(group).toHaveCount(1);
    await expect(group).toContainText(
      String(await listed(page, `status=${status}`))
    );
  }
});
