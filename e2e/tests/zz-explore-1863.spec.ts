import { expect, type Page } from "@playwright/test";

import { test } from "./support/test";
import { gotoAdmin } from "./support/admin";
import { LOCK } from "./support/locks";
import { resetToDefault } from "./support/dashboard-layout";

test.describe.configure({ lock: [LOCK.dashboard] });
const SHOTS = `${process.env.HOME}/code/nextly-workspace/temp-notes-ignore/1863-shots`;
const CELLS = '[data-testid^="widget-cell-"]';

async function cards(page: Page) {
  return page.locator(CELLS).evaluateAll(cells =>
    cells.map(cell => {
      const r = cell.getBoundingClientRect();
      return {
        id: cell.getAttribute("data-placement-id"),
        t: cell.getAttribute("data-testid"),
        size: cell.querySelector('[data-testid="card-size-label"]')?.textContent,
        r: [r.left, r.top, r.width, r.height].map(Math.round),
      };
    })
  );
}

test("explore", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1800 });
  await gotoAdmin(page, "/");
  await expect(page.locator(CELLS).filter({ visible: true }).nth(2)).toBeVisible();
  await page.getByTestId("dashboard-edit-begin").click();
  await page.waitForTimeout(800);
  console.log(JSON.stringify(await cards(page), null, 1));
  await page.screenshot({ path: `${SHOTS}/explore-customise.png` });
  const geo = await page.locator(CELLS).nth(1).evaluate(cell => {
    const box = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return [r.left, r.top, r.width, r.height].map(Math.round);
    };
    return {
      cell: box(cell),
      handle: box(cell.querySelector('[data-testid="widget-drag-handle"]')),
      header: box(cell.querySelector('[data-testid="widget-card-header"]')),
      title: box(cell.querySelector('[data-testid="widget-card-header"] h2')),
      sizeLabel: box(cell.querySelector('[data-testid="card-size-label"]')),
      menu: box(cell.querySelector('[aria-label^="Card actions for"]')),
      edge: box(cell.querySelector('[data-testid="widget-resize-edge"]')),
    };
  });
  console.log("GEO", JSON.stringify(geo));
  const handle = page.locator(CELLS).nth(1).getByTestId("widget-drag-handle");
  const hb = await handle.boundingBox();
  const target = await page.locator(CELLS).nth(3).boundingBox();
  if (!hb || !target) throw new Error("x");
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width * 0.75, target.y + target.height / 2, { steps: 15 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/explore-dragging.png` });
  const ghost = await page.getByTestId("widget-drag-ghost").boundingBox();
  const outline = await page.getByTestId("widget-drop-outline").boundingBox();
  console.log("GHOST", JSON.stringify({ ghost, outline, pointer: [target.x + target.width * 0.75, target.y + target.height / 2], hb }));
  console.log(JSON.stringify(await cards(page), null, 1));
  await page.mouse.up();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/explore-dropped.png` });
  console.log(JSON.stringify(await cards(page), null, 1));
  const edge = page.locator(CELLS).nth(0).getByTestId("widget-resize-edge");
  const eb = await edge.boundingBox();
  if (eb) {
    await page.mouse.move(eb.x + eb.width / 2, eb.y + eb.height / 2);
    await page.mouse.down();
    await page.mouse.move(eb.x + 300, eb.y + eb.height / 2, { steps: 10 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/explore-resizing.png` });
    console.log("TIP", await page.getByTestId("widget-resize-width").textContent(), JSON.stringify(await page.getByTestId("widget-resize-width").boundingBox()));
    console.log(JSON.stringify(await cards(page), null, 1));
    await page.mouse.up();
  } else console.log("no edge on card 0");
  await resetToDefault(page);
});
