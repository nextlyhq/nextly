/**
 * A collection list's query, built in the real editor and read on the
 * published page by a visitor.
 *
 * The list is over `bound-entries`, which the public reads and whose
 * `internalNote` it may not. In the Content tab the author adds a filter
 * (Title contains this run's mark), a sort (Price, highest first) and a
 * number of items (2), each through its control. Then:
 *
 * 1. The field menu offers only fields visitors can see, and says so.
 * 2. The canvas draws the entries a visitor would see, in that order.
 * 3. "Canvas shows: When empty" draws the list's empty state, tagged.
 * 4. The saved list stores the shape the engine reads.
 * 5. Published, the page lists exactly those entries to a visitor who is
 *    not signed in: a draft entry never, and the sort and the limit hold.
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import {
  canvasRoot,
  layerRow,
  openLayers,
  pressSave,
} from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { storedPageNodes } from "./support/stored-page";
import { test } from "./support/test";

const PAGES = "/admin/api/collections/pages/entries";
const ENTRIES = "/admin/api/collections/bound-entries/entries";

/** The list's id, and its template's heading bound to each entry's title. */
const LIST = "00000000-0000-4000-8000-0000000995a1";
const TITLE = "00000000-0000-4000-8000-0000000995a2";
const NONE = "00000000-0000-4000-8000-0000000995a3";

async function created(
  api: APIRequestContext,
  endpoint: string,
  data: Record<string, unknown>
): Promise<string> {
  const response = await api.post(endpoint, { data });
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as { item: { id: string } }).item.id;
}

/** The page: one list over bound entries, as a new list is placed. */
function pageDocument(): Record<string, unknown> {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: LIST,
        type: "core/collection-loop",
        version: 1,
        props: { collection: "bound-entries", limit: 10 },
        slots: {
          children: [
            {
              id: TITLE,
              type: "core/heading",
              version: 1,
              props: { text: "Entry", level: "h3" },
              bindings: { text: { $bind: "title", source: "item" } },
            },
          ],
          empty: [
            {
              id: NONE,
              type: "core/heading",
              version: 1,
              props: { text: "Nothing yet", level: "h3" },
            },
          ],
        },
      },
    ],
  };
}

/** The list's stored props, as the editor saved them. */
async function storedList(
  api: APIRequestContext,
  id: string
): Promise<Record<string, unknown>> {
  const nodes = await storedPageNodes(api, PAGES, id);
  const list = nodes.find(node => node.id === LIST);
  return (list?.props ?? {}) as Record<string, unknown>;
}

/** The entries' titles the canvas draws, in order. */
async function canvasTitles(page: Page): Promise<string[]> {
  const list = (await canvasRoot(page)).locator(`[data-nx-node="${LIST}"]`);
  return list.locator("h3").allTextContents();
}

