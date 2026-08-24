import { describe, expect, it } from "vitest";

import {
  boundsInsideRounded,
  clipPathOf,
  insetCornerRadii,
  isSquare,
  roundedInsetOf,
  scaleCornerRadii,
  SQUARE_CORNERS,
  usedCornerRadii,
  type CornerRadii,
  type DeclaredRadii,
} from "./border-radii";

/**
 * A box that is neither square nor at the origin, so no assertion here can pass
 * by coincidence: an implementation that swapped the axes, resolved both
 * percentages against one length or dropped the origin would land on the same
 * numbers for a 100×100 box at `0,0`.
 */
const BOX = { width: 200, height: 100 };

function declare(all: string): DeclaredRadii;
function declare(all: Partial<DeclaredRadii>): DeclaredRadii;
function declare(all: string | Partial<DeclaredRadii>): DeclaredRadii {
  const none = {
    topLeft: "0px",
    topRight: "0px",
    bottomRight: "0px",
    bottomLeft: "0px",
  };
  return typeof all === "string"
    ? { topLeft: all, topRight: all, bottomRight: all, bottomLeft: all }
    : { ...none, ...all };
}

describe("resolving the computed value", () => {
  it("takes a length as the same number on both axes", () => {
    expect(usedCornerRadii(declare("8px"), BOX).topLeft).toEqual({
      x: 8,
      y: 8,
    });
  });

  it("resolves a percentage per AXIS, against different lengths", () => {
    const radii = usedCornerRadii(declare({ topLeft: "50%" }), BOX);
    // 50% of a 200-wide, 100-tall box is 100 across and 50 down. One number for
    // both would be right only on a square box, which is why BOX is not one.
    expect(radii.topLeft).toEqual({ x: 100, y: 50 });
  });

  it("reads the two-value form an elliptical corner serializes as", () => {
    const radii = usedCornerRadii(declare({ topLeft: "10px 30px" }), BOX);
    expect(radii.topLeft).toEqual({ x: 10, y: 30 });
  });

  it("mixes a length and a percentage within one corner", () => {
    const radii = usedCornerRadii(declare({ topLeft: "10px 20%" }), BOX);
    expect(radii.topLeft).toEqual({ x: 10, y: 20 });
  });

  it("answers zero for a value it cannot parse", () => {
    // A `NaN` here would poison every comparison downstream into silently
    // answering false, which reads as "nothing is clipped" rather than as an error.
    const radii = usedCornerRadii(declare({ topLeft: "" }), BOX);
    expect(radii.topLeft).toEqual({ x: 0, y: 0 });
  });

  it("leaves radii that already fit alone", () => {
    const radii = usedCornerRadii(declare("20px"), BOX);
    expect(radii.topRight).toEqual({ x: 20, y: 20 });
  });
});

