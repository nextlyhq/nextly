/**
 * Previewing the page at any width by dragging the canvas frame's edges.
 *
 * The frame is laid out at the dragged width, so the page's media queries
 * answer for it, and the device being edited stays the one every edit goes
 * to. A ruler marks where each breakpoint starts and a drag snaps to it; the
 * handles are sliders; the width beside the device buttons can be typed.
 * The previewed width is never stored: Reset, a device press, a page switch
 * and a reload each show the device's own width again.
 *
 * @module canvas/frame-preview-width.spec
 */
import {
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { canvasBlock, canvasFrame } from "../support/canvas-frame";
import { gotoAdmin } from "../support/admin";
import { LOCK } from "../support/locks";
import { storedPageNodes } from "../support/stored-page";
import { storeSiteBreakpoints } from "../support/site-breakpoints";
import { test } from "../support/test";

import { pressSave } from "./editor-driver";

// The site's breakpoints are stored here and cleared after.
test.describe.configure({ lock: [LOCK.siteStyle], timeout: 180_000 });

const ENTRIES = "/admin/api/collections/pages/entries";
const HEADING = "00000000-0000-4000-8000-0000000f1975";

async function createPage(
  request: APIRequestContext,
  title: string
): Promise<string> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await request.post(ENTRIES, {
    data: {
      title,
      slug: `preview-width-${stamp}`,
      status: "draft",
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: HEADING,
            type: "core/heading",
            version: 1,
            props: { text: "A heading to preview", level: "h2" },
          },
        ],
      },
    },
  });
  expect(created.ok(), `creating a page: ${created.status()}`).toBe(true);
  return ((await created.json()) as { item: { id: string } }).item.id;
}

async function openBuilder(page: Page, id: string): Promise<void> {
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(canvasBlock(page, HEADING).first()).toBeVisible({
    timeout: 60_000,
  });
}

test.beforeEach(async ({ page }) => {
  await storeSiteBreakpoints(page.request, {
    viewport: [
      { id: "tablet", label: "Tablet", maxWidth: 1023 },
      { id: "mobile", label: "Mobile", maxWidth: 767 },
    ],
    container: [],
  });
  await page.setViewportSize({ width: 1440, height: 900 });
});

test.afterEach(async ({ page }) => {
  await storeSiteBreakpoints(page.request, null);
});

function devices(page: Page): Locator {
  return page.getByRole("radiogroup", { name: "Device" });
}

function handle(page: Page, side: "left" | "right"): Locator {
  return page.locator(`[role="slider"][data-side="${side}"]`);
}

/** The width the page is laid out at: its frame's own, before the zoom. */
function layoutWidth(page: Page): Promise<number> {
  return page
    .locator(".nx-canvas-frame__page")
    .evaluate(frame => (frame as HTMLElement).offsetWidth);
}

/** The scale the frame is painted at, from its box and its layout width. */
async function paintedScale(page: Page): Promise<number> {
  const box = await page.locator("[data-nx-canvas-frame-box]").boundingBox();
  if (box === null) throw new Error("[e2e] no frame drawn");
  return box.width / (await layoutWidth(page));
}

/** Drag the right handle so the page is `width` wide, through `steps` moves. */
async function dragTo(page: Page, width: number, steps = 12): Promise<void> {
  const scale = await paintedScale(page);
  const from = await layoutWidth(page);
  const grip = handle(page, "right");
  await grip.hover({ timeout: 15_000 });
  const box = await grip.boundingBox();
  if (box === null) throw new Error("[e2e] no handle drawn");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  // Both edges move together: the right one moves half the change, scaled.
  await page.mouse.move(x - ((from - width) * scale) / 2, y, { steps });
  await page.mouse.up();
}

/** Whether a media query answers true inside the page's frame. */
function frameMatches(page: Page, query: string): Promise<boolean> {
  return canvasFrame(page)
    .locator("body")
    .evaluate(
      (body, asked) =>
        body.ownerDocument.defaultView?.matchMedia(asked).matches ?? false,
      query
    );
}

