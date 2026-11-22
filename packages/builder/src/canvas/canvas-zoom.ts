/**
 * How large the canvas draws the page it is previewing.
 *
 * The canvas has always had a scale, and it has never been the author's. It is
 * derived to make the requested width fit the region left over after the
 * panels, so opening a panel silently shrinks the page — measured at 89% with
 * the rail alone and 59.5% with a panel open. Nothing said which of those an
 * author was looking at, and nothing let them choose.
 *
 * ## Fit is a CHOICE, not the absence of one
 *
 * Modelled as a discriminated union rather than a nullable number, because
 * "fit" and "a scale I picked" are different intentions and a caller has to
 * tell them apart. `null` meaning fit would be the same overloaded absence
 * that a `number | null` scale invites: is it unset, is it fitting, or did
 * something fail to measure?
 *
 * Fit RE-DERIVES on every layout change, which is what makes it fit; a fixed
 * scale deliberately does not, so opening a panel narrows what is visible
 * rather than shrinking the page under the author.
 *
 * ## Why a percentage is absolute, and not a multiplier of the fit
 *
 * A multiplier is the obvious composition and it makes the number a lie: an
 * author choosing 100% is asking for actual size, and "fit × 1" is whatever
 * the panels happen to leave. Every editor that shows a zoom percentage means
 * the absolute one, so the number here means what it says and Fit is the mode
 * that computes one.
 *
 * @module canvas-zoom
 */

/** What the canvas was asked to draw at. */
export type CanvasZoom =
  | { readonly kind: "fit" }
  | { readonly kind: "fixed"; readonly scale: number };

/** The default, and what every canvas did before there was a choice. */
export const FIT_ZOOM: CanvasZoom = { kind: "fit" };

/**
 * The steps the control offers, as fractions.
 *
 * Discrete rather than continuous. A slider or a free number invites values
 * whose arithmetic is exact and whose result is unreadable — 37% of a page is
 * not a view of anything — and every comparable editor offers steps for the
 * same reason. `1` is in the middle of the list because actual size is the
 * value an author returns to.
 */
export const ZOOM_STEPS: readonly number[] = [0.5, 0.75, 1, 1.5, 2];

/**
 * The bounds a stored or typed scale is held to.
 *
 * Wider than the steps, because a value can arrive from storage written by a
 * later version, and clamping is what keeps that from painting the canvas
 * somewhere unreachable. Below the floor the page is illegible; above the
 * ceiling one block fills the region and the author has lost the page.
 */
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;

/**
 * A fixed scale the canvas can actually paint at, or `null` when it cannot.
 *
 * The bounds are not only about what STORAGE may hold. `CanvasZoom` is
 * exported, so a host can construct `{ kind: "fixed", scale }` directly with
 * any number the type admits — `NaN`, `Infinity`, zero, or something far
 * outside these bounds — and none of those reach `readZoom` on the way in.
 * Interpolated into a `zoom` declaration they produce an invalid rule or a
 * canvas nobody can see, so the check belongs wherever a scale is USED rather
 * than only where one is parsed.
 */
export function usableScale(scale: number): number | null {
  if (!Number.isFinite(scale)) return null;
  return scale < MIN_ZOOM || scale > MAX_ZOOM ? null : scale;
}

/**
 * A stored value read back as a zoom, or `null` when it is not one.
 *
 * `null` rather than a silent fall back to fit: a caller restoring preferences
 * needs to know it found nothing, and a fixed scale that quietly became fit
 * would look to an author like the editor forgetting what they chose.
 */
export function readZoom(value: unknown): CanvasZoom | null {
  if (value === "fit") return FIT_ZOOM;
  if (typeof value !== "number") return null;
  const scale = usableScale(value);
  return scale === null ? null : { kind: "fixed", scale };
}

/** A zoom as it is stored: the string `"fit"`, or the scale itself. */
export function writeZoom(zoom: CanvasZoom): "fit" | number {
  return zoom.kind === "fit" ? "fit" : zoom.scale;
}

/**
 * The next step in a direction, or the same zoom when there is none.
 *
 * From FIT it steps off the scale the fit produced, so the first press moves
 * from what the author is looking at rather than jumping to an end of the
 * list. That needs the fit scale passed in, because only the canvas knows it.
 *
 * A scale the canvas cannot paint steps from the fit scale as well, for the
 * same reason and by the rule {@link usableScale} states: a host can construct
 * `{ kind: "fixed", scale }` with any number the type admits, and the canvas
 * already falls back to fit when it cannot use one. Stepping from the raw value
 * instead makes every comparison against `NaN` false, so both directions return
 * the zoom unchanged — leaving a stepper that cannot move off an unusable
 * scale, while the canvas is meanwhile painting the fit the steps would come
 * from.
 */
export function steppedZoom(
  zoom: CanvasZoom,
  fitScale: number,
  direction: "in" | "out"
): CanvasZoom {
  const from =
    zoom.kind === "fit" ? fitScale : (usableScale(zoom.scale) ?? fitScale);
  const candidates =
    direction === "in"
      ? ZOOM_STEPS.filter(step => step > from + 1e-9)
      : [...ZOOM_STEPS].reverse().filter(step => step < from - 1e-9);
  const next = candidates[0];
  return next === undefined ? zoom : { kind: "fixed", scale: next };
}
