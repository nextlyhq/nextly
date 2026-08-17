/**
 * An author who drags, then drags again, must get a drag both times — however
 * the first one ended.
 *
 * Two properties are covered here that nothing else in the suite separates.
 * "Escape ends the drag" is already covered elsewhere; "Escape leaves the
 * editor able to start another drag" is not, and a canvas can satisfy the
 * first while failing the second with every DOM signal clean — `aria-grabbed`
 * false, the overlay gone.
 *
 * **Ten gestures, not two, and the whole sequence is asserted.** A count
 * cannot distinguish a periodic failure from a decaying one or from noise, and
 * the positions can. Comparing the full array also makes the SHAPE of any
 * regression legible in the diff rather than only its size.
 *
 * **Geometry varies between gestures.** Each uses a different source element,
 * a different motion, and a different resting place for the pointer, so a
 * refusal cannot be an activation-distance or click-detection artefact of
 * pressing at one repeated coordinate.
 *
 * **No gesture reaches a drop target.** Every one begins and ends over the
 * library panel, so the document is never mutated and gesture N+1 measures the
 * tree gesture N did. The question is whether the SENSOR activates.
 *
 * **The pause between gestures is load-bearing, not padding.** Measured on
 * this canvas: with gestures issued back-to-back at machine speed, exactly
 * every second one fails to activate — `[true, false, true, false, ...]` over
 * ten gestures, and identically so whether the previous gesture ended in a
 * drop or in Escape. Adding the idle pause below makes all ten activate. So
 * the alternation is a property of synthetic input arriving faster than a
 * person can produce it, and any multi-gesture probe written without a gap
 * will measure it and mistake it for an editor defect.
 */
import { expect, test } from "@playwright/test";

import { FLAT_LIST_FIXTURE, seedPage } from "./fixtures";
import { DEFAULT_DWELL_ALLOWANCE_MS, settledValue } from "./driver";
import type { CanvasDriver, Point } from "./driver";
import { createPocDriver } from "./poc-driver";

test.describe.configure({ timeout: 240_000 });
test.use({ viewport: { width: 2560, height: 1400 } });

/** How many gestures each run performs. */
const GESTURES = 10;

/** Which gesture is abandoned with Escape. The rest are released normally. */
const ESCAPE_AT = 0;

/**
 * Idle wall-clock between gestures, in milliseconds.
 *
 * Longer than any plausible human repeat, and required for the reason given in
 * the file docblock: without it this canvas drops every second activation, so a
 * probe issuing gestures back-to-back measures the harness rather than the
 * editor.
 */
const GESTURE_GAP_MS = 500;

/**
 * Per-gesture motion after activation, in pixels.
 *
 * Small enough to stay within the library panel, so no gesture crosses into the
 * canvas and no drop can mutate the document; different from each other so no
 * two gestures present the sensor with the same delta.
 */
const MOTIONS: readonly Point[] = [
  { x: 24, y: 8 },
  { x: -18, y: 22 },
  { x: 31, y: -14 },
  { x: -27, y: -9 },
  { x: 12, y: 35 },
];

/**
 * Where the pointer rests between gestures.
 *
 * Pressing again without having moved away is a plausible click, and the sensor
 * is entitled to treat it as one. Retreating first makes each gesture an
 * independent press rather than a continuation of the last.
 */
const RETREAT: readonly Point[] = [
  { x: 40, y: 60 },
  { x: -55, y: 30 },
  { x: 25, y: -45 },
];

/**
 * The three drag sources this driver can name, cycled so consecutive gestures
 * start from different elements at different positions.
 */
async function sourceFor(
  driver: CanvasDriver,
  gesture: number
): Promise<Point> {
  const which = gesture % 3;
  if (which === 0) return driver.dragSourceCentre();
  if (which === 1) return driver.acceptedDragSourceCentre();
  return driver.restrictedDragSourceCentre();
}

/**
 * Runs {@link GESTURES} full press-move-release gestures and reports which ones
 * the sensor accepted.
 *
 * `escapeAt` selects the gesture abandoned with Escape; `null` runs the same
 * sequence with no Escape at all.
 */
async function activationsAcrossGestures(
  driver: CanvasDriver,
  escapeAt: number | null
): Promise<boolean[]> {
  const activated: boolean[] = [];

  for (let gesture = 0; gesture < GESTURES; gesture += 1) {
    await driver.startDragAt(await sourceFor(driver, gesture));

    const motion = MOTIONS[gesture % MOTIONS.length];
    if (motion) await driver.moveBy(motion.x, motion.y);

    // Settled rather than read once: an activation that has happened but not yet
    // reached the DOM reads as a refusal, which is the direction that
    // manufactures the defect this file exists to rule out.
    activated.push(
      await settledValue(
        () => driver.isDragging(),
        DEFAULT_DWELL_ALLOWANCE_MS,
        `gesture ${String(gesture)}'s liveness`
      )
    );

    if (gesture === escapeAt) {
      await driver.cancel();
    } else {
      await driver.drop();
    }

    const retreat = RETREAT[gesture % RETREAT.length];
    if (retreat) await driver.moveBy(retreat.x, retreat.y);

    // Waited in the test process because the browser has nothing left to do: the
    // pointer is up and the previous drag has already been read as settled.
    await new Promise(resolve => setTimeout(resolve, GESTURE_GAP_MS));
  }

  return activated;
}

/** Every gesture accepted, as the assertion compares it. */
const ALL_ACTIVATED = Array.from({ length: GESTURES }, () => true);

test.describe("consecutive drags activate", () => {
  let driver: CanvasDriver;

  test.beforeEach(({ page }) => {
    driver = createPocDriver(page);
  });

  test("when every drag is released normally", async ({ request }) => {
    // The control, and the reason the Escape case below is attributable to
    // Escape at all. It runs the identical sequence through the identical
    // helpers with the single difference that no Escape is sent, so a red here
    // would mean the varied geometry or the retreat motion is what the sensor
    // refuses, and the finding next door would be about this probe rather than
    // about the editor.
    await driver.mountTree(await seedPage(request, FLAT_LIST_FIXTURE));

    expect(
      await activationsAcrossGestures(driver, null),
      "the sequence itself must not stop a drag activating"
    ).toEqual(ALL_ACTIVATED);
  });

  test("when one drag is abandoned with Escape", async ({ request }) => {
    await driver.mountTree(await seedPage(request, FLAT_LIST_FIXTURE));

    expect(
      await activationsAcrossGestures(driver, ESCAPE_AT),
      "a drag abandoned with Escape must not cost the author any later drag"
    ).toEqual(ALL_ACTIVATED);
  });
});
