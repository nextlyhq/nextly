/**
 * The dashboard's arrangement in a browser: one order everywhere, and the card
 * menu's Remove and Undo by keyboard alone.
 *
 * jsdom has no layout, so the component tests can say what the grid renders
 * but not where it puts it. These measure the drawn page: the order a reader
 * sees, the order the page is read in and the order Tab visits must be one
 * order, at a width where cards sit side by side and at one where they wrap
 * differently.
 *
 * Each test returns the reader to the default dashboard when it ends, so the
 * specs that follow see the dashboard a new site has.
 *
 * @module tests/dashboard-arrangement.spec
 */
import { expect, test, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";

const CELLS = '[data-testid^="widget-cell-"]';

/** The cards' widget ids in DOM order: the order the page is read in. */
async function readingOrder(page: Page): Promise<string[]> {
  return page
    .locator(CELLS)
    .evaluateAll(cells =>
      cells.map(cell => cell.getAttribute("data-testid") ?? "")
    );
}

/** The same cards sorted as drawn: by row (top), then left to right. */
async function visualOrder(page: Page): Promise<string[]> {
  const boxes = await page.locator(CELLS).evaluateAll(cells =>
    cells.map(cell => {
      const box = cell.getBoundingClientRect();
      return {
        id: cell.getAttribute("data-testid") ?? "",
        top: Math.round(box.top),
        left: Math.round(box.left),
        visible: box.width > 0 && box.height > 0,
      };
    })
  );
  return boxes
    .filter(box => box.visible)
    .sort((a, b) => a.top - b.top || a.left - b.left)
    .map(box => box.id);
}

/** Back to the default dashboard, through the guarded reset a reader uses. */
async function resetToDefault(page: Page): Promise<void> {
  const read = await page.request.get("/admin/api/dashboard/layout");
  const body = (await read.json()) as { version: number; scope: string };
  if (body.version === 0) return;
  const reset = await page.request.delete(
    `/admin/api/dashboard/layout?version=${body.version}&scope=${encodeURIComponent(body.scope)}`
  );
  expect(reset.status()).toBe(200);
}

/** Opens customise mode from the keyboard. */
async function customize(page: Page): Promise<void> {
  const begin = page.getByTestId("dashboard-edit-begin");
  await begin.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
}

test.afterEach(async ({ page }) => {
  await resetToDefault(page);
});

for (const width of [1440, 820]) {
  test(`visual, reading and tab order agree at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await gotoAdmin(page, "/");
    await expect(page.locator(CELLS).first()).toBeVisible();

    const reading = await readingOrder(page);
    // More than one card, or "agree" proves nothing.
    expect(reading.length).toBeGreaterThan(2);
    expect(await visualOrder(page)).toEqual(reading);

    // Tab visits each card's menu in the same order.
    await customize(page);
    const menus = page.getByRole("button", { name: /^Card actions for / });
    const expected = await menus.evaluateAll(buttons =>
      buttons.map(button => button.getAttribute("aria-label") ?? "")
    );
    const visited: string[] = [];
    for (let i = 0; i < 400 && visited.length < expected.length; i += 1) {
      await page.keyboard.press("Tab");
      const label = await page.evaluate(
        () => document.activeElement?.getAttribute("aria-label") ?? ""
      );
      if (label.startsWith("Card actions for ") && !visited.includes(label)) {
        visited.push(label);
      }
    }
    expect(visited).toEqual(expected);
  });
}

test("removes a card, brings it back and saves a removal, by keyboard alone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoAdmin(page, "/");
  await expect(page.locator(CELLS).first()).toBeVisible();
  const before = await readingOrder(page);

  await customize(page);
  // Counted in customise mode: a card whose content draws nothing is hidden
  // at rest and shown there, so the rest count is a different population.
  const inCustomize = await readingOrder(page);
  const menus = page.getByRole("button", { name: /^Card actions for / });
  const firstLabel = (await menus.first().getAttribute("aria-label")) ?? "";
  const secondLabel = (await menus.nth(1).getAttribute("aria-label")) ?? "";
  const title = firstLabel.replace("Card actions for ", "");

  // Open the first card's menu and choose Remove, the last item.
  await menus.first().focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("End");
  await expect(page.getByRole("menuitem", { name: "Remove" })).toBeFocused();
  await page.keyboard.press("Enter");

  // Gone from the grid, the notice offers it back, and focus is on the next
  // card's menu.
  await expect(page.locator(CELLS)).toHaveCount(inCustomize.length - 1);
  await expect(
    page.getByRole("button", { name: `Undo removing ${title}` })
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.activeElement?.getAttribute("aria-label"))
    )
    .toBe(secondLabel);

  // Reach Undo with Tab and press it.
  let onUndo = false;
  for (let i = 0; i < 400 && !onUndo; i += 1) {
    await page.keyboard.press("Tab");
    onUndo =
      (await page.evaluate(
        () => document.activeElement?.getAttribute("aria-label") ?? ""
      )) === `Undo removing ${title}`;
  }
  expect(onUndo).toBe(true);
  await page.keyboard.press("Enter");
  await expect(page.locator(CELLS)).toHaveCount(inCustomize.length);
  expect(await readingOrder(page)).toEqual(inCustomize);

  // Nothing has changed now, so there is nothing to save. Focus is back on the
  // restored card's menu: remove it again, and save that from the keyboard.
  await expect
    .poll(() =>
      page.evaluate(() => document.activeElement?.getAttribute("aria-label"))
    )
    .toBe(firstLabel);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("End");
  await expect(page.getByRole("menuitem", { name: "Remove" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(CELLS)).toHaveCount(inCustomize.length - 1);

  const save = page.getByRole("button", { name: "Save" });
  await save.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("dashboard-edit-begin")).toBeVisible();

  // The removal was stored: after a reload the card is still gone, and every
  // other card keeps its order.
  const removedCell = inCustomize[0];
  await page.reload();
  await expect(page.locator(CELLS).first()).toBeVisible();
  expect(await readingOrder(page)).toEqual(
    before.filter(id => id !== removedCell)
  );
});
