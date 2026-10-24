/**
 * The Count card in a browser: set to a collection, it states how many entries
 * the collection holds and splits them into published and draft, each part a
 * link to the list that holds exactly it.
 *
 * Placed by the test through the layout, set to posts, since the add panel's
 * Content group is not offered yet. Other specs add posts to the shared
 * database, so the spec reads each number back from the same list the card
 * links to rather than assuming one.
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import { ok } from "./support/releases-api";
import { test } from "./support/test";

// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({ lock: [LOCK.dashboard] });

const API = "/admin/api";
const CARD = "core/count";

interface Layout {
  version: number;
  scope: string;
  placements: Array<{ widgetId: string }>;
}

/** Put one Count card, set to posts, on the reader's dashboard. */
async function placeCount(page: Page): Promise<void> {
  const layout = await ok<Layout>(
    await page.request.get(`${API}/dashboard/layout`)
  );
  const others = layout.placements.filter(p => p.widgetId !== CARD);
  await ok(
    await page.request.put(`${API}/dashboard/layout`, {
      data: {
        placements: [
          {
            id: "e2e-count",
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

test("the Count card states a collection's entries and links each part to its list", async ({
  page,
}) => {
  const stamp = Date.now().toString(36);
  await ok(
    await page.request.post(`${API}/collections/posts/entries`, {
      data: {
        title: `Count e2e ${stamp}`,
        slug: `count-e2e-${stamp}`,
        status: "published",
      },
    })
  );
  await gotoAdmin(page, "/");
  await placeCount(page);
  await gotoAdmin(page, "/");

  const card = page.getByTestId(`widget-cell-${CARD}`);
  await expect(card).toBeVisible();
  const total = card.getByRole("link", { name: /^Entries: \d+$/ });
  await expect(total).toBeVisible();
  // The number is the collection's whole list, every status.
  expect(
    Number(/\d+/.exec((await total.getAttribute("aria-label")) ?? "")?.[0])
  ).toBe(await listed(page, "status=all"));

  const published = card.getByRole("link", { name: /^Published: \d+$/ });
  await expect(published).toBeVisible();
  expect(
    Number(/\d+/.exec((await published.getAttribute("aria-label")) ?? "")?.[0])
  ).toBe(await listed(page, "status=published"));

  // The published part opens the list that holds exactly it.
  await published.click();
  await expect(page).toHaveURL(/\/admin\/collections\/posts\?status=published/);
  await expect(
    page
      .getByText(`Count e2e ${stamp}`, { exact: false })
      .filter({ visible: true })
      .first()
  ).toBeVisible();
});
