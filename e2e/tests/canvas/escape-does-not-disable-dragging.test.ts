/**
 * Pressing Escape to abandon a drag must leave the editor able to start the
 * next one.
 *
 * "Escape ends the drag" and "Escape leaves the editor usable" are different
 * properties, and only the first was covered. A canvas can clear every DOM
 * signal — `aria-grabbed` goes false, the overlay unmounts — while the sensor
 * has stopped accepting new gestures, and nothing already in the suite can
 * tell those apart.
 *
 * **Ten gestures, not two.** The behaviour under investigation alternated
 * across four attempts, which fits neither "Escape breaks every later drag"
 * nor "Escape breaks the next one". A run long enough to show a period is what
 * separates a real toggle from a coincidence, and the per-gesture record below
 * is reported in full so the SHAPE of a failure is legible rather than just
 * its count.
 *
 * **Geometry varies between gestures on purpose.** An earlier probe pressed at
 * identical coordinates every time and released without moving away, so an
 * activation-distance or click-detection artefact would have produced a clean
 * alternation indistinguishable from a state-machine defect. Each gesture here
 * uses a different source element, a different motion, and a different resting
 * place for the pointer.
 *
 * **No gesture reaches a drop target.** Every one begins and ends over the
 * library panel, so the document is never mutated and gesture N+1 measures the
 * same tree gesture N did. The question is whether the SENSOR activates, and a
 * canvas whose geometry shifted underneath the probe would answer a different
 * one.
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
 * Per-gesture motion after activation, in pixels.
 *
 * Deliberately not a constant. These are small and stay within the library
 * panel, so no gesture crosses into the canvas and no drop can mutate the
 * document; they differ from each other so that no two gestures present the
 * sensor with the same delta.
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
 * A gesture that releases and presses again without the pointer having moved
 * elsewhere is a plausible click, and the sensor is entitled to treat it as
 * one. Moving away first makes each gesture an independent press rather than a
 * continuation of the last.
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
 * Runs `GESTURES` full press-move-release gestures and reports which ones the
 * sensor accepted.
 *
 * `escapeAt` selects the gesture abandoned with Escape; passing `null` runs the
 * same sequence with no Escape at all, which is the control that makes a
 * failure attributable to Escape rather than to the varied geometry.
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

    // Settled rather than read once: an activation that has happened but not
    // yet reached the DOM reads as a refusal, which is the direction that
    // manufactures the defect being investigated.
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
  }

  return activated;
}

test.describe("Escape does not disable dragging", () => {
  let driver: CanvasDriver;

  test.beforeEach(({ page }) => {
    driver = createPocDriver(page);
  });

  test("every gesture activates when no drag is ever cancelled", async ({
    request,
  }) => {
    // The positive control, and the reason a failure in the next test is
    // reportable at all. It runs the identical sequence through the identical
    // helpers with the single difference that no Escape is sent, so a red here
    // means the varied geometry or the retreat motion is what the sensor is
    // refusing — not Escape — and the finding next door would be about the
    // probe rather than about the editor.
    await driver.mountTree(await seedPage(request, FLAT_LIST_FIXTURE));

    const activated = await activationsAcrossGestures(driver, null);

    expect(
      activated,
      "the sequence itself must not stop a drag activating"
    ).toEqual(Array.from({ length: GESTURES }, () => true));
  });

  test("gestures after an Escape still activate", async ({ request }) => {
    await driver.mountTree(await seedPage(request, FLAT_LIST_FIXTURE));

    const activated = await activationsAcrossGestures(driver, ESCAPE_AT);

    // Asserted as the WHOLE sequence rather than as a count, because the count
    // is the one thing already known not to distinguish the candidates: two
    // failures out of ten is consistent with a toggle, with a decaying effect
    // and with noise, and the positions tell them apart while the total cannot.
    expect(
      activated,
      "a drag abandoned with Escape must not cost the author any later drag"
    ).toEqual(Array.from({ length: GESTURES }, () => true));
  });
});
