/**
 * Run the server-safe subpaths in a project that CANNOT resolve anything they are not allowed to
 * reach, so a stray load fails at that moment rather than being recognised.
 *
 * The other server-safe guards read things. The directive guard looks for a `"use client"` banner,
 * the artifact gate compares what each built file reaches against an allow-list, and the source ban
 * refuses runtime module resolution by naming the forms it permits. All three are models, and a
 * model answers for the cases it was taught: the source ban gained fourteen forms over five rounds
 * of one review, every one found by a person rather than by the check.
 *
 * This asks a different question. Install ONLY the packages a server-safe entry point may use, place
 * ONLY the server-safe artifacts, and import them. A load of anything else throws
 * `ERR_MODULE_NOT_FOUND` whatever produced it — a computed specifier, `eval`, a host object, a form
 * nobody has thought of — because the file is not on disk. Nothing has to recognise a spelling.
 *
 * ## The two halves both have to be asserted
 *
 * A probe that reaches nothing at all blocks every route and reports a perfect pass, so "the
 * forbidden thing failed" is worthless on its own. Both directions are checked here:
 *
 * - every server-safe subpath must LOAD and expose at least one name, which is what proves the
 *   module was evaluated rather than merely resolved;
 * - a package that is a real dependency of this one and NOT in the allow-list must FAIL to load.
 *   If it succeeds, the isolation did not happen — the tarball was installed normally and pulled
 *   its whole dependency set in beside it — and every other result in the run is vacuous.
 *
 * The second assertion is about the instrument rather than the subject. Without it the expected
 * output of a correctly isolated run and a completely unisolated one differ in nothing this file
 * looks at.
 *
 * ## What this does NOT establish
 *
 * Execution only observes what EXECUTES. A resolver behind a branch that import-time evaluation
 * never takes is invisible here and visible to the source ban in `src/layering.test.ts`, which is
 * why that ban stays. The two cover different halves and neither subsumes the other.
 *
 * Usage, from this package's directory:
 *   tsx scripts/write-server-safe-isolation-probe.ts <directory>            write the project
 *   tsx scripts/write-server-safe-isolation-probe.ts --prune <directory>    drop non-server-safe files
 *   tsx scripts/write-server-safe-isolation-probe.ts --verify <directory>   read what the probes wrote
 *
 * Through `tsx` rather than `node`, because the lowest supported Node cannot execute TypeScript
 * directly. That is also how the workflow invokes it.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  clientArtifacts,
  publishedEntries,
  SERVER_SAFE_ALLOWED_PACKAGES,
} from "./published-entries.js";

/** Where each probe records that it reached the end of its own run. */
const MARKERS = { esm: "probe-esm.json", cjs: "probe-cjs.json" } as const;

/** The installed copy of this package inside the probe project. */
const INSTALLED = join("node_modules", "@nextlyhq", "ui");

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * A dependency of this package that a server-safe entry point may NOT use.
 *
 * Derived by subtracting the allow-list from the real manifest rather than written down, so it
 * cannot name a package that has since been removed — a sentinel that is absent for the wrong
 * reason fails to load exactly like a working boundary, and would certify an unisolated run.
 *
 * Sorted before choosing so the same name is picked on every run and a failure names a stable
 * package rather than whichever one the manifest happened to list first.
 */
function forbiddenSentinel(): string {
  const manifest = JSON.parse(
    readFileSync(join(packageRoot, "package.json"), "utf8")
  ) as { dependencies?: Record<string, string> };
  const forbidden = Object.keys(manifest.dependencies ?? {})
    .filter(name => !SERVER_SAFE_ALLOWED_PACKAGES.has(name))
    .sort();
  if (forbidden.length === 0) {
    throw new Error(
      "Every declared dependency is on the server-safe allow-list, so there is no package whose " +
        "absence can demonstrate that the probe project is isolated. Without that control a run " +
        "in a fully populated project is indistinguishable from an isolated one."
    );
  }
  return forbidden[0];
}

/** The server-safe subpaths, as a consumer spells them. */
function serverSafeSubpaths(): string[] {
  const subpaths = publishedEntries()
    .filter(entry => entry.serverSafe)
    .map(entry => entry.subpath);
  if (subpaths.length === 0) {
    throw new Error(
      "No server-safe subpaths were derived from the export map, so the probe would import " +
        "nothing and pass without asserting anything."
    );
  }
  return subpaths;
}

/**
 * Write the project, its manifest, and both probes.
 *
 * The manifest declares the allow-list and nothing else, which is what makes the boundary real:
 * `npm install` in this directory brings in exactly the packages a server-safe entry point is
 * permitted to reach, and the package under test is placed beside them afterwards rather than
 * installed, so its own dependency set is never resolved.
 */
