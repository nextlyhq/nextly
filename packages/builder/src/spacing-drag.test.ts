import { describe, expect, it } from "vitest";

import { DEFAULT_ACTIVATION_PX } from "./canvas-drag";
import type { SideOrientation } from "./side-orientation";
import type { SpacingBox, SpacingSide } from "./spacing-bands";
import {
  logicalSideFor,
  spacingAddress,
  spacingCssValue,
  spacingDelta,
  spacingGrowsOutward,
  spacingKeyDelta,
  spacingSidesFor,
  spacingStart,
  spacingValue,
  SPACING_ACTIVATION_PX,
} from "./spacing-drag";
import { measurementOf } from "./style-numeric";
import type { LogicalSide } from "./style-sides";

const SIDES: readonly SpacingSide[] = ["top", "right", "bottom", "left"];

const at = (writingMode: string, direction: string): SideOrientation => ({
  writingMode,
  direction,
});

/** The unit scale, so a test about signs is not also a test about scaling. */
const UNSCALED = {
  scale: { x: 1, y: 1 },
  marginScale: { x: 1, y: 1 },
};

describe("logicalSideFor", () => {
  it("maps the physical sides of a horizontal left-to-right element", () => {
    const ltr = at("horizontal-tb", "ltr");
    expect(logicalSideFor("top", ltr)).toBe("blockStart");
    expect(logicalSideFor("bottom", ltr)).toBe("blockEnd");
    expect(logicalSideFor("left", ltr)).toBe("inlineStart");
    expect(logicalSideFor("right", ltr)).toBe("inlineEnd");
  });

  /*
   * The case an English-only suite cannot see. A physical mapping edits the
   * side the author did not grab, and the page looks plausible either way — the
   * block simply moves the wrong direction, which reads as the drag being
   * inverted rather than as the wrong value being written.
   */
  it("puts the inline start on the RIGHT in a right-to-left element", () => {
    const rtl = at("horizontal-tb", "rtl");
    expect(logicalSideFor("right", rtl)).toBe("inlineStart");
    expect(logicalSideFor("left", rtl)).toBe("inlineEnd");
  });

  it("leaves the block axis alone in a right-to-left element", () => {
    const rtl = at("horizontal-tb", "rtl");
    expect(logicalSideFor("top", rtl)).toBe("blockStart");
    expect(logicalSideFor("bottom", rtl)).toBe("blockEnd");
  });

  it("turns the block axis sideways in vertical-rl", () => {
    const mode = at("vertical-rl", "ltr");
    expect(logicalSideFor("right", mode)).toBe("blockStart");
    expect(logicalSideFor("left", mode)).toBe("blockEnd");
    expect(logicalSideFor("top", mode)).toBe("inlineStart");
    expect(logicalSideFor("bottom", mode)).toBe("inlineEnd");
  });

  it("starts the block axis at the left in vertical-lr", () => {
    const mode = at("vertical-lr", "ltr");
    expect(logicalSideFor("left", mode)).toBe("blockStart");
    expect(logicalSideFor("right", mode)).toBe("blockEnd");
    expect(logicalSideFor("top", mode)).toBe("inlineStart");
  });

  it("treats sideways-rl as vertical-rl", () => {
    const mode = at("sideways-rl", "ltr");
    expect(logicalSideFor("right", mode)).toBe("blockStart");
    expect(logicalSideFor("top", mode)).toBe("inlineStart");
  });

  /*
   * The row a table built by symmetry gets wrong: sideways-lr rotates its text
   * anti-clockwise where every other vertical mode rotates it clockwise, so its
   * inline axis runs UP the screen and left-to-right starts at the bottom.
   */
  it("runs the inline axis upward in sideways-lr", () => {
    const mode = at("sideways-lr", "ltr");
    expect(logicalSideFor("left", mode)).toBe("blockStart");
    expect(logicalSideFor("right", mode)).toBe("blockEnd");
    expect(logicalSideFor("bottom", mode)).toBe("inlineStart");
    expect(logicalSideFor("top", mode)).toBe("inlineEnd");
  });

  it("flips only the inline axis of sideways-lr for right-to-left", () => {
    const mode = at("sideways-lr", "rtl");
    expect(logicalSideFor("top", mode)).toBe("inlineStart");
    expect(logicalSideFor("bottom", mode)).toBe("inlineEnd");
    expect(logicalSideFor("left", mode)).toBe("blockStart");
  });

  it("reads an unrecognised writing mode as horizontal-tb", () => {
    const mode = at("nonsense-xy", "ltr");
    expect(logicalSideFor("top", mode)).toBe("blockStart");
    expect(logicalSideFor("left", mode)).toBe("inlineStart");
  });

  /*
   * The invariant a per-case test cannot state: every mode has to spend all
   * four logical names on the four physical edges. A table typo that mapped two
   * edges to `inlineEnd` passes every assertion above that does not happen to
   * name the side it stole from, and then two handles write one address.
   */
  it("maps the four sides onto the four logical names, in every mode", () => {
    const modes = [
      "horizontal-tb",
      "vertical-rl",
      "vertical-lr",
      "sideways-rl",
      "sideways-lr",
    ];
    for (const writingMode of modes) {
      for (const direction of ["ltr", "rtl"]) {
        const orientation = at(writingMode, direction);
        const mapped = SIDES.map(side => logicalSideFor(side, orientation));
        expect(
          new Set<LogicalSide>(mapped),
          `${writingMode} / ${direction}`
        ).toEqual(
          new Set<LogicalSide>([
            "blockStart",
            "blockEnd",
            "inlineStart",
            "inlineEnd",
          ])
        );
      }
    }
  });
});

