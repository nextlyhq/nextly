/**
 * The page on the canvas, edge to edge.
 *
 * The frame is laid out at the edited device's width and scaled to fit the
 * canvas region, with no gutter and no shadow: at its fitted width it meets
 * the panels' dividers on both sides. A frame narrower than the region, as a
 * phone is, is centred in the well with a 1px hairline edge. A selected block
 * that touches the frame's edge keeps all four sides of its ring on screen,
 * since the region cuts off anything drawn past the page.
 *
 * @module canvas/frame-edge-to-edge.spec
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { canvasBlock, canvasLayer } from "../support/canvas-frame";
import { LOCK } from "../support/locks";
import { storeSiteBreakpoints } from "../support/site-breakpoints";
import { test } from "../support/test";

import { openEditorWith } from "./editor-driver";

// The homepage document and the site's breakpoints are both written here.
test.describe.configure({ lock: [LOCK.homepage, LOCK.siteStyle] });

/** A full-width Section at the top of the page, holding one line of text. */
const NODES = [
  {
    id: "band",
    type: "core/section",
    version: 1,
    props: { as: "section" },
    styles: { base: { base: { minHeight: "240px" } } },
    slots: {
      children: [
        {
          id: "words",
          type: "core/text",
          version: 1,
          props: { text: "Inside a full-width section" },
        },
      ],
    },
  },
];

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("[e2e] nothing drawn to measure");
  return box;
}

/** The canvas region, whose edges are the panels' dividers. */
function region(page: Page): Locator {
  return page.getByRole("region", { name: "Canvas" });
}

/** The frame's painted box. */
function frame(page: Page): Locator {
  return page.locator("[data-nx-canvas-frame-box]");
}

/** How far the frame's left and right edges sit in from the region's. */
async function sideGaps(page: Page): Promise<{ left: number; right: number }> {
  const around = await boxOf(region(page));
  const drawn = await boxOf(frame(page));
  return {
    left: drawn.x - around.x,
    right: around.x + around.width - (drawn.x + drawn.width),
  };
}

for (const width of [1440, 1280]) {
  test(`the Desktop frame meets the panels' dividers at a ${width}px window`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await openEditorWith(page, NODES, "words");
    await expect(
      page
        .getByRole("radiogroup", { name: "Device" })
        .getByRole("radio", { checked: true })
    ).toHaveAccessibleName(/^Desktop · 1280px · /);
    // Scaled to fit, edge to edge: no gutter on either side.
    await expect
      .poll(async () => {
        const { left, right } = await sideGaps(page);
        return Math.max(Math.abs(left), Math.abs(right));
      })
      .toBeLessThanOrEqual(1);
    // Nothing past the region to scroll to: the frame fills it exactly.
    const overflow = await region(page).evaluate(element => ({
      across: element.scrollWidth - element.clientWidth,
      down: element.scrollHeight - element.clientHeight,
    }));
    expect(overflow).toEqual({ across: 0, down: 0 });
    // No shadow around it.
    await expect(page.locator(".nx-canvas-frame")).toHaveCSS(
      "box-shadow",
      "none"
    );
  });
}

test("a frame narrower than the region is centred with a 1px hairline edge", async ({
  page,
}) => {
  await storeSiteBreakpoints(page.request, {
    viewport: [{ id: "mobile", label: "Mobile", maxWidth: 390 }],
    container: [],
  });
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openEditorWith(page, NODES, "words");
    await page
      .getByRole("radiogroup", { name: "Device" })
      .getByRole("radio", { name: /^Mobile/ })
      .click();
    await expect(page.locator("[data-nx-active-width]")).toHaveText("390px");
    await expect
      .poll(async () => (await sideGaps(page)).left)
      .toBeGreaterThan(40);
    const { left, right } = await sideGaps(page);
    expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
    const edge = page.locator(".nx-canvas-frame");
    await expect(edge).toHaveCSS("outline-style", "solid");
    await expect(edge).toHaveCSS("outline-width", "1px");
    await expect(edge).toHaveCSS("box-shadow", "none");
  } finally {
    await storeSiteBreakpoints(page.request, null);
  }
});

test("a selected full-width Section shows all four sides of its ring", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditorWith(page, NODES, "words");
  const band = canvasBlock(page, "band");
  // In the section's own room below its text, so the section is what's hit.
  const drawn = await boxOf(band);
  await band.click({ position: { x: drawn.width / 2, y: drawn.height - 12 } });
  await expect(band).toHaveAttribute("data-nx-selected", "primary");

  const ring = canvasLayer(page).locator(
    '.nx-canvas-mark[data-mark="selected"]'
  );
  await expect(ring).toHaveCount(1);
  const around = await boxOf(region(page));
  const marked = await boxOf(ring);
  // Every side of the ring inside what the region shows, so none is cut off.
  expect(marked.x).toBeGreaterThanOrEqual(around.x - 0.5);
  expect(marked.y).toBeGreaterThanOrEqual(around.y - 0.5);
  expect(marked.x + marked.width).toBeLessThanOrEqual(
    around.x + around.width + 0.5
  );
  expect(marked.y + marked.height).toBeLessThanOrEqual(
    around.y + around.height + 0.5
  );
  // And it rings the section: as wide as the page it spans.
  const pageBox = await boxOf(frame(page));
  expect(Math.abs(marked.width - pageBox.width)).toBeLessThanOrEqual(1);
});
