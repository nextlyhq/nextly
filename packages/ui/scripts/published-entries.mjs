/**
 * The package's published JavaScript entry points, read from the export map.
 *
 * ## Why this exists
 *
 * Three separate guards protect a published entry point, and each held its own hand-written list:
 * the built declarations must carry a release tag, the source barrel must match a surface
 * snapshot, and a server-safe entry must not carry a client banner. Every one of those lists is
 * correct and every one is opt-in, so **a newly published subpath was unprotected by default in
 * all three at once** — and each omission was found separately, in a different review round.
 *
 * The export map in `package.json` is the one place that already knows what ships. Deriving the
 * lists from it means adding an entry point enrols it in every check, so there is nothing left to
 * remember and nothing to keep in step.
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
 * @property {string} name The built file's base name, such as `index` or `color`.
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

    const types = target.import?.types;
    if (typeof types !== "string") {
      throw new Error(
        `The export "${subpath}" has no import.types condition, so its declarations cannot be ` +
          "checked. Give it one, or exclude it from the export map."
      );
    }

    // `./dist/color.d.ts` -> `color`
    const name = types.replace(/^\.\/dist\//, "").replace(/\.d\.ts$/, "");
    entries.push({ subpath, name, serverSafe: subpath !== "." });
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
  return publishedEntries().flatMap(({ name }) => [
    `${name}.d.ts`,
    `${name}.d.cts`,
  ]);
}

/**
 * The built JavaScript files that must NOT carry a `"use client"` banner.
 *
 * @returns {string[]}
 */
export function serverSafeArtifacts() {
  return publishedEntries()
    .filter(entry => entry.serverSafe)
    .flatMap(({ name }) => [`${name}.mjs`, `${name}.cjs`]);
}