describe("spacingSidesFor", () => {
  const none = { shift: false, alt: false };

  it("edits only the side that was grabbed", () => {
    expect(spacingSidesFor("top", none)).toEqual(["top"]);
  });

  it("edits the opposite pair on Alt", () => {
    expect(spacingSidesFor("top", { shift: false, alt: true })).toEqual([
      "top",
      "bottom",
    ]);
    expect(spacingSidesFor("left", { shift: false, alt: true })).toEqual([
      "right",
      "left",
    ]);
  });

  it("edits every side on Shift", () => {
    expect(spacingSidesFor("left", { shift: true, alt: false })).toEqual([
      "top",
      "right",
      "bottom",
      "left",
    ]);
  });

  it("lets Shift win over Alt, since it already contains the pair", () => {
    expect(spacingSidesFor("top", { shift: true, alt: true })).toEqual([
      "top",
      "right",
      "bottom",
      "left",
    ]);
  });

  /*
   * Order is a property of the result, not of the grab. Two authors reaching
   * the same four values from different handles must write the same document.
   */
  it("returns one order whichever handle started the gesture", () => {
    const all = { shift: true, alt: false };
    expect(spacingSidesFor("bottom", all)).toEqual(spacingSidesFor("top", all));
  });
});

describe("spacingDelta", () => {
  const px = (
    box: SpacingBox,
    side: SpacingSide,
    dx: number,
    dy: number,
    /*
     * These cases are about the SIGN TABLE, so each one names the direction it
     * is about rather than inheriting a guess: a band thickening away from the
     * block unless it says otherwise. Which direction a real band has is
     * measured, and `spacingDelta` no longer supplies a default for it.
     */
    outward = true
  ): number | undefined =>
    spacingDelta(box, side, { dx, dy }, UNSCALED, outward);

  /*
   * One assertion per box per side, because the sign table is eight cases and a
   * single spot-check leaves seven of them free to be inverted.
   */
  it("grows a margin when the pointer moves away from the block", () => {
    expect(px("margin", "top", 0, -10)).toBe(10);
    expect(px("margin", "bottom", 0, 10)).toBe(10);
    expect(px("margin", "left", -10, 0)).toBe(10);
    expect(px("margin", "right", 10, 0)).toBe(10);
  });

  it("shrinks a margin when the pointer moves toward the block", () => {
    expect(px("margin", "top", 0, 10)).toBe(-10);
    expect(px("margin", "left", 10, 0)).toBe(-10);
  });

  /*
   * Padding is the inverse and it is not a detail: the handle sits on the band's
   * INNER edge, which moves toward the middle of the block as the value grows.
   * A padding drag that borrowed the margin's signs runs backwards under the
   * hand.
   */
  it("grows a padding when the pointer moves toward the middle of the block", () => {
    expect(px("padding", "top", 0, 10, false)).toBe(10);
    expect(px("padding", "bottom", 0, -10, false)).toBe(10);
    expect(px("padding", "left", 10, 0, false)).toBe(10);
    expect(px("padding", "right", -10, 0, false)).toBe(10);
  });

  it("reads travel along the band's own axis and ignores the other", () => {
    expect(px("margin", "top", 999, 0)).toBe(0);
    expect(px("margin", "left", 0, 999)).toBe(0);
  });

  /*
   * A canvas at half scale draws a 20px margin 10px tall, so ten pixels of hand
   * has to be worth twenty pixels of value. Undivided, every drag on a zoomed
   * canvas is wrong by the zoom.
   */
  it("unscales the travel by the canvas scale", () => {
    expect(
      spacingDelta(
        "padding",
        "top",
        { dx: 0, dy: 10 },
        { scale: { x: 0.5, y: 0.5 }, marginScale: { x: 1, y: 1 } },
        false
      )
    ).toBe(20);
  });

  /*
   * The two scales differ by the block's OWN transform, and a margin is laid out
   * in the parent's coordinates. Picking the wrong one is invisible until a
   * block carries a transform, and then the margin moves by the wrong amount.
   */
  it("unscales a margin by the margin scale, not the composed one", () => {
    const scales = {
      scale: { x: 4, y: 4 },
      marginScale: { x: 2, y: 2 },
    };
    expect(
      spacingDelta("margin", "top", { dx: 0, dy: -10 }, scales, true)
    ).toBe(5);
    expect(
      spacingDelta("padding", "top", { dx: 0, dy: 10 }, scales, false)
    ).toBe(2.5);
  });

  it("refuses a scale with no pixels to divide by", () => {
    const zero = { scale: { x: 0, y: 0 }, marginScale: { x: 0, y: 0 } };
    expect(
      spacingDelta("padding", "top", { dx: 0, dy: 10 }, zero, false)
    ).toBeUndefined();
    const broken = {
      scale: { x: Number.NaN, y: Number.NaN },
      marginScale: { x: 1, y: 1 },
    };
    expect(
      spacingDelta("padding", "left", { dx: 10, dy: 0 }, broken, false)
    ).toBeUndefined();
  });
});

