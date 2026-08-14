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
  const moves: number[] = [];
  return {
    moves,
    pointer: () => ({ x: 0, y }),
    moveBy: async (_dx: number, dy: number) => {
      y += dy;
      moves.push(dy);
    },
    zoneContainingPointer: async () => {
      const hit = bands.find(b => y >= b.from && y < b.to);
      return hit ? hit.zone : -1;
    },
  };
}

const ONE_BAND: Band[] = [{ zone: 2, from: 50, to: 90 }];

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
  // And it still says how far it got, so a caller can report the fixture's real
  // capacity instead of guessing at it.
  expect(result.insetPx).toBeLessThan(25);
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
  const canvas = bandedCanvas([
    { zone: 0, from: 4, to: 12 },
    { zone: 1, from: 40, to: 80 },
  ]);
  // Start already past the first band and inside the gap, so the first band is
  // never entered and zone 1 is the one measured from.
  const inGap = bandedCanvas(
    [
      { zone: 0, from: 4, to: 12 },
      { zone: 1, from: 40, to: 80 },
    ],
    20
  );
  expect(await canvas.zoneContainingPointer()).toBe(-1);

  const result = await dragToInsetInZone(inGap, 9);

  expect(result.zone).toBe(1);
  expect(result.insetPx).toBe(9);
  expect(inGap.pointer().y).toBe(49);
});

test("a depth of zero puts the pointer on the first row inside the band", async () => {
  // The boundary itself is a legitimate request — a band assertion needs both
  // ends — and it must not be confused with the refusals above.
  const canvas = bandedCanvas(ONE_BAND);

  const result = await dragToInsetInZone(canvas, 0);

  expect(result.refused).toBeUndefined();
  expect(result.insetPx).toBe(0);
  expect(canvas.pointer().y).toBe(50);
});
