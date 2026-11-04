import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { expect, type Page } from "@playwright/test";

import {
  CANVAS_FRAME,
  canvasFrame,
  canvasLayer,
} from "../support/canvas-frame";
import { test } from "../support/test";
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
 * properties went with it. This is not that suite restored: the retired
 * driver's `.nx-pb-*` selectors describe a canvas that no longer exists.
 *
 * ## Two documents
 *
 * The harness draws the page in the canvas's own frame, laid out at the
 * window's size and drawn at 100%, so a block's box in the frame is its box on
 * the page and the pointer lands on it either way. The blocks are in the
 * FRAME's document and found through it; the editor's chrome — the drop line
 * among it — is drawn in the harness's document, over the frame. The harness's
 * own state attributes (the drag, the target, the undo depth) are on its host,
 * which is in the harness's document too.
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

/** The drop line, where the editor draws it: over the frame, in this document. */
function indicator(page: Page) {
  return canvasLayer(page).locator(INDICATOR);
}

/** Document order, by id. The single question "did the tree change". */
async function order(page: Page): Promise<(string | null)[]> {
  return canvasFrame(page)
    .locator(NODE)
    .evaluateAll(nodes => nodes.map(n => n.getAttribute("data-nx-node")));
}

async function boxOf(page: Page, id: string) {
  const box = await canvasFrame(page)
    .locator(`[data-nx-node="${id}"]`)
    .boundingBox();
  if (box === null)
    throw new Error(`${id} has no box; the fixture is not rendered`);
  return box;
}

/**
 * The frame's own viewport, which is what scrolls the page: its document's
 * scrolling element, read inside the frame.
 */