describe("spacingStart", () => {
  it("starts an unset side from the value the band reports", () => {
    expect(spacingStart(undefined, 24)).toEqual({ ok: true, px: 24 });
  });

  it("rounds a fractional used value, so both paths step the same integers", () => {
    expect(spacingStart(undefined, 10.5)).toEqual({ ok: true, px: 11 });
  });

  it("starts from the node's own pixel value when it has one", () => {
    expect(spacingStart("32px", 999)).toEqual({ ok: true, px: 32 });
    expect(spacingStart("-8px", 0)).toEqual({ ok: true, px: -8 });
  });

  it("accepts a bare number", () => {
    expect(spacingStart(16, 0)).toEqual({ ok: true, px: 16 });
  });

  /*
   * A side is draggable exactly when the inspector could STEP it, because both
   * ask `measurementOf`. The set is what matters here, not its members: a
   * private pattern is free to differ in both directions, and this one did —
   * it took `1.50px`, which `style-numeric` declines, while refusing `+10px`,
   * which it also declines. Two arbitrary policies, disagreeing.
   *
   * `measurementOfText` refuses a spelling that does not reproduce itself —
   * `+5`, `.5`, `1.50`, `05` — deliberately, and says why: composing one would
   * write a value the author never typed. A drag inherits that rather than
   * arguing with it, so a value the inspector will not step is one the handle
   * will not drag, and the reason an author is given is the same on both.
   */
  it("is draggable exactly where the shared numeric grammar allows", () => {
    for (const text of ["10px", "-8px", "1.5px", "0px"]) {
      expect(spacingStart(text, 0).ok, text).toBe(
        measurementOf(text)?.unit === "px"
      );
    }
    // The spellings that module declines, refused here for its reason rather
    // than by a pattern of this one's.
    for (const text of ["+10px", ".5px", "1e2px", "1.50px", "05px"]) {
      expect(measurementOf(text), text).toBeUndefined();
      expect(spacingStart(text, 0).ok, text).toBe(false);
    }
  });

  /*
   * The refusal that matters most. A token is a live link to the design system;
   * committing the pixels it resolves to today severs it with no visible change
   * at the moment of the drag, and the page silently stops tracking the token.
   */
  it("refuses a side that is set to a token", () => {
    const result = spacingStart({ $token: "space-4" }, 16);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/token/i);
  });

  it("refuses auto, which is how a block is centred", () => {
    const result = spacingStart("auto", 40);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/auto/);
  });

  it("refuses a unit a pixel drag cannot preserve", () => {
    expect(spacingStart("2rem", 32).ok).toBe(false);
    expect(spacingStart("50%", 32).ok).toBe(false);
    expect(spacingStart("calc(1rem + 2px)", 18).ok).toBe(false);
  });

  it("refuses a composite standing where a length belongs", () => {
    expect(spacingStart({ inlineStart: "4px" }, 4).ok).toBe(false);
  });

  it("refuses an unmeasurable used value", () => {
    expect(spacingStart(undefined, Number.NaN).ok).toBe(false);
  });
});

