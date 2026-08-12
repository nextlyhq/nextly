/**
 * The twelve properties any Nextly canvas must have, as executable acceptance.
 *
 * These land BEFORE the canvas that satisfies them. Each property the current
 * canvas cannot meet is an expected failure, so building the replacement has a
 * target that goes green point by point rather than a checklist someone ticks.
 * Written first for the reason acceptance criteria are always written first:
 * criteria authored afterwards describe what was built, and all of them pass on
 * the first day.
 *
 * **Named by property, not by number.** Two numbering schemes for this checklist
 * are already in this repository and they disagree — the dnd-kit spike numbered
 * autoscroll 7 and the 500-block budget 8, while the phase plan numbers them 8
 * and 9 and drops the spike's ninth point entirely. The merged suites use the
 * spike's numbers. A number is a claim made by a document; the property is the
 * thing itself, so each title states the property and the plan's number rides
 * along as an annotation.
 *
 * **Every expected failure names its reason.** A `test.fail()` that "passes"
 * because the page never loaded is indistinguishable from one that passes
 * because the canvas genuinely lacks the property — same colour, opposite
 * meaning — and the first silently stops being a target the moment the harness
 * breaks. Where this canvas cannot answer at all, its chrome reader throws
 * `CanvasCapabilityError` naming why, and the annotation records it.
 *
 * **Drags are synthesised pointer MOTION**, never assigned positions: a canvas
 * whose hysteresis is a dwell timer behaves differently under a teleporting
 * pointer than under a moving one, and the second is what a person does.
 */
import { expect, test } from "@playwright/test";

import {
  FLAT_LIST_FIXTURE,
  LARGE_FIXTURE,
  NESTED_FIXTURE,
  TALL_FIXTURE,
  seedPage,
} from "./fixtures";
import { mapFramePointToHost } from "./coordinate-mapping";
import { CanvasCapabilityError, dragUntilTarget } from "./driver";
import type { CanvasChromeReader, CanvasDriver } from "./driver";
import { createPocChromeReader, createPocDriver } from "./poc-driver";

test.describe.configure({ timeout: 240_000 });
test.use({ viewport: { width: 2560, height: 1400 } });

/**
 * The plan's number for each property, recorded once so the plan can be
 * followed without the titles inheriting a numbering that has already moved.
 */
const PLAN_POINT = {
  collisionByDepth: 1,
  dragStartHysteresis: 2,
  targetSwitchHysteresis: 3,
  zeroLayoutShift: 4,
  oneIndicatorInHostChrome: 5,
  indicatorLeadsIntoGap: 6,
  invalidTargetVisible: 7,
  autoscrollBounded: 8,
  cachedRectsBudget: 9,
  oneDropOneUndo: 10,
  oneEngineForBothDrags: 11,
  escapeCancelsWithoutNavigating: 12,
} as const;

/** Record which property a test covers, and why it cannot pass yet. */
function note(point: number, becomes: string, shortfall?: string): void {
  test.info().annotations.push({
    type: "acceptance",
    description: `plan point ${String(point)} · green in ${becomes}${
      shortfall === undefined ? "" : ` · falls short: ${shortfall}`
    }`,
  });
}

/** Begin a drag from the insert panel and carry the pointer over the canvas. */
async function dragFromPanel(driver: CanvasDriver): Promise<void> {
  const target = await driver.canvasCentre();
  await driver.startDragAt(await driver.dragSourceCentre());

  // The delta is measured from where the pointer ACTUALLY is after activation,
  // not from the source point. `startDragAt` is contractually allowed to move
  // past the drag threshold, and the PoC driver shifts 12px doing so — so a
  // delta computed from the source overshoots by exactly that, and a
  // replacement driver with a different activation motion overshoots by a
  // different amount. Asking the driver where the pointer is keeps the gesture
  // landing in the same place whichever driver is behind it.
  const from = driver.pointer();

  // In steps, not one jump. A single move is a teleport, and a canvas that
  // commits on dwell rather than on distance answers a teleport differently
  // from the gesture a person makes.
  const steps = 8;
  for (let step = 0; step < steps; step += 1) {
    await driver.moveBy(
      (target.x - from.x) / steps,
      (target.y - from.y) / steps
    );
  }
}

/**
 * Carry a drag onto an actual drop zone, and refuse to continue without one.
 *
 * The canvas centre is over dead space as often as not, so a test that reads a
 * target straight after {@link dragFromPanel} measures "no zone" and reports it
 * as whatever it was looking for — a collision resolved wrongly, an indicator
 * that flickers. The assertion is what keeps a property test from quietly
 * becoming a test of where the pointer happened to stop.
 */
