/**
 * The spacing overlay over a small block: a block that holds no blocks keeps
 * its own color under outlined bands, and a number thicker than its band hides
 * until the band is pointed at. A container keeps filled bands and numbers.
 *
 * @module spacing-overlay-small-blocks.spec
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { canvasBlock, canvasLayer } from "../support/canvas-frame";
import { test } from "../support/test";

import { openEditorWith, selection } from "./editor-driver";

const BUTTON = "a0000000-0000-4000-8000-0000000b7001";
const SECTION = "a0000000-0000-4000-8000-0000000b7002";
const YELLOW = "rgb(245, 197, 24)";

const NODES = [
  {
    id: BUTTON,
    type: "core/button",
    version: 1,
    props: { label: "Book a tour" },
    styles: {
      base: {
        base: {
          backgroundColor: "#f5c518",
          padding: {
            blockStart: "12px",
            blockEnd: "12px",
            inlineStart: "12px",
            inlineEnd: "12px",
          },
        },
      },
    },
  },
  {
    id: SECTION,
    type: "core/section",
    version: 1,
    props: { as: "section", contained: true },
    styles: {
      base: {
        base: {
          padding: {
            blockStart: "64px",
            blockEnd: "64px",
            inlineStart: "24px",
            inlineEnd: "24px",
          },
        },
      },
    },
    slots: { children: [] },
  },
];

function overlay(page: Page): Locator {
  return canvasLayer(page).locator(".nx-spacing-overlay");
}

function band(page: Page, side: string): Locator {
  return overlay(page).locator(
    `.nx-spacing-overlay__band[data-box="padding"][data-side="${side}"]`
  );
}

/** What the band's fill paints: its `::before` background. */
function fillOf(target: Locator): Promise<string> {
  return target.evaluate(
    element => getComputedStyle(element, "::before").backgroundColor
  );
}

function numberShown(target: Locator): Promise<string> {
  return target
    .locator(".nx-spacing-overlay__value")
    .evaluate(element => getComputedStyle(element).visibility);
}

test.describe("the spacing overlay over a small block", () => {
  test.describe.configure({ timeout: 180_000 });

  test("a yellow Button stays yellow, with outlined bands and its numbers on pointing only", async ({
    page,
  }) => {
    await openEditorWith(page, NODES, BUTTON);
    await canvasBlock(page, BUTTON).click();
    await expect.poll(() => selection(page)).toEqual([BUTTON]);

    const top = band(page, "top");
    await expect(top).toBeVisible();
    await expect(overlay(page)).toHaveAttribute("data-outlines", "");
    // Nothing is painted over the Button: the fill is gone, its own color stays.
    expect(await fillOf(top)).toBe("rgba(0, 0, 0, 0)");
    expect(
      await canvasBlock(page, BUTTON).evaluate(
        element => getComputedStyle(element).backgroundColor
      )
    ).toBe(YELLOW);

    // 12 px is thinner than its number: hidden until the band is pointed at.
    await expect(top).toHaveAttribute("data-tight", "");
    expect(await numberShown(top)).toBe("hidden");
    const box = await top.boundingBox();
    if (box === null) throw new Error("[e2e] the top band has no box");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(top).toHaveAttribute("data-pointed", "");
    expect(await numberShown(top)).toBe("visible");
  });

  test("a Section keeps filled bands and shows its numbers", async ({
    page,
  }) => {
    await openEditorWith(page, NODES, BUTTON);
    // In its padding, near the corner: the middle of an empty Section is its
    // "add a block" prompt, which a click answers instead of selecting.
    await canvasBlock(page, SECTION).click({ position: { x: 12, y: 12 } });
    await expect.poll(() => selection(page)).toEqual([SECTION]);

    const top = band(page, "top");
    await expect(top).toBeVisible();
    await expect(overlay(page)).not.toHaveAttribute("data-outlines", "");
    expect(await fillOf(top)).not.toBe("rgba(0, 0, 0, 0)");
    await expect(top).not.toHaveAttribute("data-tight", "");
    expect(await numberShown(top)).toBe("visible");
  });
});
