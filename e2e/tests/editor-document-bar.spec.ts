/**
 * The editor's place and its document bar in a real browser, where widths and
 * stickiness are laid out rather than read from class names.
 *
 * On a phone the top bar's trail shortens to the way back to the list. On a
 * desktop the document bar spans the editor, field column and panel alike,
 * and stays at the top of the editor's scroll area as the fields scroll under
 * it.
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

/** A saved entry to open, in a collection with a list page. */
async function openEntry(page: Page): Promise<void> {
  const created = await page.request.post(
    "/admin/api/collections/block-pages/entries",
    {
      data: {
        title: "Document bar",
        slug: `document-bar-${Date.now()}`,
      },
    }
  );
  expect(created.ok()).toBe(true);
  const { item } = (await created.json()) as { item: { id: string } };
  await gotoAdmin(page, `/collections/block-pages/${item.id}`);
  await expect(
    page.getByRole("textbox", { name: "Title", exact: true })
  ).toHaveValue("Document bar", { timeout: 30_000 });
}

test("shortens the trail to the way back to the list on a phone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openEntry(page);

  const trail = page.getByRole("navigation", { name: "Breadcrumb" });
  const toList = trail.locator('a[href="/admin/collections/block-pages"]');
  await expect(toList).toBeVisible();
  // The outer step and the document's own name step aside.
  await expect(trail.getByRole("link", { name: "Content" })).toBeHidden();
  await expect(trail.getByText("Document bar")).toBeHidden();
  // One link to the list on the page, not a second back link in the editor.
  await expect(
    page.locator('main a[href="/admin/collections/block-pages"]')
  ).toHaveCount(0);
});

test("shows the whole trail on a desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEntry(page);

  const trail = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(trail.getByRole("link", { name: "Content" })).toBeVisible();
  await expect(
    trail.locator('a[href="/admin/collections/block-pages"]')
  ).toBeVisible();
  await expect(trail.getByText("Document bar")).toBeVisible();
});

test("keeps the document bar at the top of the editor, as wide as the editor", async ({
  page,
}) => {
  // Short enough that this entry's fields run past the scroll area. The editor
  // fills the scroll area exactly when its fields are shorter than it (its
  // frame's floor is the scroll area's height, and it cancels the page's
  // vertical padding), so at 700px this entry fits and nothing scrolls.
  await page.setViewportSize({ width: 1440, height: 480 });
  await openEntry(page);

  const bar = page.getByTestId("document-bar");
  const main = page.locator("main");
  /** The bar, the editor it heads and the scroll area's top, as laid out. */
  const measure = () =>
    bar.evaluate(el => {
      const frame = el.closest("[data-document-editor-frame]");
      const scroller = el.closest("main");
      if (!frame || !scroller) throw new Error("bar outside an editor");
      const box = el.getBoundingClientRect();
      const editor = frame.getBoundingClientRect();
      return {
        bar: { left: box.left, top: box.top, width: box.width },
        editor: { left: editor.left, top: editor.top, width: editor.width },
        scrollTop: scroller.getBoundingClientRect().top,
      };
    });

  const before = await measure();
  // As wide as the editor it heads, panel included: the editor's frame found
  // by its own marker, not the bar's parent, so a bar moved into the field
  // column is measured against the whole editor still.
  expect(Math.abs(before.bar.width - before.editor.width)).toBeLessThanOrEqual(
    1
  );
  expect(Math.abs(before.bar.left - before.editor.left)).toBeLessThanOrEqual(1);
  // At the top of the editor's scroll area, with no page padding above it.
  expect(Math.abs(before.bar.top - before.scrollTop)).toBeLessThanOrEqual(1);

  // The control: the fields run past the scroll area, so there is a scroll
  // for the bar to hold its place through.
  const room = await main.evaluate(el => el.scrollHeight - el.clientHeight);
  expect(room).toBeGreaterThan(0);

  // Scroll the editor; the editor moves up and the bar stays at the top.
  const scrolled = await main.evaluate(el => {
    el.scrollBy(0, 400);
    return el.scrollTop;
  });
  expect(scrolled).toBeGreaterThan(0);
  await expect
    .poll(async () => (await measure()).editor.top)
    .toBeLessThan(before.editor.top);
  const after = await measure();
  expect(Math.abs(after.bar.top - after.scrollTop)).toBeLessThanOrEqual(1);
});
