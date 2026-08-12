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
 *
 * `client` says which side of the React boundary the entry belongs to, and is DECLARED because
 * nothing about a subpath reveals it. Deriving it from "everything except the root is server-safe"
 * meant a client subpath added later would be built by the server-safe config, which adds no
 * `"use client"` banner, while the directive guard demanded that same artifact stay unmarked —
 * three green guards over an entry point React cannot use. Declaring it keeps enrolment automatic
 * without guessing: a new subpath still cannot be added silently, because a missing entry here is
 * an error.
 */
const SOURCES = {
  ".": { source: "src/index.ts", client: true },
  "./tailwind-preset": { source: "src/tailwind-preset.ts", client: false },
  "./utils": { source: "src/lib/utils.ts", client: false },
  "./color": { source: "src/lib/color/index.ts", client: false },
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
 * The export conditions this module knows how to follow, and the targets it reads inside each.
 *
 * Anything else is refused rather than ignored. A resolver picks the FIRST condition it matches,
 * so a `react-server`, `browser` or top-level `default` key would be selected in the environment
 * that matches it, ahead of the four targets below — and the artifact those consumers actually
 * receive would have had neither its surface nor its client directive checked, while all three
 * guards passed on the files nobody in that environment resolves to.
 */
const SUPPORTED_CONDITIONS = new Set(["import", "require"]);
const SUPPORTED_TARGETS = new Set(["types", "default"]);

/**
 * The file extension each condition's target must carry.
 *
 * A condition names the module system a consumer arrives through, and the extension decides what
 * Node actually parses the file as. Pointing `require.default` at an `.mjs` builds cleanly, passes
 * the client-directive check, and draws only a warning from publint — while `require()` of the
 * package throws `ERR_REQUIRE_ESM` at the first consumer to try it, because CI ignores attw's
 * `cjs-resolves-to-esm` rule. Checking the extension here is what makes that unshippable.
 */
const REQUIRED_EXTENSION = {
  importTypes: ".d.ts",
  requireTypes: ".d.cts",
  importDefault: ".mjs",
  requireDefault: ".cjs",
};

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
 * The published entry points implied by an export map and a set of declared barrels.
 *
 * Stylesheets are excluded: they are published as plain strings in the export map and none of the
 * three guards has anything to say about them.
 *
 * Takes both inputs rather than reading them, so the refusals below can be exercised directly.
 * Each one describes a map this package does not have yet — a client subpath, a bare JavaScript
 * target, two subpaths sharing an artifact — and a check that can only ever run against the real
 * `package.json` proves that today's map is acceptable, not that the check works.
 *
 * @param {Record<string, unknown>} exportMap The `exports` field to read.
 * @param {Record<string, {source: string, client: boolean}>} sources The declared barrels.
 * @returns {PublishedEntry[]}
 */
export function derivePublishedEntries(exportMap, sources) {
  const entries = [];

  for (const [subpath, target] of Object.entries(exportMap ?? {})) {
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

    for (const [condition, nested] of Object.entries(target)) {
      if (!SUPPORTED_CONDITIONS.has(condition)) {
        throw new Error(
          `The export "${subpath}" has a "${condition}" condition, which these guards do not ` +
            "follow. A resolver matching it would select a file whose surface and client " +
            "directive were never checked. Add support for it here, or remove it."
        );
      }
      for (const key of Object.keys(nested ?? {})) {
        if (!SUPPORTED_TARGETS.has(key)) {
          throw new Error(
            `The export "${subpath}" has a "${condition}.${key}" target, which these guards do ` +
              "not follow. Add support for it here, or remove it."
          );
        }
      }
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

    // Every target must carry the extension its condition requires, and all four must be the SAME
    // build entry under those extensions. tsup names its output after the entry, so that is the
    // only shape it can produce — and requiring it is what makes the collision check below
    // complete. Derived from `import.default` alone, a map whose `require` targets borrowed
    // ANOTHER entry's basename passed every guard while `require("./a")` resolved to `./b`'s API
    // and `import "./a"` resolved to its own.
    const buildNames = new Set();
    for (const [condition, value] of Object.entries(paths)) {
      const extension = REQUIRED_EXTENSION[condition];
      if (!value.endsWith(extension)) {
        throw new Error(
          `The export "${subpath}" points ${condition} at "${value}", which does not end in ` +
            `"${extension}". A consumer arriving through that condition would be handed a file ` +
            "the wrong module system parses."
        );
      }
      buildNames.add(file(value).slice(0, -extension.length));
    }
    if (buildNames.size !== 1) {
      throw new Error(
        `The export "${subpath}" resolves to more than one build entry ` +
          `(${[...buildNames].sort().join(", ")}). Its four targets have to be one entry's ` +
          "output, or the files a consumer receives depend on how they imported it."
      );
    }

    const declared = sources[subpath];
    if (declared === undefined) {
      throw new Error(
        `The export "${subpath}" has no source barrel. Add one to SOURCES, so the build and the ` +
          "surface snapshot read the same file, and say whether it is client code."
      );
    }
    const { source, client } = declared;
    const artifacts = [file(paths.importDefault), file(paths.requireDefault)];
    entries.push({
      subpath,
      source,
      name: [...buildNames][0],
      declarations: [file(paths.importTypes), file(paths.requireTypes)],
      artifacts,
      serverSafe: !client,
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
  const unpublished = Object.keys(sources).filter(
    subpath => !entries.some(entry => entry.subpath === subpath)
  );
  if (unpublished.length > 0) {
    throw new Error(
      `SOURCES names ${unpublished.join(", ")}, which the export map does not publish. Remove ` +
        "the stale key, or add the matching export."
    );
  }

  // Two subpaths may resolve to one artifact only if they are built from one barrel. The build
  // entries are keyed by artifact name, so a collision between DIFFERENT barrels keeps whichever
  // came last and silently gives both subpaths its API — while the surface suite went on
  // snapshotting the two declared sources separately and the file guards inspected the single
  // shared output twice, leaving every check green.
  const barrelsByName = new Map();
  for (const entry of entries) {
    const seen = barrelsByName.get(entry.name);
    if (seen && seen.source !== entry.source) {
      throw new Error(
        `The exports "${seen.subpath}" and "${entry.subpath}" both resolve to the artifact ` +
          `"${entry.name}", but are built from "${seen.source}" and "${entry.source}". One of ` +
          "them would overwrite the other; give them separate artifacts, or one shared barrel."
      );
    }
    if (!seen) barrelsByName.set(entry.name, entry);
  }

  return entries;
}

/**
 * Every published entry point that resolves to JavaScript, read from this package.
 *
 * @returns {PublishedEntry[]}
 */
export function publishedEntries() {
  const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8"));
  return derivePublishedEntries(pkg.exports, SOURCES);
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
export function declarationFiles(entries = publishedEntries()) {
  return entries.flatMap(entry => entry.declarations);
}

/**
 * The built JavaScript files that MUST carry a `"use client"` banner.
 *
 * The mirror of {@link serverSafeArtifacts}, and derived for the same reason: hard-coding the
 * root's artifacts leaves the guard checking files a consumer may no longer resolve to.
 *
 * @returns {string[]}
 */
export function clientArtifacts(entries = publishedEntries()) {
  return entries
    .filter(entry => !entry.serverSafe)
    .flatMap(entry => entry.artifacts);
}

/**
 * The built JavaScript files that must NOT carry a `"use client"` banner.
 *
 * @returns {string[]}
 */
export function serverSafeArtifacts(entries = publishedEntries()) {
  return entries
    .filter(entry => entry.serverSafe)
    .flatMap(entry => entry.artifacts);
}

/**
 * The build entries for the server-safe subpaths, as tsup expects them.
 *
 * @returns {Record<string, string>}
 */
export function serverSafeBuildEntries(entries = publishedEntries()) {
  return Object.fromEntries(
    entries
      .filter(entry => entry.serverSafe)
      .map(entry => [entry.name, entry.source])
  );
}

/**
 * Every subpath's source barrel, keyed by subpath.
 *
 * @returns {Record<string, string>}
 */
export function sourcesBySubpath(entries = publishedEntries()) {
  return Object.fromEntries(
    entries.map(entry => [entry.subpath, entry.source])
  );
}

/**
 * The build entries for the client subpaths, as tsup expects them.
 *
 * EVERY client entry, not the first one found. Once a subpath can declare itself client code,
 * selecting one means a second is emitted by neither config — the server-safe build excludes all
 * client entries — while `clientArtifacts()` still requires its banner, so the build fails on a
 * file nothing was asked to produce.
 *
 * Keyed by artifact name rather than given as bare paths, because tsup names its output after the
 * entry: an unnamed entry pointed at a differently named barrel emits files called after that
 * barrel, while the export map still points at `dist/index.*`.
 *
 * @returns {Record<string, string>}
 */
export function clientBuildEntries(entries = publishedEntries()) {
  const client = entries.filter(entry => !entry.serverSafe);
  if (client.length === 0) {
    throw new Error(
      "No client entry point was found. The root export has moved or changed shape, and the " +
        "component build would be reading a path nothing publishes."
    );
  }
  return Object.fromEntries(client.map(entry => [entry.name, entry.source]));
}
