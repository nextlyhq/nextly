/**
 * The five scenarios of the dnd-kit iframe spike.
 *
 * 1-3 guard upstream issues that are already fixed (#1704, #1705, #1706).
 * 4 is the decision point (#2088, open). 5 covers keyboard insertion (#1991,
 * open), which matters because a full keyboard session is an exit criterion.
 *
 * Nothing here touches the canvas except through `CanvasDriver`. That is the
 * whole point of the seam: swapping `createPocDriver` for a v2 driver must
 * retarget this file without editing it.
 */
import { expect, test } from "@playwright/test";

import type { CanvasDriver } from "./driver";
import { EXTREME_RATIO_FIXTURE, FLAT_LIST_FIXTURE, seedPage } from "./fixtures";
import { createPocDriver } from "./poc-driver";
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

/**
 * How far the reported indicator may sit from the pointer before the mapping is
 * considered wrong.
 *
 * Generous on purpose: collision detection may legitimately choose a zone a
 * little away from the pointer. It is still far tighter than every failure it
 * guards. A stale-rect bug after a 200px scroll misreports by ~200px, and an
 * unscaled 0.75 transform misreports by ~25% of the travel, which exceeds this
 * within the first 240px of a sweep.
 */
const INDICATOR_TOLERANCE_PX = 60;

/** Step the pointer down until a drop zone becomes active, and report where. */
async function dragUntilTarget(
  driver: CanvasDriver,
  maxSteps = 90
): Promise<number> {
  for (let step = 0; step < maxSteps; step++) {
    await driver.moveBy(0, 8);
    const active = await driver.readActiveTarget();
    if (active >= 0) return active;
  }
  return -1;
}

/** Begin a drag from the insert panel and carry the pointer over the canvas. */
async function startPanelDrag(driver: CanvasDriver) {
  const source = await driver.dragSourceCentre();
  const target = await driver.canvasCentre();
  await driver.startDragAt(source);
  await driver.moveBy(target.x - source.x, target.y - source.y);
}

/**
 * The active indicator must be where the pointer actually is.
 *
 * A non-negative ordinal alone proves only that SOME zone is active, which is
 * exactly what a stale-rect or unscaled-transform implementation still
 * produces. Comparing the indicator's live rect against the live pointer is
 * what makes the #1705 and #1706 guards real.
 */
async function expectIndicatorAtPointer(driver: CanvasDriver, label: string) {
  const rect = await driver.readIndicatorRect();
  expect(rect, `${label}: an indicator must be visible`).not.toBeNull();
  const pointer = driver.pointer();
  const distance = Math.abs(pointer.y - (rect!.y + rect!.height / 2));
  test.info().annotations.push({
    type: `${label}-distance`,
    description: `pointerY=${Math.round(pointer.y)} indicatorY=${Math.round(rect!.y + rect!.height / 2)} distance=${Math.round(distance)}`,
  });
  expect(
    distance,
    `${label}: the indicator sits ${Math.round(distance)}px from the pointer`
  ).toBeLessThanOrEqual(INDICATOR_TOLERANCE_PX);
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

  await startPanelDrag(driver);

  // A drop target here is the whole cross-frame question: it means dnd-kit
  // resolved a droppable registered inside the iframe from a pointer event in
  // the host document.
  const active = await dragUntilTarget(driver);
  test
    .info()
    .annotations.push({ type: "active-target", description: String(active) });
  expect(active).toBeGreaterThanOrEqual(0);
  await expectIndicatorAtPointer(driver, "cross-frame");

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

  await startPanelDrag(driver);
  const before = await dragUntilTarget(driver);
  expect(before).toBeGreaterThanOrEqual(0);
  await expectIndicatorAtPointer(driver, "pre-scroll");

  const originBefore = await driver.frameOrigin();
  await driver.scrollHost(200);
  const originAfter = await driver.frameOrigin();
  // Without this the scenario silently degrades to an at-rest pointer check
  // whenever the overflow ancestor is already at its limit.
  expect(
    Math.abs(originAfter.y - originBefore.y),
    "the host must actually scroll for #1705 to be exercised"
  ).toBeGreaterThan(50);

  await driver.moveBy(0, 1);
  const after = await driver.readActiveTarget();

  test.info().annotations.push({
    type: "scroll-targets",
    description: `before=${before} after=${after}`,
  });

  // The target may legitimately change, since the pointer now sits over
  // different content. What must NOT happen is the indicator pointing at where
  // the zones used to be: that is the #1705 signature, and an ordinal check
  // alone cannot see it.
  expect(after).toBeGreaterThanOrEqual(0);
  await expectIndicatorAtPointer(driver, "post-scroll");
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

  await startPanelDrag(driver);
  const active = await dragUntilTarget(driver);
  test
    .info()
    .annotations.push({ type: "scaled-target", description: String(active) });
  expect(active).toBeGreaterThanOrEqual(0);

  // An implementation that ignores the frame transform still activates SOME
  // zone; it activates the wrong one, further out the further the pointer has
  // travelled. Only the geometry check catches that.
  await expectIndicatorAtPointer(driver, "scaled");
  await driver.cancel();
});

