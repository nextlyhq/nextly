/**
 * The Node versions a scaffolded plugin supports, and the check that refuses
 * to scaffold one on a Node it cannot build on.
 *
 * A plugin builds with tsdown and tests with Vitest, and each declares the
 * Node it runs on; the plugin's floor is where both agree. The repository's
 * packages have a lower floor, because only a plugin author runs these tools.
 * `scaffold-plugin.test.ts` derives this range from the installed tools' own
 * `engines`, so a version bump that moves either one fails there.
 */
export const PLUGIN_NODE_ENGINES = "^22.18.0 || ^24.11.0 || >=26.0.0";

type Version = readonly [number, number, number];

function parseVersion(text: string): Version {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(text.trim());
  if (!match) throw new Error(`not a Node version: ${text}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compare(a: Version, b: Version): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/**
 * Whether `version` satisfies one comparator. Only the two forms these tools
 * write are understood, `^X.Y.Z` and `>=X.Y.Z`; any other is refused rather
 * than read approximately, so a tool that starts declaring another form fails
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
  throw new Error(`unsupported Node range comparator: ${comparator}`);
}

/** Whether `version` satisfies a `||` list of `^X.Y.Z` / `>=X.Y.Z` comparators. */
export function satisfiesNodeRange(version: string, range: string): boolean {
  const parsed = parseVersion(version);
  return range
    .split("||")
    .map(part => part.trim())
    .some(comparator => satisfiesComparator(parsed, comparator));
}

/**
 * Why the plugin template cannot be scaffolded on `nodeVersion`, or
 * `undefined` when it can. Checked before anything is written, since a plugin
 * scaffolded on an older Node would install and then fail its first build.
 */
export function pluginNodeRefusal(nodeVersion: string): string | undefined {
  if (satisfiesNodeRange(nodeVersion, PLUGIN_NODE_ENGINES)) return undefined;
  return (
    `The plugin template builds with tools that need Node ${PLUGIN_NODE_ENGINES}, ` +
    `and this is Node ${nodeVersion}. Install a supported Node (for example ` +
    "`nvm install 24`) and run create-nextly-app again."
  );
}
