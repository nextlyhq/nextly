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
 * The source barrel behind each published subpath.
 *
 * Declared here rather than in the build config, and read BY it, so a retarget happens once. When
 * the build owned this and the surface snapshot kept its own copy, pointing an entry at a
 * different barrel left the snapshot reading the old one — the new barrel published, and its
 * exports never compared against anything.
 *
 * The export map decides what ships; this decides where each shipped thing is built from. The two
 * are checked against each other, so a subpath without a source, or a source without a subpath,
 * is an error rather than a gap.
 */
const SOURCES = {
  ".": "src/index.ts",
  "./tailwind-preset": "src/tailwind-preset.ts",
  "./utils": "src/lib/utils.ts",
  "./color": "src/lib/color/index.ts",
};

/**
 * Direct string targets the guards deliberately have nothing to say about.
 *
 * An allow-list of asset extensions rather than a list of JavaScript ones, so the unrecognised
 * case fails closed. A deny-list would pass an extensionless target such as `./dist/motion`,
 * which is JavaScript that no condition names — exactly what must not slip through.
 */
const ASSET_TARGET = /\.css$/;

/**
 * One published entry point.
 *
 * @typedef {object} PublishedEntry
 * @property {string} subpath The export key, such as `.` or `./color`.
 * @property {string} source The barrel it is built from, relative to the package root.
 * @property {string} name The build entry's key, such as `index` or `color`.
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
    // A stylesheet maps straight to its file. Every other direct target is refused rather than
    // skipped: a subpath published as a bare string names no `types` condition and no separate
    // ESM and CommonJS files, so the guards have nothing to read, and passing over it in silence
    // would recreate the very gap this module exists to close.
    if (typeof target === "string") {
      if (ASSET_TARGET.test(target)) continue;
      throw new Error(
        `The export "${subpath}" maps directly to "${target}". A JavaScript entry point must map ` +
          "to `import` and `require` conditions so its declarations and its client directive can " +
          "be checked; an asset must carry a recognised extension."
      );
    }
    if (typeof target !== "object" || target === null) {
      throw new Error(
        `The export "${subpath}" is neither a conditions object nor a file path, so there is ` +
          "nothing for the guards to check."
      );
    }

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
    const source = SOURCES[subpath];
    if (source === undefined) {
      throw new Error(
        `The export "${subpath}" has no source barrel. Add one to SOURCES, so the build and the ` +
          "surface snapshot read the same file."
      );
    }
    const artifacts = [file(paths.importDefault), file(paths.requireDefault)];
    entries.push({
      subpath,
      source,
      name: artifacts[0].replace(/\.[^.]+$/, ""),
      declarations: [file(paths.importTypes), file(paths.requireTypes)],
      artifacts,
      serverSafe: subpath !== ".",
    });
  }

  if (entries.length === 0) {
    throw new Error(
      "No published JavaScript entry points were found. The export map has moved or changed " +
        "shape, and every guard reading this would now be passing vacuously."
    );
  }

  // Checked in the other direction too. Every consumer derives its list from the published
  // entries, so a key naming a subpath that is no longer published is dropped before any guard
  // sees it: the retarget it describes would go unchecked while this map still claimed to
  // describe it.
  const unpublished = Object.keys(SOURCES).filter(
    subpath => !entries.some(entry => entry.subpath === subpath)
  );
  if (unpublished.length > 0) {
    throw new Error(
      `SOURCES names ${unpublished.join(", ")}, which the export map does not publish. Remove ` +
        "the stale key, or add the matching export."
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
 * The built JavaScript files that MUST carry a `"use client"` banner.
 *
 * The mirror of {@link serverSafeArtifacts}, and derived for the same reason: hard-coding the
 * root's artifacts leaves the guard checking files a consumer may no longer resolve to.
 *
 * @returns {string[]}
 */
export function clientArtifacts() {
  return publishedEntries()
    .filter(entry => !entry.serverSafe)
    .flatMap(entry => entry.artifacts);
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

/**
 * The build entries for the server-safe subpaths, as tsup expects them.
 *
 * @returns {Record<string, string>}
 */
export function serverSafeBuildEntries() {
  return Object.fromEntries(
    publishedEntries()
      .filter(entry => entry.serverSafe)
      .map(entry => [entry.name, entry.source])
  );
}

/**
 * Every subpath's source barrel, keyed by subpath.
 *
 * @returns {Record<string, string>}
 */
export function sourcesBySubpath() {
  return Object.fromEntries(
    publishedEntries().map(entry => [entry.subpath, entry.source])
  );
}

/**
 * The build entry for the root barrel, KEYED by its published artifact name.
 *
 * Keyed rather than a bare path, because tsup names its output after the entry: an unnamed entry
 * pointed at a differently named barrel emits files called after that barrel, and the export map
 * still points at `dist/index.*`. The retarget this helper exists to support would then fail its
 * own artifact checks.
 *
 * @returns {Record<string, string>}
 */
export function rootBuildEntry() {
  const root = publishedEntries().find(entry => !entry.serverSafe);
  if (!root) {
    throw new Error(
      "No client entry point was found. The root export has moved or changed shape, and the " +
        "component build would be reading a path nothing publishes."
    );
  }
  return { [root.name]: root.source };
}
