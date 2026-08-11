/**
 * Types for the stamp helper, which is authored as `.mjs` because the
 * generator scripts run under plain node and cannot import TypeScript.
 *
 * Declared rather than suppressed at the call site: the test that verifies a
 * stamp imports the same function the generators use, and that shared
 * implementation is the point -- two implementations of "the harness's
 * identity" would be free to disagree.
 */

/** The contrast harness's location, relative to the repository root. */
export declare const CONTRAST_SOURCE_DIR: string;

/**
 * A short, stable hash of every file that participates in a measurement,
 * excluding tests, which do not compute ratios.
 */
export declare function contrastSourceStamp(repoRoot: string): string;
