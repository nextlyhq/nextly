/**
 * Binding a heading inside a collection list to the list item's own field.
 *
 * The picker lists the item's fields first, named for the list's entries,
 * with the first entry's value beside each; a pick binds the item, so each
 * row of the list shows its own entry's title rather than the page's title
 * repeated. Reopened, the picker marks the item's Title as the field bound.
 *
 * @module tests/builder-list-item-binding.spec
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { block, canvasRoot } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

const PAGES = "/admin/api/collections/pages/entries";
const ENTRIES = "/admin/api/collections/bound-entries/entries";

const LIST = "00000000-0000-4000-8000-0000001000d1";
const ITEM = "00000000-0000-4000-8000-0000001000d2";

async function created(
  api: APIRequestContext,
  endpoint: string,
  data: Record<string, unknown>
): Promise<string> {
  const response = await api.post(endpoint, { data });
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as { item: { id: string } }).item.id;
}

/**
 * Three published entries of this run, and a page whose list of them holds
 * one unbound heading per entry.
 */
async function seed(
  api: APIRequestContext,
  mark: string
): Promise<{ id: string; titles: string[] }> {
  const titles = ["Alder", "Birch", "Cedar"].map(name => `${mark} ${name}`);
  for (const title of titles) {
    await created(api, ENTRIES, { title, status: "published" });
  }
  const id = await created(api, PAGES, {
    title: `${mark} list page`,
    slug: `list-item-binding-${mark.toLowerCase()}`,
    status: "published",
    content: {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: LIST,
          type: "core/collection-loop",
          version: 1,
          props: {
            collection: "bound-entries",
            limit: 10,
            // Sorted, so the first entry and the order below are the list's
            // own: unsorted entries come in id order, and an id is random.
            sort: "title",
            filters: [{ field: "title", op: "contains", value: mark }],
          },
          slots: {
            children: [
              {
                id: ITEM,
                type: "core/heading",
                version: 1,
                props: { text: "A section title", level: "h3" },
              },
            ],
          },
        },
      ],
    },
  });
  return { id, titles };
}

/** The titles the list draws, row by row. */
async function rowTitles(page: Page): Promise<string[]> {
  const root = await canvasRoot(page);
  return root.locator(`[data-nx-node="${LIST}"] h3`).allTextContents();
}

/**
 * Select the list item's heading from its first row, clicked at its right
 * edge, which the block toolbar never covers.
 */
async function selectItemHeading(page: Page): Promise<void> {
  const first = (await block(page, ITEM)).first();
  await expect(first).toBeVisible({ timeout: 60_000 });
  const box = await first.boundingBox();
  if (box === null) throw new Error("[e2e] the item heading drew no box");
  await page.mouse.click(box.x + box.width - 8, box.y + box.height / 2);
}

test.describe("binding inside a collection list", () => {
  test.describe.configure({ timeout: 240_000 });

  test("binds a heading to each entry's own title from the item's fields", async ({
    page,
  }) => {
    await gotoAdmin(page, "/");
    const mark = `L${Date.now().toString(36)}`;
    const { id, titles } = await seed(page.request, mark);
    await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
    // Before binding, every row draws the heading's own text.
    await expect
      .poll(() => rowTitles(page), { timeout: 60_000 })
      .toEqual(["A section title", "A section title", "A section title"]);

    await selectItemHeading(page);
    await page.getByRole("button", { name: "Bind Text to a field" }).click();
    const picker = page.getByRole("listbox", { name: "Fields for Text" });
    await expect(picker).toBeVisible();
    // The item's fields first, named for the list's entries, then the page's
    // own sources.
    const groups = picker.getByRole("group");
    await expect(groups.first()).toHaveAttribute(
      "aria-label",
      "Each blog post in the list"
    );
    await expect(groups.nth(1)).toHaveAttribute("aria-label", /^This /);
    // The item's Title shows the list's first entry's value.
    const item = picker.getByRole("group", {
      name: "Each blog post in the list",
    });
    const title = item.getByRole("option", { name: /^Title/ });
    await expect(title).toContainText(titles[0] ?? "", { timeout: 30_000 });
    await title.click();

    await expect(
      page.getByRole("button", {
        name: /^Text: bound to Title of each blog post/,
      })
    ).toBeVisible();
    // Each row now shows its own entry's title.
    await expect
      .poll(() => rowTitles(page), { timeout: 30_000 })
      .toEqual(titles);

    // Reopened, the picker marks the item's Title as the field bound now.
    await page
      .getByRole("button", { name: /^Text: bound to Title of each blog post/ })
      .click();
    await page.getByRole("menuitem", { name: "Change field…" }).click();
    const again = page.getByRole("listbox", { name: "Fields for Text" });
    const marked = again.locator("[data-current]");
    await expect(marked).toHaveCount(1);
    await expect(
      again
        .getByRole("group", { name: "Each blog post in the list" })
        .locator("[data-current]")
    ).toContainText("Title");
  });
});
