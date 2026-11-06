/**
 * A page far taller than the screen, in the editor.
 *
 * The canvas is the author's window onto the page: it fills the room the
 * editor gives it, at any zoom, and the page scrolls inside it as it does in a
 * visitor's browser. Choosing a block in Layers brings that block into view.
 * Until this held, the frame stood at a fixed device height and the rest of a
 * long page could not be reached.
 *
 * @module tests/builder-canvas-tall-page.spec
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { canvasBlock, canvasFrame, frameAndRoom } from "./support/canvas-frame";
import { test } from "./support/test";

const PAGES = "/admin/api/collections/pages/entries";

/** Thirty tall sections of text: a page several screens long. */
const SECTIONS = Array.from({ length: 30 }, (_, index) => ({
  id: `section-${String(index)}`,
  type: "core/text",
  version: 1,
  props: { text: `Section number ${String(index)}` },
  styles: {
    base: {
      base: { padding: { blockStart: "96px", blockEnd: "96px" } },
    },
  },
}));

const LAST = "section-29";

async function seedTallPage(page: Page): Promise<string> {
  const run = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const created = await page.request.post(PAGES, {
    data: {
      title: "A tall page",
      slug: `tall-page-${run}`,
      content: { formatVersion: 1, kind: "page", nodes: SECTIONS },
    },
  });
  expect(created.ok(), `seeding the page: ${created.status()}`).toBe(true);
  return ((await created.json()) as { item: { id: string } }).item.id;
}

async function openBuilder(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  const id = await seedTallPage(page);
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(canvasBlock(page, "section-0")).toBeVisible({ timeout: 30_000 });
}

async function boxOf(locator: Locator): Promise<{
  x: number;
  y: number;
  width: number;
  height: number;
}> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("[e2e] nothing drawn to measure");
  return box;
}

/** How far the page inside the frame is scrolled. */
function scrolledBy(page: Page): Promise<number> {
  return canvasFrame(page)
    .locator(".nx-canvas")
    .evaluate(
      element => element.ownerDocument.scrollingElement?.scrollTop ?? -1
    );
}

test.describe("a page taller than the screen", () => {
  test.describe.configure({ timeout: 180_000 });

  test("the canvas fills the room the editor gives it, at every zoom", async ({
    page,
  }) => {
    await openBuilder(page);
    for (const zoom of ["Fit", "50%", "100%"]) {
      if (zoom !== "Fit") {
        await page.getByRole("button", { name: /^Canvas zoom:/ }).click();
        await page
          .getByRole("menuitemradio", { name: zoom, exact: true })
          .click();
      }
      // Painted exactly as tall as the room, to the pixel.
      await expect
        .poll(
          async () => {
            const { painted, room } = await frameAndRoom(page);
            return Math.abs(painted - room);
          },
          { message: `${zoom}: the frame against the room's height` }
        )
        .toBeLessThanOrEqual(1);
    }
  });

  test("the wheel scrolls the page inside the canvas", async ({ page }) => {
    await openBuilder(page);
    const frame = await boxOf(page.locator("[data-nx-canvas-frame-box]"));
    await page.mouse.move(
      frame.x + frame.width / 2,
      frame.y + frame.height / 2
    );
    await page.mouse.wheel(0, 1600);
    await expect.poll(() => scrolledBy(page)).toBeGreaterThan(0);
  });

  test("choosing the last block in Layers brings it into view", async ({
    page,
  }) => {
    await openBuilder(page);
    const layers = page.getByRole("button", { name: "Layers", exact: true });
    if ((await layers.getAttribute("aria-pressed")) !== "true") {
      await layers.click();
    }
    const tree = page.getByRole("tree", { name: "Layers" });
    await tree.locator(`[data-nx-layer="${LAST}"]`).click();
    await expect(canvasBlock(page, LAST)).toHaveAttribute(
      "data-nx-selected",
      "primary"
    );
    const frame = await boxOf(page.locator("[data-nx-canvas-frame-box]"));
    await expect
      .poll(async () => {
        const block = await boxOf(canvasBlock(page, LAST));
        return (
          block.y >= frame.y - 1 &&
          block.y + block.height <= frame.y + frame.height + 1
        );
      })
      .toBe(true);
  });
});
