/**
 * Recent entries, Over time and the Content table in a browser, each placed by the test through
 * the layout, the first two set to posts.
 *
 * Recent entries: a row opens its entry, and "View all (N)", drawn while the collection holds
 * more than the card draws, opens the collection's list holding the card's rows. Over time: its Date range, the card's one quick setting, is on the card's header
 * at each reference width, and choosing a range redraws the card over it. Content: one table of
 * the collections and Singles the reader may see, a collection's + opening a new entry and its
 * Drafts opening its list under the Draft filter they were counted by.
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { widestSizeOf } from "./support/dashboard-sizes";
import { LOCK } from "./support/locks";
import { ok } from "./support/releases-api";
import { test } from "./support/test";

// Shares state with other specs; see support/locks.ts for what each lock guards.
test.describe.configure({ lock: [LOCK.dashboard] });

const API = "/admin/api";

interface Layout {
  version: number;
  scope: string;
  placements: Array<{ widgetId: string }>;
}

/**
 * Put one card of `widgetId`, with the settings in `config`, on the reader's dashboard, as wide
 * as it may be.
 */
async function place(
  page: Page,
  widgetId: string,
  config: Record<string, unknown>
): Promise<void> {
  const layout = await ok<Layout>(
    await page.request.get(`${API}/dashboard/layout`)
  );
  const others = layout.placements.filter(p => p.widgetId !== widgetId);
  await ok(
    await page.request.put(`${API}/dashboard/layout`, {
      data: {
        placements: [
          {
            id: `e2e-${widgetId.replace("/", "-")}`,
            widgetId,
            ...(await widestSizeOf(page, widgetId)),
            removed: false,
            config,
          },
          ...others,
        ],
        version: layout.version,
        scope: layout.scope,
      },
    })
  );
}

test("a Recent entries row opens its entry, and View all (N) opens the collection's list", async ({
  page,
}) => {
  const stamp = Date.now().toString(36);
  const title = `Recent e2e ${stamp}`;
  const created = await ok<{ item: { id: string } }>(
    await page.request.post(`${API}/collections/posts/entries`, {
      data: { title, slug: `recent-e2e-${stamp}`, status: "published" },
    })
  );
  await gotoAdmin(page, "/");
  await place(page, "core/recent-entries", { collection: "posts" });
  await gotoAdmin(page, "/");

  const card = page.getByTestId("widget-cell-core/recent-entries");
  const row = card.getByRole("link", { name: title });
  await expect(row).toBeVisible();
  await row.click();
  await expect(page).toHaveURL(
    new RegExp(`/admin/collections/posts/${created.item.id}$`)
  );

  // A second entry, and a card drawing one row: the collection then holds more than the card
  // draws, which is when it offers the full list.
  await ok(
    await page.request.post(`${API}/collections/posts/entries`, {
      data: {
        title: `${title} second`,
        slug: `recent-e2e-${stamp}-2`,
        status: "published",
      },
    })
  );
  await place(page, "core/recent-entries", { collection: "posts", limit: 1 });
  await gotoAdmin(page, "/");
  await card.getByRole("link", { name: /^View all/ }).click();
  await expect(page).toHaveURL(/\/admin\/collections\/posts\?sort=-updatedAt/);
  await expect(
    page.getByText(title, { exact: false }).filter({ visible: true }).first()
  ).toBeVisible();
});

test("the Content table draws its columns, and a row's + and Drafts open the posts it counts", async ({
  page,
}) => {
  // A draft saved now: posts is then the most recently saved, so its row is drawn first, and it
  // holds at least one draft to link to.
  const stamp = Date.now().toString(36);
  await ok(
    await page.request.post(`${API}/collections/posts/entries`, {
      data: {
        title: `Content e2e ${stamp}`,
        slug: `content-e2e-${stamp}`,
        status: "draft",
      },
    })
  );
  await gotoAdmin(page, "/");
  await place(page, "core/content-table", {});
  await gotoAdmin(page, "/");

  const card = page.getByTestId("widget-cell-core/content-table");
  const table = card.getByTestId("content-table");
  // Placed at its widest, the card is large and draws its rows as a table.
  await expect(table.getByRole("columnheader")).toHaveText([
    "Name",
    "Entries",
    "Drafts",
    "Updated",
    "Actions",
  ]);
  await expect(
    table.getByRole("link", { name: "Posts", exact: true })
  ).toHaveAttribute("href", /\/admin\/collections\/posts$/);

  await table.getByRole("link", { name: "New entry in Posts" }).click();
  await expect(page).toHaveURL(/\/admin\/collections\/posts\/create$/);

  await gotoAdmin(page, "/");
  await card.getByRole("link", { name: /drafts in Posts$/ }).click();
  await expect(page).toHaveURL(/\/admin\/collections\/posts\?status=draft$/);
  // The filtered list holds the draft the card counted.
  await expect(
    page
      .getByText(`Content e2e ${stamp}`, { exact: false })
      .filter({ visible: true })
      .first()
  ).toBeVisible();
});

const WIDTHS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "820", width: 820, height: 1180 },
  { name: "phone 390", width: 390, height: 844 },
];

for (const viewport of WIDTHS) {
  test(`Over time's Date range is on its card and redraws it over the range chosen (${viewport.name})`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await gotoAdmin(page, "/");
    await place(page, "core/over-time", { collection: "posts" });
    await gotoAdmin(page, "/");

    const card = page.getByTestId("widget-cell-core/over-time");
    // Set to posts, the card is titled by its subject, "Posts", and its control is named for
    // that title; the widget's name and the range it is set to are its subtitle.
    const range = card.getByRole("combobox", { name: "Date range for Posts" });
    await expect(range).toBeVisible();
    await expect(range).toHaveText(/Last 30 days/);
    await expect(card.getByText("Over time · last 30 days")).toBeVisible();

    await range.click();
    await page.getByRole("option", { name: "Last 12 months" }).click();
    // Said once the card shows the new range, by the toast that offers its Undo, and the card
    // redrawn under it: its subtitle names the range chosen.
    await expect(
      page.getByText("Posts: Date range set to Last 12 months.")
    ).toBeVisible();
    await expect(card.getByText("Over time · last 12 months")).toBeVisible();
    // Kept for this reader: it is there after a reload.
    await page.reload();
    await expect(
      card.getByRole("combobox", { name: "Date range for Posts" })
    ).toHaveText(/Last 12 months/);
  });
}
