import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";

import {
  ACCEPTANCE_PROPERTIES,
  COVERED,
  DEFERRED,
  titleFor,
} from "./acceptance-manifest";

/**
 * The canvas acceptance suite, rebuilt against the v2 canvas.
 *
 * The original was retired in `c12e43472` with the PoC canvas it drove, and the
 * properties went with it. This is not that suite restored: v2 renders
 * SAME-DOCUMENT with no iframe, so the retired driver's cross-frame mapping and
 * its `.nx-pb-*` selectors describe a canvas that no longer exists.
 *
 * ## Every drag here is POINTER MOTION, never a position
 *
 * `useCanvasDrag` reads live `clientX`/`clientY` off real `pointermove` events
 * and keys BOTH its activation threshold (4px) and its target-switch hysteresis
 * (8px) on ACCUMULATED TRAVEL. A test that jumps the pointer to a coordinate
 * exercises none of that and passes against a canvas broken for anyone using a
 * mouse. Playwright's `dragTo` is one such jump, which is why nothing here uses
 * it.
 *
 * ## Population before verdict
 *
 * Two guards, because they fail differently. `the suite covers what it claims`
 * asserts every property the manifest calls covered has a test here — a rename
 * or a deletion turns it red. `the deferred set is reported` prints what is NOT
 * covered, so a partial suite can never read as a complete one.
 *
 * @module tests/canvas/acceptance
 */

const ROUTE = "/builder-canvas";
const NODE = "[data-nx-node]";
const HOST = '[data-testid="canvas-harness"]';
const INDICATOR = ".nx-drop-indicator";

/** Document order, by id. The single question "did the tree change". */
async function order(page: Page): Promise<(string | null)[]> {
  return page
    .locator(NODE)
    .evaluateAll(nodes => nodes.map(n => n.getAttribute("data-nx-node")));
}

async function boxOf(page: Page, id: string) {
  const box = await page.locator(`[data-nx-node="${id}"]`).boundingBox();
  if (box === null)
    throw new Error(`${id} has no box; the fixture is not rendered`);
  return box;
}

/**
 * Press, travel through intermediate points, and leave the button down.
 *
 * `steps` is not decoration: it is what makes this a drag rather than a jump.
 */
async function pressAndTravel(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 16
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
}

async function openCanvas(page: Page): Promise<void> {
  await page.goto(ROUTE);
  // The population, before any property is asked about it.
  await expect(page.locator(NODE)).toHaveCount(6);
}

