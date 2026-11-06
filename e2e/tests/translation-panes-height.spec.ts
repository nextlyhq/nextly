/**
 * Translation mode's panes fill the entry page's content area, at every width.
 *
 * The panes' height was the window's less header heights written down by hand,
 * which is right only while every bar above `<main>` adds up to them. Measured
 * here against `<main>` itself: the panes start where it starts, end where it
 * ends, and nothing scrolls under them.
 *
 * @module tests/translation-panes-height
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { mainColumnBox, type Box } from "./support/shell-geometry";
import { test } from "./support/test";

const AUTHORS = "/admin/api/collections/authors/entries";
const MAIN = "#nextly-main-content:visible";

const WIDTHS = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

/** An author of its own, for translation mode to open. */
async function createAuthor(page: Page): Promise<string> {
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const created = await page.request.post(AUTHORS, {
    data: { title: `Translated author ${stamp}`, bio: "Written in English." },
  });
  expect(created.ok(), `creating an author: ${created.status()}`).toBe(true);
  const body = (await created.json()) as { item?: { id?: string } };
  const id = body.item?.id;
  if (typeof id !== "string") throw new Error("the new author has no id");
  return id;
}

/** Whether `<main>` scrolls: more content than the box it shows it in. */
async function mainScrolls(page: Page): Promise<boolean> {
  return page
    .locator(MAIN)
    .evaluate(element => element.scrollHeight > element.clientHeight + 1);
}

/** The two panes, together: the group the handle between them sits in. */
async function panesBox(page: Page): Promise<Box> {
  const handle = page.getByRole("separator", {
    name: "Source and translation",
  });
  await expect(handle).toBeVisible({ timeout: 30_000 });
  const box = await handle.evaluate(element => {
    const group = element.parentElement;
    if (group === null) throw new Error("the handle has no group");
    const rect = group.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  return {
    x: Math.round(box.x),
    y: Math.round(box.y),
    width: Math.round(box.width),
    height: Math.round(box.height),
  };
}

test.describe("translation mode", () => {
  for (const viewport of WIDTHS) {
    test(`fills the content area, and only it, at ${viewport.name} width`, async ({
      page,
    }) => {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      const id = await createAuthor(page);

      // Spanish, shown beside its English source.
      await gotoAdmin(
        page,
        `/collections/authors/${id}?locale=es&translate=en`
      );
      const panes = await panesBox(page);
      const main = await mainColumnBox(page);

      // The panes sit below the mode's own bar, so they END where the area
      // does rather than starting where it does.
      expect(
        Math.abs(panes.y + panes.height - (main.y + main.height)),
        "the panes end where the area does"
      ).toBeLessThanOrEqual(1);
      expect(await mainScrolls(page), "the area scrolls under the panes").toBe(
        false
      );
    });
  }
});
