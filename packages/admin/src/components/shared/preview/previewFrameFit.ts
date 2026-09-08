/**
 * Fitting a requested viewport width into the space the preview pane has.
 *
 * ## Why two widths, and why they must not collapse
 *
 * The split reserves a minimum editor, so the preview pane has a hard ceiling —
 * it can never exceed a fixed share of the split, which on a laptop is a few
 * hundred pixels short of a desktop viewport. A preset therefore has a width it
 * ASKS FOR and a width the pane can physically give, and the two answer
 * different questions:
 *
 * - the REQUESTED width is what the site's `@media` queries resolve against, so
 *   it is what makes the preview truthful about the viewport being previewed;
 * - the MEASURED width is what the pane can show, so it is what decides whether
 *   anything has to be scaled.
 *
 * Feeding the measured width back as the selection makes the preset the author
 * just chose appear unselected. Reporting only the request makes it impossible
 * to say the pane could not honour it. This module keeps both and reports which
 * case applies, so a caller can size the frame, transform it, and label the real
 * viewport without deriving any of those from each other.
 *
 * ## Why scaling stays truthful
 *
 * A CSS transform does not change the frame's own width, so a scaled frame's
 * media queries still resolve against the width it was given. The preview
 * remains a faithful rendering of that viewport, drawn smaller. What it stops
 * being faithful about is PHYSICAL size — text renders at a size no visitor
 * sees — which is why a caller must label the real width rather than let the
 * scaling pass unremarked.
 *
 * @module components/shared/preview/previewFrameFit
 */

import type { CSSProperties } from "react";

/** How the frame should be sized, or that the question cannot be answered yet. */
export type PreviewFit =
  /**
   * The pane has not been measured, so nothing can be said about it.
   *
   * Distinct from every other case on purpose: it is the only one where the
   * caller must render no width, no label and no scaling note. A first paint
   * that named a width and then corrected itself reads as a glitch, and one
   * that named the WRONG width is the confident wrong answer this control
   * exists to remove.
   */
  | { kind: "unmeasured" }
  /** No particular width was asked for; the frame fills the pane. */
  | { kind: "responsive" }
  /** The requested width fits as it is. */
  | { kind: "exact"; width: number }
  /**
   * The requested width does not fit and is drawn smaller.
   *
   * `width` stays the REQUESTED one — the frame is sized to it and transformed
   * — because that is what the site resolves its media queries against.
   */
  | { kind: "scaled"; width: number; scale: number };

/**
 * Decide how to draw a requested viewport width in the space available.
 *
 * `availableWidth` is `null` before the pane has been laid out. Both zero and
 * `null` mean the same thing here — nothing has been measured — and neither is
 * a width to divide by.
 */
export function previewFrameFit(
  requestedWidth: number | null,
  availableWidth: number | null
): PreviewFit {
  // Asked before layout. Answering anything else would be a claim about a box
  // nobody has looked at, including the claim that it should fill the pane.
  if (availableWidth === null || !(availableWidth > 0)) {
    return { kind: "unmeasured" };
  }

  /*
   * A request that is absent, zero, negative or non-finite all reach the same
   * answer, and deliberately so: they arrive from a cleared or half-typed
   * custom-width box, where the author has not yet said anything meaningful.
   * Filling the pane keeps it usable; dividing by any of them produces
   * `Infinity`, `NaN` or a flipped frame.
   */
  if (requestedWidth === null || !Number.isFinite(requestedWidth)) {
    return { kind: "responsive" };
  }
  if (requestedWidth <= 0) return { kind: "responsive" };

  /*
   * Equal counts as fitting. A scale of exactly 1 is a transform that does
   * nothing, and reporting it as scaled would put a "drawn smaller" note on a
   * frame that is at its true size.
   */
  if (requestedWidth <= availableWidth) {
    return { kind: "exact", width: requestedWidth };
  }

  return {
    kind: "scaled",
    width: requestedWidth,
    scale: availableWidth / requestedWidth,
  };
}

/**
 * The inline style that realises a fit, derived from it rather than beside it.
 *
 * The frame's size and its transform are two views of ONE decision, and two
 * places computing them would agree until someone edited either — with the
 * failure being a frame whose media queries resolve against one width while it
 * is drawn at another, which looks like a rendering bug in the site.
 *
 * `unmeasured` and `responsive` both return nothing, and for the same reason
 * from the caller's side: the frame fills the pane, which is what it does with
 * no inline size at all. They stay distinct in {@link PreviewFit} because the
 * CONTROL must tell them apart — one has an answer and the other does not.
 */
export function previewFrameStyle(fit: PreviewFit): CSSProperties {
  if (fit.kind === "exact") return { width: `${fit.width}px` };
  if (fit.kind === "scaled") {
    return {
      width: `${fit.width}px`,
      /*
       * Divided by the scale so the frame still covers the pane vertically
       * AFTER being shrunk. A plain `100%` would be scaled down with everything
       * else and leave a band of empty pane below the page.
       */
      height: `${100 / fit.scale}%`,
      transform: `scale(${fit.scale})`,
      // Top-left, so the page's own left edge stays where a visitor's would be.
      // With `scale` chosen as available/requested the frame fills the pane
      // exactly, so there is nothing to centre.
      transformOrigin: "top left",
    };
  }
  return {};
}