describe("the overlap reduction CSS applies and the computed value does not", () => {
  it("shrinks every radius by the tightest side's factor", () => {
    /*
     * Measured in Chromium: a 200×100 box with `border-radius: 200px` renders
     * its corners at 50, not at the 200 the computed value reports. The tightest
     * side is the 100-tall one, whose two radii sum to 400, so f = 0.25.
     */
    const radii = usedCornerRadii(declare("200px"), BOX);
    expect(radii.topLeft).toEqual({ x: 50, y: 50 });
    expect(radii.bottomRight).toEqual({ x: 50, y: 50 });
  });

  it("applies ONE factor across all four corners, not one per corner", () => {
    /*
     * The separating case, and it is measured: with only the top-left corner
     * declared, the box's HEIGHT still constrains it — the left side's radii sum
     * to 200 against a length of 100, so f = 0.5 and the corner draws at 100.
     *
     * An implementation that clamped each corner to the sides it touches would
     * leave this at 200, since nothing about the top-left corner alone is too
     * big for a 200-wide box.
     */
    const radii = usedCornerRadii(declare({ topLeft: "200px" }), BOX);
    expect(radii.topLeft).toEqual({ x: 100, y: 100 });
  });

  it("carries the factor to corners that were not themselves too big", () => {
    const radii = usedCornerRadii(
      declare({ topLeft: "150px", topRight: "150px", bottomLeft: "10px" }),
      BOX
    );
    /*
     * Four sides constrain, and the tightest wins: top gives 200/300, right
     * 100/150, bottom 200/10, and LEFT 100/(10 + 150) = 0.625, which is the one.
     *
     * The 10px corner is not too big for anything and is reduced anyway, which
     * is what one shared factor means — and it is the corner that makes the
     * left side tight in the first place.
     */
    expect(radii.bottomLeft.x).toBeCloseTo(10 * 0.625, 6);
    expect(radii.topLeft.x).toBeCloseTo(150 * 0.625, 6);
  });

  it.each([
    ["top", { topLeft: "150px 10px", topRight: "150px 10px" }, 200 / 300],
    ["right", { topRight: "10px 150px", bottomRight: "10px 150px" }, 100 / 300],
    [
      "bottom",
      { bottomLeft: "150px 10px", bottomRight: "150px 10px" },
      200 / 300,
    ],
    ["left", { topLeft: "10px 150px", bottomLeft: "10px 150px" }, 100 / 300],
  ])("lets the %s side alone be the binding one", (side, declared, factor) => {
    /*
     * One case per side, each built so that ONLY that side is tight — the other
     * three come out at ten or twenty times over. A factor that skipped any
     * single side would leave its case unreduced, which no fixture with a
     * symmetric box can show: dropping the right side changes nothing while the
     * left side happens to bind with the same numbers.
     *
     * Elliptical corners are what make one side tight without its neighbours:
     * a side is constrained by the half-axes running ALONG it, so a corner that
     * is wide and shallow loads the horizontal sides and spares the vertical.
     */
    const radii = usedCornerRadii(declare(declared), BOX);
    const corner = Object.keys(declared)[0] as keyof CornerRadii;
    const declaredMajor = 150;
    expect([side, radii[corner].x + radii[corner].y]).toEqual([
      side,
      expect.closeTo((declaredMajor + 10) * factor, 6),
    ]);
    // And the factor really is below one, so the assertion above is not
    // satisfied by an implementation that reduced nothing.
    expect(factor).toBeLessThan(1);
  });

  it("does not divide by a side with no curve on it", () => {
    // Every side sums to zero here, and `L / 0` would reduce the box by Infinity.
    expect(usedCornerRadii(declare("0px"), BOX)).toEqual(SQUARE_CORNERS);
  });

  it("squares every corner on a box with no width", () => {
    const radii = usedCornerRadii(declare("20px"), { width: 0, height: 100 });
    expect(radii.topLeft).toEqual({ x: 0, y: 0 });
  });
});

describe("the padding box's curve", () => {
  it("takes each border width off the half-axis running alongside it", () => {
    const outer = usedCornerRadii(declare("40px"), BOX);
    const inner = insetCornerRadii(outer, {
      top: 4,
      right: 8,
      bottom: 12,
      left: 16,
    });
    // Horizontal half-axes lose the left or right border, vertical ones the top
    // or bottom. Using one width for both is right only on a uniform border.
    expect(inner.topLeft).toEqual({ x: 40 - 16, y: 40 - 4 });
    expect(inner.bottomRight).toEqual({ x: 40 - 8, y: 40 - 12 });
  });

  it("squares a corner whose border is thicker than its curve", () => {
    const inner = insetCornerRadii(usedCornerRadii(declare("6px"), BOX), {
      top: 10,
      right: 10,
      bottom: 10,
      left: 10,
    });
    // Floored rather than inverted: a negative radius would draw a corner
    // bulging outward, which is not a shape CSS has.
    expect(inner.topLeft).toEqual({ x: 0, y: 0 });
  });

  it("reduces BEFORE insetting, which is not the same answer", () => {
    /*
     * The order is load-bearing and this is the case that separates the two,
     * measured in Chromium: a 200×100 box with `border-top-left-radius: 100px`
     * and a 10px border draws its inner curve at 90.
     *
     * Reducing first finds f = 1 — the corner already fits — and insets 100 to
     * 90. Insetting first gives 90 and then reduces it against the 180×80
     * padding box, where the left side's radii sum to 90 over a length of 80,
     * giving 80. The engine draws 90, so this asserts BOTH the number and that
     * it is not the other one.
     */
    const outer = usedCornerRadii(declare({ topLeft: "100px" }), BOX);
    expect(outer.topLeft).toEqual({ x: 100, y: 100 });

    const border = { top: 10, right: 10, bottom: 10, left: 10 };
    const inner = insetCornerRadii(outer, border);
    expect(inner.topLeft).toEqual({ x: 90, y: 90 });

    const otherOrder = usedCornerRadii(declare({ topLeft: "90px" }), {
      width: BOX.width - 20,
      height: BOX.height - 20,
    });
    expect(otherOrder.topLeft.y).toBeCloseTo(80, 6);
    expect(inner.topLeft.y).not.toBeCloseTo(otherOrder.topLeft.y, 6);
  });
});

