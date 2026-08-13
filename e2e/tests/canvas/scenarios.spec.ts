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

import { dragUntilTarget } from "./driver";
import type { ActiveTargetTransition, CanvasDriver } from "./driver";
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

/** Step the pointer down until a drop zone becomes active, and report where. */
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

  // Exact, not within a tolerance. A distance threshold is meaningless here:
  // collision picks the NEAREST zone, so the pointer legitimately sits up to
  // half the zone spacing away, and any threshold near that is either slack
  // enough to accept a neighbour or tight enough to reject a correct answer.
  // "Is the active zone the nearest one?" has neither problem, and both the
  // stale-rect and unscaled-transform failures pick a non-nearest zone.
  const active = await driver.readActiveTarget();
  const nearest = await driver.nearestZoneToPointer();
  test.info().annotations.push({
    type: `${label}-zone`,
    description: `active=${active} nearest=${nearest}`,
  });
  expect(
    active,
    `${label}: the active zone must be the nearest to the pointer`
  ).toBe(nearest);
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

  // A net increase of one is not evidence of an insertion: a drop that removed
  // an existing block while adding two produces the same count. Every original
  // id must survive, and exactly one id must be new.
  const after = await driver.readTreeShape();
  expect(
    before.filter(id => !after.includes(id)),
    "a drop must not remove existing blocks"
  ).toEqual([]);
  const added = after.filter(id => !before.includes(id));
  expect(added, "a drop must add exactly one block").toHaveLength(1);

  // Position, not just presence. A drop handler that ignored the indicated
  // insertion point and always appended would satisfy every assertion above.
  // Zone `k` sits before child `k`, and `readTreeShape` puts the root first,
  // so the new block belongs at index `k + 1`.
  expect(
    after.indexOf(added[0]!),
    `the block must land at the indicated target (zone ${active}); tree was ${JSON.stringify(after)}`
  ).toBe(active + 1);
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

  // Prove the transform took. If `setZoom` silently stopped applying it, this
  // scenario would quietly degrade to an ordinary unscaled drag: a zone is
  // still found and it is still the nearest, so every assertion below passes
  // without scaled coordinate handling being exercised at all.
  const appliedScale = await driver.frameScale();
  expect(appliedScale, "the canvas frame must actually be scaled").toBeCloseTo(
    0.75,
    2
  );

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
 * Expected failure: this canvas has no target-switch hysteresis.
 *
 * The requirement is a sticky target with an 8-12px dead-zone margin or a
 * >100ms dwell, so that oscillating the pointer 2px around any boundary never
 * flips the indicator. Observed here, with the edge bracketed to 1px and the
 * samples taken on opposite sides of it: `[1,2,1,2,...]`, a flip on every move.
 *
 * Both halves of the method are load-bearing. Jittering anywhere other than a
 * bracketed edge measures the middle of one zone's catchment, and sampling P
 * and P+2 rather than P-2 and P+2 keeps both samples on the same side; either
 * reports a stable indicator on a canvas that has none.
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

  // Bracket the edge of `crossed`'s own catchment. Waiting for `previous` to
  // return cannot work: the file documents that zones are separated by
  // block-sized dead space, so the old zone is hundreds of pixels away and six
  // 1px moves simply run out, leaving the pointer wherever it started.
  // Search well past the largest hysteresis margin the requirement allows
  // (8-12px). Failing to find the edge within that distance is not a test
  // failure: it means the target is sticky, which is the behaviour being asked
  // for. The jitter below then runs from wherever the pointer sits and simply
  // observes no flip.
  const HYSTERESIS_SEARCH_PX = 24;
  let bracketed = false;
  for (let step = 0; step < HYSTERESIS_SEARCH_PX; step++) {
    await driver.moveBy(0, -1);
    if ((await driver.readActiveTarget()) !== crossed) {
      // One step back inside, so +/-2px straddles the edge.
      await driver.moveBy(0, 1);
      bracketed = true;
      break;
    }
  }
  test.info().annotations.push({
    type: "bracketed",
    description: String(bracketed),
  });
  // Step to P-2 first, then alternate by 4px so the samples are P+2 and P-2 —
  // genuinely opposite sides of the edge. Alternating +/-2 from P samples P+2
  // and P, both on the same side, which an implementation that switches the
  // instant the pointer crosses would still pass.
  await driver.moveBy(0, -2);

  // Recorded from inside the page, not sampled from the test. The requirement
  // permits hysteresis expressed as a dwell of more than 100ms as an
  // alternative to a distance margin, and a `readActiveTarget()` between two
  // moves is a cross-frame round trip that holds the pointer still for the
  // length of that trip. On a loaded runner that alone can outlast the dwell,
  // so a canvas that implements the timer correctly would still be seen to
  // switch on every sample and would stay classified as the known gap below.
  // Recording separates the observation from the gesture; the moves then run
  // back to back and the dwell is only as long as a mouse event takes.
  // Whether the probe was valid at all, established rather than assumed. If a
  // move took longer than the dwell the requirement allows, the pointer rested
  // at an endpoint long enough for a compliant timer to commit, and any flip
  // observed afterwards says nothing about hysteresis.
  //
  // Each move is one CDP round trip, so its duration is a property of the
  // machine rather than of the canvas. A busy runner exceeds the allowance
  // often enough that the probe has to expect it: the jitter is repeated, and
  // the first sweep whose slowest move stays inside the allowance is the one
  // read. Each sweep returns the pointer to where it started, 10 moves of +4
  // against 10 of -4, so a repeat re-probes the same bracketed edge.
  const DWELL_ALLOWANCE_MS = 100;
  const PROBE_SWEEPS = 3;
  let observed: ActiveTargetTransition[] | undefined;
  let slowest = Number.POSITIVE_INFINITY;

  for (let sweep = 0; sweep < PROBE_SWEEPS && observed === undefined; sweep++) {
    const readTransitions = await driver.recordActiveTargetTransitions();
    const moveDurations: number[] = [];
    for (let step = 0; step < 20; step++) {
      const startedAt = Date.now();
      await driver.moveBy(0, step % 2 === 0 ? 4 : -4);
      moveDurations.push(Date.now() - startedAt);
    }
    const log = await readTransitions();
    slowest = Math.max(...moveDurations);
    test.info().annotations.push({
      type: `jitter-move-durations-ms-sweep-${sweep + 1}`,
      description: JSON.stringify(moveDurations),
    });
    if (slowest < DWELL_ALLOWANCE_MS) observed = log;
  }
  await driver.cancel();

  // An unmeasurable run is INCONCLUSIVE, not a defect. Failing here would
  // report a missing canvas behaviour on evidence that cannot show one, and it
  // would do so for a reason that lives in the runner rather than the code —
  // so the outcome is a skip carrying what was measured, and the scenario keeps
  // its meaning on any machine fast enough to ask the question.
  if (observed === undefined) {
    test.skip(
      true,
      `the jitter never outpaced the ${DWELL_ALLOWANCE_MS}ms dwell a canvas may use as hysteresis across ${PROBE_SWEEPS} sweeps (slowest ${slowest}ms), so this runner cannot tell a sticky target from a slow mouse`
    );
    return;
  }

  test.info().annotations.push({
    type: "boundary-jitter",
    description: JSON.stringify(observed),
  });

  // NEVER finding a target is a different defect from missing hysteresis:
  // it means detection is broken on this fixture, and a log that only ever saw
  // -1 would otherwise satisfy the single-state assertion below and be reported
  // as the known gap. Rejected before the marker.
  //
  // A run that ALTERNATES between a zone and nothing is not that: it is the
  // indicator changing on a 2px move, which is precisely the missing
  // hysteresis, and it belongs under the marker with the zone-to-zone flip.
  expect(
    observed.some(entry => entry.index >= 0),
    `the drag must find a target at all: ${JSON.stringify(observed)}`
  ).toBe(true);

  test.fail(
    true,
    "no target-switch hysteresis: the indicator flips on every 2px move"
  );

  // The log's first entry is the state when recording began, so anything after
  // it is a change the jitter caused. -1 is NOT excluded: an indicator that
  // vanishes and returns is the same defect seen from the other side, and it
  // shows up here as two transitions rather than none.
  expect(
    observed.slice(1),
    `the indicator must neither flip nor disappear: ${JSON.stringify(observed)}`
  ).toEqual([]);
  // A log of exactly one entry that was already -1 means nothing changed
  // because nothing was ever shown.
  expect(
    observed[0]?.index,
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
  await driver.keyboardInsert("down");
  const moved = await driver.readTreeShape();

  test.info().annotations.push({
    type: "keyboard-shape",
    description: `before=${JSON.stringify(before)} moved=${JSON.stringify(moved)}`,
  });

  // Corruption invariants run OUTSIDE the expected failure. Once keyboard
  // dragging partially exists, an implementation that deletes or replaces the
  // focused block fails one of these, and that is a different defect from
  // "keyboard moves are unbuilt".
  expect(moved.length, "a move must not change the block count").toBe(
    before.length
  );
  expect(
    [...moved].sort(),
    "a move must not change which blocks exist"
  ).toEqual([...before].sort());

  // Only the absence of a reorder is the known gap.
  test.fail(true, "this canvas has no keyboard move path at all");
  expect(moved, "a keyboard move must reorder the tree").not.toEqual(before);
});
