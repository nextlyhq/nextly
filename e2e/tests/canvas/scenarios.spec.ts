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

import {
  dragPointerTo,
  dragToZoneEdge,
  dragUntilInsideZone,
  dragUntilTarget,
  jitterAcrossEdge,
} from "./driver";
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

/** Begin a drag from the insert panel and carry the pointer over the canvas. */
async function startPanelDrag(driver: CanvasDriver) {
  const target = await driver.canvasCentre();
  await driver.startDragAt(await driver.dragSourceCentre());
  await dragPointerTo(driver, target);
}

/**
 * The active indicator must be where the pointer actually is.
 *
 * A non-negative ordinal alone proves only that SOME zone is active, which is
 * exactly what a stale-rect or unscaled-transform implementation still
 * produces. Comparing the indicator's live rect against the live pointer is
 * what makes the #1705 and #1706 guards real.
 */
async function expectIndicatorAtPointer(
  driver: CanvasDriver,
  label: string
): Promise<number> {
  // Driven INTO a zone before the comparison, so the exact reading is always
  // the one used. `@dnd-kit/collision` resolves to a zone containing the
  // pointer first and only ranks by the dragged shape's overlap when none does,
  // and these scenarios can stop on that fallback with the pointer outside
  // every zone.
  //
  // Tolerating that case is what makes this guard weak. An adjacency bound
  // accepts the NEIGHBOURING zone, which is precisely what a stale-scroll or
  // unscaled-transform implementation selects — so the two failures this
  // function exists to catch (#1705, #1706) can satisfy it. Inside a zone,
  // containment is exact and needs no tolerance at all, and every geometry
  // scenario can reach such a position.
  const containing = await dragUntilInsideZone(driver);

  // The indicator is read AFTER the containment walk, not before it. Reading
  // first certifies a rectangle from a position the pointer has since left: if
  // the target change during the walk hides or collapses the indicator while
  // leaving the active marker set, every scenario passes on a stale rect for a
  // position where nothing is drawn.
  const rect = await driver.readIndicatorRect();
  expect(rect, `${label}: an indicator must be visible`).not.toBeNull();

  const active = await driver.readActiveTarget();
  const nearest = await driver.nearestZoneToPointer();
  test.info().annotations.push({
    type: `${label}-zone`,
    description: `active=${active} containing=${containing} nearest=${nearest}`,
  });

  // A precondition, not a fallback. If no position inside a zone can be reached
  // the mapping question cannot be asked exactly, and answering it approximately
  // would certify the implementations this is meant to reject.
  expect(
    containing,
    `${label}: the pointer must reach a position inside a zone for containment to be decidable`
  ).toBeGreaterThanOrEqual(0);
  expect(
    active,
    `${label}: the zone containing the pointer must be the active one`
  ).toBe(containing);

  // Handed back so a caller asserting on POSITION uses the target the pointer
  // ended on. The containment walk can activate a different zone than the one
  // the caller reached, and a drop then lands at the new target while an
  // assertion written against the cached ordinal reports a failure the canvas
  // did not cause.
  return active;
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
  const reached = await dragUntilTarget(driver);
  test
    .info()
    .annotations.push({ type: "active-target", description: String(reached) });
  expect(reached).toBeGreaterThanOrEqual(0);
  // The target the pointer ENDED on, which is what the drop will use. The
  // containment walk inside this helper can activate a different zone than the
  // one `dragUntilTarget` stopped at — the first may have come from the overlap
  // fallback — and a position assertion written against the earlier ordinal
  // then reports a failure for a drop that landed exactly where it was shown.
  const active = await expectIndicatorAtPointer(driver, "cross-frame");

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

  // Onto a zone, then to that zone's EDGE. Both halves are required: jittering
  // from a point with no active target measures dead space, and jittering from
  // the middle of one zone's catchment is not a boundary at all. Either reports
  // a clean run without testing the thing named in the title.
  //
  // Shared with the acceptance suite rather than written twice. The two suites
  // ask the same question, and a second copy of this walk is invisible when it
  // is wrong — the drag still runs and still reports an ordinal.
  const edge = await dragToZoneEdge(driver);
  expect(
    edge.target,
    "the drag must reach a zone before seeking a boundary"
  ).toBeGreaterThanOrEqual(0);
  // The target must have CHANGED. A canvas whose collision resolution is stuck
  // on one target forever walks the whole search without a crossing, and every
  // jitter afterwards is stable — indistinguishable from a compliant 8-12px
  // margin or dwell. Without this, that unusable implementation produces the
  // same eventual green as a correct one.
  expect(
    edge.crossed,
    "a boundary must actually be crossed, or this measures the middle of one zone"
  ).toBe(true);
  // An unbracketed edge is INCONCLUSIVE rather than weaker evidence: a resolver
  // that advances once and never retreats satisfies `crossed`, leaves this
  // false, and jitters stably from the middle of its catchment — exactly like a
  // compliant margin. The scenario stops rather than reporting either verdict.
  test.info().annotations.push({
    type: "bracketed",
    description: String(edge.bracketed),
  });
  if (!edge.bracketed) {
    await driver.cancel();
    test.skip(
      true,
      "the reverse search never found the edge, so a stable jitter cannot be told from a target that only ever advances"
    );
    return;
  }
  // The DWELL-AWARE probe, shared with the acceptance suite so both ask the
  // question the same way. It steps to P-2 first and alternates by 4 (samples
  // on genuinely opposite sides of the edge), records transitions from inside
  // the page rather than sampling between moves, and repeats until a sweep is
  // fast enough to be conclusive.
  //
  // The timing is what makes it valid rather than merely repeated: the
  // requirement permits hysteresis as a >100ms dwell instead of a distance
  // margin, and each move is a CDP round trip whose duration belongs to the
  // machine. If a move outlasts that allowance the pointer rested long enough
  // for a compliant timer to commit, and any flip afterwards says nothing.
  const probe = await jitterAcrossEdge(driver);
  const observed = probe.transitions;
  const slowest = probe.slowestMoveMs;
  const DWELL_ALLOWANCE_MS = probe.dwellAllowanceMs;
  const PROBE_SWEEPS = probe.sweeps;
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
