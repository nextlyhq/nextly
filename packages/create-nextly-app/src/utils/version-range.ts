/**
 * The small part of semver this CLI needs, in one implementation: reading a
 * version, comparing two, testing one against the `^X.Y.Z` / `>=X.Y.Z` ranges
 * the CLI itself declares, and the lowest version a dependency spec admits.
 *
 * The plugin template's Node floor and the Next.js / React ranges an existing
 * app is held to both go through here, so the two checks cannot read a range
 * differently.
 */

type Version = readonly [number, number, number];

function parseVersion(text: string): Version {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(text.trim());
  if (!match) throw new Error(`not a version: ${text}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compare(a: Version, b: Version): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/**
 * Negative when `a` is older than `b`, positive when newer, 0 when equal.
 * A prerelease suffix is ignored: `17.0.0-canary.1` compares as `17.0.0`.
 */
export function compareVersions(a: string, b: string): number {
  return compare(parseVersion(a), parseVersion(b));
}

/**
 * Whether `version` satisfies one comparator. Only the two forms this CLI
 * writes are understood, `^X.Y.Z` and `>=X.Y.Z`; any other is refused rather
 * than read approximately, so a range that starts using another form fails
 * the test that reads it.
 */
function satisfiesComparator(version: Version, comparator: string): boolean {
  const caret = /^\^(\d+\.\d+\.\d+)$/.exec(comparator);
  if (caret) {
    const floor = parseVersion(caret[1]);
    return version[0] === floor[0] && compare(version, floor) >= 0;
  }
  const atLeast = /^>=(\d+\.\d+\.\d+)$/.exec(comparator);
  if (atLeast) return compare(version, parseVersion(atLeast[1])) >= 0;
  throw new Error(`unsupported range comparator: ${comparator}`);
}

/** Whether `version` satisfies a `||` list of `^X.Y.Z` / `>=X.Y.Z` comparators. */
export function satisfiesRange(version: string, range: string): boolean {
  const parsed = parseVersion(version);
  return range
    .split("||")
    .map(part => part.trim())
    .some(comparator => satisfiesComparator(parsed, comparator));
}

/**
 * The lowest version a package.json dependency spec admits, as `X.Y.Z`, or
 * `undefined` when the spec names no lower bound this can read: a dist-tag
 * (`latest`, `canary`), a protocol (`workspace:*`, `file:`, a URL), `*`, or an
 * upper bound alone (`<17`). An exact version is its own lowest; `^`, `~`, `=`
 * and `>=` start at the version they name; a missing or wildcard minor or
 * patch (`15`, `15.x`) counts as 0; across `||` the lowest alternative wins.
 */
export function lowestVersionIn(spec: string): string | undefined {
  let lowest: Version | undefined;
  for (const part of spec.split("||")) {
    const match =
      /^\s*(?:\^|~|>=|=)?\s*v?(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?/.exec(
        part
      );
    if (!match) continue;
    const number = (text: string | undefined) =>
      text === undefined || !/^\d+$/.test(text) ? 0 : Number(text);
    const found: Version = [
      Number(match[1]),
      number(match[2]),
      number(match[3]),
    ];
    if (!lowest || compare(found, lowest) < 0) lowest = found;
  }
  return lowest ? lowest.join(".") : undefined;
}
