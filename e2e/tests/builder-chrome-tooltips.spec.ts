/**
 * No editor tooltip is left open over the canvas.
 *
 * The canvas is an iframe: once the pointer is inside it, the editor's own
 * document sees no further move, and a tooltip waiting to learn where the
 * pointer went stayed open over the page being edited. Swept here the way a
 * pointer really travels, from the top bar and from the rail down and across
 * into the canvas.
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import { test } from "./support/test";

// The editor opens on the homepage Single, which other files edit.
test.describe.configure({ lock: [LOCK.homepage] });

/** The control that opens the page builder, in either of its wordings. */
const OPEN_BUILDER_ACTION = /^(?:Build this page|Open Page Builder)$/;

async function openEditor(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoAdmin(page, "/singles/homepage");
  await page.getByRole("link", { name: OPEN_BUILDER_ACTION }).click();
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
}

/** The middle of the canvas region, where a pointer lands on the page. */
async function canvasMiddle(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.getByRole("region", { name: "Canvas" }).boundingBox();
  if (box === null) throw new Error("the canvas region has no box");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.describe("the editor's tooltips over the canvas", () => {
  test("none is left open after the pointer sweeps from the chrome into the canvas", async ({
    page,
  }) => {
    await openEditor(page);
    const middle = await canvasMiddle(page);
    const header = page.getByRole("banner", { name: "Editor actions" });
    const rail = page.getByRole("navigation", { name: "Editor panels" });
    const controls = [
      ...(await header.getByRole("button").all()).slice(0, 6),
      ...(await rail.getByRole("button").all()),
    ];
    expect(controls.length).toBeGreaterThan(4);

    for (const control of controls) {
      if (!(await control.isVisible())) continue;
      await control.hover();
      // Long enough for a tooltip that is going to open to have opened.
      await page.waitForTimeout(500);
      await page.mouse.move(middle.x, middle.y, { steps: 6 });
      await expect(page.getByRole("tooltip")).toHaveCount(0);
    }
  });

  test("a rail tooltip does open, so the sweep above has something to close", async ({
    page,
  }) => {
    // The positive control: a sweep that found no tooltip because none ever
    // opened would pass the test above.
    await openEditor(page);
    await page
      .getByRole("navigation", { name: "Editor panels" })
      .getByRole("button", { name: "Layers", exact: true })
      .hover();
    await expect(page.getByRole("tooltip")).toHaveText("LayersL");
  });
});