async function frameScroll(
  page: Page
): Promise<{ top: number; height: number; client: number }> {
  return canvasFrame(page)
    .locator("html")
    .evaluate(root => {
      const scroller = root.ownerDocument.scrollingElement;
      if (scroller === null) throw new Error("nothing scrolls the frame");
      return {
        top: scroller.scrollTop,
        height: scroller.scrollHeight,
        client: scroller.clientHeight,
      };
    });
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
  // The population, before any property is asked about it. Eleven, because the
  // fixture nests: a section holding a text block, and a columns row holding a
  // column that itself holds text — an EMPTY column renders zero pixels tall,
  // and a region with no height contains no pointer, so the refusal it exists
  // to demonstrate would be unreachable.
  await expect(canvasFrame(page).locator(NODE)).toHaveCount(11);
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
    const from = await boxOf(page, "hx-text-short");
    const to = await boxOf(page, "hx-heading");

    // None before the drag — the control for the count below.
    await expect(indicator(page)).toHaveCount(0);

    await pressAndTravel(
      page,
      { x: from.x + from.width / 2, y: from.y + from.height / 2 },
      { x: from.x + from.width / 2, y: to.y + 2 }
    );
    await expect(indicator(page)).toHaveCount(1);
    // ONE line, and it is the editor's: nothing is drawn inside the page,
    // where the site's CSS could reach it.
    await expect(canvasFrame(page).locator(INDICATOR)).toHaveCount(0);
    await page.mouse.up();
    await expect(indicator(page)).toHaveCount(0);
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

    const from = await boxOf(page, "hx-text-short");
    await pressAndTravel(
      page,
      { x: from.x + from.width / 2, y: from.y + from.height / 2 },
      { x: from.x + from.width / 2, y: gapTop + 1 }
    );

    const line = await indicator(page).boundingBox();
    expect(line).not.toBeNull();
    // Inside the gap, not on top of either neighbour's text.
    expect(line!.y).toBeGreaterThanOrEqual(gapTop - 2);
    expect(line!.y).toBeLessThanOrEqual(gapBottom + 2);
    await page.mouse.up();
  });

  test(`${titleFor(COVERED.find(p => p.n === 4)!)}`, async ({ page }) => {
    await openCanvas(page);
    const settled = async () =>
      canvasFrame(page)
        .locator(NODE)
        .evaluateAll(nodes =>
          nodes.map(n => {
            const r = n.getBoundingClientRect();
            return { top: r.top, height: r.height };
          })
        );
    const before = await settled();

    const from = await boxOf(page, "hx-text-short");
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
    const from = await boxOf(page, "hx-text-short");
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
    const before = await order(page);
    const depth = async () =>
      Number(await page.locator(HOST).getAttribute("data-nx-undo-depth"));
    expect(await depth()).toBe(0);

    const from = await boxOf(page, "hx-text-short");
    const to = await boxOf(page, "hx-heading");
    await pressAndTravel(
      page,
      { x: from.x + from.width / 2, y: from.y + from.height / 2 },
      { x: from.x + from.width / 2, y: to.y + 2 }
    );
    await page.mouse.up();

    // The tree moved — without this the undo-depth check below passes for a
    // drop that did nothing at all. Compared against what was captured BEFORE
    // the drag rather than a hardcoded list, which goes stale the moment the
    // fixture gains a node.
    expect(await order(page)).not.toEqual(before);
    expect(await depth()).toBe(1);
  });

  test(`${titleFor(COVERED.find(p => p.n === 12)!)}`, async ({ page }) => {
    await openCanvas(page);
    const before = await order(page);
    const from = await boxOf(page, "hx-text-short");
    const to = await boxOf(page, "hx-heading");

    await pressAndTravel(
      page,
      { x: from.x + from.width / 2, y: from.y + from.height / 2 },
      { x: from.x + from.width / 2, y: to.y + 2 }
    );
    await expect(page.locator(HOST)).toHaveAttribute(
      "data-nx-dragging",
      "hx-text-short"
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

  test(`${titleFor(COVERED.find(p => p.n === 1)!)}`, async ({ page }) => {
    await openCanvas(page);
    const nested = await boxOf(page, "hx-nested-text");
    const from = await boxOf(page, "hx-text-short");
    const x = nested.x + nested.width / 2;

    // A point over the nested text is simultaneously over the section that
    // holds it and over the root. Which one wins is the whole property.
    await pressAndTravel(
      page,
      { x: from.x + from.width / 2, y: from.y + from.height / 2 },
      { x, y: nested.y + nested.height / 2 }
    );
    /*
     * Then along the nested text, past the switch distance, without leaving
     * the line it is nearest: a rival target replaces the committed one only
     * once the pointer has travelled that far while it is the candidate, and
     * coming down through a short block the candidate changes line halfway
     * down it, which restarts the count. Holding the line is what lets the
     * reading below be about depth alone.
     */
    await page.mouse.move(x + 24, nested.y + nested.height / 2, { steps: 6 });

    /*
     * Read as the engine settles rather than at the instant the pointer
     * stops: the target is committed through the drag's own hysteresis, and
     * a reading taken mid-commit describes the gap the pointer came from.
     * Polled, a canvas that answers "root" here still fails, because it never
     * answers anything else.
     */
    const region = async (): Promise<string | undefined> => {
      const target = await page
        .locator(HOST)
        .getAttribute("data-nx-drop-target");
      if (target === null || target === "") return undefined;
      return (JSON.parse(target) as { regionId?: string }).regionId;
    };
    // A drop over a nested block resolves somewhere, and to the DEEPER region,
    // not the root. A canvas ignoring depth would answer "root" here and still
    // look correct on a flat document — which is why the fixture nests.
    await expect.poll(region).toBeTruthy();
    await expect.poll(region).not.toBe("root");

    // The control: over a ROOT-level block, the root is the right answer, so a
    // canvas that simply always answered "deepest" is not passing by accident.
    const rootLevel = await boxOf(page, "hx-heading");
    await page.mouse.move(
      rootLevel.x + rootLevel.width / 2,
      rootLevel.y + rootLevel.height / 2,
      { steps: 16 }
    );
    await expect.poll(region).toBe("root");
    await page.mouse.up();
  });

  test(`${titleFor(COVERED.find(p => p.n === 7)!)}`, async ({ page }) => {
    await openCanvas(page);
    // `core/columns` accepts ONLY `core/column`. Dragging a text block at it is
    // the refusal; dragging the column is the acceptance. Both halves, because
    // a refusal shown nowhere and one shown everywhere pass each other's test.
    const columns = await boxOf(page, "hx-columns");
    const column = await boxOf(page, "hx-column");
    // BELOW the column, inside the row. Anywhere over the column resolves to
    // the column's own slot, which accepts a text block — the restriction lives
    // on the ROW, and this band is the only part of it not covered by a child.
    const aim = {
      x: columns.x + columns.width / 2,
      y:
        column.y +
        column.height +
        (columns.y + columns.height - column.y - column.height) / 2,
    };
    expect(
      aim.y,
      "the row must extend below its column for the refusal to be reachable"
    ).toBeGreaterThan(column.y + column.height);

    const refused = await boxOf(page, "hx-text-short");
    await pressAndTravel(
      page,
      { x: refused.x + refused.width / 2, y: refused.y + refused.height / 2 },
      aim
    );
    const refusedTarget = await page
      .locator(HOST)
      .getAttribute("data-nx-drop-target");
    // Either no target at all, or one explicitly marked invalid — both are the
    // engine saying no. What must NOT happen is a silent, ordinary target.
    const refusedOk =
      refusedTarget === "" ||
      refusedTarget === null ||
      /invalid|forbidden|refus/i.test(refusedTarget);
    expect(
      refusedOk,
      `a text block aimed into a columns slot resolved to: ${refusedTarget}`
    ).toBe(true);
    await page.mouse.up();

    // The ACCEPTED half. Pressed at the column's LEFT EDGE rather than its
    // centre: the centre is occupied by the text block inside it, and a press
    // there picks up the child — measured, `data-nx-dragging` read
    // "hx-column-text". Which block a press grabs is the deepest one under the
    // pointer, which is correct and is why the aim has to avoid the child.
    const accepted = await boxOf(page, "hx-column");
    await pressAndTravel(
      page,
      { x: accepted.x + 2, y: accepted.y + 2 },
      { x: aim.x, y: aim.y + 1 }
    );
    const draggingAccepted = await page
      .locator(HOST)
      .getAttribute("data-nx-dragging");
    expect(
      draggingAccepted,
      "the accepted half must drag a block the container allows"
    ).toBeTruthy();
    await page.mouse.up();
  });

  test(`${titleFor(COVERED.find(p => p.n === 8)!)}`, async ({ page }) => {
    await openCanvas(page);
    const host = page.locator(HOST);
    // The POPULATION for this property: the canvas must actually overflow, or
    // "it did not scroll" is indistinguishable from "there was nowhere to go".
    const before = await frameScroll(page);
    const scrollable = before.height > before.client + 40;
    expect(
      scrollable,
      "the fixture must overflow its box for autoscroll to be askable"
    ).toBe(true);
    expect(before.top).toBe(0);

    const from = await boxOf(page, "hx-heading");
    const box = await host.boundingBox();
    if (box === null) throw new Error("the canvas host has no box");

    // Drag toward the BOTTOM edge and hold there. Autoscroll is a response to
    // the pointer approaching an edge, so the pointer has to arrive and stay.
    await pressAndTravel(
      page,
      { x: from.x + from.width / 2, y: from.y + from.height / 2 },
      { x: box.x + box.width / 2, y: box.y + box.height - 4 },
      20
    );
    for (let i = 0; i < 8; i += 1) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height - 4, {
        steps: 2,
      });
      await page.waitForTimeout(80);
    }
    const scrolled = (await frameScroll(page)).top;
    await page.mouse.up();

    expect(
      scrolled,
      "holding at the bottom edge did not scroll"
    ).toBeGreaterThan(0);

    // And it STOPS at the bound rather than running past it.
    const max = before.height - before.client;
    expect(scrolled).toBeLessThanOrEqual(max);
  });

  test(`${titleFor(COVERED.find(p => p.n === 9)!)}`, async ({ page }) => {
    await openCanvas(page);

    // Spy on the DOM API from the test rather than instrumenting the engine.
    // This watches what the canvas does without changing it, which is the only
    // honest way to assert "measured once" — an engine that reported its own
    // read count could report anything.
    // In BOTH documents: the blocks are measured in the frame's, and the
    // chrome drawn over it in this one. Each window has its own prototype,
    // and both count into this window's tally.
    await page.evaluate(() => {
      (window as unknown as { __rectReads: number }).__rectReads = 0;
    });
    const spy = (view: Window & typeof globalThis, tally: Window): void => {
      const original = view.Element.prototype.getBoundingClientRect;
      view.Element.prototype.getBoundingClientRect = function patched(
        this: Element
      ): DOMRect {
        (tally as unknown as { __rectReads: number }).__rectReads += 1;
        return original.call(this);
      };
    };
    await page.evaluate(`(${spy.toString()})(window, window)`);
    const frame = await (
      await page.locator(CANVAS_FRAME).elementHandle()
    )?.contentFrame();
    if (frame === null || frame === undefined) {
      throw new Error("the canvas frame has no document");
    }
    await frame.evaluate(`(${spy.toString()})(window, window.parent)`);
    const reads = async () =>
      page.evaluate(
        () => (window as unknown as { __rectReads: number }).__rectReads
      );

    const from = await boxOf(page, "hx-text-short");
    const centre = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
    const before = await reads();

    await page.mouse.move(centre.x, centre.y);
    await page.mouse.down();
    await page.mouse.move(centre.x, centre.y - 40, { steps: 8 });
    const afterStart = await reads();

    // The POPULATION: a snapshot actually happened. Without this, "no reads
    // during moves" is satisfied by an engine that never measured anything —
    // which is indistinguishable from one that measured once, on this metric.
    expect(
      afterStart - before,
      "the drag must snapshot the tree's geometry when it starts"
    ).toBeGreaterThanOrEqual(11);

    // Now move a lot. If rects were re-read per move, this scales with the
    // number of blocks times the number of moves.
    for (let i = 0; i < 20; i += 1) {
      await page.mouse.move(centre.x, centre.y - 40 - i, { steps: 2 });
    }
    const afterMoves = await reads();
    await page.mouse.up();

    const perMove = (afterMoves - afterStart) / 20;
    // The property is that reads do NOT SCALE WITH THE TREE — a read per block
    // per move is the reflow-per-frame the snapshot exists to avoid. A small
    // constant is legitimate: the indicator has to be placed somewhere.
    //
    // Bounded at six rather than at the block count. Measured here: FOUR per
    // move against eleven blocks. A bound of "fewer than the blocks" would
    // express the property but loosen every time the fixture grows, and would
    // still pass if the engine quietly went from four to ten. Six holds the
    // measured behaviour with a little room, and a change past it is a real
    // change somebody should look at rather than a threshold nobody noticed.
    expect(
      perMove,
      `geometry reads per pointer move: ${perMove} (11 blocks in the fixture)`
    ).toBeLessThanOrEqual(6);
  });
});
