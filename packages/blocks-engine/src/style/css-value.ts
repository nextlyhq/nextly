/**
 * Safety and shape checks for CSS values that reach the emitted stylesheet.
 *
 * Three things are checked, and deliberately only three:
 *
 * 1. **The value parses as a CSS value.** A value that parses cannot carry a
 *    stray `;` or `}` and so cannot escape its declaration.
 * 2. **Characters and URL schemes that survive parsing.** A quoted CSS string
 *    parses happily while containing `</style>`, and css-tree accepts a quoted
 *    `javascript:` URL, so neither is caught by parsing alone.
 * 3. **That a value declared as a length actually is one**, which generic
 *    parsing does not tell us: `"10"` and `"red"` are both well-formed CSS
 *    values and neither is a length.
 *
 * What is NOT checked is whether a value is grammatically legal for its
 * property. The reference grammar available to do that lags the CSS browsers
 * actually ship — measured against css-tree 2.3.1, it rejects `oklch()`,
 * `color-mix()`, `clamp()` and does not even know `container-type` — so using
 * it as a gate would refuse correct, current CSS. Per-property strictness comes
 * instead from the catalog's own keyword sets, which are ours to keep current.
 *
 * The parser and walker are imported by subpath rather than from css-tree's
 * root: the root entry loads that same MDN reference data, which reaches for
 * `node:module`, and the engine promises to run in browsers and edge runtimes.
 *
 * ## The complexity suppressions in this module's parts
 *
 * Nine functions in its parts carry `fallow-ignore-next-line complexity`:
 * `measurementRejection`, `attrProducesDimension` and `alternationRejection`
 * in `css-value-dimensions`, `numericType` and `callType` in
 * `css-value-types`, `escapeIdentifier` in `css-value-syntax`,
 * `walkForUrlRejection` in `css-value-urls`, `checkColorValue` in
 * `css-value-colors` and `nestingDepth` in `css-value-check`. They moved there
 * unchanged, apart from an `export`, when this module was split into parts,
 * and their scores were inherited, so ungated, while they sat here. The audit
 * calls them new only because their files are new, and the health baseline
 * is generated from `main`, never from a branch. Suppressed inline, one by
 * one, as `ops.ts`, `validation.ts` and `list-query.ts` do for theirs: a new
 * complex function added to any part still gets caught.
 */

export { MAX_VALUE_LENGTH } from "./css-value-vocabulary";
export type { CssValueRejection, MayFetchUrl } from "./css-value-vocabulary";
export {
  asciiLower,
  decodeIdentifier,
  escapeIdentifier,
  isCssWideKeyword,
  splitCssTokens,
  trimCssWhitespace,
} from "./css-value-syntax";
export { unitCategory } from "./css-value-types";
export { checkUrlValue } from "./css-value-urls";
export {
  checkCssValue,
  isOverlongValue,
  referencesCustomProperty,
} from "./css-value-check";
export { checkDimensionValue } from "./css-value-dimensions";
export { checkColorValue } from "./css-value-colors";
