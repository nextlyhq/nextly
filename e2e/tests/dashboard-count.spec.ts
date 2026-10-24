/**
 * The Count card in a browser: set to a collection, it states how many entries
 * the collection holds and splits them into published and draft, each part a
 * link to the list that holds exactly it.
 *
 * Placed by the test through the layout, set to posts, so the spec reads the
 * card alone rather than the add panel's rows. Other specs add posts to the
 * shared database, also while this one runs, so the spec reads each number
 * back from the same list the card links to, on either side of the card's
 * render.
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

/**
 * How far the card's `name` part is from the list under `query`, read on a
 * fresh render between two reads of the list. Other specs add posts while this
 * one runs, so a count is compared only when the list held still across the
 * render; otherwise the answer is null and the caller asks again.
 */
async function offBy(
  page: Page,
  name: RegExp,
  query: string
): Promise<number | null> {
  const before = await listed(page, query);
  await page.reload();
  const part = page
    .getByTestId(`widget-cell-${CARD}`)
    .getByRole("link", { name });
  await expect(part).toBeVisible();
  const shown = Number(
    /\d+/.exec((await part.getAttribute("aria-label")) ?? "")?.[0]
  );
  const after = await listed(page, query);
  return before === after ? shown - before : null;
}

test("the Count card states a collection's entries and links each part to its list", async ({
  page,
}) => {
  test.setTimeout(120_000);
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
  // The number is the collection's whole list, every status. Each try renders
  // the dashboard again, so the tries get room beyond the default 5 s.
  await expect
    .poll(() => offBy(page, /^Entries in .+: \d+$/, "status=all"), {
      timeout: 30_000,
    })
    .toBe(0);
  await expect
    .poll(() => offBy(page, /^Published: \d+$/, "status=published"), {
      timeout: 30_000,
    })
    .toBe(0);

  const published = card.getByRole("link", { name: /^Published: \d+$/ });

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
