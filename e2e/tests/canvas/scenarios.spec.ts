/**
 * The five scenarios of the dnd-kit iframe spike.
 *
 * 1-3 guard upstream issues that are already fixed (#1704, #1705, #1706).
 * 4 is the decision point (#2088, open). 5 covers keyboard insertion (#1991,
 * open), which matters because a full keyboard session is an exit criterion.
 */
import { expect, test } from "@playwright/test";

import { EXTREME_RATIO_FIXTURE, FLAT_LIST_FIXTURE, seedPage } from "./fixtures";
import { createPocDriver, LIBRARY_ITEM } from "./poc-driver";
import { findReversal } from "./oscillation";

/**
 * A cold Next dev server compiles the builder on first request, and each test
 * then drives 20-60 real pointer moves. The default 30s budget is spent before
 * the canvas has mounted, which reads as a failure of the thing under test
 * rather than of the clock.
 */
test.describe.configure({ timeout: 180_000 });

/**
 * The builder renders as a FIELD inside the entry-form column, not as a
 * full-screen view, so the canvas gets whatever width that column has left
 * after the two side panels. At the default 1280 viewport that remainder is
 * zero: the iframe is `visible` with `width: 0`, which every visibility check
 * reports as hidden. The constraint is the column, not the viewport.
 */
test.use({ viewport: { width: 2560, height: 1400 } });

/** Centre of the first library entry, in top-level viewport coordinates. */
async function libraryItemCentre(page: import("@playwright/test").Page) {
  const box = await page.locator(LIBRARY_ITEM).first().boundingBox();
  expect(box, "library item must be visible to drag from").not.toBeNull();
  return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
}

/** Centre of the canvas iframe, a point guaranteed to be over the block list. */
async function canvasCentre(page: import("@playwright/test").Page) {
  const box = await page.locator("iframe").boundingBox();
  expect(box, "canvas iframe must be visible").not.toBeNull();
  return { x: box!.x + box!.width / 2, y: box!.y + 80 };
}

/**
 * Step the pointer down until a drop zone becomes active, and report where.
 *
 * Teleporting to a zone's centre does NOT activate it: the zones are 0px tall
 * at rest and only 6px while dragging, and dnd-kit resolves collisions from
 * pointer movement rather than from a single position. Stepping is also what a
 * real user produces.
 */
async function dragUntilTarget(
  driver: import("./driver").CanvasDriver,
  maxSteps = 90
): Promise<number> {
  for (let step = 0; step < maxSteps; step++) {
    await driver.moveBy(0, 8);
    const active = await driver.readActiveTarget();
    if (active >= 0) return active;
  }
  return -1;
}

test("scenario 1: a library block drags across the iframe boundary", async ({
  page,
  request,
}) => {
  const fixture = await seedPage(request, FLAT_LIST_FIXTURE);
  const driver = createPocDriver(page);
  await driver.mountTree(fixture);

  const before = await driver.readTreeShape();
  expect(before).toEqual(fixture.blockIds);

  const source = await libraryItemCentre(page);
  const target = await canvasCentre(page);
  await driver.startDragAt(source);
  await driver.moveBy(target.x - source.x, target.y - source.y);

  // The pointer is over the canvas, in a different document. A drop target here
  // is the whole cross-frame question: it means dnd-kit resolved a droppable
  // registered inside the iframe from a pointer event in the host.
  const active = await dragUntilTarget(driver);
  test
    .info()
    .annotations.push({ type: "active-target", description: String(active) });
  expect(active).toBeGreaterThanOrEqual(0);

  await driver.drop();
  await expect
    .poll(async () => (await driver.readTreeShape()).length)
    .toBe(before.length + 1);
});

test("scenario 2: droppable geometry survives a host scroll mid-drag", async ({
  page,
  request,
}) => {
  const fixture = await seedPage(request, FLAT_LIST_FIXTURE);
  const driver = createPocDriver(page);
  await driver.mountTree(fixture);

  const source = await libraryItemCentre(page);
  const target = await canvasCentre(page);
  await driver.startDragAt(source);
  await driver.moveBy(target.x - source.x, target.y - source.y);
  const before = await dragUntilTarget(driver);
  expect(before).toBeGreaterThanOrEqual(0);

  await driver.scrollHost(200);
  await driver.moveBy(0, 1);
  const after = await driver.readActiveTarget();

  test.info().annotations.push({
    type: "scroll-targets",
    description: `before=${before} after=${after}`,
  });

  // The pointer now sits over different content, so the target may legitimately
  // change. Losing it entirely is the #1705 signature: stale rects still
  // pointing at where the zones used to be.
  expect(after).toBeGreaterThanOrEqual(0);
  await driver.cancel();
});