test.describe("the canvas acceptance suite", () => {
  test("the suite covers what its manifest claims", async () => {
    // Reads THIS FILE and checks a test exists for every covered property.
    //
    // A count alone would not do it: a suite that renamed a test and lost its
    // property still counts the same. Asserting the titles are present is what
    // makes "covered" a claim the suite can fail rather than a label on a list.
    const source = await readFile(fileURLToPath(import.meta.url), "utf8");
    const missing = COVERED.filter(
      p => !source.includes(`titleFor(COVERED.find(p => p.n === ${p.n})!)`)
    );
    expect(
      missing.map(p => `A${p.n}`),
      "manifest says covered, no test found in this file"
    ).toEqual([]);

    expect(COVERED.length).toBeGreaterThan(0);
    expect(new Set(COVERED.map(titleFor)).size).toBe(COVERED.length);
    expect(COVERED.length + DEFERRED.length).toBe(ACCEPTANCE_PROPERTIES.length);
    expect(ACCEPTANCE_PROPERTIES.length).toBe(12);
  });

  test("the deferred properties are reported, not hidden", async () => {
    // Deferring is not passing. Printed so a reader of the run cannot mistake
    // a partial suite for a complete one.
    for (const p of DEFERRED) {
      expect(p.reason, `A${p.n} defers without a reason`).toBeTruthy();
      // eslint-disable-next-line no-console
      console.log(`DEFERRED A${p.n}: ${p.property} — ${p.reason}`);
    }
    expect(DEFERRED.every(p => (p.reason ?? "").length > 20)).toBe(true);
  });

  test(`${titleFor(COVERED.find(p => p.n === 2)!)}`, async ({ page }) => {
    await openCanvas(page);
    const before = await order(page);
    const box = await boxOf(page, "hx-text-short");
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

    // 2px: inside the 4px activation threshold.
    await pressAndTravel(page, centre, { x: centre.x + 2, y: centre.y }, 4);
    await expect(page.locator(HOST)).toHaveAttribute("data-nx-dragging", "");
    await page.mouse.up();
    expect(await order(page)).toEqual(before);

    // The POSITIVE CONTROL, in the same test: past the threshold it MUST drag.
    // Without it a canvas that never drags at all passes the half above.
    await pressAndTravel(page, centre, { x: centre.x, y: centre.y - 60 }, 16);
    await expect(page.locator(HOST)).toHaveAttribute(
      "data-nx-dragging",
      "hx-text-short"
    );
    await page.mouse.up();
  });

  test(`${titleFor(COVERED.find(p => p.n === 5)!)}`, async ({ page }) => {
    await openCanvas(page);
    const from = await boxOf(page, "hx-text-last");
    const to = await boxOf(page, "hx-heading");

    // None before the drag — the control for the count below.
    await expect(page.locator(INDICATOR)).toHaveCount(0);

    await pressAndTravel(
      page,
      { x: from.x + from.width / 2, y: from.y + from.height / 2 },
      { x: from.x + from.width / 2, y: to.y + 2 }
    );
    await expect(page.locator(INDICATOR)).toHaveCount(1);
    await page.mouse.up();
    await expect(page.locator(INDICATOR)).toHaveCount(0);
  });

  test(`${titleFor(COVERED.find(p => p.n === 6)!)}`, async ({ page }) => {
    await openCanvas(page);
    const heading = await boxOf(page, "hx-heading");
    const next = await boxOf(page, "hx-text-tall");
    const gapTop = heading.y + heading.height;
    const gapBottom = next.y;
    expect(
      gapBottom - gapTop,
      "the fixture must have a gap for an indicator to land in"
    ).toBeGreaterThan(0);

    const from = await boxOf(page, "hx-text-last");
    await pressAndTravel(
      page,
      { x: from.x + from.width / 2, y: from.y + from.height / 2 },
      { x: from.x + from.width / 2, y: gapTop + 1 }
    );

    const line = await page.locator(INDICATOR).boundingBox();
    expect(line).not.toBeNull();
    // Inside the gap, not on top of either neighbour's text.
    expect(line!.y).toBeGreaterThanOrEqual(gapTop - 2);
    expect(line!.y).toBeLessThanOrEqual(gapBottom + 2);
    await page.mouse.up();
  });

  test(`${titleFor(COVERED.find(p => p.n === 4)!)}`, async ({ page }) => {
    await openCanvas(page);
    const settled = async () =>
      page.locator(NODE).evaluateAll(nodes =>
        nodes.map(n => {
          const r = n.getBoundingClientRect();
          return { top: r.top, height: r.height };
        })
      );
    const before = await settled();

    const from = await boxOf(page, "hx-text-last");
    const to = await boxOf(page, "hx-heading");
    await pressAndTravel(
      page,
      { x: from.x + from.width / 2, y: from.y + from.height / 2 },
      { x: from.x + from.width / 2, y: to.y + 2 }
    );
    // Drop zones are live now; nothing may have MOVED to make room for them.
    expect(await settled()).toEqual(before);
    await page.mouse.up();
  });

  test(`${titleFor(COVERED.find(p => p.n === 3)!)}`, async ({ page }) => {
    await openCanvas(page);
    const from = await boxOf(page, "hx-text-last");
    const heading = await boxOf(page, "hx-heading");
    const edge = heading.y + heading.height;
    const x = from.x + from.width / 2;

    await pressAndTravel(
      page,
      { x, y: from.y + from.height / 2 },
      { x, y: edge - 1 }
    );
    const first = await page.locator(HOST).getAttribute("data-nx-drop-target");

    // Jitter ACROSS the edge by 2px, well inside the 8px switch threshold.
    for (let i = 0; i < 6; i += 1) {
      await page.mouse.move(x, edge + 1, { steps: 2 });
      await page.mouse.move(x, edge - 1, { steps: 2 });
    }
    expect(await page.locator(HOST).getAttribute("data-nx-drop-target")).toBe(
      first
    );

    // Control: a DELIBERATE crossing must switch it.
    //
    // Far enough to cross the next INSERTION boundary, not merely the 8px
    // travel threshold. An insertion point sits between siblings, so a pointer
    // moved into the upper half of the block below still resolves to the same
    // index — measured: 40px past the edge held `at: {index: 1}`, because that
    // is still "before hx-text-tall". The boundary is that block's midpoint, so
    // the control aims well past it, at a later sibling.
    const later = await boxOf(page, "hx-text-short");
    await page.mouse.move(x, later.y + later.height / 2, { steps: 16 });
    expect(
      await page.locator(HOST).getAttribute("data-nx-drop-target")
    ).not.toBe(first);
    await page.mouse.up();
  });

  test(`${titleFor(COVERED.find(p => p.n === 10)!)}`, async ({ page }) => {
    await openCanvas(page);
    const depth = async () =>
      Number(await page.locator(HOST).getAttribute("data-nx-undo-depth"));
    expect(await depth()).toBe(0);

    const from = await boxOf(page, "hx-text-last");
    const to = await boxOf(page, "hx-heading");
    await pressAndTravel(
      page,
      { x: from.x + from.width / 2, y: from.y + from.height / 2 },
      { x: from.x + from.width / 2, y: to.y + 2 }
    );
    await page.mouse.up();

    // The tree moved — without this the depth check below passes for a drop
    // that did nothing at all.
    expect(await order(page)).not.toEqual([
      "hx-heading",
      "hx-text-tall",
      "hx-divider",
      "hx-text-short",
      "hx-spacer",
      "hx-text-last",
    ]);
    expect(await depth()).toBe(1);
  });

  test(`${titleFor(COVERED.find(p => p.n === 12)!)}`, async ({ page }) => {
    await openCanvas(page);
    const before = await order(page);
    const from = await boxOf(page, "hx-text-last");
    const to = await boxOf(page, "hx-heading");

    await pressAndTravel(
      page,
      { x: from.x + from.width / 2, y: from.y + from.height / 2 },
      { x: from.x + from.width / 2, y: to.y + 2 }
    );
    await expect(page.locator(HOST)).toHaveAttribute(
      "data-nx-dragging",
      "hx-text-last"
    );

    await page.keyboard.press("Escape");
    await expect(page.locator(HOST)).toHaveAttribute("data-nx-dragging", "");
    await page.mouse.up();

    // Abandoned, not committed: the tree is untouched and nothing is undoable.
    expect(await order(page)).toEqual(before);
    expect(
      Number(await page.locator(HOST).getAttribute("data-nx-undo-depth"))
    ).toBe(0);
  });
});
