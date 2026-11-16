/**
 * Colour contrast, with nothing behind it.
 *
 * The package root re-exports the whole engine, and its style compiler carries
 * a CSS parser. Core checks the contrast of a colour on every admin screen, the
 * sign-in page included, and reaching `checkContrast` through the root put the
 * whole engine and the parser on each of those screens for one function.
 *
 * This entry point is that function and the math under it, from the same
 * module the root re-exports, so there is one contrast implementation however
 * it is reached. **Nothing here may import anything with a runtime
 * dependency**: one convenient import would undo the entry point silently. The
 * boundary is checked against the built bundles in `format-boundary.test.ts`.
 *
 * @experimental A narrow slice of the root's surface; its names follow the
 * root's.
 * @module contrast
 */

export {
  checkContrast,
  compositeOver,
  contrastRatio,
  parseColor,
  relativeLuminance,
} from "./style/contrast";
export type { ContrastLevel, ContrastResult, Rgb } from "./style/contrast";