test("scenario 4: a steady drag over variable-height blocks never reverses", async ({
  page,
  request,
}) => {
  const fixture = await seedPage(request, EXTREME_RATIO_FIXTURE);
  const driver = createPocDriver(page);
  await driver.mountTree(fixture);

  // The #2088 conclusion rests entirely on this geometry, so it is asserted
  // rather than merely recorded. If the seeded heights stop rendering, the
  // scenario must fail loudly instead of passing without the size ratio it
  // claims to have exercised.
  const boxes = await driver.readBlockBoxes();
  const siblings = boxes.slice(1);
  const tall = siblings.filter(b => b.height >= 300);
  const short = siblings.filter(b => b.height > 0 && b.height <= 40);
  test.info().annotations.push({
    type: "geometry",
    description: JSON.stringify({
      heights: boxes.map(b => b.height),
      zones: await driver.readZoneHeights(),
    }),
  });
  expect(tall.length, "the fixture must render tall blocks").toBeGreaterThan(1);
  expect(short.length, "the fixture must render short blocks").toBeGreaterThan(
    1
  );
  expect(
    Math.min(...tall.map(b => b.height)) /
      Math.max(...short.map(b => b.height)),
    "the size ratio #2088 depends on must actually be present"
  ).toBeGreaterThan(8);

  await startPanelDrag(driver);

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

  // `findReversal` also returns null for a sequence that never found a target
  // and for one stuck on a single target forever. Both would mean droppable
  // detection broke on this fixture, so both must fail here rather than read as
  // a clean run.
  const observed = sequence.filter(value => value >= 0);
  expect(observed.length, "the drag must find targets at all").toBeGreaterThan(
    0
  );
  expect(
    new Set(observed).size,
    "the target must advance across the drag, not stall on one zone"
  ).toBeGreaterThan(1);
  expect(findReversal(sequence)).toBeNull();

  // The pointer only ever moves down and zones are numbered top-to-bottom, so
  // a monotonically RETREATING walk has no reversal and multiple ordinals —
  // it clears every guard above while being completely backwards.
  const first = observed[0]!;
  const last = observed[observed.length - 1]!;
  expect(
    last,
    `targets must advance downward: ${JSON.stringify(observed)}`
  ).toBeGreaterThan(first);
});

/**
 * Expected failure, and the reason is structural rather than a bug in dnd-kit.
 *
 * Master plan §2.8 point 3 assumes a boundary BETWEEN TWO drop targets. This
 * canvas has no such boundary: zones are thin gaps separated by whole blocks of
 * dead space, so the only edge a pointer can straddle is zone-versus-nothing.
 * Bracketed to 1px, a 2px jitter there yields [-1 x20] — the indicator is
 * absent, not flickering between two candidates.
 *
 * That is the same structural fact that makes #2088 unreproducible (§3 of the
 * report) seen from its costly side, and it is what compensation C4 has to fix:
 * insertion feedback must exist between the gaps, not only within them.
 */
