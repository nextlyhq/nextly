// Each function on its own: semver's root loads every one it has, at each
// command's start.
import satisfies from "semver/functions/satisfies.js";
import validRange from "semver/ranges/valid.js";

/**
 * Policy for all plugin version ranges: prereleases (alpha/beta) count as
 * in-range, so a `>=0.0.2-alpha.0` range matches the `0.0.2-alpha.21` core.
 */
const RANGE_OPTS = { includePrerelease: true } as const;

/** True if `range` is a parseable semver range. */
export function isValidRange(range: string): boolean {
  return validRange(range, RANGE_OPTS) !== null;
}

/** True if concrete `version` satisfies `range` (prereleases in-range). */
export function satisfiesRange(version: string, range: string): boolean {
  return satisfies(version, range, RANGE_OPTS);
}
