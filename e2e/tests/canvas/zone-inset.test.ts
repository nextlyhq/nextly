/**
 * The exact-depth control, against a canvas whose geometry is known.
 *
 * A hysteresis expressed as a distance MARGIN can only be questioned from a
 * known depth: a compliant canvas holds its previous target a few pixels past a
 * boundary, so a probe that stops "somewhere inside" cannot tell a correct
 * margin from a missing one. `dragToInsetInZone` exists to stand at a stated
 * depth; these tests exist because a control that reports the wrong depth would
 * make every band measurement built on it wrong in a way nothing downstream
 * could notice.
 *
 * The simulated canvas has bands at known pixel positions, so the answer is
 * arithmetic rather than a second opinion — which is the only way to check an
 * instrument that is itself the measuring device.
 *
 * No browser, matching `settle.test.ts` and `dwelling-canvas.test.ts`.
 */
import { expect, test } from "@playwright/test";

import { dragToInsetInZone } from "./driver";

interface Band {
  readonly zone: number;
  readonly from: number;
  readonly to: number;
}

/**
 * A canvas whose zones are half-open vertical bands, with dead space between.
 *
 * Half-open (`from <= y < to`) so a boundary belongs to exactly one band and
 * "the first y inside zone K" is a single well-defined number the assertions
 * can be written against.
 */
function bandedCanvas(bands: Band[], startY = 0) {
  let y = startY;
  return {
    pointer: () => ({ x: 0, y }),
    moveBy: async (_dx: number, dy: number) => {
      y += dy;
    },
    zoneContainingPointer: async () => {
      const hit = bands.find(b => y >= b.from && y < b.to);
      return hit ? hit.zone : -1;
    },
  };
}

const ONE_BAND: Band[] = [{ zone: 2, from: 50, to: 90 }];

/**
 * The depth the pointer ACTUALLY sits at, computed from the band's known edge.
 *
 * The separating assertion, and it has to be stated separately from the
 * returned value: a control that measured from wherever its coarse approach
 * landed reports a self-consistent depth that is simply not the depth from the
 * boundary. Comparing the report against this catches that; comparing it
 * against the request cannot.
 */
function trueDepth(band: Band, y: number): number {
  return y - band.from;
}

test("stands at exactly the depth it was asked for", async () => {
  // The whole point. The band starts at y=50, so a depth of 12 means y=62 — and
  // the reported depth has to be the measured one rather than the requested one
  // echoed back.
  const canvas = bandedCanvas(ONE_BAND);

  const result = await dragToInsetInZone(canvas, 12);

  expect(result.zone).toBe(2);
  expect(result.insetPx).toBe(12);
  expect(result.refused).toBeUndefined();
  expect(canvas.pointer().y).toBe(62);
  // The reported depth is the REAL one, measured from the band's edge rather
  // than from wherever the approach happened to stop.
  expect(trueDepth(ONE_BAND[0], canvas.pointer().y)).toBe(result.insetPx);
});

test("lands on the same depth from a coarse approach that overshoots", async () => {
  // The defect this replaces: a 4px scan enters the band anywhere from 0 to 3px
  // past its edge, so where it stops is an accident of the start position. Every
  // start inside one step has to produce the same depth.
  for (const startY of [0, 1, 2, 3]) {
    const canvas = bandedCanvas(ONE_BAND, startY);
    const result = await dragToInsetInZone(canvas, 10);
    expect(result.insetPx).toBe(10);
    expect(canvas.pointer().y).toBe(60);
    expect(trueDepth(ONE_BAND[0], canvas.pointer().y)).toBe(result.insetPx);
  }
});

test("reports a band too shallow to hold the depth, rather than the depth it managed", async () => {
  // A fact about the FIXTURE, not the canvas. Returning the closest depth
  // reached would answer a question the caller did not ask while carrying the
  // name of the one they did.
  const canvas = bandedCanvas([{ zone: 1, from: 20, to: 28 }]);

  const result = await dragToInsetInZone(canvas, 25);

  expect(result.refused).toBe("too-narrow");
  expect(result.zone).toBe(1);
  // The EXACT capacity, not merely "less than asked". The band spans y=20..27,
  // so the deepest contained depth is 7 — and a looser bound would accept a
  // result that overstated it by the step that left the zone.
  expect(result.insetPx).toBe(7);
  // And the pointer is standing at the depth reported, inside the zone it
  // names. A reported depth the pointer is not at is a different measurement.
  expect(canvas.pointer().y).toBe(27);
  expect(await canvas.zoneContainingPointer()).toBe(1);
});

