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

import { FLAT_LIST_FIXTURE, NESTED_FIXTURE, seedPage } from "./fixtures";
import { dragUntilTarget } from "./driver";
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
  const source = await driver.dragSourceCentre();
  const target = await driver.canvasCentre();
  await driver.startDragAt(source);
  // In steps, not one jump. A single move is a teleport, and a canvas that
  // commits on dwell rather than on distance answers a teleport differently
  // from the gesture a person makes.
  const steps = 8;
  for (let step = 0; step < steps; step += 1) {
    await driver.moveBy(
      (target.x - source.x) / steps,
      (target.y - source.y) / steps
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
    // Onto a zone first. Reading a target at the canvas centre answers -1 from
    // dead space, and -1 against a real index reads as a collision resolved
    // wrongly rather than as a pointer that was never over anything.
    const active = await dragOntoZone(driver);

    // The geometrically nearest zone and the active zone must agree. Both the
    // stale-rect and the unscaled-transform failures select a zone that is not
    // the nearest, so agreement catches them with no tolerance to tune.
    const nearest = await driver.nearestZoneToPointer();
    await driver.cancel();
    expect(active, "the active zone must be the one under the pointer").toBe(
      nearest
    );
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

  test.fail(
    "holds its target through a jitter at a zone boundary",
    async ({ request }) => {
      note(
        PLAN_POINT.targetSwitchHysteresis,
        "B-7",
        "no switch margin: a 2px jitter moves the target to a neighbouring zone"
      );
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

      // The transitions themselves, not just how many. A count cannot separate
      // an indicator flipping between two real zones from one vanishing and
      // returning, and only the first is the property named in the title. What
      // this canvas produces is a single move to a REAL neighbouring zone, so
      // the expected failure records a genuine absence of hysteresis and not a
      // pointer that wandered off every zone.
      expect(
        transitions.map(entry => entry.index),
        "a 2px jitter must not move the drop target"
      ).toEqual([]);
    }
  );

  test.fail(
    "shifts no existing block when its drop zones appear",
    async ({ request }) => {
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
      expect(during, "drop zones must take no layout space").toEqual(before);
    }
  );

  test.fail(
    "draws exactly one insertion indicator, in host chrome",
    async ({ request }) => {
      note(
        PLAN_POINT.oneIndicatorInHostChrome,
        "B-7",
        "this canvas draws its indicator inside the iframe with CSS"
      );
      await driver.mountTree(await seedPage(request, FLAT_LIST_FIXTURE));
      await dragFromPanel(driver);

      const indicators = await chrome.readIndicators();
      await driver.cancel();

      // One claim, asserted as one. A canvas with a host indicator AND a
      // leftover inside the frame answers "one" to a host-scoped count.
      expect(indicators).toEqual({ count: 1, host: "document" });
    }
  );

  test.fail(
    "puts the indicator in the gap the pointer is over",
    async ({ request }) => {
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

      expect(rect, "a drag in progress must show an indicator").not.toBeNull();
      // In the gap, not merely somewhere on screen. What this catches is an
      // indicator trailing the pointer by a whole block.
      const centre = rect!.y + rect!.height / 2;
      expect(
        Math.abs(centre - pointer.y),
        "the indicator must lead the pointer into the gap it names"
      ).toBeLessThanOrEqual(24);
    }
  );

  test.fail(
    "shows an explicit state over an invalid target",
    async ({ request }) => {
      note(
        PLAN_POINT.invalidTargetVisible,
        "B-7",
        "this canvas shows nothing over an illegal target"
      );
      await driver.mountTree(await seedPage(request, NESTED_FIXTURE));
      await dragFromPanel(driver);

      const explicit = await chrome.readsInvalidTarget();
      await driver.cancel();

      // Showing nothing is not a state. The author cannot tell "you may not drop
      // here" from "the drag broke", and both read as an unresponsive editor.
      expect(explicit, "an invalid target must be shown, not implied").toBe(
        true
      );
    }
  );

  test.fail(
    "autoscrolls toward an edge and stops at the bounds",
    async ({ request }) => {
      note(PLAN_POINT.autoscrollBounded, "B-8");
      await driver.mountTree(await seedPage(request, NESTED_FIXTURE));
      await dragFromPanel(driver);

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
    }
  );

  test("stays responsive dragging over a large tree", async ({ request }) => {
    note(PLAN_POINT.cachedRectsBudget, "B-8");
    await driver.mountTree(await seedPage(request, FLAT_LIST_FIXTURE));
    await dragFromPanel(driver);

    const started = Date.now();
    const moves = 20;
    for (let move = 0; move < moves; move += 1) await driver.moveBy(0, 12);
    const perMove = (Date.now() - started) / moves;
    await driver.cancel();

    test.info().annotations.push({
      type: "per-move-ms",
      description: String(Math.round(perMove)),
    });
    // A budget, not a frame rate. Wall clock on a machine running several
    // matrices measures load as much as code, so this sits where only a
    // re-measure-the-whole-tree-every-move regression can cross it.
    expect(perMove, "a move must not re-measure the whole tree").toBeLessThan(
      120
    );
  });

  test.fail(
    "records exactly one undo entry for one drop",
    async ({ request }) => {
      note(
        PLAN_POINT.oneDropOneUndo,
        "B-9",
        "this canvas keeps no undo history to count"
      );
      await driver.mountTree(await seedPage(request, FLAT_LIST_FIXTURE));

      const before = await chrome.undoDepth();
      await dragFromPanel(driver);
      await driver.drop();
      const after = await chrome.undoDepth();

      // Exactly one. A drop recorded as several makes undo feel broken: the
      // author presses it once and the block half-moves.
      expect(after - before, "one drop is one undoable edit").toBe(1);
    }
  );

  test.fail(
    "drives a canvas drag with the same engine as a panel drag",
    async ({ request }) => {
      note(
        PLAN_POINT.oneEngineForBothDrags,
        "B-15",
        "dragging a block already in the canvas is not offered here"
      );
      const fixture = await seedPage(request, FLAT_LIST_FIXTURE);
      await driver.mountTree(fixture);

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
    }
  );

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

  test.fail("ends the drag when Escape cancels", async ({ request }) => {
    note(
      PLAN_POINT.escapeCancelsWithoutNavigating,
      "B-11",
      "this canvas leaves its drag state set after Escape; the gesture stops " +
        "affecting the document but never reports that it ended"
    );
    await driver.mountTree(await seedPage(request, FLAT_LIST_FIXTURE));
    await dragFromPanel(driver);
    await driver.cancel();

    expect(await driver.isDragging(), "Escape must end the drag").toBe(false);
  });
});
