/**
 * Recent entries and Over time in a browser, each placed by the test through the layout, set
 * to posts.
 *
 * Recent entries: a row opens its entry, and "View all" opens the collection's list holding the
 * card's rows. Over time: its Date range, the card's one quick setting, is on the card's header
 * at each reference width, and choosing a range redraws the card over it.
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { ok } from "./support/releases-api";
import { test } from "./support/test";

const API = "/admin/api";

interface Layout {
  version: number;
  scope: string;
  placements: Array<{ widgetId: string }>;
}

/** Put one card of `widgetId`, set to posts, on the reader's dashboard, full width. */
async function place(page: Page, widgetId: string): Promise<void> {
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
            width: "full",
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

test("a Recent entries row opens its entry, and View all opens the collection's list", async ({
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
  await place(page, "core/recent-entries");
  await gotoAdmin(page, "/");

  const card = page.getByTestId("widget-cell-core/recent-entries");
  const row = card.getByRole("link", { name: title });
  await expect(row).toBeVisible();
  await row.click();
  await expect(page).toHaveURL(
    new RegExp(`/admin/collections/posts/${created.item.id}$`)
  );

  await gotoAdmin(page, "/");
  await card.getByRole("link", { name: "View all" }).click();
  await expect(page).toHaveURL(/\/admin\/collections\/posts\?sort=-updatedAt/);
  await expect(
    page.getByText(title, { exact: false }).filter({ visible: true }).first()
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
    await place(page, "core/over-time");
    await gotoAdmin(page, "/");

    const card = page.getByTestId("widget-cell-core/over-time");
    const range = card.getByRole("combobox", {
      name: /^Date range for Over time/,
    });
    await expect(range).toBeVisible();
    await expect(range).toHaveText(/Last 30 days/);

    await range.click();
    await page.getByRole("option", { name: "Last 12 months" }).click();
    // Kept for this reader, and the chart redrawn over months.
    await expect(page.getByTestId("widget-grid-live")).toHaveText(
      /Date range set to Last 12 months/
    );
    await page.reload();
    await expect(
      card.getByRole("combobox", { name: /^Date range for Over time/ })
    ).toHaveText(/Last 12 months/);
  });
}