test("says how precisely it knows the boundary", async () => {
  // A zone edge is fractional and the pointer is commanded in whole steps, so
  // the boundary this measures from can sit a step past the real one. A caller
  // comparing a measured band against a required range has to widen its bounds
  // by exactly this, which it can only do if the probe says what it is.
  const canvas = bandedCanvas(ONE_BAND);

  const result = await dragToInsetInZone(canvas, 5);

  expect(result.resolutionPx).toBe(1);
});

test("reports a boundary it never crossed as its own failure, and puts the pointer back", async () => {
  // A drag already deep inside a tall zone has no boundary within reach. Saying
  // "never entered a zone" there would be false — the pointer is in one — and
  // leaving it moved by the whole retreat would make the caller's next reading
  // about a position this probe chose rather than the one they set up.
  const canvas = bandedCanvas([{ zone: 3, from: 0, to: 10_000 }], 5_000);

  const result = await dragToInsetInZone(canvas, 5);

  expect(result.refused).toBe("boundary-not-found");
  expect(result.zone).toBe(3);
  expect(canvas.pointer().y).toBe(5_000);
  // No depth, because no boundary was found to measure one from. A `0` here
  // would read as "at the boundary", which is a position the pointer is not at.
  expect(result.insetPx).toBeUndefined();
});

test("reports never reaching a zone as a refusal, not as a depth of zero", async () => {
  // Depth 0 is a legitimate reading at a boundary; "no zone was ever entered" is
  // not a reading at all, and collapsing the two would let a canvas drawing no
  // zones pass as one whose bands begin where the pointer already is.
  const canvas = bandedCanvas([{ zone: 0, from: 10_000, to: 10_010 }]);

  const result = await dragToInsetInZone(canvas, 5);

  expect(result.refused).toBe("never-entered");
  expect(result.zone).toBe(-1);
});

test("measures from the band it entered, not from where the walk began", async () => {
  // Dead space between bands is the case a step-count would get wrong: the
  // pointer crosses a gap, and a depth counted from the start position or from
  // the previous band is larger than the depth inside THIS one.
  const bands: Band[] = [
    { zone: 0, from: 4, to: 12 },
    { zone: 1, from: 40, to: 80 },
  ];
  // Started past the first band and inside the gap, so the first band is never
  // entered and zone 1 is the one the depth is measured from.
  const canvas = bandedCanvas(bands, 20);
  expect(await canvas.zoneContainingPointer()).toBe(-1);

  const result = await dragToInsetInZone(canvas, 9);

  expect(result.zone).toBe(1);
  expect(result.insetPx).toBe(9);
  expect(canvas.pointer().y).toBe(49);
  expect(trueDepth(bands[1], canvas.pointer().y)).toBe(result.insetPx);
});

test("a depth of zero puts the pointer on the first row inside the band", async () => {
  // The boundary itself is a legitimate request — a band assertion needs both
  // ends — and it must not be confused with the refusals above.
  const canvas = bandedCanvas(ONE_BAND);

  const result = await dragToInsetInZone(canvas, 0);

  expect(result.refused).toBeUndefined();
  expect(result.insetPx).toBe(0);
  expect(canvas.pointer().y).toBe(50);
  expect(trueDepth(ONE_BAND[0], canvas.pointer().y)).toBe(result.insetPx);
});

/**
 * A canvas whose zone edge MOVES the first `shifts` times it is entered.
 *
 * The real one does this: a drop zone is 6px tall with a 3px margin while a
 * drag is in flight and takes a 4px margin once it is the ACTIVE target, so
 * arriving in a zone moves its own edge and every edge below it. A depth
 * measured across that transition is measured from a boundary that has since
 * moved.
 */