describe("spacingValue", () => {
  it("adds the delta and rounds to whole pixels", () => {
    expect(spacingValue(10, 4.4, "margin")).toBe(14);
    expect(spacingValue(10, 4.6, "margin")).toBe(15);
  });

  /*
   * CSS has no negative padding. Without the clamp the catalog refuses the
   * value, the preview blanks and the handle appears to stick for the rest of
   * the gesture with nothing said about why.
   */
  it("clamps a padding at zero", () => {
    expect(spacingValue(4, -40, "padding")).toBe(0);
  });

  it("lets a margin go negative, which the catalog allows", () => {
    expect(spacingValue(4, -40, "margin")).toBe(-36);
  });
});

describe("which way a band thickens", () => {
  /*
   * Neither box decides it, and the margin half of this used to. A margin was
   * called structural because it lies outside the border box, so growing one was
   * said to push the neighbour and never the block. Measured in Chromium that is
   * false on three sides of four: `margin-top`, `margin-left` and `margin-right`
   * on an auto-width block each drive the BORDER edge inward while the outer
   * edge stays pinned by the container or by what precedes it. So both boxes
   * carry the measured answer and nothing is read off the box's name.
   */
  it("takes the measured answer, for either box", () => {
    for (const measured of [true, false]) {
      expect(spacingGrowsOutward(false, measured), String(measured)).toBe(
        measured
      );
    }
  });

  /*
   * A negative band is the one thing the probe cannot answer, because it is a
   * fact about how the band is DRAWN rather than how the block responds:
   * `spacingBands` lays it inside the border edge, mirrored across it, so the
   * rectangle's two edges swap roles and the measured answer swaps with them.
   */
  it("mirrors the answer for a band drawn inside the border edge", () => {
    expect(spacingGrowsOutward(true, true)).toBe(false);
    expect(spacingGrowsOutward(true, false)).toBe(true);
  });
});

