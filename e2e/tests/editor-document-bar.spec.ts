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

test("draws the document's controls in the admin's one bar, which stays put as the editor scrolls", async ({
  page,
}) => {
  // Short enough that this entry's fields run past the scroll area.
  await page.setViewportSize({ width: 1440, height: 480 });
  await openEntry(page);

  const bar = page.getByTestId("document-bar");
  const main = page.locator("main");
  /** The document's controls, the admin's bar, the editor and the scroll area, as laid out. */
  const measure = () =>
    bar.evaluate(el => {
      const header = el.closest("header");
      const scroller = document.querySelector("main");
      const frame = document.querySelector("[data-document-editor-frame]");
      if (!header || !scroller || !frame) throw new Error("missing a part");
      const box = el.getBoundingClientRect();
      const top = header.getBoundingClientRect();
      return {
        bar: { top: box.top, bottom: box.bottom, right: box.right },
        header: { top: top.top, bottom: top.bottom, height: top.height },
        editorTop: frame.getBoundingClientRect().top,
        scrollTop: scroller.getBoundingClientRect().top,
      };
    });

  // One bar: the document draws its controls inside the admin's bar, 56px tall,
  // on its one row, and draws no bar of its own.
  await expect(page.getByTestId("document-bar")).toHaveCount(1);
  const before = await measure();
  expect(Math.round(before.header.height)).toBe(56);
  expect(before.bar.top).toBeGreaterThanOrEqual(before.header.top - 1);
  expect(before.bar.bottom).toBeLessThanOrEqual(before.header.bottom + 1);
  expect(before.bar.right).toBeLessThanOrEqual(1440 + 1);
  // The editor starts directly under the bar: no page padding between them.
  expect(Math.abs(before.editorTop - before.scrollTop)).toBeLessThanOrEqual(1);

  // The control: the fields run past the scroll area, so there is a scroll.
  const room = await main.evaluate(el => el.scrollHeight - el.clientHeight);
  expect(room).toBeGreaterThan(0);

  // Scroll the editor; the editor moves up and the bar stays where it was.
  const scrolled = await main.evaluate(el => {
    el.scrollBy(0, 400);
    return el.scrollTop;
  });
  expect(scrolled).toBeGreaterThan(0);
  await expect
    .poll(async () => (await measure()).editorTop)
    .toBeLessThan(before.editorTop);
  const after = await measure();
  expect(Math.abs(after.bar.top - before.bar.top)).toBeLessThanOrEqual(1);
});