test("dragging an edge lays the page out at that width, still editing Desktop", async ({
  page,
}) => {
  await openBuilder(page, await createPage(page.request, "Drag to 900"));
  expect(await layoutWidth(page)).toBe(1280);
  // Nothing about another width at rest.
  await expect(page.locator("[data-nx-preview-ruler]")).toHaveCount(0);

  await dragTo(page, 900);
  await expect.poll(() => layoutWidth(page)).toBeGreaterThanOrEqual(899);
  const width = await layoutWidth(page);
  expect(width).toBeLessThanOrEqual(901);

  // The page's media queries answer for that width.
  expect(await frameMatches(page, `(max-width: ${String(width)}px)`)).toBe(
    true
  );
  expect(await frameMatches(page, `(max-width: ${String(width - 1)}px)`)).toBe(
    false
  );
  expect(await frameMatches(page, "(max-width: 1023px)")).toBe(true);

  // Desktop is still the device edited, and every surface says so.
  await expect(
    devices(page).getByRole("radio", { checked: true })
  ).toHaveAccessibleName(/^Desktop/);
  const shown = page.locator("[data-nx-active-width]");
  await expect(shown).toHaveText(`${String(width)}px`);
  await expect(shown).toHaveAttribute("data-previewing", "");
  await expect(
    page.getByRole("button", { name: "Reset", exact: true })
  ).toBeVisible();
  await expect(
    page.getByText(
      `Previewing at ${String(width)}px · still editing Desktop styles`
    )
  ).toBeVisible();
  // The ruler marks where each breakpoint starts.
  const ruler = page.locator("[data-nx-preview-ruler]");
  await expect(ruler).toContainText("768 Tablet");
  await expect(ruler).toContainText("1024 Desktop");
});

test("a drag passing near a ruler mark snaps to it", async ({ page }) => {
  await openBuilder(page, await createPage(page.request, "Snap"));
  const scale = await paintedScale(page);
  // Short of the Desktop mark at 1024 by less than 6 screen pixels' worth.
  await dragTo(page, 1024 + Math.floor((2 * 5) / scale));
  await expect.poll(() => layoutWidth(page)).toBe(1024);
  await expect(page.locator("[data-nx-active-width]")).toHaveText("1024px");
});

test("at a zoom that overflows the canvas, the dragged edge follows the pointer", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openBuilder(page, await createPage(page.request, "Overflowing"));
  await page.getByRole("button", { name: /^Canvas zoom:/ }).click();
  await page.getByRole("menuitemradio", { name: "100%" }).click();
  await expect.poll(() => paintedScale(page)).toBeCloseTo(1, 2);
  // Scrolled to the page's right edge, which is then on screen.
  const region = page.getByRole("region", { name: "Canvas" });
  await region.evaluate(element => {
    element.scrollLeft = element.scrollWidth;
  });
  const grip = handle(page, "right");
  await grip.hover({ timeout: 15_000 });
  const box = await grip.boundingBox();
  if (box === null) throw new Error("[e2e] no handle drawn");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  // The region's scroll holds while the frame narrows, so the handle stays
  // under the pointer: 100 screen pixels in at 100% is 200px narrower.
  await page.mouse.move(x - 100, y, { steps: 8 });
  await expect
    .poll(async () => {
      const moved = await grip.boundingBox();
      return moved === null ? Number.NaN : moved.x + moved.width / 2;
    })
    .toBeCloseTo(x - 100, -1);
  await page.mouse.up();
  await expect.poll(() => layoutWidth(page)).toBeGreaterThanOrEqual(1079);
  expect(await layoutWidth(page)).toBeLessThanOrEqual(1081);
});

test("a font size changed at 900px is stored for Desktop, and none for Tablet", async ({
  page,
}) => {
  const id = await createPage(page.request, "Edit while previewing");
  await openBuilder(page, id);
  await dragTo(page, 900);
  await expect.poll(() => layoutWidth(page)).toBeLessThan(1000);

  await canvasBlock(page, HEADING).first().click();
  const inspector = page.getByTestId("inspector");
  await inspector.getByRole("tab", { name: "Style" }).click();
  const section = inspector
    .getByRole("button", { name: /^Text(\s?has changes)?$/ })
    .first();
  if ((await section.getAttribute("aria-expanded")) !== "true") {
    await section.click();
  }
  const size = inspector.getByRole("textbox", { name: /^Font size\b/ });
  await size.fill("41");
  await size.press("Enter");
  await expect
    .poll(() =>
      canvasBlock(page, HEADING)
        .first()
        .evaluate(element => getComputedStyle(element).fontSize)
    )
    .toBe("41px");

  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect.poll(() => layoutWidth(page)).toBe(1280);
  await expect(page.locator("[data-nx-active-width]")).toHaveText("1280px");
  await expect(
    page.getByRole("button", { name: "Reset", exact: true })
  ).toHaveCount(0);

  const saved = page.waitForResponse(
    response =>
      new URL(response.url()).pathname.endsWith(`/entries/${id}`) &&
      ["PATCH", "PUT"].includes(response.request().method()) &&
      response.ok()
  );
  await pressSave(page);
  await saved;
  // Stored under Desktop (the base breakpoint) alone: nothing for Tablet.
  // Asked again while the dev server answers its first read of the entry,
  // which it can drop while compiling the route.
  await expect(async () => {
    const [heading] = await storedPageNodes(page.request, ENTRIES, id);
    expect(heading?.styles ?? {}).toEqual({
      base: { base: { fontSize: "41px" } },
    });
  }).toPass({ timeout: 30_000 });
});

