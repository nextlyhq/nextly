import semver from "semver";

/**
 * Policy for all plugin version ranges: prereleases (alpha/beta) count as
 * in-range, so a `>=0.0.2-alpha.0` range matches the `0.0.2-alpha.21` core. (D6)
 */
const RANGE_OPTS = { includePrerelease: true } as const;

/** True if `range` is a parseable semver range. */
export function isValidRange(range: string): boolean {
  return semver.validRange(range, RANGE_OPTS) !== null;
}

/** True if concrete `version` satisfies `range` (prereleases in-range). */
export function satisfiesRange(version: string, range: string): boolean {
  return semver.satisfies(version, range, RANGE_OPTS);
}
