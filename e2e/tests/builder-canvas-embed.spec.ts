/**
 * The device and zoom controls, on a page holding an Embed block.
 *
 * An embed is an iframe sandboxed into an opaque origin, so the admin window
 * holds a frame it may not read: touching anything on it throws a
 * `SecurityError`. On such a page the canvas stopped following the controls —
 * Desktop was laid out at the panel's width while the zoom read "Fit · 100%",
 * and choosing another device or a zoom changed nothing on the canvas. The
 * cases here put an embed on the page and check that each control still moves
 * the canvas, and that nothing on the page threw.
 *
 * @module tests/builder-canvas-embed.spec
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { canvasRoot, openEditorWith } from "./canvas/editor-driver";
import { CANVAS_FRAME } from "./support/canvas-frame";
import { LOCK } from "./support/locks";
import { test } from "./support/test";

// The homepage Single is reseeded here, and the device buttons are read off the
// site's breakpoints, which other files store and clear under the style lock.
test.describe.configure({ lock: [LOCK.homepage, LOCK.siteStyle] });

/**
 * A player on another origin. Answered here so the case needs no network: the
 * sandbox puts whatever loads into an opaque origin either way, so the admin
 * cannot read the frame whatever the URL serves.
 */
const PLAYER = "https://player.example.test/embed/demo";

const HEADING_ID = "embed-page-heading";
const NODES = [
  {
    id: HEADING_ID,
    type: "core/heading",
    version: 1,
    props: { text: "A page with a video", level: 2 },
  },
  {
    id: "embed-page-video",
    type: "core/embed",
    version: 1,
    props: { src: PLAYER, title: "A product video" },
  },
  {
    id: "embed-page-text",
    type: "core/text",
    version: 1,
    props: { text: "Text under the video." },
  },
];

function devices(page: Page): Locator {
  return page.getByRole("radiogroup", { name: "Device" });
}

function zoomTrigger(page: Page): Locator {
  return page.getByRole("button", { name: /^Canvas zoom:/ });
}

/** The width the canvas lays the page out at, which the zoom does not change. */
async function layoutWidth(page: Page): Promise<number> {
  return page
    .locator(CANVAS_FRAME)
    .evaluate(element => (element as HTMLElement).offsetWidth);
}

/** The scale the canvas is drawn at: its painted width over its layout width. */
async function drawnZoom(page: Page): Promise<number> {
  return page.locator(CANVAS_FRAME).evaluate(element => {
    const frame = element as HTMLElement;
    return frame.getBoundingClientRect().width / frame.offsetWidth;
  });
}

test.describe("the canvas with an embed on the page", () => {
  test.describe.configure({ timeout: 180_000 });

  test("follows the device and the zoom", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => {
      // The suite's theme script runs in every frame, the embed's sandboxed
      // one included, and storage is refused there. That error is the
      // harness's, raised inside the frame, and says nothing about the editor.
      if (/Failed to read the 'localStorage' property/.test(error.message)) {
        return;
      }
      errors.push(`${error.name}: ${error.message}`);
    });
    await page.route(`${PLAYER}*`, async route => {
      try {
        await route.fulfill({
          contentType: "text/html",
          body: "<!doctype html><title>Player</title><p>Video player</p>",
        });
      } catch {
        // The page closed before the frame was answered; nothing to answer.
      }
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await openEditorWith(page, NODES, HEADING_ID);

    // The frame is on the canvas, so the case is about a page that has one.
    await expect(
      (await canvasRoot(page)).locator('iframe[title="A product video"]')
    ).toBeAttached();

    // Desktop is laid out at its own width and shrunk to fit beside the panels.
    // At 1440 the region is narrower than 1280, so fitting is under 100%.
    await expect(
      devices(page).getByRole("radio", { checked: true })
    ).toHaveText("Desktop · 1280px");
    await expect.poll(() => layoutWidth(page)).toBe(1280);
    const trigger = zoomTrigger(page);
    await expect
      .poll(async () =>
        Number((await trigger.textContent())?.match(/^Fit · (\d+)%$/)?.[1])
      )
      .toBeLessThan(100);

    // Tablet lays the page out at the tablet's width, and says so.
    await devices(page)
      .getByRole("radio", { name: /^Tablet/ })
      .click();
    await expect(
      devices(page).getByRole("radio", { checked: true })
    ).toHaveText("Tablet · 1024px");
    await expect.poll(() => layoutWidth(page)).toBe(1024);

    // A chosen zoom draws the canvas at that scale.
    await trigger.click();
    await page.getByRole("menuitemradio", { name: "50%", exact: true }).click();
    await expect(trigger).toHaveText("50%");
    await expect.poll(() => drawnZoom(page)).toBe(0.5);

    expect(errors).toEqual([]);
  });
});