test("a device press, a page switch and a reload each show the device's own width", async ({
  page,
}) => {
  const stamp = `Switch ${String(Date.now())}`;
  const other = await createPage(page.request, `${stamp} other`);
  const id = await createPage(page.request, `${stamp} here`);
  await openBuilder(page, id);

  // Pressing the device being edited.
  await dragTo(page, 900);
  await expect.poll(() => layoutWidth(page)).toBeLessThan(1000);
  await devices(page)
    .getByRole("radio", { name: /^Desktop/ })
    .click();
  await expect.poll(() => layoutWidth(page)).toBe(1280);

  // Pressing another device: its own width, not the previewed one.
  await dragTo(page, 900);
  await expect.poll(() => layoutWidth(page)).toBeLessThan(1000);
  await devices(page)
    .getByRole("radio", { name: /^Tablet/ })
    .click();
  await expect.poll(() => layoutWidth(page)).toBe(1023);
  await expect(
    page.getByRole("button", { name: "Reset", exact: true })
  ).toHaveCount(0);
  await devices(page)
    .getByRole("radio", { name: /^Desktop/ })
    .click();
  await expect.poll(() => layoutWidth(page)).toBe(1280);

  // A reload.
  await dragTo(page, 900);
  await expect.poll(() => layoutWidth(page)).toBeLessThan(1000);
  await page.reload();
  await expect(canvasBlock(page, HEADING).first()).toBeVisible({
    timeout: 60_000,
  });
  await expect.poll(() => layoutWidth(page)).toBe(1280);
  await expect(
    page.getByRole("button", { name: "Reset", exact: true })
  ).toHaveCount(0);

  // Another page, from the Pages panel.
  await dragTo(page, 900);
  await expect.poll(() => layoutWidth(page)).toBeLessThan(1000);
  const item = page
    .getByRole("navigation", { name: "Editor panels" })
    .getByRole("button", { name: "Pages" });
  if ((await item.getAttribute("aria-pressed")) !== "true") await item.click();
  const pages = page.getByRole("region", { name: "Pages" }).first();
  await pages.getByRole("textbox", { name: "Search pages" }).fill(stamp);
  await pages
    .getByRole("button", { name: `${stamp} other`, exact: true })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/collections/pages/${other}/builder`)
  );
  await expect(canvasBlock(page, HEADING).first()).toBeVisible({
    timeout: 60_000,
  });
  await expect.poll(() => layoutWidth(page)).toBe(1280);
  await expect(
    page.getByRole("button", { name: "Reset", exact: true })
  ).toHaveCount(0);
});

test("the handles are sliders the keys move, and a width can be typed", async ({
  page,
}) => {
  await openBuilder(page, await createPage(page.request, "Keys"));
  const right = handle(page, "right");
  await expect(right).toHaveAccessibleName("Preview width");
  await right.focus();

  const steps: Array<[string, number]> = [
    ["ArrowLeft", 1270],
    ["Shift+ArrowLeft", 1269],
    ["ArrowRight", 1279],
    ["PageDown", 1024],
    ["PageDown", 768],
    ["PageUp", 1024],
    ["Home", 320],
    ["End", 1280],
  ];
  for (const [key, width] of steps) {
    await page.keyboard.press(key);
    await expect.poll(() => layoutWidth(page), { message: key }).toBe(width);
    await expect(right).toHaveAttribute("aria-valuenow", String(width));
  }
  await expect(right).toHaveAttribute(
    "aria-valuetext",
    "1280 pixels, Desktop range"
  );

  // Typed beside the device buttons: Enter applies it.
  await page.locator("[data-nx-active-width]").click();
  const field = page.getByRole("spinbutton", { name: "Preview width" });
  await field.fill("600");
  await field.press("Enter");
  await expect.poll(() => layoutWidth(page)).toBe(600);
  await expect(right).toHaveAttribute(
    "aria-valuetext",
    "600 pixels, Mobile range"
  );

  // Escape leaves it as it was.
  await page.locator("[data-nx-active-width]").click();
  await field.fill("700");
  await field.press("Escape");
  await expect(field).toHaveCount(0);
  await expect.poll(() => layoutWidth(page)).toBe(600);
});