describe("a padding whose block grows outward", () => {
  /*
   * The reported defect. On an ordinary auto-height block, increasing
   * `padding-bottom` moves the BORDER edge down and leaves the content edge
   * where it was — so the band thickens downward and dragging down must
   * increase. Assuming the fixed-height model inverted it: the author dragged
   * down and the value fell while the block grew away from the pointer.
   */
  it("grows a bottom padding when the pointer moves DOWN", () => {
    expect(
      spacingDelta("padding", "bottom", { dx: 0, dy: 10 }, UNSCALED, true)
    ).toBe(10);
  });

  it("still grows a fixed-height block's bottom padding moving UP", () => {
    expect(
      spacingDelta("padding", "bottom", { dx: 0, dy: -10 }, UNSCALED, false)
    ).toBe(10);
  });

  it("grows a right padding when the pointer moves RIGHT on an auto block", () => {
    expect(
      spacingDelta("padding", "right", { dx: 10, dy: 0 }, UNSCALED, true)
    ).toBe(10);
  });

  /*
   * Top and left were already right and must stay so. Measured: on an auto
   * block, padding-top moves the CONTENT edge down and leaves the border edge
   * pinned by flow — the inner-edge model — so these read `false`.
   */
  it("leaves top and left alone, which the measurement already agreed with", () => {
    expect(
      spacingDelta("padding", "top", { dx: 0, dy: 10 }, UNSCALED, false)
    ).toBe(10);
    expect(
      spacingDelta("padding", "left", { dx: 10, dy: 0 }, UNSCALED, false)
    ).toBe(10);
  });

  it("carries the same answer to the keyboard", () => {
    // Up means more on every handle, whichever edge responds.
    expect(spacingKeyDelta("ArrowUp", "padding", "bottom", true)).toBe(1);
    expect(spacingKeyDelta("ArrowUp", "padding", "bottom", false)).toBe(1);
    // And the spatial arrows follow the measured edge.
    expect(spacingKeyDelta("ArrowRight", "padding", "right", true)).toBe(1);
    expect(spacingKeyDelta("ArrowLeft", "padding", "right", false)).toBe(1);
  });
});

