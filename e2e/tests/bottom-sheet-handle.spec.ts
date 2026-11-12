/**
 * On a phone, the document panel and an item's media details open as bottom
 * sheets with a grab strip, in a real browser at 390px with touch input.
 *
 * What a unit test cannot see: the sheet's real height against the screen,
 * its body scrolling inside it, and a finger's drag arriving as touch
 * pointer events: a short drag springs back, a long one closes the sheet,
 * and Escape still closes it.
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { dropFiles, pngBuffer } from "./support/media-files";
import { test } from "./support/test";

const WIDTH = 390;
const HEIGHT = 844;

test.use({ hasTouch: true, viewport: { width: WIDTH, height: HEIGHT } });

/** A finger on the sheet's grab strip, moved `distance` px down over `ms`. */
async function dragHandle(
  page: Page,
  sheet: Locator,
  distance: number,
  ms: number
): Promise<void> {
  const strip = await sheet
    .locator("[data-slot='sheet-drag-handle']")
    .boundingBox();
  expect(strip, "the sheet draws a grab strip").not.toBeNull();
  const x = Math.round(strip!.x + strip!.width / 2);
  const y = Math.round(strip!.y + strip!.height / 2);
  const cdp = await page.context().newCDPSession(page);
  const steps = 10;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y }],
  });
  for (let step = 1; step <= steps; step++) {
    await page.waitForTimeout(ms / steps);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: y + Math.round((distance * step) / steps) }],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await cdp.detach();
}

/** The sheet's height as a share of the screen's, and whether its body scrolls inside. */
async function measure(sheet: Locator) {
  return sheet.evaluate(element => {
    const box = element.getBoundingClientRect();
    const scrollers = [...element.querySelectorAll<HTMLElement>("*")].filter(
      node =>
        node.scrollHeight > node.clientHeight + 1 &&
        /(auto|scroll)/.test(getComputedStyle(node).overflowY)
    );
    return {
      share: box.height / window.innerHeight,
      bottomGap: Math.round(window.innerHeight - box.bottom),
      scrollsInside: scrollers.length > 0,
      pageScrollsInstead:
        document.documentElement.scrollHeight > window.innerHeight + 1 &&
        element.scrollHeight > element.clientHeight + 1,
    };
  });
}

async function openDocumentPanel(page: Page): Promise<Locator> {
  const created = await page.request.post(
    "/admin/api/collections/block-pages/entries",
    {
      data: {
        title: "Bottom sheet",
        slug: `bottom-sheet-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      },
    }
  );
  expect(created.ok()).toBe(true);
  const { item } = (await created.json()) as { item: { id: string } };
  await gotoAdmin(page, `/collections/block-pages/${item.id}`);
  await expect(
    page.getByRole("textbox", { name: "Title", exact: true })
  ).toHaveValue("Bottom sheet", { timeout: 30_000 });
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Show document panel" }).click();
  const sheet = page.getByRole("dialog", { name: "Document" });
  await expect(sheet).toBeVisible();
  // Settled from its slide-in before anything measures or drags it.
  await expect(sheet).toHaveAttribute("data-state", "open");
  await page.waitForTimeout(300);
  return sheet;
}

test("the document panel's sheet: sized to its content, dragged closed, or closed on Escape", async ({
  page,
}) => {
  let sheet = await openDocumentPanel(page);

  const size = await measure(sheet);
  expect(size.bottomGap).toBe(0);
  expect(size.share).toBeLessThanOrEqual(0.9 + 0.005);
  // At 90% the body scrolls inside the sheet, never the page under it.
  if (size.share > 0.89) expect(size.scrollsInside).toBe(true);
  expect(size.pageScrollsInstead).toBe(false);

  // A short, slow drag springs back.
  const before = await sheet.boundingBox();
  await dragHandle(page, sheet, 60, 600);
  await page.waitForTimeout(300);
  await expect(sheet).toBeVisible();
  const after = await sheet.boundingBox();
  expect(Math.abs(after!.y - before!.y)).toBeLessThanOrEqual(1);

  // A long drag closes it.
  await dragHandle(page, sheet, Math.round(before!.height * 0.5), 400);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Opened again, Escape closes it too.
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Show document panel" }).click();
  sheet = page.getByRole("dialog", { name: "Document" });
  await expect(sheet).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("an item's media details: a sheet with a grab strip that a drag closes", async ({
  page,
}) => {
  await gotoAdmin(page, "/media");
  await dropFiles(page, [{ name: "sheet-drag-a.png", buffer: pngBuffer(60) }]);
  await expect(
    page.getByRole("status").filter({ hasText: /uploaded/ })
  ).toContainText("1 uploaded", { timeout: 30_000 });
  await page.getByRole("button", { name: "Close uploads" }).click();
  await page.getByRole("button", { name: "Grid view" }).click();
  await page
    .getByRole("button", { name: /^sheet-drag-a\.png/ })
    .first()
    .click();

  const sheet = page.getByRole("dialog", { name: "sheet-drag-a.png" });
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveAttribute("data-state", "open");
  await page.waitForTimeout(300);
  const size = await measure(sheet);
  expect(size.bottomGap).toBe(0);
  expect(size.share).toBeLessThanOrEqual(0.9 + 0.005);
  if (size.share > 0.89) expect(size.scrollsInside).toBe(true);

  const box = await sheet.boundingBox();
  await dragHandle(page, sheet, Math.round(box!.height * 0.5), 400);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
