import { describe, expect, it } from "vitest";

import {
  clipPathOf,
  insetCornerRadii,
  isSquare,
  roundedInsideRounded,
  roundedShapeIn,
  scaleCornerRadii,
  SQUARE_CORNERS,
  usedCornerRadii,
  type CornerRadii,
  type CornerRadius,
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

/**
 * The resolved radii, or a failure naming the input.
 *
 * `usedCornerRadii` answers `undefined` for a value it cannot resolve, and a
 * test that let that through would compare `undefined` to `undefined` and pass
 * while resolving nothing.
 */
function used(declared: DeclaredRadii, box = BOX): CornerRadii {
  const radii = usedCornerRadii(declared, box);
  if (radii === undefined) {
    throw new Error(`unresolved: ${JSON.stringify(declared)}`);
  }
  return radii;
}

describe("resolving the computed value", () => {
  it("takes a length as the same number on both axes", () => {
    expect(used(declare("8px")).topLeft).toEqual({
      x: 8,
      y: 8,
    });
  });

  it("resolves a percentage per AXIS, against different lengths", () => {
    const radii = used(declare({ topLeft: "50%" }));
    // 50% of a 200-wide, 100-tall box is 100 across and 50 down. One number for
    // both would be right only on a square box, which is why BOX is not one.
    expect(radii.topLeft).toEqual({ x: 100, y: 50 });
  });

  it("reads the two-value form an elliptical corner serializes as", () => {
    const radii = used(declare({ topLeft: "10px 30px" }));
    expect(radii.topLeft).toEqual({ x: 10, y: 30 });
  });

  it("mixes a length and a percentage within one corner", () => {
    const radii = used(declare({ topLeft: "10px 20%" }));
    expect(radii.topLeft).toEqual({ x: 10, y: 20 });
  });

  it("reads an EMPTY value as square rather than as unknown", () => {
    /*
     * The one unreadable case that is not unknown. A computed style never
     * reports a supported longhand as blank, so a blank one means the engine has
     * no such property — and an engine without `border-radius` draws a square
     * corner, which is what zero says.
     *
     * Refusing it instead would blank the overlay in every renderer that does
     * not implement the property, jsdom included.
     */
    expect(used(declare({ topLeft: "" })).topLeft).toEqual({ x: 0, y: 0 });
  });

  it("answers UNDEFINED for a percentage inside a math function", () => {
    /*
     * Reachable, and measured: a percentage inside `calc()` still depends on the
     * box, so the computed longhand stays `"calc(10% + 5px)"` where
     * `calc(10px + 5px)` resolves to `"15px"`. The catalog accepts a `calc()`
     * length, so an author reaches this from the inspector.
     */
    expect(
      usedCornerRadii(declare({ topLeft: "calc(10% + 5px)" }), BOX)
    ).toBeUndefined();
    // The control: a math function the browser DID resolve arrives as a plain
    // length and must not be refused with it.
    expect(used(declare({ topLeft: "15px" })).topLeft).toEqual({
      x: 15,
      y: 15,
    });
  });

  it("refuses the whole box when any ONE corner is unresolvable", () => {
    // The shape is refused, not the corner: three known corners and one unknown
    // is still a shape that cannot be drawn.
    expect(
      usedCornerRadii(declare({ bottomLeft: "min(10px, 5%)" }), BOX)
    ).toBeUndefined();
  });

  it("leaves radii that already fit alone", () => {
    const radii = used(declare("20px"));
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
    const radii = used(declare("200px"));
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
    const radii = used(declare({ topLeft: "200px" }));
    expect(radii.topLeft).toEqual({ x: 100, y: 100 });
  });

  it("carries the factor to corners that were not themselves too big", () => {
    const radii = used(
      declare({ topLeft: "150px", topRight: "150px", bottomLeft: "10px" })
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
    const radii = used(declare(declared));
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
    expect(used(declare("0px"))).toEqual(SQUARE_CORNERS);
  });

  it("squares every corner on a box with no width", () => {
    const radii = used(declare("20px"), { width: 0, height: 100 });
    expect(radii.topLeft).toEqual({ x: 0, y: 0 });
  });
});

describe("the padding box's curve", () => {
  it("takes each border width off the half-axis running alongside it", () => {
    const outer = used(declare("40px"));
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
    const inner = insetCornerRadii(used(declare("6px")), {
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
    const outer = used(declare({ topLeft: "100px" }));
    expect(outer.topLeft).toEqual({ x: 100, y: 100 });

    const border = { top: 10, right: 10, bottom: 10, left: 10 };
    const inner = insetCornerRadii(outer, border);
    expect(inner.topLeft).toEqual({ x: 90, y: 90 });

    const otherOrder = used(declare({ topLeft: "90px" }), {
      width: BOX.width - 20,
      height: BOX.height - 20,
    });
    expect(otherOrder.topLeft.y).toBeCloseTo(80, 6);
    expect(inner.topLeft.y).not.toBeCloseTo(otherOrder.topLeft.y, 6);
  });
});

describe("moving radii into rendered pixels", () => {
  it("scales each half-axis by its own axis", () => {
    const scaled = scaleCornerRadii(used(declare("10px")), {
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
    expect(roundedInsideRounded(box, SQUARE_CORNERS, CLIP, CURVED, 0.5)).toBe(
      true
    );
  });

  it("rejects a box that pokes through the arc", () => {
    // Top-left arc centre is (260, 140). The box corner at (210, 110) sits
    // (50, 30) inside it: (50/60)^2 + (30/40)^2 = 1.26, which is outside.
    const box = { top: 110, right: 400, bottom: 240, left: 210 };
    expect(roundedInsideRounded(box, SQUARE_CORNERS, CLIP, CURVED, 0.5)).toBe(
      false
    );
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

    expect(roundedInsideRounded(box, SQUARE_CORNERS, CLIP, CURVED, 0.5)).toBe(
      true
    );
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
      expect([
        name,
        roundedInsideRounded(box, SQUARE_CORNERS, CLIP, CURVED, 0.5),
      ]).toEqual([name, false]);
    }
  });

  it("accepts everything when the corners are square", () => {
    const flush = { top: 100, right: 500, bottom: 300, left: 200 };
    expect(
      roundedInsideRounded(flush, SQUARE_CORNERS, CLIP, SQUARE_CORNERS, 0.5)
    ).toBe(true);
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
    expect(
      roundedInsideRounded(grazing, SQUARE_CORNERS, CLIP, CURVED, 0.5)
    ).toBe(true);
    // The separating half: with no allowance the same box IS outside the curve,
    // so the acceptance above is the slack's doing and not the box's.
    expect(roundedInsideRounded(grazing, SQUARE_CORNERS, CLIP, CURVED, 0)).toBe(
      false
    );
  });
});

describe("a ROUNDED shape inside a rounded one", () => {
  it("accepts a block flush inside an equally rounded container", () => {
    /*
     * The nested rounded card, and the case a rectangle comparison gets wrong.
     * The block fills the clip exactly and is not cut anywhere — while its
     * bounding rectangle's corners sit outside every one of the container's
     * arcs, which is what a test reading only the rectangle would refuse.
     */
    const flush = { top: 100, right: 500, bottom: 300, left: 200 };
    expect(roundedInsideRounded(flush, CURVED, CLIP, CURVED, 0.5)).toBe(true);

    // The separating half: the SAME box with square corners IS refused, so the
    // acceptance above is the block's own curve and not a widened allowance.
    expect(roundedInsideRounded(flush, SQUARE_CORNERS, CLIP, CURVED, 0.5)).toBe(
      false
    );
  });

  it("accepts a block rounded MORE than the container it sits in", () => {
    const flush = { top: 100, right: 500, bottom: 300, left: 200 };
    const rounder: CornerRadii = {
      topLeft: { x: 90, y: 60 },
      topRight: { x: 90, y: 60 },
      bottomRight: { x: 90, y: 60 },
      bottomLeft: { x: 90, y: 60 },
    };
    expect(roundedInsideRounded(flush, rounder, CLIP, CURVED, 0.5)).toBe(true);
  });

  it("still refuses a rounded block whose curve leaves the container's", () => {
    /*
     * A block rounded too gently for the corner it is pushed into. Without this
     * the fix for the flush case would be "accept anything with a radius", which
     * reopens the defect the corner test exists for.
     */
    const pushed = { top: 110, right: 400, bottom: 240, left: 210 };
    const gentle: CornerRadii = {
      topLeft: { x: 4, y: 4 },
      topRight: { x: 4, y: 4 },
      bottomRight: { x: 4, y: 4 },
      bottomLeft: { x: 4, y: 4 },
    };
    expect(roundedInsideRounded(pushed, gentle, CLIP, CURVED, 0.5)).toBe(false);
  });

  it.each<[string, CornerRadius]>([
    ["40px / 0", { x: 40, y: 0 }],
    ["0 / 40px", { x: 0, y: 40 }],
  ])("reads a corner declared %s as the box corner", (_label, topLeft) => {
    /*
     * `border-radius: 40px / 0` draws a right angle: an ellipse with a zero
     * half-axis has no interior, so the block's extreme point there is its box
     * CORNER rather than a point along a curve.
     *
     * BOTH orientations, because they fail differently and only one of them
     * fails at all. Zeroing just the axis that is zero leaves `0 / 40px`
     * sampling a point forty pixels DOWN from the corner and missing the
     * incursion entirely, while `40px / 0` still happens to sweep through the
     * corner and gives the right answer for the wrong reason.
     */
    const pushed = { top: 110, right: 400, bottom: 240, left: 210 };
    const degenerate: CornerRadii = { ...SQUARE_CORNERS, topLeft };
    expect(roundedInsideRounded(pushed, degenerate, CLIP, CURVED, 0.5)).toBe(
      false
    );
    // And it agrees with the square reading, which is what the browser draws.
    expect(
      roundedInsideRounded(pushed, SQUARE_CORNERS, CLIP, CURVED, 0.5)
    ).toBe(false);
  });

  it("samples the arc rather than only its two ends", () => {
    /*
     * A block whose corner arc is INSIDE the container's curve at both of its
     * endpoints and outside it in between. Testing only the ends — the cheap
     * thing to write, and the thing that looks sufficient — accepts a block the
     * container visibly cuts.
     *
     * The fixture was found by searching the parameter space rather than
     * reasoned out, because the case needs a wide shallow container arc against
     * a wide shallow block arc and does not turn up by picking round numbers.
     * Both halves are asserted below, so it cannot drift into a fixture where an
     * endpoint is already outside and the test passes for the wrong reason.
     */
    const wide: CornerRadii = {
      ...SQUARE_CORNERS,
      topLeft: { x: 130, y: 24 },
    };
    const own: CornerRadii = { ...SQUARE_CORNERS, topLeft: { x: 60, y: 8 } };
    const box = { top: 102, right: 400, bottom: 240, left: 230 };

    /** How far past the container's top-left arc a point on the block's is. */
    const reach = (angle: number): number => {
      const cx = box.left + own.topLeft.x;
      const cy = box.top + own.topLeft.y;
      const px = cx - own.topLeft.x * Math.cos(angle);
      const py = cy - own.topLeft.y * Math.sin(angle);
      const dx = CLIP.left + wide.topLeft.x - px;
      const dy = CLIP.top + wide.topLeft.y - py;
      if (dx <= 0 || dy <= 0) return 0;
      return (dx / wide.topLeft.x) ** 2 + (dy / wide.topLeft.y) ** 2;
    };

    // Both ENDS of the block's arc are inside the container's curve.
    expect(reach(0)).toBeLessThan(1);
    expect(reach(Math.PI / 2)).toBeLessThan(1);
    // Somewhere in between, it is not.
    expect(
      Math.max(...[0.2, 0.3, 0.4, 0.5].map(f => reach(f * Math.PI)))
    ).toBeGreaterThan(1);

    expect(roundedInsideRounded(box, own, CLIP, wide, 0.5)).toBe(false);
  });
});

describe("the sampling allowance at extreme radii", () => {
  it("still accepts two identical flush shapes at a huge rendered radius", () => {
    /*
     * A fixed sample count runs out of precision on a large shape: at
     * sixty-four steps the chord falls further from the arc than the whole
     * half-pixel allowance somewhere above a 6,600px rendered half-axis, the
     * allowance goes NEGATIVE, and two identical flush rounded rectangles start
     * failing containment — so the overlay vanishes on a block nothing removes.
     *
     * Reachable on a large box, and more easily under an ancestor `scale`, since
     * these radii are in RENDERED pixels.
     */
    const huge = 40_000;
    const clip = { top: 0, right: 100_000, bottom: 100_000, left: 0 };
    const radii: CornerRadii = {
      topLeft: { x: huge, y: huge },
      topRight: { x: huge, y: huge },
      bottomRight: { x: huge, y: huge },
      bottomLeft: { x: huge, y: huge },
    };
    expect(roundedInsideRounded(clip, radii, clip, radii, 0.5)).toBe(true);
  });

  it("still refuses a shape that genuinely leaves the curve at that scale", () => {
    /*
     * The other half. Adapting the sample count must not turn into accepting
     * everything large — a square-cornered block pushed into a huge arc is still
     * cut, and reads as cut.
     */
    const huge = 40_000;
    const clip = { top: 0, right: 100_000, bottom: 100_000, left: 0 };
    const radii: CornerRadii = {
      topLeft: { x: huge, y: huge },
      topRight: { x: huge, y: huge },
      bottomRight: { x: huge, y: huge },
      bottomLeft: { x: huge, y: huge },
    };
    expect(roundedInsideRounded(clip, SQUARE_CORNERS, clip, radii, 0.5)).toBe(
      false
    );
  });

  it("spends the chord error out of the allowance, not on top of it", () => {
    /*
     * The reason the error is SUBTRACTED rather than merely bounded. Without it
     * the guarantee slips: the caller asks to tolerate half a pixel, sampling
     * can miss a violation by up to the chord error on top of that, and the two
     * add up to more overhang than anyone allowed.
     *
     * At a 300,000px half-axis the sample count is capped, so the chord error is
     * a substantial 0.353px and the effective allowance is 0.147px. A shape
     * pushed out by 0.3px therefore sits BETWEEN the two: inside the raw slack,
     * outside the allowance the error leaves. It has to be refused.
     */
    const huge = 300_000;
    const clip = { top: 0, right: 1_000_000, bottom: 1_000_000, left: 0 };
    const radii: CornerRadii = {
      topLeft: { x: huge, y: huge },
      topRight: { x: huge, y: huge },
      bottomRight: { x: huge, y: huge },
      bottomLeft: { x: huge, y: huge },
    };
    const pushedOut = (by: number) => ({ ...clip, top: -by, left: -by });

    expect(roundedInsideRounded(pushedOut(0.3), radii, clip, radii, 0.5)).toBe(
      false
    );

    /*
     * The separating half: a displacement comfortably inside the remaining
     * allowance is still accepted, so the refusal above is the error being spent
     * and not a blanket refusal of large shapes.
     */
    expect(roundedInsideRounded(pushedOut(0.05), radii, clip, radii, 0.5)).toBe(
      true
    );
  });

  it("degrades toward refusing past the cap, without refusing everything", () => {
    /*
     * Past the sample cap the chords are further from the arcs than the whole
     * allowance and it goes negative, which TIGHTENS every depth rather than
     * loosening it. Both halves are asserted, because the useful behaviour is
     * the pair:
     *
     * - a shape sitting ON the curve is refused, since nothing here can certify
     *   it and answering "inside" would accept a shape the container cuts;
     * - a shape comfortably INSIDE is still accepted, which a blanket refusal at
     *   this point would have thrown away for no gain.
     *
     * It takes a rendered half-axis over 400,000px, which no layout produces on
     * its own; `transform` is a catalog property, so an ancestor `scale` is the
     * route that reaches it.
     */
    const absurd = 1_000_000;
    const clip = { top: 0, right: 4_000_000, bottom: 4_000_000, left: 0 };
    const radii: CornerRadii = {
      topLeft: { x: absurd, y: absurd },
      topRight: { x: absurd, y: absurd },
      bottomRight: { x: absurd, y: absurd },
      bottomLeft: { x: absurd, y: absurd },
    };
    expect(roundedInsideRounded(clip, radii, clip, radii, 0.5)).toBe(false);

    const wellInside = {
      top: 100_000,
      right: 3_900_000,
      bottom: 3_900_000,
      left: 100_000,
    };
    expect(roundedInsideRounded(wellInside, radii, clip, radii, 0.5)).toBe(
      true
    );
  });

  it("keeps a small corner cheap", () => {
    // The count is derived, so a four-pixel corner is not paid for at the rate a
    // four-thousand-pixel one needs. Asserted through behaviour rather than by
    // reaching for the private count: a tiny flush shape is still accepted.
    const clip = { top: 0, right: 40, bottom: 20, left: 0 };
    const tiny: CornerRadii = {
      topLeft: { x: 4, y: 4 },
      topRight: { x: 4, y: 4 },
      bottomRight: { x: 4, y: 4 },
      bottomLeft: { x: 4, y: 4 },
    };
    expect(roundedInsideRounded(clip, tiny, clip, tiny, 0.5)).toBe(true);
  });
});

describe("stating the shape as a clip", () => {
  it("states the shape in the clipped element's own coordinates", () => {
    const band = { x: 10, y: 20, width: 100, height: 40 };
    const shape = { x: 20, y: 25, width: 70, height: 20 };
    // A `clip-path` resolves against the element carrying it, so the shape is
    // offset by the difference between the two origins and keeps its own size.
    expect(roundedShapeIn(band, shape, SQUARE_CORNERS)).toEqual({
      x: 10,
      y: 5,
      width: 70,
      height: 20,
      radii: SQUARE_CORNERS,
    });
  });

  it("writes a PATH rather than an inset, so nothing renormalises it", () => {
    /*
     * `inset(... round ...)` resolves its radii the way `border-radius` does,
     * which includes the overlap reduction against the inset rectangle —
     * measured, a 180x80 element under `inset(0 round 90px)` is cut at 80. A
     * padding-box curve that legitimately exceeds its own box would be silently
     * shrunk, and that case is reachable: an outer corner of 100 less a 10px
     * border leaves 90 on a padding box 80 tall, and the engine draws the 90.
     */
    const value = clipPathOf({
      x: 0,
      y: 0,
      width: 180,
      height: 80,
      radii: { ...SQUARE_CORNERS, topLeft: { x: 90, y: 90 } },
    });
    expect(value.startsWith("path(")).toBe(true);
    expect(value).not.toContain("inset(");
    // The radius survives at its full size rather than being clamped to the box.
    expect(value).toContain("A 90 90");
  });

  it("writes each corner's own radii, in path order", () => {
    /*
     * Every corner elliptical and every corner distinct, because a transposed
     * pair of half-axes is invisible on a circular corner and the arcs are
     * written in the order the outline is walked rather than the order the
     * shorthand lists them.
     */
    const radii: CornerRadii = {
      topLeft: { x: 1, y: 5 },
      topRight: { x: 2, y: 6 },
      bottomRight: { x: 3, y: 7 },
      bottomLeft: { x: 4, y: 8 },
    };
    expect(clipPathOf({ x: 0, y: 0, width: 100, height: 50, radii })).toBe(
      'path("M 1 0 L 98 0 A 2 6 0 0 1 100 6 L 100 43 A 3 7 0 0 1 97 50 ' +
        'L 4 50 A 4 8 0 0 1 0 42 L 0 5 A 1 5 0 0 1 1 0 Z")'
    );
  });

  it("offsets the whole outline by the shape's origin", () => {
    // A band is rarely at the clipped element's own origin, and a path written
    // as if it were lands the curve in the wrong corner.
    const value = clipPathOf({
      x: 7,
      y: 11,
      width: 20,
      height: 30,
      radii: SQUARE_CORNERS,
    });
    expect(value).toContain("M 7 11");
    expect(value).toContain("27 41");
  });
});