describe("moving radii into rendered pixels", () => {
  it("scales each half-axis by its own axis", () => {
    const scaled = scaleCornerRadii(usedCornerRadii(declare("10px"), BOX), {
      x: 2,
      y: 0.5,
    });
    // `scale(2, 0.5)` is one legal value, and a single factor would be right on
    // one axis and wrong on the other.
    expect(scaled.topLeft).toEqual({ x: 20, y: 5 });
  });
});

describe("whether a box has any curve at all", () => {
  it("calls a box with no radius square", () => {
    expect(isSquare(SQUARE_CORNERS)).toBe(true);
  });

  it("calls a corner with a zero half-axis square", () => {
    // `border-radius: 40px / 0` draws a right angle: an ellipse with a zero
    // half-axis has no interior. Reading only `x` would call this curved and
    // send every consumer on to divide by `y`.
    const radii: CornerRadii = {
      ...SQUARE_CORNERS,
      topLeft: { x: 40, y: 0 },
    };
    expect(isSquare(radii)).toBe(true);
  });

  it("calls one genuinely curved corner enough", () => {
    const radii: CornerRadii = {
      ...SQUARE_CORNERS,
      bottomLeft: { x: 1, y: 1 },
    };
    expect(isSquare(radii)).toBe(false);
  });
});

/** A clip rectangle away from the origin, for the same reason `BOX` is not square. */
const CLIP = { top: 100, right: 500, bottom: 300, left: 200 };

/** Every corner curved, and the two axes different so a transposition shows. */
const CURVED: CornerRadii = {
  topLeft: { x: 60, y: 40 },
  topRight: { x: 60, y: 40 },
  bottomRight: { x: 60, y: 40 },
  bottomLeft: { x: 60, y: 40 },
};

