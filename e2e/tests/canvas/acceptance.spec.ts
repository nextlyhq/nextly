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
  readSeededBlockBoxes,
  seedPage,
} from "./fixtures";
import { mapFramePointToHost } from "./coordinate-mapping";
import {
  CanvasCapabilityError,
  dragPointerTo,
  dragSourceUntilTarget,
  dragToZoneEdge,
  dragUntilInsideZone,
  dragUntilTarget,
  jitterAcrossEdge,
  readShellState,
  dwellAllowanceOf,
  settledTarget,
  settledValue,
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

/**
 * How long a cancelled drag may take to report that it ended, in milliseconds.
 *
 * Generous on purpose. The property is that Escape ends the drag, not that it ends it
 * within any particular frame, so a tight bound here would turn a loaded CI runner into
 * a canvas defect. Measured locally the state clears within 100ms; the allowance is a
 * ceiling the poll stops early on rather than a wait anyone pays.
 */
const ESCAPE_SETTLE_MS = 2_000;

/**
 * Time budgets for the autoscroll case, in milliseconds.
 *
 * Durations rather than move counts. The scroll advances on the canvas's own timer, so a number of
 * synthesised pointer events says nothing about how far it has travelled — a faster runner sends
 * them sooner and arrives at the same place later in wall-clock terms, which is exactly backwards.
 *
 * Each is a CEILING that the wait stops early on. Reaching the bound in 200ms costs 200ms; the
 * budget is only spent when the canvas never arrives, which is the failure being reported.
 */
const ENGAGE_WINDOW_MS = 2_000;
const REACH_BOUND_WINDOW_MS = 15_000;
const HOLD_AT_BOUND_MS = 500;

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

/**
 * The two sources the invalid-target point needs, each carried onto a zone.
 *
 * A pair, because either drag alone is satisfied by a canvas that treats every target the same
 * way. Both go through the shared transport so the gesture is identical and only the block differs.
 */
async function dragRestrictedOntoZone(driver: CanvasDriver): Promise<number> {
  return dragSourceUntilTarget(
    driver,
    await driver.restrictedDragSourceCentre()
  );
}

/** A drag an ordinary container will take. */
async function dragAcceptedOntoZone(driver: CanvasDriver): Promise<number> {
  return dragSourceUntilTarget(driver, await driver.acceptedDragSourceCentre());
}

/**
 * What a running drag looks like from outside, whichever engine is driving it.
 *
 * Deliberately reads only what BOTH a panel drag and a canvas drag can answer,
 * so the two are comparable rather than merely both measured. Anything one side
 * cannot report would make the comparison a statement about the harness.
 *
 * Containment rather than proximity for the target reading. `@dnd-kit/collision`
 * resolves to a zone CONTAINING the pointer first and only ranks by overlap when
 * none does, so a nearest-zone equality holds most of the time and fails next to
 * a boundary — a flake that reads as an engine disagreement.
 */
async function engineSignature(driver: CanvasDriver): Promise<{
  dragging: boolean;
  resolvesToContainingZone: boolean;
}> {
  const containing = await driver.zoneContainingPointer();
  // SETTLED, because a canvas using the permitted dwell rather than a distance
  // margin is entitled to keep the previous target for up to the allowance
  // after the pointer moves into a new zone. Sampling immediately reports
  // `resolvesToContainingZone: false` for a correct engine, which fails the
  // panel-side control before the marker even when both drags share it.
  const active = await settledTarget(driver);
  return {
    dragging: await driver.isDragging(),
    resolvesToContainingZone: containing >= 0 && active === containing,
  };
}

test.describe("a canvas any Nextly editor could ship", () => {
  let driver: CanvasDriver;
  let chrome: CanvasChromeReader;

  test.beforeEach(({ page }) => {
    driver = createPocDriver(page);
    chrome = createPocChromeReader(page, driver);
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
      owner: string | null;
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
      if (driver.pointer().y >= liveTop) {
        // Containment is measured at EVERY sample inside the region, before
        // anything is known about whether a target activated. Recording it only
        // where one did would drop exactly the positions that matter: a canvas
        // missing most of its zones and activating one leaves the misses
        // invisible, and the samples that survive all agree.
        const containing = await driver.zoneContainingPointer();
        // Settled wherever the pointer is INSIDE a zone, which is exactly where
        // the assertions below read this. A stale reading there is wrong in
        // both directions: a pointer that has just entered may legitimately
        // have no owner yet, AND it may still be showing the PREVIOUS zone's
        // owner. Settling only the absent case answers the first and takes the
        // second at face value, recording a lingering owner as one the canvas
        // chose. Outside a zone nothing asserts on the value, so the wait is
        // not spent there.
        const owner =
          containing >= 0
            ? await settledValue(
                () => driver.readActiveZoneOwner(),
                dwellAllowanceOf(driver),
                "active zone owner"
              )
            : await driver.readActiveZoneOwner();
        if (owner !== null) owners.push(owner);
        zoneChoices.push({
          owner,
          active: await driver.readActiveTarget(),
          nearest: await driver.nearestZoneToPointer(),
          containing,
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
    // A zone under the pointer must be the ACTIVE one. Asserted before the
    // owner, because ownership of a zone nothing selected says nothing about
    // what the canvas resolved: a sample where the pointer sits inside a zone
    // and no target is active is a zone the canvas missed, and it has to fail
    // rather than quietly leave the set.
    expect(
      contained.filter(choice => choice.owner === null),
      "a zone containing the pointer must have activated a target"
    ).toEqual([]);
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
      zoneChoices
        .filter(choice => choice.active >= 0)
        .filter(choice => Math.abs(choice.active - choice.nearest) > 1),
      "the resolved zone must be the nearest to the pointer or its neighbour"
    ).toEqual([]);
  });

  test("never turns a click into a drag", async ({ request }) => {
    note(PLAN_POINT.dragStartHysteresis, "B-6");
    await driver.mountTree(await seedPage(request, FLAT_LIST_FIXTURE));

    // `pressAt`, not `startDragAt`: the latter passes the drag threshold by
    // contract, so the drag would already have begun before the move below.
    const source = await driver.dragSourceCentre();
    await driver.pressAt(source);
    // Below any sane activation distance. A canvas that begins dragging here
    // makes every click on a block a possible accidental move.
    await driver.moveBy(2, 2);
    const subThreshold = await driver.isDragging();
    // The SAME press, carried past the threshold BY THE DRIVER. Without this
    // the assertion below is satisfied by absence: a press that never landed —
    // a moved handle, a changed selector, an overlay swallowing the pointerdown
    // — reports "not dragging" exactly as a correct hysteresis does, and the
    // target then passes on a gesture that never happened. Continuing the same
    // gesture rather than starting a second one is what makes it a control: it
    // proves the press this test made was live.
    //
    // The distance is the DRIVER's, not a number written here. Activation
    // motion is explicitly each canvas's own, so a hard-coded displacement
    // asserts this canvas's threshold on every replacement — and one whose
    // activation distance is larger leaves the press below threshold, failing a
    // control for a property it satisfies.
    await driver.crossActivationThreshold();
    const pastThreshold = await driver.isDragging();
    await driver.cancel();

    expect(
      pastThreshold,
      "the press must be live, or 'not dragging' proves nothing"
    ).toBe(true);
    expect(subThreshold, "a 2px movement must not begin a drag").toBe(false);
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
    note(
      PLAN_POINT.targetSwitchHysteresis,
      "B-7",
      "this canvas has no switch margin: bracketed at an edge, the target " +
        "flips on every 2px crossing"
    );
    await driver.mountTree(await seedPage(request, FLAT_LIST_FIXTURE));
    // Onto a zone, then to that zone's EDGE. Both halves are preconditions with
    // teeth. Jittering from dead space counts the indicator appearing and
    // vanishing as target changes, which looks exactly like the missing
    // hysteresis this is meant to detect; jittering from the middle of a zone's
    // catchment reports a stable target on a canvas with NO hysteresis, because
    // nothing there was ever close to switching. The second is the weaker
    // failure and the harder to see: it passes, and it passes for a reason that
    // has nothing to do with the property.
    await dragFromPanel(driver);
    const edge = await dragToZoneEdge(driver);
    expect(
      edge.target,
      "the drag must reach a zone before a boundary can be sought"
    ).toBeGreaterThanOrEqual(0);
    // The target must have CHANGED at least once. A canvas stuck on one target
    // forever never crosses a boundary, and every jitter afterwards is stable —
    // which reads exactly like the compliant switch margin this point asks for.
    // Asserted rather than annotated, because that unusable implementation
    // would otherwise produce the same green as a correct one.
    expect(
      edge.crossed,
      "a boundary must be crossed, or this measures a target that never moves"
    ).toBe(true);
    // An unbracketed edge makes the jitter INCONCLUSIVE rather than weaker, so
    // the run stops here. A resolver sticky in one direction only advances once
    // and never retreats: it satisfies `crossed`, leaves this false, and then
    // jitters perfectly stably from the middle of its catchment — which is what
    // a compliant margin looks like. Failing would blame a canvas that may be
    // correct; continuing would let a broken one read as correct the day the
    // marker comes off. Neither is an answer, so neither is given.
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

    // The DWELL-AWARE probe, shared with the scenario suite. The requirement
    // permits hysteresis expressed as a >100ms dwell instead of a distance
    // margin, and each move is a CDP round trip whose duration belongs to the
    // machine: on a loaded runner one move outlasts that dwell, the pointer
    // rests long enough for a compliant timer to commit, and the flip that
    // follows says nothing about hysteresis. An untimed jitter reports that as
    // this canvas's known gap.
    const probe = await jitterAcrossEdge(driver);
    await driver.cancel();

    // Unmeasurable is INCONCLUSIVE, not a shortfall. Failing here would report
    // a missing canvas behaviour on evidence that cannot show one, for a reason
    // living in the runner rather than the code.
    if (probe.transitions === undefined) {
      test.skip(
        true,
        `the jitter never outpaced the ${String(probe.dwellAllowanceMs)}ms dwell a canvas may use as hysteresis across ${String(probe.sweeps)} sweeps (slowest ${String(probe.slowestMoveMs)}ms), so this runner cannot tell a sticky target from a slow mouse`
      );
      return;
    }
    const transitions = probe.transitions;

    // The indicator has to have been visible throughout: a log holding only a
    // baseline of -1 reports no movement because nothing was ever shown. A
    // precondition, so it runs BEFORE the expectation is marked.
    expect(
      transitions[0]?.index,
      "the indicator must be visible to measure whether it moves"
    ).toBeGreaterThanOrEqual(0);

    // Marked only now. Everything above ran unprotected, so a failed seed, a
    // drag that never reached a zone, a target that never moved, or a probe the
    // runner was too slow to take stays a real outcome of its own rather than
    // becoming another expected failure.
    test.fail(true, "the target flips on every 2px crossing of a zone edge");

    // The log's FIRST entry is the state when recording began, not a change, so
    // anything after it is motion the jitter caused. Comparing the whole log
    // instead asserts an array that can never be empty, which would keep this
    // reporting a shortfall the canvas does not have.
    expect(
      transitions.slice(1).map(entry => entry.index),
      "a 2px jitter must not move the drop target"
    ).toEqual([]);
  });

  test("shifts no existing block when its drop zones appear", async ({
    request,
  }) => {
    note(PLAN_POINT.zeroLayoutShift, "B-6");
    await driver.mountTree(await seedPage(request, FLAT_LIST_FIXTURE));

    const before = await readSeededBlockBoxes(driver, FLAT_LIST_FIXTURE);
    await dragFromPanel(driver);
    // Without this the assertion below is satisfied by a drag that never
    // started: no drag means no zones appear, `during` equals `before`, and
    // zero reflow is indistinguishable from zero interaction.
    expect(
      await driver.isDragging(),
      "the drag must be active for the mid-drag geometry to mean anything"
    ).toBe(true);
    const during = await readSeededBlockBoxes(driver, FLAT_LIST_FIXTURE);
    await driver.cancel();

    // Unrounded, and every edge. Comparing tops alone passes a canvas that
    // reflows horizontally, and rounding hides a shift under half a pixel —
    // exactly the size a grid or a percentage-width column produces.
    // The droppable is out of flow and its slot is permanently zero-height, so
    // no zone contributes geometry at any point in a drag.
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
    const childHeights = blocks.slice(1).map(box => box.height * scale);
    await driver.cancel();
    // The children have to EXIST before a bound is derived from them. With only
    // the root measured — a child selector that stopped matching, a replacement
    // driver reporting less — `Math.min()` of nothing is `Infinity`, a
    // "greater than 0" precondition passes on it, and the distance assertion
    // below accepts any indicator anywhere on screen while reporting this
    // acceptance point green.
    expect(
      childHeights.length,
      "the fixture must render blocks to measure the bound against"
    ).toBeGreaterThan(0);
    const shortestBlock = Math.min(...childHeights);
    expect(
      Number.isFinite(shortestBlock) && shortestBlock > 0,
      "the derived bound must be a real distance"
    ).toBe(true);

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
    note(PLAN_POINT.invalidTargetVisible, "B-7");
    await driver.mountTree(await seedPage(request, NESTED_FIXTURE));

    // The driver's restricted source is a block restricting its own PARENT, which is what makes an
    // illegal target reachable at all: no block in the shipped registry declares an `allowedBlocks`
    // slot, so a slot-side refusal has nothing to refuse and a container-side one has everything.
    const refused = await dragRestrictedOntoZone(driver);
    expect(
      refused,
      "the refused drag must reach a drop zone before the canvas is read"
    ).toBeGreaterThanOrEqual(0);
    const explicit = await chrome.readsInvalidTarget();
    await driver.cancel();

    // Showing nothing is not a state. The author cannot tell "you may not drop
    // here" from "the drag broke", and both read as an unresponsive editor.
    expect(explicit, "an invalid target must be shown, not implied").toBe(true);

    // The other half, and without it the point is satisfied by a canvas that draws a refusal over
    // EVERY target. That canvas tells the author nothing — a signal present everywhere carries no
    // information — and it passes every assertion above.
    await driver.mountTree(await seedPage(request, NESTED_FIXTURE));
    const accepted = await dragAcceptedOntoZone(driver);
    expect(
      accepted,
      "the permitted drag must reach a drop zone before the canvas is read"
    ).toBeGreaterThanOrEqual(0);
    const overLegal = await chrome.readsInvalidTarget();
    await driver.cancel();
    expect(
      overLegal,
      "a target that accepts the block must not be shown as invalid"
    ).toBe(false);
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

    // A second precondition, and it is about the CANVAS rather than the fixture: a document that
    // renders tall enough still gives autoscroll nothing to do if the element that holds it does
    // not overflow. The two are different failures and only this one is invisible in the boxes.
    const range = await chrome.canvasScroll();
    expect(
      range.max,
      "the canvas must have somewhere to scroll TO, or nothing here can move"
    ).toBeGreaterThan(0);
    expect(range.top, "the canvas must start at the top").toBe(0);

    // To the EDGE, then dwell. Autoscroll answers a pointer resting near a boundary, not a single
    // move — and walking down in fixed steps runs the pointer off the viewport before it has
    // dwelled anywhere, which reads as the canvas ignoring the gesture.
    const source = await driver.dragSourceCentre();
    await driver.startDragAt(source);
    await dragPointerTo(driver, await driver.canvasBottomEdge());
    let pointerUp = false;

    // Moving by a pixel each tick rather than holding still. dnd-kit recomputes the scroll intent
    // from the drag position, and a pointer that never moves again produces no further signal —
    // so a perfectly still hold can measure a canvas that simply stopped being told anything.
    const nudge = async () => {
      pointerUp = !pointerUp;
      await driver.moveBy(0, pointerUp ? 1 : -1);
    };

    /**
     * Keep the pointer alive until `done`, or until the deadline passes.
     *
     * By ELAPSED TIME, not by a count of moves. The scroll advances on dnd-kit's own timer, so a
     * number of Playwright commands is not a duration: on a fast runner the loop can finish before
     * a correct autoscroller has crossed a 5000px range, and the bound assertion then fails on a
     * canvas doing exactly the right thing. Counting events measures the harness.
     */
    const keepDragging = async (
      untilMs: number,
      done?: () => Promise<boolean>
    ) => {
      const deadline = Date.now() + untilMs;
      while (Date.now() < deadline) {
        await nudge();
        if (done && (await done())) return;
      }
    };

    // Engagement is a change, so it needs only enough time for the first tick to land.
    await keepDragging(
      ENGAGE_WINDOW_MS,
      async () => (await chrome.canvasScroll()).top > range.top
    );
    const engaged = await chrome.canvasScroll();

    // The bound is an ARRIVAL, so this waits for it rather than for a number of moves, and stops
    // as soon as it is reached. A timeout here means autoscroll never got there, which the
    // assertions below report as the failure it is rather than hiding in a longer wait.
    await keepDragging(REACH_BOUND_WINDOW_MS, async () => {
      const now = await chrome.canvasScroll();
      return now.top >= now.max;
    });
    const settled = await chrome.canvasScroll();
    // And STAYS there while the pointer is still at the edge, which is the "stops" half.
    await keepDragging(HOLD_AT_BOUND_MS);
    const stillSettled = await chrome.canvasScroll();
    await driver.cancel();

    expect(
      engaged.top,
      "autoscroll must engage while the pointer rests near an edge"
    ).toBeGreaterThan(range.top);
    // And STOP, at the end rather than merely somewhere. Two equal readings alone are satisfied by
    // a scroll that stalled for any reason, including one that never started — so the bound is
    // asserted as well. A scroll that runs past the end leaves the author looking at blank space
    // with no way back except releasing the drag.
    expect(
      settled.top,
      "autoscroll must not scroll past the end of the document"
    ).toBeLessThanOrEqual(settled.max);
    expect(
      settled.top,
      "autoscroll must actually reach the bound it is asked to stop at"
    ).toBe(settled.max);
    expect(
      stillSettled.top,
      "autoscroll must stay stopped once it is at the bound"
    ).toBe(settled.top);
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
      "this canvas publishes no undo depth a test can read"
    );
    await driver.mountTree(await seedPage(request, FLAT_LIST_FIXTURE));

    // The canvas cannot answer this, and that refusal IS the shortfall — but the
    // refusal is about the SEAM, not the feature. The editor keeps a bounded undo
    // history in its store; nothing publishes a depth to the DOM, so no test can
    // read one. Directing a maintainer to implement undo would send them to build
    // what already exists.
    //
    // Asserted as the reader's OWN error type BEFORE the expectation is marked, so
    // a broken selector, a missing iframe or a failed seed stays a real failure
    // instead of becoming another expected one.
    //
    // This assertion is a tripwire rather than a restatement, and it is one only
    // because `undoDepth` QUERIES the seam in both documents and refuses on an actual
    // absence. Publish the attribute and the reader returns a count, this line goes red,
    // and the target below has to be rewritten. Guarding a reader that refused without
    // looking would detect only that reader being edited, never the seam arriving.
    //
    // The async thunk covers a reader that signals failure either way: a synchronous
    // throw never reaches `expect(reader())` as a promise, so `.rejects` cannot see it,
    // while a rejected promise works through the thunk unchanged.
    await expect(async () => chrome.undoDepth()).rejects.toThrow(
      CanvasCapabilityError
    );

    // THE CONTROL, with its own drop, entirely before the marker. A drop that
    // changed nothing would make `after - before === 1` a statement about a
    // gesture that did not happen — an editor logging an undo step for a no-op
    // is worse than one logging none, because the author presses undo and
    // watches nothing.
    //
    // It cannot share the measured drop below, because the count needs a
    // reading BEFORE its own drop and `undoDepth` throws today. Under an active
    // marker that throw would be recorded as the expected missing-undo failure
    // and the control would never run at all.
    const treeBefore = await driver.readTreeShape();
    // Onto a live zone, not merely over the canvas. `dragFromPanel` stops at
    // the centre, which the file's own comment says is dead space as often as
    // not — and a drop there inserts nothing.
    await dragOntoZone(driver);
    await driver.drop();
    // POLLED, because the insert is asynchronous: the canvas re-renders after
    // the drop resolves, so a single read taken immediately sees the tree the
    // drag started from and reports a working drop as having changed nothing.
    await expect
      .poll(async () => (await driver.readTreeShape()).length, {
        message:
          "a drop must change the document before any undo entry for it means anything",
      })
      .toBe(treeBefore.length + 1);

    // Marked only now. Everything above ran unprotected.
    test.fail(true, "this canvas publishes no undo depth a test can read");

    const before = await chrome.undoDepth();
    await dragOntoZone(driver);
    await driver.drop();
    const after = await chrome.undoDepth();

    // Exactly one. A drop recorded as several makes undo feel broken: the
    // author presses it once and the block half-moves.
    expect(after - before, "one drop is one undoable edit").toBe(1);
  });

  test("picks up a block already in the canvas", async ({ request }) => {
    // The CONTROL the engine-parity case below depends on, kept as its own test so it
    // fails for its own reason. That case runs this reader under an expected-failure
    // marker, where a reader that stopped finding the block or stopped activating its
    // drag would be absorbed as the shortfall it is investigating — leaving the suite
    // green having measured nothing about either.
    //
    // Deliberately the SIMPLEST possible use: one drag, nothing before it. The parity
    // case starts this drag after a cancelled one, so the two differ only in what
    // precedes them, and that is exactly the difference under investigation there.
    const fixture = await seedPage(request, FLAT_LIST_FIXTURE);
    await driver.mountTree(fixture);

    await chrome.startDragOfBlock(fixture.blockIds[1] ?? "");

    // POLLED for the same reason the Escape case polls: the drag state is written on a
    // React commit, so a read taken in the tick that started the drag sees the state one
    // commit before it is set and reports a working drag as a dead one.
    await expect
      .poll(async () => driver.isDragging(), {
        message:
          "a placed block must be draggable on a canvas with no prior drag",
        timeout: ESCAPE_SETTLE_MS,
      })
      .toBe(true);

    await driver.cancel();
  });

  test("drives a canvas drag with the same engine as a panel drag", async ({
    request,
  }) => {
    note(
      PLAN_POINT.oneEngineForBothDrags,
      "B-15",
      "a drag started after a cancelled drag does not activate"
    );
    const fixture = await seedPage(request, FLAT_LIST_FIXTURE);
    await driver.mountTree(fixture);

    // BOTH drags, measured the same way, and compared against each other.
    // Reading only the canvas drag asks whether it works, not whether it is the
    // same engine — two independent implementations both satisfy that whenever
    // the canvas one reports dragging, so it cannot separate them. The property
    // is AGREEMENT, which is why neither side may be a constant written into
    // this file.
    //
    // The panel side runs BEFORE the marker, with everything it depends on.
    // Under an active `test.fail`, a panel-side harness regression — a broken
    // `dragOntoZone`, a reader that stopped working — is recorded as the
    // expected failure and the canvas comparison below is never reached, so the
    // control stops controlling anything at exactly the moment it matters.
    await dragOntoZone(driver);
    // INSIDE a zone, not merely on one. `dragOntoZone` stops as soon as a
    // target resolves, and that can be the overlap fallback with the pointer
    // outside every zone — measured, this control read
    // `resolvesToContainingZone: false` from a perfectly healthy panel drag.
    // The signature's exact reading is only decidable from containment.
    await dragUntilInsideZone(driver);
    const panel = await engineSignature(driver);
    await driver.cancel();

    // The panel side is the reference, so it has to be a live drag resting
    // inside a zone. Two dead readings compare equal, and `toEqual` below would
    // report two engines agreeing when neither was running.
    expect(
      panel,
      "the panel drag is the reference and must be live and on a zone"
    ).toEqual({ dragging: true, resolvesToContainingZone: true });

    // The previous drag must be DEMONSTRABLY over before the next one starts. A drag
    // begun while the last one is still tearing down never activates at all, and
    // `cancel` returns as soon as the events are sent rather than when the engine has
    // settled — so without this the canvas looks unable to drag its own blocks.
    await expect
      .poll(async () => driver.isDragging(), {
        message:
          "the panel drag must be fully over before the canvas drag begins",
        timeout: ESCAPE_SETTLE_MS,
      })
      .toBe(false);

    await chrome.startDragOfBlock(fixture.blockIds[1] ?? "");
    // Marked HERE, with the panel-side control and the settle above it.
    //
    // The shortfall is an interaction between consecutive drags, not a missing capability
    // and not a failure to cancel. `CanvasNode` makes every placed block a drag source,
    // and started on its own this drag activates: the source inside the frame reports
    // `aria-grabbed="true"` and carries the dragging class across repeated moves. Started
    // after a panel drag has run and been cancelled, it does not, and waiting for the
    // first drag to report that it ended does not change that.
    //
    // So the settle above is necessary and NOT sufficient, and what survives a cancel to
    // block the next drag is not yet isolated.
    test.fail(true, "a drag started after a cancelled drag does not activate");
    // Advanced INSIDE a zone, exactly as the panel side is. Sampling the two
    // under different conditions makes the comparison a statement about the
    // harness: `dragUntilTarget` can resolve through overlap with the pointer
    // outside every zone, so a canvas drag using the very same engine reports
    // `resolvesToContainingZone: false` and stays an expected failure.
    await dragUntilTarget(driver);
    await dragUntilInsideZone(driver);
    const canvas = await engineSignature(driver);
    await driver.cancel();

    // Two engines drift: one gains a hysteresis fix or an autoscroll tune and
    // the other does not, and the canvas then behaves differently depending on
    // where the block came from.
    //
    // WHAT THIS DOES NOT PROVE, stated because the title overreaches and a
    // future reader should not take the green for more than it is: two
    // independent engines that both report dragging and both resolve to the
    // containing zone pass this. Agreement on observable behaviour is necessary
    // for "one engine" and nowhere near sufficient, and the drift this case
    // exists to catch — a hysteresis fix or an autoscroll tune landing on one
    // side only — is not represented in either reading.
    //
    // Separating the two genuinely needs an identity boundary rather than a
    // behavioural sample: one provider both drags resolve through, asserted at
    // the architecture rather than through the DOM. That is a B-15 design
    // decision and cannot be bolted on from the harness, so it is recorded here
    // rather than approximated with more booleans.
    expect(canvas, "a canvas drag behaves as a panel drag does").toEqual(panel);
  });

  test("leaves the document and the editor intact when Escape cancels", async ({
    page,
    request,
  }) => {
    note(PLAN_POINT.escapeCancelsWithoutNavigating, "B-11");
    await driver.mountTree(await seedPage(request, FLAT_LIST_FIXTURE));

    const before = await driver.readTreeShape();
    // Read through the shared probe rather than assembled here. Two
    // hand-written copies of one invariant drift: a correction applied to one
    // never reaches the other, and both keep claiming the same property while
    // disagreeing about it.
    const shellBefore = await readShellState(page, driver);
    await dragFromPanel(driver);
    await driver.cancel();

    // Two of the three claims. Split from the third because a canvas can
    // satisfy any two, and folding them into one assertion would let this
    // canvas's shortfall on the third hide the regression cover the first two
    // give today.
    expect(await driver.readTreeShape(), "Escape changes nothing").toEqual(
      before
    );
    // The LOCATION and the DOM together. A shell that treats Escape as go-back
    // changes the location synchronously while the outgoing document stays
    // mounted for a tick, so a presence check alone reads the editor on its way
    // out and reports no navigation.
    expect(
      await readShellState(page, driver),
      "Escape must not navigate away or unmount the editor"
    ).toEqual({ url: shellBefore.url, hasEditor: true });
  });

  test("ends the drag when Escape cancels", async ({ request }) => {
    note(
      PLAN_POINT.escapeCancelsWithoutNavigating,
      "B-11",
      "Escape clears the drag state, but a cancel leaves the engine unable to start the next drag"
    );
    await driver.mountTree(await seedPage(request, FLAT_LIST_FIXTURE));
    await dragFromPanel(driver);

    // A precondition with teeth: if the drag never started, "not dragging"
    // below is satisfied by absence and the target passes on nothing.
    expect(
      await driver.isDragging(),
      "the drag must be running before Escape can end it"
    ).toBe(true);

    // Escape ALONE. `cancel` releases the pointer straight after, so reading the
    // state through it cannot tell Escape ending the drag from the mouse-up ending
    // it — and a dead Escape handler passes. The release below happens only after
    // the assertion has already been satisfied.
    await driver.pressEscape();

    // POLLED, not read once. The drag state clears on a React commit, so a read taken
    // in the same tick as the key press observes the state one commit BEFORE it is
    // cleared — measured, `aria-grabbed` is still set at +0ms and gone by +100ms. A
    // single read there reports a working Escape as a dead one.
    //
    // The bound IS the claim: an Escape that has not ended the drag within it has not
    // ended it. Polling stops early on success, so a canvas that cancels promptly pays
    // nothing for the allowance.
    await expect
      .poll(async () => driver.isDragging(), {
        message: "Escape must clear the drag state",
        timeout: ESCAPE_SETTLE_MS,
      })
      .toBe(false);

    // WHAT THIS ESTABLISHES, stated because the title is broader than the assertion.
    //
    // Escape clears the drag state: `aria-grabbed` goes false in both documents, within
    // about 100ms. That is what the poll asserts and all it asserts.
    //
    // Clearing the source attribute is NECESSARY and not sufficient for "the drag ended",
    // and this file holds the counterexample: the engine-parity case starts a drag after
    // this same cancellation and that drag never activates, so something survives a
    // cancel that `aria-grabbed` cannot see.
    //
    // The full property needs an observable teardown control — overlay and active target
    // gone, AND a subsequent drag able to start. That last clause is deliberately not
    // asserted while what survives a cancel remains unisolated, since a failure attributed
    // to an unknown cause is not a target anyone can work.
    await driver.cancel();
  });
});
