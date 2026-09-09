import { describe, expect, it } from "vitest";

import { DEFAULT_ACTIVATION_PX } from "./canvas-drag";
import type { SideOrientation } from "./side-orientation";
import type { SpacingBox, SpacingSide } from "./spacing-bands";
import {
  logicalSideFor,
  spacingAddress,
  spacingCssValue,
  spacingDelta,
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
    dy: number
  ): number | undefined => spacingDelta(box, side, { dx, dy }, UNSCALED);

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
    expect(px("padding", "top", 0, 10)).toBe(10);
    expect(px("padding", "bottom", 0, -10)).toBe(10);
    expect(px("padding", "left", 10, 0)).toBe(10);
    expect(px("padding", "right", -10, 0)).toBe(10);
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
        { scale: { x: 0.5, y: 0.5 }, marginScale: { x: 1, y: 1 } }
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
    expect(spacingDelta("margin", "top", { dx: 0, dy: -10 }, scales)).toBe(5);
    expect(spacingDelta("padding", "top", { dx: 0, dy: 10 }, scales)).toBe(2.5);
  });

  it("refuses a scale with no pixels to divide by", () => {
    const zero = { scale: { x: 0, y: 0 }, marginScale: { x: 0, y: 0 } };
    expect(
      spacingDelta("padding", "top", { dx: 0, dy: 10 }, zero)
    ).toBeUndefined();
    const broken = {
      scale: { x: Number.NaN, y: Number.NaN },
      marginScale: { x: 1, y: 1 },
    };
    expect(
      spacingDelta("padding", "left", { dx: 10, dy: 0 }, broken)
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

describe("spacingKeyDelta", () => {
  /*
   * The keyboard's directions are the DRAG's, run through one sign table. Two
   * tables would agree today and disagree the first time either moves, and the
   * disagreement is invisible until someone compares the two paths by hand —
   * which is exactly what WCAG 2.5.7 makes load-bearing here.
   */
  it("grows a margin the way dragging its handle outward does", () => {
    expect(spacingKeyDelta("ArrowUp", "margin", "top")).toBe(1);
    expect(spacingKeyDelta("ArrowDown", "margin", "top")).toBe(-1);
    expect(spacingKeyDelta("ArrowDown", "margin", "bottom")).toBe(1);
    expect(spacingKeyDelta("ArrowLeft", "margin", "left")).toBe(1);
    expect(spacingKeyDelta("ArrowRight", "margin", "right")).toBe(1);
  });

  it("grows a padding the opposite way, as its handle moves inward", () => {
    expect(spacingKeyDelta("ArrowDown", "padding", "top")).toBe(1);
    expect(spacingKeyDelta("ArrowUp", "padding", "bottom")).toBe(1);
    expect(spacingKeyDelta("ArrowRight", "padding", "left")).toBe(1);
  });

  it("agrees with the pointer for the same movement", () => {
    for (const box of ["margin", "padding"] as const) {
      for (const side of SIDES) {
        const vertical = side === "top" || side === "bottom";
        const key = vertical ? "ArrowUp" : "ArrowLeft";
        const move = vertical ? { dx: 0, dy: -1 } : { dx: -1, dy: 0 };
        expect(spacingKeyDelta(key, box, side), `${box} ${side}`).toBe(
          spacingDelta(box, side, move, UNSCALED)
        );
      }
    }
  });

  /*
   * Page carries the coarse step because Shift is spoken for: it selects SIDES
   * on both paths, so an all-sides edit stays reachable without a pointer.
   */
  it("takes a coarse step on the Page keys, in the same direction for every side", () => {
    for (const side of SIDES) {
      expect(spacingKeyDelta("PageUp", "margin", side)).toBe(10);
      expect(spacingKeyDelta("PageDown", "padding", side)).toBe(-10);
    }
  });

  it("ignores an arrow across the band's own axis", () => {
    expect(spacingKeyDelta("ArrowLeft", "margin", "top")).toBeUndefined();
    expect(spacingKeyDelta("ArrowUp", "margin", "left")).toBeUndefined();
  });

  it("ignores a key this control does not answer to", () => {
    expect(spacingKeyDelta("Enter", "margin", "top")).toBeUndefined();
    expect(spacingKeyDelta("a", "margin", "top")).toBeUndefined();
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
          spacingKeyDelta(key, "margin", side),
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