describe("whether a rectangle fits inside a rounded one", () => {
  it("accepts a box clear of every corner", () => {
    const box = { top: 160, right: 400, bottom: 240, left: 300 };
    expect(boundsInsideRounded(box, CLIP, CURVED, 0.5)).toBe(true);
  });

  it("rejects a box that pokes through the arc", () => {
    // Top-left arc centre is (260, 140). The box corner at (210, 110) sits
    // (50, 30) inside it: (50/60)^2 + (30/40)^2 = 1.26, which is outside.
    const box = { top: 110, right: 400, bottom: 240, left: 210 };
    expect(boundsInsideRounded(box, CLIP, CURVED, 0.5)).toBe(false);
  });

  it("accepts a box INSIDE the corner's square but inside its arc too", () => {
    /*
     * The separating case. This box reaches into the top-left corner's quarter
     * on both axes, so an implementation that refused anything entering that
     * quarter would reject it — and it is nonetheless entirely within the curve.
     *
     * Both halves are asserted, so a change that widens the refusal fails here
     * rather than passing quietly.
     */
    const box = { top: 125, right: 400, bottom: 240, left: 220 };
    expect(box.left).toBeLessThan(CLIP.left + CURVED.topLeft.x);
    expect(box.top).toBeLessThan(CLIP.top + CURVED.topLeft.y);

    const dx = CLIP.left + CURVED.topLeft.x - box.left;
    const dy = CLIP.top + CURVED.topLeft.y - box.top;
    expect(
      (dx / CURVED.topLeft.x) ** 2 + (dy / CURVED.topLeft.y) ** 2
    ).toBeLessThan(1);

    expect(boundsInsideRounded(box, CLIP, CURVED, 0.5)).toBe(true);
  });

  it("tests each corner independently", () => {
    /*
     * One case per corner, each poking through only that one. A copy-paste slip
     * that measured the same corner four times passes any single-corner test.
     */
    const inset = 6;
    const corners = {
      topLeft: { top: 106, right: 400, bottom: 240, left: 206 },
      topRight: { top: 106, right: 494, bottom: 240, left: 300 },
      bottomRight: { top: 160, right: 494, bottom: 294, left: 300 },
      bottomLeft: { top: 160, right: 400, bottom: 294, left: 206 },
    };
    expect(inset).toBe(6);
    for (const [name, box] of Object.entries(corners)) {
      expect([name, boundsInsideRounded(box, CLIP, CURVED, 0.5)]).toEqual([
        name,
        false,
      ]);
    }
  });

  it("accepts everything when the corners are square", () => {
    const flush = { top: 100, right: 500, bottom: 300, left: 200 };
    expect(boundsInsideRounded(flush, CLIP, SQUARE_CORNERS, 0.5)).toBe(true);
  });

  it("forgives an overhang past the ARC no bigger than the slack", () => {
    /*
     * Two fractional measurements disagreeing by a third of a pixel is rounding,
     * not a block being cut.
     *
     * The corners must be CURVED for this to reach the slack at all: on a square
     * corner the arc test returns before it is consulted, so a fixture built on
     * `SQUARE_CORNERS` passes whether the slack is applied or not.
     *
     * The box starts on the top-left arc — 45° along it, at (217.574, 111.716) —
     * and is pushed 0.3px deeper on both axes, which is past the curve by less
     * than the half-pixel allowance.
     */
    const grazing = { top: 111.416, right: 400, bottom: 240, left: 217.274 };
    expect(boundsInsideRounded(grazing, CLIP, CURVED, 0.5)).toBe(true);
    // The separating half: with no allowance the same box IS outside the curve,
    // so the acceptance above is the slack's doing and not the box's.
    expect(boundsInsideRounded(grazing, CLIP, CURVED, 0)).toBe(false);
  });
});

describe("stating the shape as a clip", () => {
  it("measures each inset from the band to the shape", () => {
    const band = { x: 10, y: 20, width: 100, height: 40 };
    const shape = { x: 20, y: 25, width: 70, height: 20 };
    expect(roundedInsetOf(band, shape, SQUARE_CORNERS)).toEqual({
      top: 5,
      left: 10,
      right: 20,
      bottom: 15,
      radii: SQUARE_CORNERS,
    });
  });

  it("writes the horizontal radii before the vertical ones", () => {
    /*
     * The two lists are easy to transpose and impossible to notice once
     * transposed, because they differ only on an elliptical corner — so the
     * fixture makes every corner elliptical and every corner distinct.
     */
    const radii: CornerRadii = {
      topLeft: { x: 1, y: 5 },
      topRight: { x: 2, y: 6 },
      bottomRight: { x: 3, y: 7 },
      bottomLeft: { x: 4, y: 8 },
    };
    expect(clipPathOf({ top: 0, right: 0, bottom: 0, left: 0, radii })).toBe(
      "inset(0px 0px 0px 0px round 1px 2px 3px 4px / 5px 6px 7px 8px)"
    );
  });

  it("writes the edges in the order CSS reads them", () => {
    const value = clipPathOf({
      top: 1,
      right: 2,
      bottom: 3,
      left: 4,
      radii: SQUARE_CORNERS,
    });
    expect(value.startsWith("inset(1px 2px 3px 4px round")).toBe(true);
  });
});
