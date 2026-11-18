/**
 * The data picker inside a collection list, nearest first, with live values.
 *
 * Clicking the list's SECOND row selects its heading; the picker then lists
 * the list's item first ("Each blog post in the list") with that entry's
 * values, not the first entry's, then this page, with the Singles and the
 * site folded into one row each until the author opens one.
 *
 * @module tests/builder-data-picker-nearest.spec
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { block, canvasRoot } from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

const PAGES = "/admin/api/collections/pages/entries";
const ENTRIES = "/admin/api/collections/bound-entries/entries";

const LIST = "00000000-0000-4000-8000-0000002008d1";
const ITEM = "00000000-0000-4000-8000-0000002008d2";

async function created(
  api: APIRequestContext,
  endpoint: string,
  data: Record<string, unknown>
): Promise<string> {
  const response = await api.post(endpoint, { data });
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as { item: { id: string } }).item.id;
}

/** Three published entries of this run, and a page listing them. */
async function seed(
  api: APIRequestContext,
  mark: string
): Promise<{ id: string; titles: string[] }> {
  const titles = ["Alder", "Birch", "Cedar"].map(name => `${mark} ${name}`);
  for (const title of titles) {
    await created(api, ENTRIES, { title, status: "published" });
  }
  const id = await created(api, PAGES, {
    title: `${mark} nearest page`,
    slug: `data-picker-nearest-${mark.toLowerCase()}`,
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
            // Sorted, so the second row is the second title.
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

/** The headings the list draws, row by row. */
async function rows(page: Page): Promise<number> {
  const root = await canvasRoot(page);
  return root.locator(`[data-nx-node="${LIST}"] h3`).count();
}

/**
 * Select the item heading in row `index`, clicked at its right edge, which
 * the block toolbar never covers.
 */
async function selectRow(page: Page, index: number): Promise<void> {
  const heading = (await block(page, ITEM)).nth(index);
  await expect(heading).toBeVisible({ timeout: 60_000 });
  const box = await heading.boundingBox();
  if (box === null) throw new Error("[e2e] the item heading drew no box");
  await page.mouse.click(box.x + box.width - 8, box.y + box.height / 2);
}

test.describe("the data picker inside a collection list", () => {
  test.describe.configure({ timeout: 240_000 });

  test("shows the clicked entry's values first, with Singles and Site folded", async ({
    page,
  }) => {
    await gotoAdmin(page, "/");
    const mark = `N${Date.now().toString(36)}`;
    const { id, titles } = await seed(page.request, mark);
    await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
    await expect.poll(() => rows(page), { timeout: 60_000 }).toBe(3);

    // The second row's heading, clicked on the canvas.
    await selectRow(page, 1);
    await page.getByRole("button", { name: "Bind Text to a field" }).click();
    const picker = page.getByRole("listbox", { name: "Fields for Text" });
    await expect(picker).toBeVisible();

    const groups = picker.getByRole("group");
    await expect(groups.first()).toHaveAttribute(
      "aria-label",
      "Each blog post in the list"
    );
    await expect(groups.nth(1)).toHaveAttribute("aria-label", /^This /);
    // The item's Title is the SECOND entry's, the one clicked.
    const title = picker
      .getByRole("group", { name: "Each blog post in the list" })
      .getByRole("option", { name: /^Title/ });
    await expect(title).toContainText(titles[1] ?? "", { timeout: 30_000 });
    await expect(title).not.toContainText(titles[0] ?? "");

    // Singles and the site are folded into one row each, opened in place.
    const folded = picker.getByRole("group", { name: /Site$/ }).last();
    const site = folded.getByRole("option", { name: "Site settings" });
    await expect(site).toHaveAttribute("aria-expanded", "false");
    await site.click();
    await expect(
      picker
        .getByRole("group", { name: "Site", exact: true })
        .getByRole("option")
        .first()
    ).toBeVisible();

    // The first row, clicked, gives the first entry's values.
    await page.keyboard.press("Escape");
    await selectRow(page, 0);
    await page.getByRole("button", { name: "Bind Text to a field" }).click();
    await expect(
      page
        .getByRole("listbox", { name: "Fields for Text" })
        .getByRole("group", { name: "Each blog post in the list" })
        .getByRole("option", { name: /^Title/ })
    ).toContainText(titles[0] ?? "", { timeout: 30_000 });
  });
});