function write(target: string): void {
  mkdirSync(target, { recursive: true });

  const allowed = [...SERVER_SAFE_ALLOWED_PACKAGES].sort();
  const dependencies = Object.fromEntries(allowed.map(name => [name, "*"]));
  writeFileSync(
    join(target, "package.json"),
    `${JSON.stringify({ name: "server-safe-isolation-probe", private: true, version: "1.0.0", dependencies }, null, 2)}\n`
  );

  const subpaths = serverSafeSubpaths();
  const sentinel = forbiddenSentinel();
  const specifiers = subpaths.map(subpath => `@nextlyhq/ui${subpath.slice(1)}`);

  // Both module systems, because the export map publishes both and a consumer arriving through
  // `require` resolves different files. Checking one leaves the other's artifacts evaluated by
  // nothing, while the map still promises them.
  writeFileSync(
    join(target, "probe.mjs"),
    `import { writeFileSync } from "node:fs";
const loaded = {};
for (const specifier of ${JSON.stringify(specifiers)}) {
  const module = await import(specifier);
  loaded[specifier] = Object.keys(module).length;
}
let sentinelReached = false;
try {
  await import(${JSON.stringify(sentinel)});
  sentinelReached = true;
} catch {}
writeFileSync(${JSON.stringify(MARKERS.esm)}, JSON.stringify({ loaded, sentinelReached }));
`
  );

  writeFileSync(
    join(target, "probe.cjs"),
    `const { writeFileSync } = require("node:fs");
const loaded = {};
for (const specifier of ${JSON.stringify(specifiers)}) {
  const module = require(specifier);
  loaded[specifier] = Object.keys(module).length;
}
let sentinelReached = false;
try {
  require(${JSON.stringify(sentinel)});
  sentinelReached = true;
} catch {}
writeFileSync(${JSON.stringify(MARKERS.cjs)}, JSON.stringify({ loaded, sentinelReached }));
`
  );

  console.log(
    `Wrote an isolation probe for ${subpaths.length} server-safe subpaths (${subpaths.join(", ")}) ` +
      `to ${target}. Allowed dependencies: ${allowed.join(", ")}. Isolation is demonstrated by ` +
      `${sentinel} failing to load.`
  );
}

/**
 * Remove every artifact the server-safe subpaths do not own.
 *
 * The export map refuses a deep import, so a client subpath cannot be reached by name. A RELATIVE
 * import from inside a server-safe artifact is a different route and the map has nothing to say
 * about it, so those files are deleted rather than left present and unreachable-by-name.
 */
function prune(target: string): void {
  const dist = join(target, INSTALLED, "dist");
  if (!existsSync(dist)) {
    throw new Error(
      `${dist} does not exist, so there is nothing to prune and the probe would run against a ` +
        "package that was never placed. Extract the packed tarball there first."
    );
  }
  const removed: string[] = [];
  for (const artifact of clientArtifacts()) {
    const path = join(dist, artifact);
    if (existsSync(path)) {
      rmSync(path);
      removed.push(artifact);
    }
  }
  if (removed.length === 0) {
    throw new Error(
      "No client artifacts were removed. Either the build produced none — in which case the " +
        "package has no client surface and this check is asserting less than it appears to — or " +
        "the tarball was extracted somewhere other than the path above."
    );
  }
  console.log(`Removed ${removed.length} client artifacts from ${dist}.`);
}

/**
 * Read what the probes recorded, rather than trusting that they exited 0.
 *
 * A module that ends the process while it initialises exits 0 from inside the import being
 * checked, so the exit status of a probe cannot distinguish "imported everything" from "died on
 * the first one". The marker is written last and is the only evidence that the run completed.
 */
function verify(target: string): void {
  const expected = serverSafeSubpaths().map(
    subpath => `@nextlyhq/ui${subpath.slice(1)}`
  );
  const problems: string[] = [];

  for (const [system, marker] of Object.entries(MARKERS)) {
    const path = join(target, marker);
    if (!existsSync(path)) {
      problems.push(
        `The ${system} probe wrote no marker, so it did not reach the end of its run. Its exit ` +
          "status cannot tell you why: a module ending the process during initialization exits 0."
      );
      continue;
    }
    const record = JSON.parse(readFileSync(path, "utf8")) as {
      loaded: Record<string, number>;
      sentinelReached: boolean;
    };

    if (record.sentinelReached) {
      problems.push(
        `The ${system} probe loaded a package outside the allow-list, so the project it ran in was ` +
          "not isolated and every other result from it is vacuous. The package under test was " +
          "probably installed rather than placed, which resolves its whole dependency set."
      );
    }

    for (const specifier of expected) {
      const names = record.loaded[specifier];
      if (names === undefined) {
        problems.push(`The ${system} probe never loaded ${specifier}.`);
      } else if (names === 0) {
        problems.push(
          `${specifier} loaded under ${system} and exposed no names, so nothing proves its module ` +
            "body was evaluated rather than merely resolved."
        );
      }
    }
  }

  if (problems.length > 0) {
    console.error(problems.map(problem => `- ${problem}`).join("\n"));
    process.exit(1);
  }
  console.log(
    `Both probes loaded all ${expected.length} server-safe subpaths with non-empty exports, and ` +
      "neither could reach a package outside the allow-list."
  );
}

const MODES = new Set(["--prune", "--verify"]);
const flag = process.argv[2];
const mode = MODES.has(flag) ? flag : undefined;
const target = mode === undefined ? process.argv[2] : process.argv[3];

if (target === undefined) {
  console.error(
    "Usage: tsx scripts/write-server-safe-isolation-probe.ts [--prune|--verify] <directory>. The " +
      "directory is where the probe project is written; it is created if it does not exist."
  );
  process.exit(1);
}

if (mode === "--prune") prune(target);
else if (mode === "--verify") verify(target);
else write(target);