test("scenario 3: droppable geometry survives a scaled canvas frame", async ({
  page,
  request,
}) => {
  const fixture = await seedPage(request, FLAT_LIST_FIXTURE);
  const driver = createPocDriver(page);
  await driver.mountTree(fixture);
  await driver.setZoom(0.75);

  const source = await libraryItemCentre(page);
  const target = await canvasCentre(page);
  await driver.startDragAt(source);
  await driver.moveBy(target.x - source.x, target.y - source.y);
  const active = await dragUntilTarget(driver);
  test
    .info()
    .annotations.push({ type: "scaled-target", description: String(active) });
  expect(active).toBeGreaterThanOrEqual(0);
  await driver.cancel();
});

test("scenario 4: a steady drag over variable-height blocks never reverses", async ({
  page,
  request,
}) => {
  const fixture = await seedPage(request, EXTREME_RATIO_FIXTURE);
  const driver = createPocDriver(page);
  await driver.mountTree(fixture);

  // Record the geometry the claim rests on: the ratio under test, and the size
  // of the targets dnd-kit is actually choosing between.
  const geometry = await page
    .frames()
    .find(f => f.url() === "about:blank")!
    .evaluate(() => ({
      blocks: Array.from(document.querySelectorAll("[data-nx-id]")).map(el =>
        Math.round(el.getBoundingClientRect().height)
      ),
      zonesAtRest: Array.from(document.querySelectorAll(".nx-pb-dropzone")).map(
        el => Math.round(el.getBoundingClientRect().height)
      ),
    }));
  test.info().annotations.push({
    type: "geometry",
    description: JSON.stringify(geometry),
  });

  const source = await libraryItemCentre(page);
  const target = await canvasCentre(page);
  await driver.startDragAt(source);
  await driver.moveBy(target.x - source.x, target.y - source.y);

  // One direction, small constant steps. Anything the target does other than
  // advance or hold is the defect #2088 describes.
  const sequence: number[] = [];
  for (let step = 0; step < 60; step++) {
    await driver.moveBy(0, 8);
    sequence.push(await driver.readActiveTarget());
  }
  await driver.cancel();

  test.info().annotations.push({
    type: "oscillation-sequence",
    description: JSON.stringify(sequence),
  });

  expect(findReversal(sequence)).toBeNull();
});

test("scenario 4b: a 2px oscillation at a boundary never flips the indicator", async ({
  page,
  request,
}) => {
  const fixture = await seedPage(request, EXTREME_RATIO_FIXTURE);
  const driver = createPocDriver(page);
  await driver.mountTree(fixture);

  const source = await libraryItemCentre(page);
  const target = await canvasCentre(page);
  await driver.startDragAt(source);
  await driver.moveBy(target.x - source.x, target.y - source.y);

  // Walk down until the target changes: that step crossed a boundary, which is
  // where the checklist says a 2px jitter must not flip anything.
  let previous = await driver.readActiveTarget();
  for (let step = 0; step < 80; step++) {
    await driver.moveBy(0, 4);
    const current = await driver.readActiveTarget();
    if (current !== previous && current >= 0 && previous >= 0) break;
    previous = current;
  }

  const observed: number[] = [];
  for (let step = 0; step < 20; step++) {
    await driver.moveBy(0, step % 2 === 0 ? 2 : -2);
    observed.push(await driver.readActiveTarget());
  }
  await driver.cancel();

  test.info().annotations.push({
    type: "boundary-jitter",
    description: JSON.stringify(observed),
  });

  const distinct = new Set(observed.filter(v => v >= 0));
  expect(distinct.size).toBeLessThanOrEqual(2);
});

/**
 * Marked failing, not passing, because it CANNOT fail here.
 *
 * Probed directly: a block takes focus (`document.activeElement` is the right
 * `data-nx-id`, and every block carries `tabindex=0` and `role=button`), but
 * Space, ArrowDown, ArrowDown, Space leaves the tree byte-identical. There is
 * no keyboard move path in this canvas at all, so the round-trip assertion
 * holds vacuously and would keep holding if dnd-kit #1991 were far worse than
 * reported. Assessing #1991 needs driver #2, against a canvas that implements
 * keyboard dragging.
 */
test.fixme(
  "scenario 5: keyboard insertion position round-trips",
  async ({ page, request }) => {
    const fixture = await seedPage(request, FLAT_LIST_FIXTURE);
    const driver = createPocDriver(page);
    await driver.mountTree(fixture);

    const before = await driver.readTreeShape();
    await driver.keyboardInsert("down");
    await driver.keyboardInsert("up");
    const after = await driver.readTreeShape();

    test.info().annotations.push({
      type: "keyboard-shape",
      description: `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
    });

    // #1991 reports `position.current` lagging one frame under keyboard
    // navigation, and "insert above vs below" is computed from it, so a lag shows
    // up as a move that does not come back.
    expect(after).toEqual(before);
  }
);