function shiftingEdgeCanvas(
  band: Band,
  shifts: number,
  startY = 0,
  direction: -1 | 1 = -1
) {
  let y = startY;
  let from = band.from;
  let entries = 0;
  let wasInside = false;
  return {
    pointer: () => ({ x: 0, y }),
    moveBy: async (_dx: number, dy: number) => {
      y += dy;
    },
    zoneContainingPointer: async () => {
      const inside = y >= from && y < band.to;
      // Shifted on ENTRY only. The real transition fires when a zone becomes the
      // active target, not on every read — and an edge that receded on every
      // read would simply outrun the probe, which is a different fact
      // (`boundary-not-found`) and would not exercise this one.
      if (inside && !wasInside && entries < shifts) {
        entries += 1;
        from += direction;
      }
      wasInside = inside;
      return inside ? band.zone : -1;
    },
  };
}

test("settles a moving edge by measuring it twice, not by waiting", async () => {
  // One shift is what the real transition produces: the zone grows once, when it
  // becomes the active target. A second agreeing measurement is what proves the
  // edge has stopped, and it costs no wall-clock time.
  const canvas = shiftingEdgeCanvas({ zone: 4, from: 50, to: 90 }, 1);

  const result = await dragToInsetInZone(canvas, 6);

  expect(result.refused).toBeUndefined();
  expect(result.zone).toBe(4);
  expect(result.insetPx).toBe(6);
});

test("refuses rather than measuring from an edge that keeps moving", async () => {
  // A depth taken from an edge in motion is a number with no referent, and
  // reporting one would be worse than reporting nothing — every band assertion
  // built on it would be wrong with no symptom pointing here.
  const canvas = shiftingEdgeCanvas({ zone: 4, from: 50, to: 900 }, 99);

  const result = await dragToInsetInZone(canvas, 6);

  expect(result.refused).toBe("edge-moving");
  expect(result.zone).toBe(4);
  expect(result.insetPx).toBeUndefined();
});

test("refuses a depth it cannot represent, rather than rounding to one it can", async () => {
  // A caller deriving a depth from fractional or scaled DOM geometry would
  // otherwise get 13px of movement for a 12.5px request and a success saying 13
  // — a false measurement rather than a failed one. Negative and NaN are worse:
  // the walk never runs and depth 0 comes back as a success.
  const canvas = () => bandedCanvas(ONE_BAND);

  await expect(dragToInsetInZone(canvas(), 12.5)).rejects.toThrow(
    /whole, non-negative depth/
  );
  await expect(dragToInsetInZone(canvas(), -4)).rejects.toThrow(
    /whole, non-negative depth/
  );
  await expect(dragToInsetInZone(canvas(), Number.NaN)).rejects.toThrow(
    /whole, non-negative depth/
  );
});

test("refuses a step budget it cannot honour, rather than running forever", async () => {
  // `Infinity` is the dangerous one: the approach never terminates and the run
  // hangs until Playwright's outer timeout, defeating the runaway guard this
  // parameter exists to be. `NaN` and a negative skip the approach entirely and
  // would report `never-entered` about a canvas that was never asked.
  const outside = () => bandedCanvas([{ zone: 0, from: 9_000, to: 9_010 }]);

  await expect(
    dragToInsetInZone(outside(), 4, Number.POSITIVE_INFINITY)
  ).rejects.toThrow(/whole, non-negative step budget/);
  await expect(dragToInsetInZone(outside(), 4, -1)).rejects.toThrow(
    /whole, non-negative step budget/
  );
  await expect(dragToInsetInZone(outside(), 4, Number.NaN)).rejects.toThrow(
    /whole, non-negative step budget/
  );
});

test("re-enters a zone whose edge moved DOWN out from under the pointer", async () => {
  // The direction the real canvas produces: a drop zone swaps its 3px drag margin for a 4px
  // active one, so the top edge travels DOWN and a pointer resting on the old boundary is left
  // just above the new one. A bracket that only ever retreats moves further away, and reports an
  // edge it is standing one pixel short of as unfindable.
  const canvas = shiftingEdgeCanvas({ zone: 5, from: 50, to: 90 }, 1, 0, 1);

  const result = await dragToInsetInZone(canvas, 6);

  expect(result.refused).toBeUndefined();
  expect(result.zone).toBe(5);
  expect(result.insetPx).toBe(6);
  // Measured from the edge where it SETTLED, not where it started.
  expect(canvas.pointer().y).toBe(57);
});
