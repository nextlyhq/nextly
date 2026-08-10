/**
 * The package's published JavaScript entry points, read from the export map.
 *
 * ## Why this exists
 *
 * Three guards protect a published entry point: its built declarations must carry a release tag,
 * its source barrel must match a surface snapshot, and a server-safe entry must not carry a
 * client banner. Each guard reads a list of what to check, and a list written by hand is opt-in —
 * so a newly published subpath is absent from it, every assertion stays green, and nothing
 * reports that the new entry point is unchecked.
 *
 * The export map is the one place that already knows what ships. Deriving the lists from it makes
 * enrolment automatic, so there is no step to remember and no two lists to keep in step.
 *
 * @module scripts/published-entries
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * One published entry point.
 *
 * @typedef {object} PublishedEntry
 * @property {string} subpath The export key, such as `.` or `./color`.
 * @property {string[]} declarations The declaration files it resolves to, ESM then CJS.
 * @property {string[]} artifacts The JavaScript files it resolves to, ESM then CJS.
 * @property {boolean} serverSafe Whether it is importable from server code.
 */

/**
 * Every published entry point that resolves to JavaScript.
 *
 * Stylesheets are excluded: they are published as plain strings in the export map and none of the
 * three guards has anything to say about them.
 *
 * `serverSafe` is derived rather than listed. The root barrel is the component surface and is
 * published with a `"use client"` banner; every other JavaScript subpath exists precisely because
 * it carries no React runtime, which is the property that makes it importable from a server
 * component. Anything published from the root is client code by construction.
 *
 * @returns {PublishedEntry[]}
 */
export function publishedEntries() {
  const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8"));
  const entries = [];

  for (const [subpath, target] of Object.entries(pkg.exports ?? {})) {
    // A stylesheet maps straight to a string; a JavaScript entry maps to conditions.
    if (typeof target !== "object" || target === null) continue;

    // Every condition's OWN target is kept. Synthesising the other three from one basename
    // assumes they share it, and a map is free not to: the guards would then inspect files that
    // are emitted but never selected, while the ones `import` and `require` actually resolve to
    // go unchecked.
    const paths = {
      importTypes: target.import?.types,
      requireTypes: target.require?.types,
      importDefault: target.import?.default,
      requireDefault: target.require?.default,
    };

    for (const [condition, value] of Object.entries(paths)) {
      if (typeof value !== "string") {
        throw new Error(
          `The export "${subpath}" has no ${condition} target, so the file a consumer resolves ` +
            "to cannot be checked. Give it one, or exclude the entry from the export map."
        );
      }
    }

    const file = value => value.replace(/^\.\//, "").replace(/^dist\//, "");
    entries.push({
      subpath,
      declarations: [file(paths.importTypes), file(paths.requireTypes)],
      artifacts: [file(paths.importDefault), file(paths.requireDefault)],
      serverSafe: subpath !== ".",
    });
  }

  if (entries.length === 0) {
    throw new Error(
      "No published JavaScript entry points were found. The export map has moved or changed " +
        "shape, and every guard reading this would now be passing vacuously."
    );
  }

  return entries;
}

/**
 * The built declaration files a published entry point resolves to, in both module systems.
 *
 * Both, because each entry point has an `import.types` AND a `require.types` condition. Listing
 * only the ESM side left the files served to CommonJS consumers unchecked while every assertion
 * stayed green.
 *
 * @returns {string[]}
 */
export function declarationFiles() {
  return publishedEntries().flatMap(entry => entry.declarations);
}

/**
 * The built JavaScript files that must NOT carry a `"use client"` banner.
 *
 * @returns {string[]}
 */
export function serverSafeArtifacts() {
  return publishedEntries()
    .filter(entry => entry.serverSafe)
    .flatMap(entry => entry.artifacts);
}
