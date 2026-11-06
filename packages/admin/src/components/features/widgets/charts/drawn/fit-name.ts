/**
 * A name as it fits a column of `width` pixels, ending in "…" when it is longer, measured in the
 * font it is drawn in.
 *
 * The engine's own measure took the page's default font and size, and so cut names that fit.
 * Measured here in an offscreen canvas, in the drawing's own font. Where nothing can measure (no
 * offscreen canvas, as in jsdom), the name is drawn whole.
 *
 * @module components/features/widgets/charts/drawn/fit-name
 */

let measure: OffscreenCanvasRenderingContext2D | null | undefined;

/** A context to measure text in, made once; none where the page has no offscreen canvas. */
function measurer(): OffscreenCanvasRenderingContext2D | null {
  if (measure === undefined) {
    measure =
      typeof OffscreenCanvas === "undefined"
        ? null
        : new OffscreenCanvas(1, 1).getContext("2d");
  }
  return measure;
}

/**
 * How wide `text` is drawn in `font` (a CSS font, "12px Inter"), in pixels, or `undefined` where
 * nothing can measure. The one measure a name is fitted and its column sized by.
 */
export function textWidth(text: string, font: string): number | undefined {
  const context = measurer();
  if (!context) return undefined;
  context.font = font;
  return context.measureText(text).width;
}

/** `name` cut to fit `width` in `font` (a CSS font, "12px Inter"), with "…" where it is cut. */
export function fitName(name: string, width: number, font: string): string {
  const whole = textWidth(name, font);
  if (whole === undefined || whole <= width) return name;
  let cut = name.length;
  while (cut > 1 && (textWidth(`${name.slice(0, cut)}…`, font) ?? 0) > width) {
    cut -= 1;
  }
  return `${name.slice(0, cut)}…`;
}
