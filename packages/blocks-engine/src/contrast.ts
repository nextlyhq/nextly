/**
 * Colour contrast, with nothing behind it.
 *
 * The package root re-exports the whole engine, and its style compiler carries
 * a CSS parser. Core's colour helpers check contrast, and `nextly/config`,
 * which the admin imports, imports them: reached through the root, that one
 * function could bring the whole engine and the parser to an admin screen.
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