test("builds a filtered, sorted list in the editor and shows it to a visitor", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(240_000);
  await gotoAdmin(page, "/");
  const api = page.request;
  const mark = `Q${Date.now().toString(36)}`;
  // Four of this run's entries, one a draft; the rest of the run's rows do
  // not carry its mark, so the filter is what keeps them out.
  for (const [title, price, status] of [
    [`${mark} Alder`, 10, "published"],
    [`${mark} Birch`, 30, "published"],
    [`${mark} Cedar`, 20, "published"],
    [`${mark} Draft`, 50, "draft"],
  ] as const) {
    await created(api, ENTRIES, { title, price, status });
  }
  const slug = `list-query-${mark.toLowerCase()}`;
  const pageId = await created(api, PAGES, {
    title: `List query ${mark}`,
    slug,
    status: "draft",
    content: pageDocument(),
  });

  await gotoAdmin(page, `/collections/pages/${pageId}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
  await openLayers(page);
  await layerRow(page, LIST).click();
  const inspector = page.locator(".nx-inspector");
  await expect(
    inspector.getByRole("button", { name: "Source Bound entries" })
  ).toBeVisible();

  // 1. A filter: only the fields visitors can see are offered.
  await inspector.getByRole("button", { name: "Add filter" }).click();
  const fields = page.getByRole("listbox", { name: "Fields to filter by" });
  await expect(fields).toBeVisible();
  await expect(fields.getByRole("option", { name: /^Title/ })).toBeVisible();
  await expect(
    fields.getByRole("option", { name: /Internal note/ })
  ).toHaveCount(0);
  await expect(
    page.getByText("Only fields visitors can see are listed.")
  ).toBeVisible();
  await fields.getByRole("option", { name: /^Title/ }).click();
  await inspector
    .getByRole("combobox", { name: "How Title is compared" })
    .click();
  await page.getByRole("option", { name: "contains", exact: true }).click();
  const value = inspector.getByRole("textbox", {
    name: /^Filter Title contains/,
  });
  await value.fill(mark);
  await value.press("Enter");

  // 2. A sort, highest price first, and two items.
  await inspector.getByRole("button", { name: "Add sort" }).click();
  await page
    .getByRole("listbox", { name: "Fields to sort by" })
    .getByRole("option", { name: /^Price/ })
    .click();
  const order = inspector.getByRole("combobox", { name: "Order of Price" });
  await expect(order).toHaveText("Lowest first");
  await order.click();
  await page.getByRole("option", { name: "Highest first" }).click();
  const items = inspector.getByLabel("Number of items", { exact: true });
  await items.fill("2");
  await items.press("Enter");

  // The canvas draws what a visitor would see: this run's two dearest.
  await expect
    .poll(() => canvasTitles(page), { timeout: 30_000 })
    .toEqual([`${mark} Birch`, `${mark} Cedar`]);

  // 3. The empty state, on request, tagged, and the entries again after.
  await inspector.getByRole("radio", { name: "When empty" }).click();
  const list = (await canvasRoot(page)).locator(`[data-nx-node="${LIST}"]`);
  await expect(list).toHaveAttribute("data-nx-list-empty-because", "chosen");
  await expect(list.locator("h3")).toHaveText(["Nothing yet"]);
  await inspector.getByRole("radio", { name: "Entries" }).click();
  await expect
    .poll(() => canvasTitles(page), { timeout: 30_000 })
    .toEqual([`${mark} Birch`, `${mark} Cedar`]);

  // 4. Saved as the engine reads it.
  await pressSave(page);
  await expect
    .poll(() => storedList(api, pageId), { timeout: 15_000 })
    .toEqual({
      collection: "bound-entries",
      limit: 2,
      filters: [{ field: "title", op: "contains", value: mark }],
      sort: "-price",
    });
  await page
    .locator('[data-topbar="end"]')
    .getByRole("button", { name: "Publish", exact: true })
    .click();
  await expect
    .poll(
      async () => {
        const read = await api.get(`${PAGES}/${pageId}?status=all`);
        const body = (await read.json()) as {
          item?: { status?: unknown };
          status?: unknown;
        };
        return body.item?.status ?? body.status;
      },
      { timeout: 15_000 }
    )
    .toBe("published");

  // 5. A visitor with no session sees the same two, in the same order.
  const baseURL = testInfo.project.use.baseURL;
  const visitor = await browser.newContext({ storageState: undefined });
  try {
    const shown = await visitor.newPage();
    const response = await shown.goto(`${baseURL ?? ""}/${slug}`);
    expect(response?.status()).toBe(200);
    await expect(shown.locator("h3")).toHaveText([
      `${mark} Birch`,
      `${mark} Cedar`,
    ]);
    // An author's note never reaches a visitor.
    await expect(shown.locator("[data-nx-list-diagnostic]")).toHaveCount(0);
    await expect(shown.locator("[data-nx-list-shows]")).toHaveCount(0);
  } finally {
    await visitor.close();
  }
});
