/**
 * Fixture for the release-tag shadowing guard in `ui-surface.test.ts`.
 *
 * It holds one declaration of each shape so the detector can be shown to fire
 * on the defect and stay quiet on the three things that resemble it. A guard
 * asserting an empty list proves nothing on its own: an empty list is what a
 * detector that parses nothing also returns.
 *
 * Not named `*.test.ts`, so Vitest does not collect it, and it lives in
 * `__tests__/`, which the guard's own file walk skips.
 */

/**
 * The defect. This description never reaches the symbol, because the tag block
 * below it is the one TypeScript associates with the declaration.
 */
/** @experimental */
export const shadowedTag = 1;

/**
 * The fix: one block carrying both, so the description and the tag survive.
 *
 * @experimental
 */
export const mergedTag = 2;

/** @experimental */
export const tagOnly = 3;

/**
 * Prose on the line of the declaration above is a TRAILING comment of that
 * declaration, so the tag block below is the only block leading this one.
 */
export const beforeTrailing = 4; /** Trailing prose, documenting nothing below. */
/** @experimental */
export const afterTrailing = 5;
