/**
 * How much of a scroller's top the block toolbar keeps clear.
 *
 * @module scroll-clearance
 */

/**
 * The `scroll-padding-top` that keeps both the scroller's own clearance and
 * the bar's `height` pixels clear. Pixels are compared here; anything else —
 * a percentage of the scroller, a `calc()` — is not a number of pixels this
 * can read, so the browser is asked for the larger of the two with `max()`.
 */
export function clearanceWith(own: string, height: number): string {
  const bar = `${String(height)}px`;
  const value = own.trim();
  if (value === "" || value === "auto") return bar;
  const pixels = /^(-?[\d.]+)px$/.exec(value)?.[1];
  if (pixels !== undefined) {
    return `${String(Math.max(Number(pixels), height))}px`;
  }
  return `max(${value}, ${bar})`;
}
