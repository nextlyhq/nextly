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
 *
 * Under Number of items the selected list says how many entries match and
 * how many show, taken from the canvas's own read of the list: the editor
 * makes no read of its own for it, and the published page shows none. A
 * second case presses a fallen-back sort's "Choose a field" from the
 * keyboard.
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

/** Every read the editor makes through the list entries route, in order. */
function listReads(page: Page): Record<string, unknown>[] {
  const reads: Record<string, unknown>[] = [];
  page.on("request", request => {
    if (!request.url().includes("/list-entries")) return;
    const body = request.postDataJSON() as {
      query?: Record<string, unknown>;
    } | null;
    if (body?.query !== undefined) reads.push(body.query);
  });
  return reads;
}

/** A read made only to count: one row of ids, which the canvas never makes. */
function countOnly(query: Record<string, unknown>): boolean {
  return query.limit === 1 && JSON.stringify(query.select) === '["id"]';
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

  const reads = listReads(page);
  await gotoAdmin(page, `/collections/pages/${pageId}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
  await expect
    .poll(() => canvasTitles(page), { timeout: 30_000 })
    .not.toEqual([]);
  await openLayers(page);
  await layerRow(page, LIST).click();
  const inspector = page.locator(".nx-inspector");
  await expect(
    inspector.getByRole("button", { name: "Source Blog posts" })
  ).toBeVisible();
  await expect(
    inspector.getByText(/match(es)?, so \d+ shows?\./)
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
  // Three published entries carry the mark; two show.
  await expect(
    inspector.getByText("3 entries match, so 2 show.", { exact: true })
  ).toBeVisible();
  // The count is the total of the canvas's own read of the list, so the
  // editor reads nothing to count: every read is the list's.
  expect(reads.filter(countOnly)).toEqual([]);
  expect(reads).toContainEqual({
    collection: "bound-entries",
    limit: 2,
    filters: [{ field: "title", op: "contains", value: mark }],
    sort: "-price",
  });

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
    // An author's note, and the editor's count, never reach a visitor.
    await expect(shown.locator("[data-nx-list-diagnostic]")).toHaveCount(0);
    await expect(shown.getByText(/match(es)?, so \d+ shows?/)).toHaveCount(0);
    await expect(shown.locator("[data-nx-list-shows]")).toHaveCount(0);
  } finally {
    await visitor.close();
  }
});

test("a fallen-back sort's Choose a field takes the author to the sort, from the keyboard", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await gotoAdmin(page, "/");
  const document = pageDocument();
  const [first] = document.nodes as { props: Record<string, unknown> }[];
  if (first !== undefined) first.props = { ...first.props, sort: "-title" };
  const pageId = await created(page.request, PAGES, {
    title: `Sort fallback ${Date.now().toString(36)}`,
    slug: `sort-fallback-${Date.now().toString(36)}`,
    status: "draft",
    content: document,
  });
  // A sort the reader refuses arises only once a field is removed from the
  // schema or hidden from visitors after the list was saved, which a test
  // cannot do to a running site: the reader's refusal is stood in for, and
  // the read in id order that follows it goes through.
  await page.route("**/list-entries", async route => {
    try {
      const body = route.request().postDataJSON() as {
        query?: { sort?: unknown };
      } | null;
      const sort = body?.query?.sort;
      if (typeof sort === "string" && sort !== "") {
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: "VALIDATION_ERROR",
              message: "Validation failed.",
              requestId: "stand-in",
              data: {
                errors: [
                  {
                    path: "sort.title",
                    code: "FIELD_NOT_SORTABLE",
                    message: "Not sortable.",
                  },
                ],
              },
            },
          }),
        });
        return;
      }
      await route.continue();
    } catch {
      await route.continue().catch(() => undefined);
    }
  });
  await gotoAdmin(page, `/collections/pages/${pageId}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
  const canvas = await canvasRoot(page);
  const note = canvas.locator('[data-nx-list-diagnostic="sort-fallback"]');
  await expect(note).toBeVisible({ timeout: 30_000 });
  // One action, a button in the note, reached and pressed from the keyboard.
  const choose = note.getByRole("button", { name: "Choose a field" });
  await expect(note.getByRole("button")).toHaveCount(1);
  await choose.focus();
  await choose.press("Enter");
  const inspector = page.locator(".nx-inspector");
  await expect(
    inspector.getByRole("button", { name: /^Sort 1 of 1, by/ })
  ).toBeFocused();
  await page.unroute("**/list-entries");
});