test("scenario 4b: a 2px jitter at a zone edge keeps the indicator stable", async ({
  page,
  request,
}) => {
  const fixture = await seedPage(request, EXTREME_RATIO_FIXTURE);
  const driver = createPocDriver(page);
  await driver.mountTree(fixture);

  await startPanelDrag(driver);

  // Get onto a zone first, then walk until the target CHANGES. Both halves are
  // required: jittering from a point with no active target measures dead space,
  // and jittering from the middle of one zone's catchment is not a boundary at
  // all. Either would report a clean run without testing the thing named in the
  // title.
  const first = await dragUntilTarget(driver);
  expect(
    first,
    "the drag must reach a zone before seeking a boundary"
  ).toBeGreaterThanOrEqual(0);

  let crossed = -1;
  let previous = first;
  for (let step = 0; step < 120; step++) {
    await driver.moveBy(0, 4);
    const current = await driver.readActiveTarget();
    if (current >= 0 && current !== previous) {
      crossed = current;
      break;
    }
    if (current >= 0) previous = current;
  }
  expect(
    crossed,
    "a boundary must actually be crossed, or this measures the middle of one zone"
  ).toBeGreaterThanOrEqual(0);

  // The 4px search only proves the boundary lies somewhere in (P-4, P]. Walk
  // back 1px at a time until the old target returns, which brackets it to 1px,
  // so the +/-2px samples below genuinely land on opposite sides.
  for (let step = 0; step < 6; step++) {
    await driver.moveBy(0, -1);
    if ((await driver.readActiveTarget()) === previous) break;
  }
  const observed: number[] = [];
  for (let step = 0; step < 20; step++) {
    await driver.moveBy(0, step % 2 === 0 ? 4 : -4);
    observed.push(await driver.readActiveTarget());
  }
  await driver.cancel();

  test.info().annotations.push({
    type: "boundary-jitter",
    description: JSON.stringify(observed),
  });

  // Declared here, after the evidence is collected: the run above is the
  // measurement, and it is what the annotation records either way.
  test.fail(
    true,
    "zones do not tile the canvas, so a catchment edge borders dead space"
  );

  // -1 is NOT filtered out. A run of [2,-1,2,-1,...] has one active value but
  // the indicator vanishes on every other move, which is the same defect seen
  // from the other side. Counting the inactive state makes that fail.
  const distinct = new Set(observed);
  expect(
    distinct.size,
    `the indicator must neither flip nor disappear: ${JSON.stringify(observed)}`
  ).toBe(1);
  // [-1,-1,...] also has one distinct value: the indicator was simply gone the
  // whole time.
  expect(
    [...distinct][0],
    `the indicator must stay visible: ${JSON.stringify(observed)}`
  ).toBeGreaterThanOrEqual(0);
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
test("scenario 5: a keyboard move actually moves a block", async ({
  page,
  request,
}) => {
  const fixture = await seedPage(request, FLAT_LIST_FIXTURE);
  const driver = createPocDriver(page);
  await driver.mountTree(fixture);

  const before = await driver.readTreeShape();
  test.fail(true, "this canvas has no keyboard move path at all");
  await driver.keyboardInsert("down");
  const moved = await driver.readTreeShape();

  test.info().annotations.push({
    type: "keyboard-shape",
    description: `before=${JSON.stringify(before)} moved=${JSON.stringify(moved)}`,
  });

  // A reorder, not any mutation: deleting the focused block or inserting a
  // different one also makes `moved` differ, and that is corruption rather than
  // a successful move. Same length, same ids, different order.
  expect(moved.length, "a move must not change the block count").toBe(
    before.length
  );
  expect(
    [...moved].sort(),
    "a move must not change which blocks exist"
  ).toEqual([...before].sort());
  expect(moved, "a keyboard move must reorder the tree").not.toEqual(before);
});
