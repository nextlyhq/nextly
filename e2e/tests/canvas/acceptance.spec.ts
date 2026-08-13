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
import {
  CanvasCapabilityError,
  dragPointerTo,
  dragUntilTarget,
} from "./driver";
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
  await dragPointerTo(driver, target);
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
    // Recorded as falling short even though it passes, because what it measures
    // is weaker than the property it is named for. Depth priority says the
    // DEEPER container wins when both could claim the pointer; this canvas has
    // no such rule — `plugin-page-builder` registers no collision priority
    // anywhere, while `@dnd-kit/collision` uses the concept throughout — and its
    // default detector ranks by pointer containment then by the dragged shape's
    // overlap, neither of which takes depth as an input.
    //
    // It passes regardless because the nested container's own gap zones cover
    // its interior, so the container under the pointer is also the owner of the
    // zone under the pointer. Separating the two needs a position where an
    // ancestor's zone competes INSIDE a descendant, and this fixture offers
    // none: every ancestor zone lies outside the nested container's box.
    //
    // So the shortfall is the missing coverage rather than a missing behaviour,
    // and it is recorded here rather than as an expected failure, which would
    // report red for a canvas that answers every position correctly.
    note(
      PLAN_POINT.collisionByDepth,
      "B-6",
      "no position in this fixture makes two depths compete, so depth priority is unseparated"
    );
    await driver.mountTree(await seedPage(request, NESTED_FIXTURE));

    // Searched, not aimed. Activation expands every gap zone from zero height,
    // so a coordinate computed before the drag starts describes a layout that
    // no longer exists when the pointer arrives, and how far it shifts depends
    // on how the canvas lays out under load. Descending until the OWNER is the
    // nested container asks the question directly rather than predicting where
    // the answer will be.
    await driver.startDragAt(await driver.dragSourceCentre());

    const boxes = await driver.readBlockBoxes();
    const inner = boxes.find(box => box.id === "nx-inner");
    expect(inner, "the nested container must be measurable").toBeTruthy();

    const origin = await driver.frameOrigin();
    const scale = await driver.frameScale();

    // A margin at each edge, in frame units. The insertion gap immediately
    // before and after the nested container belongs to the OUTER one, so a
    // pointer sitting on the boundary is a position both containers can
    // legitimately claim. Depth priority is a statement about being INSIDE,
    // and the same margin is what makes the canonical probe stable.
    const EDGE_MARGIN_PX = 8;
    const centreX = inner!.left + inner!.width / 2;
    const top = mapFramePointToHost(
      { x: centreX, y: inner!.top + EDGE_MARGIN_PX },
      origin,
      scale
    );
    const bottom = mapFramePointToHost(
      { x: centreX, y: inner!.top + inner!.height - EDGE_MARGIN_PX },
      origin,
      scale
    );
    // The unambiguous span must exist before anything is asserted about it: a
    // container shorter than two margins leaves nothing to traverse, and the
    // descent below would then report a pass having sampled nothing inside.
    expect(
      bottom.y - top.y,
      "the nested region must be tall enough to sample inside its edges"
    ).toBeGreaterThan(0);

    // The descent starts ABOVE the region and enters it under its own steps, so
    // no assertion rests on the reading taken immediately after the long jump
    // that carries the pointer here. Every recorded sample then follows one
    // small step, which is the same treatment for all of them.
    const approach = mapFramePointToHost(
      { x: centreX, y: inner!.top - EDGE_MARGIN_PX },
      origin,
      scale
    );
    await dragPointerTo(driver, approach);

    // EVERY sample taken while the pointer is inside the nested region, not the
    // first one that agrees. Exiting on the first `nx-inner` would pass an
    // implementation that resolves correctly at one depth and lets the outer
    // container win everywhere else in the same region.
    //
    // The step is derived from the zone height, and it has to be: a step larger
    // than a zone steps OVER it, so the pointer lands inside a drop zone only by
    // coincidence and the exact assertion below is left with nothing to check.
    // Half the shortest zone cannot skip one.
    //
    // Read while the drag is live, because activation is what gives the zones a
    // height at all — measured before it, every zone is 0 and the step derived
    // from them would not advance.
    const zoneHeights = (await driver.readZoneHeights()).filter(
      height => height > 0
    );
    expect(
      zoneHeights.length,
      "the drag must have expanded the drop zones before they can be sampled"
    ).toBeGreaterThan(0);
    const STEP_PX = Math.max(
      1,
      Math.floor((Math.min(...zoneHeights) * scale) / 2)
    );
    // A runaway guard, and it is bounded by the WHOLE document rather than by
    // the nested span: the span grows under the descent as gap zones expand, so
    // a cap sized to the span measured beforehand runs out partway down and the
    // descent stops for the one reason this guard exists to rule out. Nothing
    // legitimate needs more steps than the document is tall. What the descent
    // completed is asserted separately, from the exit condition.
    const root = boxes[0];
    expect(root, "the document root must be measurable").toBeTruthy();
    const maxSteps = Math.ceil((root!.height * scale) / STEP_PX) + 4;
    const owners: string[] = [];
    const zoneChoices: Array<{
      owner: string;
      active: number;
      nearest: number;
      containing: number;
    }> = [];
    let step = 0;
    let exitedBelow = false;
    for (; step < maxSteps; step += 1) {
      // The region is re-measured every sample, not computed once above. Gap
      // zones expand when the drag activates and the canvas reflows as they do,
      // so a span taken before the descent describes a layout that has since
      // moved — and the pointer then sits outside the nested container while
      // an assertion written against the stale span still calls it inside.
      const live = (await driver.readBlockBoxes()).find(
        box => box.id === "nx-inner"
      );
      if (!live) break;
      const liveTop = mapFramePointToHost(
        { x: centreX, y: live.top + EDGE_MARGIN_PX },
        origin,
        scale
      ).y;
      const liveBottom = mapFramePointToHost(
        { x: centreX, y: live.top + live.height - EDGE_MARGIN_PX },
        origin,
        scale
      ).y;
      if (driver.pointer().y > liveBottom) {
        exitedBelow = true;
        break;
      }

      // Recorded by POSITION, never by loop index. The descent begins above the
      // region, so nothing measured on the way in is attributed to a position
      // inside it.
      const inside = driver.pointer().y >= liveTop;
      const owner = inside ? await driver.readActiveZoneOwner() : null;
      if (owner !== null) {
        owners.push(owner);
        // At every sample, not just the first. A check taken once proves the
        // mapping at one depth, which is the same weakness the owner check
        // exists to close.
        zoneChoices.push({
          owner,
          active: await driver.readActiveTarget(),
          nearest: await driver.nearestZoneToPointer(),
          containing: await driver.zoneContainingPointer(),
        });
      }
      await driver.moveBy(0, STEP_PX);
    }
    await driver.cancel();

    // The descent left the region because it crossed the far edge, not because
    // it ran out of iterations. Without this the assertions below are true of
    // however much of the region the loop happened to cover.
    expect(
      exitedBelow,
      "the descent must cross the far edge of the nested region"
    ).toBe(true);
    expect(
      owners.length,
      "the descent must find at least one active zone inside the region"
    ).toBeGreaterThan(0);

    // Ownership is asserted where the collision rule is UNAMBIGUOUS, which is
    // where the pointer is inside a zone: `@dnd-kit/collision` tries pointer
    // intersection first and only falls back to the dragged shape's overlap when
    // the pointer is inside none. Under that fallback the ancestor's insertion
    // gap immediately before the nested container is a legitimate candidate,
    // because the dragged shape overlaps it too — so an ancestor winning there
    // is not a fault, and asserting over every sample makes the test fail on
    // correct behaviour.
    //
    // What this does NOT establish is depth priority; the annotation at the top
    // of the test records that and why.
    const contained = zoneChoices.filter(choice => choice.containing >= 0);
    expect(
      [...new Set(contained.map(choice => choice.owner))],
      "a zone containing the pointer inside the nested region must be its own"
    ).toEqual(["nx-inner"]);

    // Which zone won, which catches a different fault: a stale rect or an
    // unscaled transform resolves the pointer to a zone far from where it is.
    //
    // Two assertions rather than one, because the canvas answers by two rules.
    // "The nearest zone wins" is not one this canvas follows, so asserting it
    // outright fails on a legitimate boundary tie: a zone one ordinal from the
    // nearest can win when the pointer is inside neither.
    //
    // Inside a zone, the answer is exact and has no tie to lose.
    expect(
      contained.length,
      "the descent must sample the pointer inside a drop zone at least once"
    ).toBeGreaterThan(0);
    expect(
      contained.filter(choice => choice.active !== choice.containing),
      "a zone containing the pointer must be the zone that resolves"
    ).toEqual([]);

    // Outside every zone, the fallback may legitimately choose either side of a
    // boundary, so the bound is one ordinal — the resolution limit of the rule
    // itself, not a pixel tolerance.
    //
    // It is the WEAKER of the two, deliberately, and the exact assertion above
    // is what carries the guarantee. Zone spacing here is not uniform (measured
    // 9, 10, 92, 92, 132 and 133 frame px between centres), so one ordinal is
    // ten pixels of slack in the tight places and over a hundred in the loose
    // ones. A bound stated in ordinals cannot be tight everywhere, which is
    // exactly why the containing-zone case is asserted exactly rather than
    // folded in here.
    expect(
      zoneChoices.filter(
        choice => Math.abs(choice.active - choice.nearest) > 1
      ),
      "the resolved zone must be the nearest to the pointer or its neighbour"
    ).toEqual([]);
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
    // Onto a zone, not merely over the canvas. The refusal asserted below is
    // contingent on an indicator EXISTING: the reader raises only when it finds
    // one it cannot model, and answers `{count: 0}` when the canvas is drawing
    // none. Stopping wherever the panel drag lands leaves that to chance —
    // measured, the reader resolved with a count of zero and the assertion read
    // the missing indicator as a canvas that had gained the capability.
    await dragOntoZone(driver);

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
    note(PLAN_POINT.indicatorLeadsIntoGap, "B-7");
    await driver.mountTree(await seedPage(request, FLAT_LIST_FIXTURE));
    // Onto a zone, not merely over the canvas: with no zone active the canvas
    // draws no indicator and the rect is null, so the assertions below would be
    // recorded against an absent indicator rather than against the one they are
    // about.
    await dragOntoZone(driver);

    const rect = await driver.readIndicatorRect();
    const pointer = driver.pointer();
    // The bound comes from the tree being dragged over, not from a constant.
    // The fault this names is an indicator trailing the pointer by a whole
    // block, so the shortest block is what "a whole block" means here; a fixed
    // number encodes whatever the fixture's spacing happens to be, which is a
    // property of the fixture rather than of the requirement.
    const blocks = await driver.readBlockBoxes();
    const scale = await driver.frameScale();
    const shortestBlock = Math.min(
      ...blocks.slice(1).map(box => box.height * scale)
    );
    await driver.cancel();
    expect(
      shortestBlock,
      "the fixture must have blocks to measure the bound against"
    ).toBeGreaterThan(0);

    // No expected-failure marking: this canvas meets the property. The rect is
    // comparable with the pointer because the driver maps it out of frame
    // coordinates into host ones.
    expect(rect, "a drag in progress must show an indicator").not.toBeNull();
    // In the gap, not merely somewhere on screen. What this catches is an
    // indicator trailing the pointer by a whole block.
    const centre = rect!.y + rect!.height / 2;
    expect(
      Math.abs(centre - pointer.y),
      "the indicator must lead the pointer into the gap it names"
    ).toBeLessThan(shortestBlock);
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

    // A CONTROL first: the same pointer moves with no drag running. Every
    // sample includes the Playwright protocol round trip, Node scheduling and
    // whatever else a loaded runner is doing, and none of that is canvas work
    // — so measuring the drag alone makes a single GC pause look exactly like
    // a re-measured tree.
    //
    // The two samples must differ in ONE thing: whether a drag is live. Move
    // distance is not transport cost — hit-testing and zone selection scale
    // with how far the pointer travels — so a control that steps a different
    // distance, or over a different element, leaves part of the difference
    // explained by something other than drag work.
    const MOVE_COUNT = 20;
    const MOVE_PX = 12;
    const centre = await driver.canvasCentre();
    const resting = driver.pointer();
    await driver.moveBy(centre.x - resting.x, centre.y - resting.y);

    const idle: number[] = [];
    for (let move = 0; move < MOVE_COUNT; move += 1) {
      const started = Date.now();
      await driver.moveBy(0, MOVE_PX);
      idle.push(Date.now() - started);
    }

    await dragFromPanel(driver);

    const dragging: number[] = [];
    for (let move = 0; move < MOVE_COUNT; move += 1) {
      const started = Date.now();
      await driver.moveBy(0, MOVE_PX);
      dragging.push(Date.now() - started);
    }
    await driver.cancel();

    // The DIFFERENCE of the medians. A median because one outlier is
    // scheduling rather than code; a difference because the transport cost is
    // common to both samples and cancels. What survives is the work the canvas
    // does per move while a drag is live, which is what the budget is about.
    const median = (samples: number[]): number => {
      const sorted = [...samples].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)] ?? 0;
    };
    const canvasCost = median(dragging) - median(idle);

    test.info().annotations.push({
      type: "per-move-ms",
      description: `canvasCost=${String(canvasCost)} drag=${String(median(dragging))} idle=${String(median(idle))}`,
    });

    // A budget, not a frame rate. It sits where only a
    // re-measure-the-whole-tree-every-move regression can cross it: on 500
    // blocks that costs tens of milliseconds per move, while the transport it
    // is measured against costs the same either way.
    expect(
      canvasCost,
      "a move must not re-measure the whole tree"
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