async function dragOntoZone(driver: CanvasDriver): Promise<number> {
  await dragFromPanel(driver);
  const active = await dragUntilTarget(driver);
  expect(
    active,
    "the drag must reach a drop zone before any target is read"
  ).toBeGreaterThanOrEqual(0);
  return active;
}

test.describe("a canvas any Nextly editor could ship", () => {
  let driver: CanvasDriver;
  let chrome: CanvasChromeReader;

  test.beforeEach(({ page }) => {
    driver = createPocDriver(page);
    chrome = createPocChromeReader(page);
  });

  test("resolves a pointer collision to the innermost container", async ({
    request,
  }) => {
    note(PLAN_POINT.collisionByDepth, "B-6");
    await driver.mountTree(await seedPage(request, NESTED_FIXTURE));

    // INSIDE the nested container, not merely somewhere on the canvas. The
    // point of depth resolution is that two containers both contain the
    // pointer and the innermost has to win, so a pointer that never entered
    // `nx-inner` cannot separate that from ordinary nearest-zone handling.
    const boxes = await driver.readBlockBoxes();
    const first = boxes.find(box => box.id === "nx-inner-0");
    const second = boxes.find(box => box.id === "nx-inner-1");
    expect(
      first && second,
      "the nested children must be measurable, or the pointer cannot be aimed"
    ).toBeTruthy();

    // Enter `nx-inner` at its top, then descend until a zone activates. A
    // fixed y guesses at where the zones are and lands in the dead space
    // between them as often as not, which reports "no owner" and looks like a
    // depth failure rather than a pointer that was never over a zone.
    // CONVERTED, not used raw. `readBlockBoxes` measures inside the iframe, so
    // its rects are frame-local; the pointer moves in host coordinates. Using
    // one as the other is off by the frame's origin and wrong again by its
    // scale, and at 100% zoom with the frame near the top-left it is close
    // enough to look correct — which is how it survived.
    const origin = await driver.frameOrigin();
    const scale = await driver.frameScale();
    const entry = mapFramePointToHost(
      { x: first!.left + first!.width / 2, y: first!.top },
      origin,
      scale
    );

    await driver.startDragAt(await driver.dragSourceCentre());
    const from = driver.pointer();
    await driver.moveBy(entry.x - from.x, entry.y - from.y);
    const reached = await dragUntilTarget(driver);
    expect(
      reached,
      "the drag must reach a zone inside the nested container"
    ).toBeGreaterThanOrEqual(0);

    // No expected failure here, and the reason is worth recording. This case
    // WAS marked as one: descending from `nx-inner` appeared to find no zone
    // until well past the container's own bottom edge. That measurement was
    // taken with frame-local rects used as host coordinates, so the pointer was
    // never inside the container it was supposed to be in. Converted, the
    // canvas resolves to the innermost container correctly.
    //
    // The shortfall was the harness, not the canvas.

    // And it must still be inside `nx-inner` after that descent, or the walk
    // carried the pointer out the bottom and the ownership below is about a
    // different container entirely.
    // Both sides in the SAME space. The pointer is host, the box is frame-local,
    // so comparing them directly asks a question neither coordinate answers.
    const bottom = mapFramePointToHost(
      { x: 0, y: second!.top + second!.height },
      origin,
      scale
    );
    expect(
      driver.pointer().y,
      "the descent must not leave the nested container"
    ).toBeLessThanOrEqual(bottom.y);

    const owner = await driver.readActiveZoneOwner();
    const active = await driver.readActiveTarget();
    const nearest = await driver.nearestZoneToPointer();
    await driver.cancel();

    // The separating property, and the one the previous version never asked:
    // the zone under the pointer must belong to the INNERMOST container. A
    // canvas that always lets the outer container win passes an
    // active-equals-nearest check and fails this.
    expect(
      owner,
      "the innermost container under the pointer must own the drop zone"
    ).toBe("nx-inner");
    // Kept as well, because it catches a different fault: a stale rect or an
    // unscaled transform selects a zone that is not the nearest at all.
    expect(active, "and it must be the zone nearest the pointer").toBe(nearest);
  });

  test("never turns a click into a drag", async ({ request }) => {
    note(PLAN_POINT.dragStartHysteresis, "B-6");
    await driver.mountTree(await seedPage(request, FLAT_LIST_FIXTURE));

    // `pressAt`, not `startDragAt`: the latter passes the drag threshold by
    // contract, so the drag would already have begun before the move below.
    await driver.pressAt(await driver.dragSourceCentre());
    // Below any sane activation distance. A canvas that begins dragging here
    // makes every click on a block a possible accidental move.
    await driver.moveBy(2, 2);
    const dragging = await driver.isDragging();
    await driver.cancel();

    expect(dragging, "a 2px movement must not begin a drag").toBe(false);
  });

  test("reaches a drop zone on the fixture the hysteresis probe uses", async ({
    request,
  }) => {
    // Positive control for the expected failure below, and it is load-bearing.
    // `test.fail()` reports the same green whether the canvas lacks hysteresis
    // or the harness never got onto a zone to measure it — opposite meanings in
    // the same colour, and the second is exactly the state this suite was in
    // before `dragOntoZone` existed. Asserting the precondition separately, on
    // the SAME fixture, leaves the property as the only thing the expected
    // failure can be reporting.
    await driver.mountTree(await seedPage(request, FLAT_LIST_FIXTURE));
    const active = await dragOntoZone(driver);
    await driver.cancel();

    expect(
      active,
      "the hysteresis probe must be able to reach a zone at all"
    ).toBeGreaterThanOrEqual(0);
  });

  test("holds its target through a jitter at a zone boundary", async ({
    request,
  }) => {
    note(PLAN_POINT.targetSwitchHysteresis, "B-7");
    await driver.mountTree(await seedPage(request, FLAT_LIST_FIXTURE));
    // Jittering from dead space counts the indicator appearing and vanishing
    // as target changes, which looks exactly like the missing hysteresis this
    // is meant to detect. The property is only observable from a live zone,
    // and without this the run reported nine changes that were mostly the
    // indicator blinking rather than moving.
    await dragOntoZone(driver);

    const reader = await driver.recordActiveTargetTransitions();
    // A 2px oscillation across a boundary. With no switch margin the target
    // flips on every crossing and the indicator stutters under a hand that is
    // not perfectly still.
    for (let cycle = 0; cycle < 6; cycle += 1) {
      await driver.moveBy(0, 2);
      await driver.moveBy(0, -2);
    }
    const transitions = await reader();
    await driver.cancel();

    // The log's FIRST entry is the state when recording began, not a change, so
    // anything after it is motion the jitter caused. Comparing the whole log
    // instead asserts an array that can never be empty, which would keep this
    // reporting a shortfall the canvas does not have.
    expect(
      transitions.slice(1).map(entry => entry.index),
      "a 2px jitter must not move the drop target"
    ).toEqual([]);
    // And the indicator has to have been visible throughout: a log holding only
    // a baseline of -1 reports no movement because nothing was ever shown.
    expect(
      transitions[0]?.index,
      "the indicator must be visible to measure whether it moves"
    ).toBeGreaterThanOrEqual(0);
  });

  test("shifts no existing block when its drop zones appear", async ({
    request,
  }) => {
    note(
      PLAN_POINT.zeroLayoutShift,
      "B-6",
      "this canvas's drop zones take layout space, so every block below the " +
        "pointer moves — the same shortfall checklist.spec.ts already marks"
    );
    await driver.mountTree(await seedPage(request, FLAT_LIST_FIXTURE));

    const before = await driver.readBlockBoxes();
    await dragFromPanel(driver);
    const during = await driver.readBlockBoxes();
    await driver.cancel();

    // Unrounded, and every edge. Comparing tops alone passes a canvas that
    // reflows horizontally, and rounding hides a shift under half a pixel —
    // exactly the size a grid or a percentage-width column produces.
    // Marked HERE, not on the declaration. The declaration form makes
    // EVERY error in the body expected, so a failed seed or a broken
    // reader goes green exactly like the shortfall.
    test.fail(
      true,
      "drop zones take layout space, so every block below the pointer moves"
    );
    expect(during, "drop zones must take no layout space").toEqual(before);
  });

  test("draws exactly one insertion indicator, in host chrome", async ({
    request,
  }) => {
    note(
      PLAN_POINT.oneIndicatorInHostChrome,
      "B-7",
      "this canvas draws its indicator inside the iframe with CSS"
    );
    await driver.mountTree(await seedPage(request, FLAT_LIST_FIXTURE));
    await dragFromPanel(driver);

    // The canvas cannot answer this at all, and that refusal IS the
    // shortfall. Asserted as the reader's OWN error type BEFORE the
    // expectation is marked, so a broken selector, a missing iframe or a
    // failed seed stays a real failure instead of becoming another
    // expected one. It also fires the day the capability arrives: this
    // line goes red first and forces the target below to be rewritten.
    //
    // Wrapped in an async thunk because these readers throw SYNCHRONOUSLY:
    // `expect(reader())` never receives a promise, so `.rejects` cannot see
    // the refusal and the raw error escapes the assertion entirely.
    await expect(async () => chrome.readIndicators()).rejects.toThrow(
      CanvasCapabilityError
    );

    // Marked only now. Everything above ran unprotected.
    test.fail(
      true,
      "the indicator is drawn inside the iframe with CSS, not in host chrome"
    );

    const indicators = await chrome.readIndicators();
    await driver.cancel();

    // One claim, asserted as one. A canvas with a host indicator AND a
    // leftover inside the frame answers "one" to a host-scoped count.
    expect(indicators).toEqual({ count: 1, host: "document" });
  });

  test("puts the indicator in the gap the pointer is over", async ({
    request,
  }) => {
    note(
      PLAN_POINT.indicatorLeadsIntoGap,
      "B-7",
      "the indicator is not a host element, so its rect is not comparable"
    );
    await driver.mountTree(await seedPage(request, FLAT_LIST_FIXTURE));
    await dragFromPanel(driver);

    const rect = await driver.readIndicatorRect();
    const pointer = driver.pointer();
    await driver.cancel();

    // Marked HERE, not on the declaration. The declaration form makes
    // EVERY error in the body expected, so a failed seed or a broken
    // reader goes green exactly like the shortfall.
    test.fail(
      true,
      "the indicator is not a host element, so its rect is not comparable"
    );
    expect(rect, "a drag in progress must show an indicator").not.toBeNull();
    // In the gap, not merely somewhere on screen. What this catches is an
    // indicator trailing the pointer by a whole block.
    const centre = rect!.y + rect!.height / 2;
    expect(
      Math.abs(centre - pointer.y),
      "the indicator must lead the pointer into the gap it names"
    ).toBeLessThanOrEqual(24);
  });

  test("shows an explicit state over an invalid target", async ({
    request,
  }) => {
    note(
      PLAN_POINT.invalidTargetVisible,
      "B-7",
      "this canvas shows nothing over an illegal target"
    );
    await driver.mountTree(await seedPage(request, NESTED_FIXTURE));
    await dragFromPanel(driver);

    // The canvas cannot answer this at all, and that refusal IS the
    // shortfall. Asserted as the reader's OWN error type BEFORE the
    // expectation is marked, so a broken selector, a missing iframe or a
    // failed seed stays a real failure instead of becoming another
    // expected one. It also fires the day the capability arrives: this
    // line goes red first and forces the target below to be rewritten.
    //
    // Wrapped in an async thunk because these readers throw SYNCHRONOUSLY:
    // `expect(reader())` never receives a promise, so `.rejects` cannot see
    // the refusal and the raw error escapes the assertion entirely.
    await expect(async () => chrome.readsInvalidTarget()).rejects.toThrow(
      CanvasCapabilityError
    );

    // Marked only now. Everything above ran unprotected.
    test.fail(true, "nothing is shown over an illegal target");

    const explicit = await chrome.readsInvalidTarget();
    await driver.cancel();

    // Showing nothing is not a state. The author cannot tell "you may not drop
    // here" from "the drag broke", and both read as an unresponsive editor.
    expect(explicit, "an invalid target must be shown, not implied").toBe(true);
  });

  test("autoscrolls toward an edge and stops at the bounds", async ({
    request,
  }) => {
    note(PLAN_POINT.autoscrollBounded, "B-8");
    // A document TALLER than the canvas, or there is no scroll range and the
    // target cannot pass however correctly autoscroll is implemented.
    const fixture = await seedPage(request, TALL_FIXTURE);
    await driver.mountTree(fixture);

    // Precondition, asserted rather than assumed: if the fixture rendered
    // shorter than the viewport this case would measure a canvas that cannot
    // scroll and report it as a missing behaviour.
    const boxes = await driver.readBlockBoxes();
    const authored = boxes.reduce(
      (lowest, box) => Math.max(lowest, box.top + box.height),
      0
    );
    expect(
      authored,
      "the fixture must overflow the canvas, or autoscroll is unobservable"
    ).toBeGreaterThan(1400);

    await dragFromPanel(driver);

    // The canvas cannot answer this at all, and that refusal IS the
    // shortfall. Asserted as the reader's OWN error type BEFORE the
    // expectation is marked, so a broken selector, a missing iframe or a
    // failed seed stays a real failure instead of becoming another
    // expected one. It also fires the day the capability arrives: this
    // line goes red first and forces the target below to be rewritten.
    //
    // Wrapped in an async thunk because these readers throw SYNCHRONOUSLY:
    // `expect(reader())` never receives a promise, so `.rejects` cannot see
    // the refusal and the raw error escapes the assertion entirely.
    await expect(async () => chrome.canvasScrollTop()).rejects.toThrow(
      CanvasCapabilityError
    );

    // Marked only now. Everything above ran unprotected.
    test.fail(true, "this canvas does not autoscroll toward an edge");

    const start = await chrome.canvasScrollTop();
    // Autoscroll answers dwelling near an edge, not a single move.
    for (let tick = 0; tick < 12; tick += 1) await driver.moveBy(0, 40);
    const engaged = await chrome.canvasScrollTop();
    for (let tick = 0; tick < 40; tick += 1) await driver.moveBy(0, 40);
    const settled = await chrome.canvasScrollTop();
    const stillSettled = await chrome.canvasScrollTop();
    await driver.cancel();

    expect(engaged, "autoscroll must engage near an edge").toBeGreaterThan(
      start
    );
    // And stop. A scroll that runs past the end leaves the author looking at
    // blank space with no way back except releasing the drag.
    expect(settled, "autoscroll must stop at the bounds").toBe(stillSettled);
  });

  test("stays responsive dragging over a large tree", async ({ request }) => {
    note(PLAN_POINT.cachedRectsBudget, "B-8");
    // The LARGE fixture, because the budget is the whole point. On six
    // siblings a canvas that re-measures every block on every pointer move
    // finishes well inside 120ms, so the target passes on exactly the
    // implementation it exists to reject.
    const fixture = await seedPage(request, LARGE_FIXTURE);
    await driver.mountTree(fixture);
    // A precondition, not decoration: a fixture that silently seeded fewer
    // blocks would make the budget meaningless while still reporting green.
    expect(
      fixture.blockIds.length,
      "the budget must be measured against the supported tree size"
    ).toBeGreaterThanOrEqual(500);
    // SEEDED is not RENDERED. Timing against a canvas that mounted 6 of the 500
    // measures a small tree while claiming to measure a large one, and the
    // budget then passes on exactly the implementation it exists to reject.
    const rendered = await driver.readBlockBoxes();
    expect(
      rendered.length,
      "the tree must be on screen before timing moves against it"
    ).toBeGreaterThanOrEqual(500);

    await dragFromPanel(driver);

    // Every move timed individually. A mean hides the shape that matters: one
    // 2-second stall among twenty fast moves averages to a comfortable number
    // while the editor visibly locks up, and a canvas that re-measures the tree
    // does exactly that on the move where a rect cache misses.
    const durations: number[] = [];
    for (let move = 0; move < 20; move += 1) {
      const started = Date.now();
      await driver.moveBy(0, 12);
      durations.push(Date.now() - started);
    }
    await driver.cancel();

    const slowest = Math.max(...durations);
    const mean = durations.reduce((sum, ms) => sum + ms, 0) / durations.length;
    test.info().annotations.push({
      type: "per-move-ms",
      description: `slowest=${String(slowest)} mean=${String(Math.round(mean))}`,
    });
    // A budget, not a frame rate. Wall clock on a machine running several
    // matrices measures load as much as code, so this sits where only a
    // re-measure-the-whole-tree-every-move regression can cross it — but it is
    // the SLOWEST move that has to sit under it, not the average.
    expect(
      slowest,
      "no single move may re-measure the whole tree"
    ).toBeLessThan(120);
  });

  test("records exactly one undo entry for one drop", async ({ request }) => {
    note(
      PLAN_POINT.oneDropOneUndo,
      "B-9",
      "this canvas keeps no undo history to count"
    );
    await driver.mountTree(await seedPage(request, FLAT_LIST_FIXTURE));

    // The canvas cannot answer this at all, and that refusal IS the
    // shortfall. Asserted as the reader's OWN error type BEFORE the
    // expectation is marked, so a broken selector, a missing iframe or a
    // failed seed stays a real failure instead of becoming another
    // expected one. It also fires the day the capability arrives: this
    // line goes red first and forces the target below to be rewritten.
    //
    // Wrapped in an async thunk because these readers throw SYNCHRONOUSLY:
    // `expect(reader())` never receives a promise, so `.rejects` cannot see
    // the refusal and the raw error escapes the assertion entirely.
    await expect(async () => chrome.undoDepth()).rejects.toThrow(
      CanvasCapabilityError
    );

    // Marked only now. Everything above ran unprotected.
    test.fail(true, "this canvas keeps no undo history to count");

    const before = await chrome.undoDepth();
    await dragFromPanel(driver);
    await driver.drop();
    const after = await chrome.undoDepth();

    // Exactly one. A drop recorded as several makes undo feel broken: the
    // author presses it once and the block half-moves.
    expect(after - before, "one drop is one undoable edit").toBe(1);
  });

  test("drives a canvas drag with the same engine as a panel drag", async ({
    request,
  }) => {
    note(
      PLAN_POINT.oneEngineForBothDrags,
      "B-15",
      "dragging a block already in the canvas is not offered here"
    );
    const fixture = await seedPage(request, FLAT_LIST_FIXTURE);
    await driver.mountTree(fixture);

    // The canvas cannot answer this at all, and that refusal IS the
    // shortfall. Asserted as the reader's OWN error type BEFORE the
    // expectation is marked, so a broken selector, a missing iframe or a
    // failed seed stays a real failure instead of becoming another
    // expected one. It also fires the day the capability arrives: this
    // line goes red first and forces the target below to be rewritten.
    //
    // Wrapped in an async thunk because these readers throw SYNCHRONOUSLY:
    // `expect(reader())` never receives a promise, so `.rejects` cannot see
    // the refusal and the raw error escapes the assertion entirely.
    await expect(async () =>
      chrome.startDragOfBlock(fixture.blockIds[1] ?? "")
    ).rejects.toThrow(CanvasCapabilityError);

    // Marked only now. Everything above ran unprotected.
    test.fail(
      true,
      "dragging a block already in the canvas is not offered here"
    );

    await chrome.startDragOfBlock(fixture.blockIds[1] ?? "");
    // The same observable state a panel drag produces. Two engines drift:
    // one gains a hysteresis fix or an autoscroll tune and the other does
    // not, and the canvas then behaves differently depending on where the
    // block came from.
    const dragging = await driver.isDragging();
    const active = await driver.readActiveTarget();
    const nearest = await driver.nearestZoneToPointer();
    await driver.cancel();

    expect(dragging, "a canvas drag reports the same drag state").toBe(true);
    expect(active, "and resolves targets by the same rule").toBe(nearest);
  });

  test("leaves the document and the editor intact when Escape cancels", async ({
    request,
  }) => {
    note(PLAN_POINT.escapeCancelsWithoutNavigating, "B-11");
    await driver.mountTree(await seedPage(request, FLAT_LIST_FIXTURE));

    const before = await driver.readTreeShape();
    await dragFromPanel(driver);
    await driver.cancel();

    // Two of the three claims. Split from the third because a canvas can
    // satisfy any two, and folding them into one assertion would let this
    // canvas's shortfall on the third hide the regression cover the first two
    // give today.
    expect(await driver.readTreeShape(), "Escape changes nothing").toEqual(
      before
    );
    expect(
      await driver.isEditorPresent(),
      "and the shell does not treat it as go-back"
    ).toBe(true);
  });

  test("ends the drag when Escape cancels", async ({ request }) => {
    note(
      PLAN_POINT.escapeCancelsWithoutNavigating,
      "B-11",
      "this canvas leaves its drag state set after Escape; the gesture stops " +
        "affecting the document but never reports that it ended"
    );
    await driver.mountTree(await seedPage(request, FLAT_LIST_FIXTURE));
    await dragFromPanel(driver);

    // A precondition with teeth: if the drag never started, "not dragging"
    // below is satisfied by absence and the target passes on nothing.
    expect(
      await driver.isDragging(),
      "the drag must be running before Escape can end it"
    ).toBe(true);

    // Escape ALONE. `cancel` releases the pointer straight after, so reading
    // the state through it cannot tell Escape ending the drag from the
    // mouse-up ending it — and a dead Escape handler passes.
    await driver.pressEscape();
    const afterEscape = await driver.isDragging();
    await driver.cancel();

    // Marked HERE, not on the declaration, so a failed seed or a broken
    // driver is a real failure rather than another expected one.
    test.fail(true, "the drag state stays set after Escape");
    expect(afterEscape, "Escape must end the drag").toBe(false);
  });
});
