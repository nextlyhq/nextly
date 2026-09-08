/**
 * How a requested viewport width is fitted into the space the pane actually has.
 *
 * The split reserves a minimum editor, so the preview pane has a hard ceiling
 * and a desktop width cannot fit on a laptop. Every case below is about which
 * of the two widths answers a given question — the REQUESTED one is what the
 * site's media queries must resolve against, and the MEASURED one is what the
 * pane can physically show. Collapsing them is what makes a preset either lie
 * about the viewport or fail to report that the pane could not honour it.
 */
import { describe, expect, it } from "vitest";

import { previewFrameFit, previewFrameStyle } from "../previewFrameFit";

describe("previewFrameFit", () => {
  it("answers nothing until the pane has been measured", () => {
    /*
     * The first render has no layout yet. Naming a width for a box nobody has
     * looked at is the confident wrong answer this control exists to remove —
     * and it is worse than silence, because the label would appear, be wrong,
     * and then correct itself in a way that reads as a glitch.
     */
    expect(previewFrameFit(1280, null)).toEqual({ kind: "unmeasured" });
    expect(previewFrameFit(1280, 0)).toEqual({ kind: "unmeasured" });
    // Even with nothing requested: "responsive" is a claim about a box too.
    expect(previewFrameFit(null, null)).toEqual({ kind: "unmeasured" });
  });

  it("fills the pane when no width is requested", () => {
    expect(previewFrameFit(null, 618)).toEqual({ kind: "responsive" });
  });

  it("uses the requested width exactly when it fits", () => {
    expect(previewFrameFit(390, 618)).toEqual({ kind: "exact", width: 390 });
  });

  it("treats a width equal to the space as fitting, not as scaled", () => {
    // The boundary. A scale of exactly 1 is a transform doing nothing, and
    // reporting it as `scaled` would show a "scaled to fit" note on a frame
    // that is at its true size.
    expect(previewFrameFit(618, 618)).toEqual({ kind: "exact", width: 618 });
  });

  it("scales the SHORTFALL when the request is wider than the pane", () => {
    /*
     * The frame keeps its requested width — that is what the site's `@media`
     * resolves against, so the preview stays truthful — and is transformed down
     * to fit. Both numbers are reported: the caller needs `width` to size the
     * frame and `scale` to transform it, and a caller given only the product
     * cannot label the real viewport.
     */
    expect(previewFrameFit(1280, 640)).toEqual({
      kind: "scaled",
      width: 1280,
      scale: 0.5,
    });
  });

  it("keeps the requested width in the answer, not the space it was fitted into", () => {
    // The separating property. A fit that returned the AVAILABLE width would
    // satisfy "the frame is 618px wide" and would silently make the preview a
    // 618px viewport — which is the bug, not the fix.
    const fit = previewFrameFit(1280, 618);
    expect(fit).toMatchObject({ kind: "scaled", width: 1280 });
    expect(fit).not.toMatchObject({ width: 618 });
  });

  it("refuses a nonsensical request rather than dividing by it", () => {
    // Zero and negatives reach here from a cleared or half-typed custom width
    // box. Falling back to responsive keeps the pane usable; scaling by them
    // produces Infinity or a flipped frame.
    expect(previewFrameFit(0, 618)).toEqual({ kind: "responsive" });
    expect(previewFrameFit(-100, 618)).toEqual({ kind: "responsive" });
    expect(previewFrameFit(Number.NaN, 618)).toEqual({ kind: "responsive" });
    expect(previewFrameFit(Number.POSITIVE_INFINITY, 618)).toEqual({
      kind: "responsive",
    });
  });
});

describe("previewFrameStyle", () => {
  it("gives an unanswered or responsive fit no inline size at all", () => {
    // Both fill the pane, which is what no inline size does. They stay separate
    // in the fit because the CONTROL has to tell them apart; the frame does not.
    expect(previewFrameStyle({ kind: "unmeasured" })).toEqual({});
    expect(previewFrameStyle({ kind: "responsive" })).toEqual({});
  });

  it("sizes an exact fit and does not transform it", () => {
    const style = previewFrameStyle({ kind: "exact", width: 390 });
    expect(style).toEqual({ width: "390px" });
    // Named explicitly: a transform of `scale(1)` would still create a
    // containing block and a new stacking context inside the frame.
    expect(style.transform).toBeUndefined();
  });

  it("sizes a scaled fit to the REQUESTED width and shrinks it", () => {
    /*
     * The separating property, restated as CSS: the width the browser lays the
     * page out at is the requested one, so `@media` resolves against it, and
     * the transform only changes how large that layout is drawn.
     */
    expect(
      previewFrameStyle({ kind: "scaled", width: 1280, scale: 0.5 })
    ).toEqual({
      width: "1280px",
      height: "200%",
      transform: "scale(0.5)",
      transformOrigin: "top left",
    });
  });

  it("compensates the HEIGHT for the scale, so no empty band is left below", () => {
    // 1/0.4 = 250%. Scaled by 0.4 that covers exactly 100% of the pane; a plain
    // `100%` would shrink to 40% and leave the rest of the pane blank.
    const style = previewFrameStyle({
      kind: "scaled",
      width: 1500,
      scale: 0.4,
    });
    expect(style.height).toBe("250%");
  });
});
