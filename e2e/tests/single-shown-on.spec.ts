/**
 * A Single's side panel says where the builder shows its values, as an
 * author meets it.
 *
 * A heading on a page is bound to the Homepage Single's Title through the
 * inspector's picker and saved. The Homepage's panel then lists "<page>,
 * Heading" under "Shown on (from the builder)", says that only builder pages
 * are listed, and the row opens the page's builder with that heading
 * selected.
 *
 * The save starts the bindings sweep that keeps the index; the panel asks
 * again each time the Single opens, so the spec opens it until the row is
 * there.
 *
 * @module tests/single-shown-on.spec
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import {
  block,
  clickBlock,
  pressSave,
  selection,
} from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

const PAGES = "/admin/api/collections/pages/entries";
const HOMEPAGE_API = "/admin/api/singles/homepage";
const HEADING = "00000000-0000-4000-8000-0000001000f1";

/** A published page holding one unbound heading. */
async function seed(api: APIRequestContext, title: string): Promise<string> {
  const response = await api.post(PAGES, {
    data: {
      title,
      slug: `shown-on-${Date.now().toString(36)}`,
      status: "published",
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: HEADING,
            type: "core/heading",
            version: 1,
            props: { text: "Its own heading", level: "h1" },
          },
        ],
      },
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as { item: { id: string } }).item.id;
}

/** The Homepage's "Shown on (from the builder)" section. */
function shownOn(page: Page) {
  return page.getByRole("region", { name: "Shown on (from the builder)" });
}

test.describe("where the builder shows a Single's values", () => {
  test.describe.configure({ timeout: 240_000 });

  test("lists a page whose heading shows the Homepage, and opens the builder at that heading", async ({
    page,
  }) => {
    await gotoAdmin(page, "/");
    const mark = Date.now().toString(36);
    // The Homepage's title, so the picker's option is this run's.
    const titled = await page.request.patch(HOMEPAGE_API, {
      data: { title: `Welcome ${mark}`, _overwrite: true },
    });
    expect(titled.ok(), await titled.text()).toBe(true);
    const title = `Home ${mark}`;
    const id = await seed(page.request, title);

    // Bind the heading's Text to the Homepage's Title, and save.
    await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
    await expect(await block(page, HEADING)).toBeVisible({ timeout: 60_000 });
    await clickBlock(page, HEADING);
    await page.getByRole("button", { name: "Bind Text to a field" }).click();
    const picker = page.getByRole("listbox", { name: "Fields for Text" });
    await picker
      .getByRole("group", { name: /Homepage/ })
      .getByRole("option", { name: new RegExp(`^Title Welcome ${mark}`) })
      .click();
    await expect(
      page.getByRole("button", { name: /^Text: bound to Title of Homepage/ })
    ).toBeVisible();
    await pressSave(page);
    await expect(page.getByText(/^Saved/).first()).toBeVisible({
      timeout: 30_000,
    });

    // The Homepage, opened as a form, lists the page and its heading.
    const row = shownOn(page).getByRole("link", {
      name: `${title}, Heading`,
    });
    await expect
      .poll(
        async () => {
          await gotoAdmin(page, "/singles/homepage");
          await expect(shownOn(page)).toBeVisible({ timeout: 30_000 });
          await expect(
            shownOn(page).getByText(/Only pages made with the builder/)
          ).toBeVisible();
          return row.count();
        },
        { timeout: 120_000, intervals: [2_000, 5_000] }
      )
      .toBe(1);
    await expect(
      shownOn(page).getByText(
        "Only pages made with the builder are listed. Code that reads this Single directly isn't."
      )
    ).toBeVisible();

    // Following it opens the page's builder with that heading selected.
    await row.click();
    await expect(page).toHaveURL(
      new RegExp(`/collections/pages/${id}/builder\\?.*block=${HEADING}`)
    );
    await expect(await block(page, HEADING)).toBeVisible({ timeout: 60_000 });
    await expect
      .poll(() => selection(page), { timeout: 30_000 })
      .toEqual([HEADING]);
  });
});
