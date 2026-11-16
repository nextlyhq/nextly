/**
 * A plugin's document view fills the entry page's content area, at every
 * width.
 *
 * The view's frame took the window's height while the layout keeps a 56 px
 * header above `<main>` below the desktop breakpoint, so the frame was taller
 * than the area it sat in and `<main>` scrolled under it at phone and tablet
 * widths. Desktop, where that header is hidden, is the control: it measured
 * right before the fix as well.
 *
 * Measured with a probe view from the style-fixture plugin whose root only
 * fills its box, and once on the Page Builder, the document view authors use.
 *
 * @module tests/document-view-height
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import { mainColumnBox, type Box } from "./support/shell-geometry";
import { test } from "./support/test";

// The builder case below shares the homepage with other specs; see
// support/locks.ts.
test.describe.configure({ lock: [LOCK.homepage] });

const API = "/admin/api";
const MAIN = "#nextly-main-content:visible";

const WIDTHS = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

/** A draft post of its own, for the probe view to open. */
async function createPost(page: Page): Promise<string> {
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const created = await page.request.post(`${API}/collections/posts/entries`, {
    data: {
      title: `Fill probe ${stamp}`,
      slug: `fill-probe-${stamp}`,
      status: "draft",
    },
  });
  expect(created.ok(), `creating a post: ${created.status()}`).toBe(true);
  const body = (await created.json()) as { item?: { id?: string } };
  const id = body.item?.id;
  if (typeof id !== "string") throw new Error("the new post has no id");
  return id;
}

/** Whether `<main>` scrolls: more content than the box it shows it in. */
async function mainScrolls(page: Page): Promise<boolean> {
  return page
    .locator(MAIN)
    .evaluate(element => element.scrollHeight > element.clientHeight + 1);
}

async function boxOf(page: Page, testId: string): Promise<Box> {
  const box = await page.getByTestId(testId).boundingBox();
  if (box === null) throw new Error(`${testId} has no box`);
  return {
    x: Math.round(box.x),
    y: Math.round(box.y),
    width: Math.round(box.width),
    height: Math.round(box.height),
  };
}

test.describe("a plugin's document view", () => {
  for (const viewport of WIDTHS) {
    test(`fills the content area, and only it, at ${viewport.name} width`, async ({
      page,
    }) => {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      const id = await createPost(page);

      await gotoAdmin(page, `/collections/posts/${id}/fill-probe`);
      await expect(page.getByTestId("fill-probe")).toBeVisible();

      const main = await mainColumnBox(page);
      const probe = await boxOf(page, "fill-probe");
      expect(
        Math.abs(probe.y - main.y),
        "the view starts where the area does"
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(probe.height - main.height),
        "the view is as tall as the area"
      ).toBeLessThanOrEqual(1);
      expect(await mainScrolls(page), "the area scrolls under the view").toBe(
        false
      );
    });
  }
});

test.describe("the Page Builder's screen", () => {
  test("fits the content area at phone width", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    await gotoAdmin(page, "/singles/homepage/builder?field=layout");
    await expect(page.locator(".nx-builder-chrome").first()).toBeVisible({
      timeout: 30_000,
    });

    expect(await mainScrolls(page), "the area scrolls under the builder").toBe(
      false
    );
  });
});