describe("spacingKeyDelta", () => {
  /*
   * The keyboard's directions are the DRAG's, run through one sign table. Two
   * tables would agree today and disagree the first time either moves, and the
   * disagreement is invisible until someone compares the two paths by hand —
   * which is exactly what WCAG 2.5.7 makes load-bearing here.
   */
  /*
   * Up means MORE on every handle, and Down means less.
   *
   * These are a spinbutton's own keys, and the role promises they behave the
   * same way whichever instance has focus. Read spatially they would do nothing
   * at all on a left or right handle, and would run backwards on a bottom
   * margin and a top padding — the two edges that grow by moving DOWN.
   */
  it("makes Up increase and Down decrease on every handle", () => {
    for (const box of ["margin", "padding"] as const) {
      for (const side of SIDES) {
        // Both directions, because the promise is that the edge which responds
        // makes no difference to these two keys.
        for (const outward of [true, false]) {
          const where = `${box} ${side} outward=${String(outward)}`;
          expect(spacingKeyDelta("ArrowUp", box, side, outward), where).toBe(1);
          expect(spacingKeyDelta("ArrowDown", box, side, outward), where).toBe(
            -1
          );
        }
      }
    }
  });

  /*
   * Left and Right stay SPATIAL, and only on the axis a band runs along. On a
   * horizontal band the two readings agree — the arrow pointing the way the
   * edge moves is the one that increases — so nothing has to choose between
   * them there. On a vertical band they would contradict the numeric reading
   * above, and the numeric one wins because the role promised it.
   */
  it("keeps Left and Right as travel along a horizontal band", () => {
    for (const box of ["margin", "padding"] as const) {
      for (const side of ["left", "right"] as const) {
        for (const key of ["ArrowLeft", "ArrowRight"] as const) {
          for (const outward of [true, false]) {
            const move =
              key === "ArrowLeft" ? { dx: -1, dy: 0 } : { dx: 1, dy: 0 };
            expect(
              spacingKeyDelta(key, box, side, outward),
              `${key} ${box} ${side} outward=${String(outward)}`
            ).toBe(spacingDelta(box, side, move, UNSCALED, outward));
          }
        }
      }
    }
  });

  it("grows a horizontal band with the arrow its edge moves toward", () => {
    // Named by the direction each band is in, rather than by its box: which
    // edge responds is measured, and both boxes answer both ways.
    expect(spacingKeyDelta("ArrowLeft", "margin", "left", true)).toBe(1);
    expect(spacingKeyDelta("ArrowRight", "margin", "right", true)).toBe(1);
    expect(spacingKeyDelta("ArrowRight", "padding", "left", false)).toBe(1);
    expect(spacingKeyDelta("ArrowLeft", "padding", "right", false)).toBe(1);
    // And a band measured the OTHER way takes the other arrow, which is the
    // half a box-derived table could not express at all.
    expect(spacingKeyDelta("ArrowRight", "margin", "left", false)).toBe(1);
    expect(spacingKeyDelta("ArrowLeft", "padding", "right", true)).toBe(-1);
  });

  /*
   * Page carries the coarse step because Shift is spoken for: it selects SIDES
   * on both paths, so an all-sides edit stays reachable without a pointer.
   */
  it("takes a coarse step on the Page keys, in the same direction for every side", () => {
    for (const side of SIDES) {
      expect(spacingKeyDelta("PageUp", "margin", side, true)).toBe(10);
      expect(spacingKeyDelta("PageDown", "padding", side, false)).toBe(-10);
    }
  });

  it("ignores a horizontal arrow on a vertical band", () => {
    expect(spacingKeyDelta("ArrowLeft", "margin", "top", true)).toBeUndefined();
    expect(
      spacingKeyDelta("ArrowRight", "padding", "bottom", false)
    ).toBeUndefined();
  });

  it("ignores a key this control does not answer to", () => {
    expect(spacingKeyDelta("Enter", "margin", "top", true)).toBeUndefined();
    expect(spacingKeyDelta("a", "margin", "top", true)).toBeUndefined();
  });

  /*
   * `KeyboardEvent.key` is an arbitrary string, so the table is asked about
   * names `Object.prototype` already has. Asserted on EVERY side deliberately:
   * on a vertical one the axis check happens to reject the prototype's function
   * anyway, so a test that only looked there passes against the object lookup
   * this guards. On a HORIZONTAL side the same lookup read `.dx` off that
   * function and returned `NaN` as a distance.
   */
  it("does not answer for a name Object.prototype carries, on any side", () => {
    for (const key of ["constructor", "toString", "valueOf", "__proto__"]) {
      for (const side of SIDES) {
        expect(
          spacingKeyDelta(key, "margin", side, true),
          `${key} on ${side}`
        ).toBeUndefined();
      }
    }
  });

  it("reads the axis table by own key too", () => {
    // The same hole one table over: an unknown mode must fall back to
    // horizontal-tb rather than to a function reached through the prototype.
    const odd = at("constructor", "ltr");
    expect(logicalSideFor("top", odd)).toBe("blockStart");
    expect(logicalSideFor("left", odd)).toBe("inlineStart");
  });
});

describe("addresses and values", () => {
  it("addresses the catalog property and the logical side", () => {
    expect(
      spacingAddress("margin", "inlineStart", {
        state: "base",
        breakpoint: "mobile",
      })
    ).toEqual({
      state: "base",
      breakpoint: "mobile",
      property: "margin",
      path: ["inlineStart"],
    });
  });

  it("writes a pixel length", () => {
    expect(spacingCssValue(-12)).toBe("-12px");
  });
});

/*
 * Identity, not equality. A second threshold spelled here would agree with the
 * canvas today and drift the moment either moves, leaving one editor with two
 * answers to "did the hand mean to move".
 */
it("takes its activation threshold from the canvas", () => {
  expect(SPACING_ACTIVATION_PX).toBe(DEFAULT_ACTIVATION_PX);
});
