/**
 * Binding a prop from the inspector, and unbinding it, as an author does.
 *
 * 1. A heading's Text is bound to the page's own title through the picker:
 *    the chip names the field, and the canvas draws the title.
 * 2. A heading bound to the page's title is unbound: the text a visitor saw
 *    is kept in the prop, said in a note, and is what the page holds once
 *    saved and opened again.
 *
 * @module tests/builder-binding-controls.spec
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import {
  block,
  canvasRoot,
  clickBlock,
  pressSave,
} from "./canvas/editor-driver";
import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

const PAGES = "/admin/api/collections/pages/entries";
const HEADING = "00000000-0000-4000-8000-0000001000c1";

/** A published page holding one heading, bound to its title when asked. */
async function seed(
  api: APIRequestContext,
  title: string,
  bound: boolean
): Promise<string> {
  const response = await api.post(PAGES, {
    data: {
      title,
      slug: `binding-controls-${Date.now().toString(36)}`,
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
            ...(bound ? { bindings: { text: { $bind: "title" } } } : {}),
          },
        ],
      },
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as { item: { id: string } }).item.id;
}

async function openHeading(page: Page, id: string): Promise<void> {
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(await block(page, HEADING)).toBeVisible({ timeout: 60_000 });
  await clickBlock(page, HEADING);
}

/** The heading as the canvas draws it. */
async function drawnHeading(page: Page): Promise<string> {
  const root = await canvasRoot(page);
  return (
    (await root.locator(`[data-nx-node="${HEADING}"]`).textContent()) ?? ""
  );
}

test.describe("binding a prop from the inspector", () => {
  test.describe.configure({ timeout: 240_000 });

  test("binds a heading's text to the page's title", async ({ page }) => {
    await gotoAdmin(page, "/");
    const title = `Spring sale ${Date.now().toString(36)}`;
    const id = await seed(page.request, title, false);
    await openHeading(page, id);

    await page.getByRole("button", { name: "Bind Text to a field" }).click();
    // Focus moves into the picker, and its fields are grouped by source.
    const picker = page.getByRole("listbox", { name: "Fields for Text" });
    await expect(picker).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "Find a field" })
    ).toBeFocused();
    await expect(picker.getByRole("group", { name: /^This / })).toBeVisible();
    await picker
      .getByRole("option", { name: new RegExp(`^Title ${title}`) })
      .click();

    await expect(
      page.getByRole("button", { name: /^Text: bound to Title of this / })
    ).toBeVisible();
    await expect
      .poll(() => drawnHeading(page), { timeout: 30_000 })
      .toBe(title);
  });

  test("unbinds, keeping the text visitors saw through a save", async ({
    page,
  }) => {
    await gotoAdmin(page, "/");
    const title = `Autumn sale ${Date.now().toString(36)}`;
    const id = await seed(page.request, title, true);
    await openHeading(page, id);

    const chip = page.getByRole("button", { name: /^Text: bound to Title/ });
    await chip.click();
    await page.getByRole("menuitem", { name: "Unbind, keep the text" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Unbound." })
    ).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole("textbox", { name: "Text" })).toHaveValue(
      title
    );

    // The save's own write, answered, before the page is opened again.
    const saved = page.waitForResponse(
      response =>
        response.url().includes("/collections/pages/entries") &&
        ["PATCH", "PUT", "POST"].includes(response.request().method()) &&
        response.ok()
    );
    await pressSave(page);
    await saved;
    await openHeading(page, id);
    await expect(page.getByRole("textbox", { name: "Text" })).toHaveValue(
      title
    );
    await expect(
      page.getByRole("button", { name: /^Text: bound to/ })
    ).toHaveCount(0);
  });
});
