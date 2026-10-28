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
  await page.setViewportSize({ width: 1440, height: 700 });
  await openEntry(page);

  const bar = page.getByTestId("document-bar");
  const before = await bar.boundingBox();
  const editor = await bar.evaluate(el => {
    const box = el.parentElement!.getBoundingClientRect();
    return { left: box.left, width: box.width };
  });
  expect(before).not.toBeNull();
  // As wide as the editor it heads, panel included.
  expect(Math.abs(before!.width - editor.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(before!.x - editor.left)).toBeLessThanOrEqual(1);

  // Scroll the editor; the bar stays where it was.
  const scrolled = await page.locator("main").evaluate(el => {
    el.scrollBy(0, 400);
    return el.scrollTop;
  });
  // The control: the editor did scroll, so a bar that stayed put stuck.
  expect(scrolled).toBeGreaterThan(0);
  await expect.poll(async () => (await bar.boundingBox())?.y).toBe(before!.y);
});
