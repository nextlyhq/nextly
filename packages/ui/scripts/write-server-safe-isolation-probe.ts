/**
 * Run the server-safe subpaths in a project where every package they may not use is a TRIPWIRE, so
 * reaching one leaves evidence that survives whatever the caller does about the failure.
 *
 * The other server-safe guards read things. The directive guard looks for a `"use client"` banner,
 * the artifact gate compares what each built file reaches against an allow-list, and the source ban
 * refuses runtime module resolution by naming the forms it permits. All three are models of what a
 * consumer does, and a model answers only for the cases it encodes: its surface is every way the
 * language can spell a module load, which is unbounded, so it can be extended but never completed.
 *
 * ## Why a decoy rather than an empty project
 *
 * Leaving the forbidden packages out is the obvious design and it has a hole. Absence produces a
 * signal only when the failure ESCAPES: an entry point that swallows its own error —
 * `try { createRequire(...)("react") } catch {}` — resolves nothing here and throws nothing out,
 * so the run is indistinguishable from one that never tried. The same code succeeds in a consumer
 * where that package is installed, which is the situation that matters.
 *
 * Intercepting the request instead does not work either, and this was measured rather than assumed:
 * patching `Module._resolveFilename` and `Module._load` captures nothing for a require obtained
 * from `createRequire`, whether reached directly or through `process.getBuiltinModule`. The loader
 * hooks that would see it do not span the supported Node range — `registerHooks` starts at 22.15,
 * and `register` is documented not to affect `createRequire` at all.
 *
 * So the evidence is written by the thing being reached. Each forbidden package is replaced by a
 * module that appends its own name to a log and then throws. The throw preserves the old behaviour
 * for callers that do not catch; the log is what a caller cannot undo. Nothing has to recognise a
 * spelling, and nothing has to intercept anything, because the record is made after resolution has
 * already succeeded — by definition, whatever route got there.
 *
 * ## The two halves both have to be asserted
 *
 * A probe that reaches nothing at all trips no wire and reports a perfect pass, so "no wire was
 * tripped" is worthless on its own. Both directions are checked:
 *
 * - every server-safe subpath must LOAD and expose at least one name, which is what proves the
 *   module was evaluated rather than merely resolved;
 * - every tripwire must still BE a tripwire when the run ends. If the real package was installed
 *   over one, its absence of a marker says so — otherwise a project that resolved the package
 *   under test normally, pulling its whole dependency set in beside it, would pass every other
 *   assertion here.
 *
 * The second is about the instrument rather than the subject. Without it the expected output of a
 * correctly built project and a completely unisolated one differ in nothing this file looks at.
 *
 * ## What this does NOT establish
 *
 * Execution only observes what EXECUTES. A resolver behind a branch that import-time evaluation
 * never takes is invisible here and visible to the source ban in `src/layering.test.ts`, which is
 * why that ban stays. The two cover different halves and neither subsumes the other.
 *
 * The tripwires cover the packages this one SHIPS WITH — its dependencies and peer dependencies —
 * plus everything the install actually placed, which catches a transitive dependency hoisted to the
 * top level that no manifest here names.
 *
 * TWO ROUTES REMAIN OUTSIDE THIS, and they are the same fact wearing two costumes: a tripwire is
 * evidence written by code that RAN, so a forbidden reach that never executes the module leaves
 * none.
 *
 * - **Resolution without evaluation.** `createRequire(...).resolve("react")` returns the decoy's
 *   path and runs nothing in it, so no append happens. Wiring resolution instead is not available:
 *   that is the same statement, since `resolve` executes no code by design.
 * - **A load deferred behind a function.** These probes import each entry point and count its
 *   exports; a forbidden load inside an exported helper is never reached, because nothing calls it.
 *
 * Both are properties of runtime observation rather than defects here, and neither is closed by the
 * source ban either: it catches the plain spellings and says in its own header that computed host
 * access such as `globalThis["pro" + "cess"]` is outside what reading syntax can recognise. So a
 * COMPUTED resolver form that only resolves, or that sits behind an uncalled function, is currently
 * covered by neither check. That is written here rather than left for a green run to imply.
 *
 * Usage, from this package's directory:
 *   tsx scripts/write-server-safe-isolation-probe.ts <directory>            write the project
 *   tsx scripts/write-server-safe-isolation-probe.ts --arm <directory>      place tripwires, prune
 *   tsx scripts/write-server-safe-isolation-probe.ts --verify <directory>   read what the run left
 *
 * Through `tsx` rather than `node`, because the lowest supported Node cannot execute TypeScript
 * directly. That is also how the workflow invokes it.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

import {
  clientArtifacts,
  publishedEntries,
  SERVER_SAFE_ALLOWED_PACKAGES,
} from "./published-entries.js";

/** Where each probe records that it reached the end of its own run. */
const MARKERS = { esm: "probe-esm.json", cjs: "probe-cjs.json" } as const;

/** Where a tripwire appends its own name when something loads it. */
const REACHED_LOG = "tripwires-reached.log";

/** Written inside each tripwire so a real package installed over one is detectable. */
const TRIPWIRE_MARKER = ".is-tripwire";

/** The names `--arm` actually wired, so `--verify` checks those rather than a fresh derivation. */
const WIRED_MANIFEST = "tripwires.json";

/** The installed copy of this package inside the probe project. */
const INSTALLED = join("node_modules", "@nextlyhq", "ui");

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** This package's manifest, which decides both what is allowed and what is faked. */
function manifest(): {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
} {
  return JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
}

/**
 * The allowed packages at the versions this package actually supports.
 *
 * The RANGE is carried across rather than replaced with `*`. A wildcard installs whatever is
 * newest, so the day either package publishes a major this build never asked for, an unrelated
 * export change fails every pull request for a version the package does not claim to support —
 * and the failure names this probe rather than the upgrade that caused it.
 */
function allowedDependencies(): Record<string, string> {
  const declared = manifest().dependencies ?? {};
  return Object.fromEntries(
    [...SERVER_SAFE_ALLOWED_PACKAGES].sort().map(name => {
      const range = declared[name];
      if (range === undefined) {
        throw new Error(
          `${name} is on the server-safe allow-list but is not a declared dependency of this ` +
            "package, so there is no supported range to install it at. Either the allow-list " +
            "names a package that was removed, or the dependency was dropped without updating it."
        );
      }
      return [name, range] as const;
    })
  );
}

/**
 * Every package a server-safe entry point may not reach but COULD obtain in a real consumer.
 *
 * Dependencies and peer dependencies together, because both resolve where this package is
 * installed — a peer is absent from `node_modules` here and present in the app that consumes it,
 * so leaving peers out would mean the routes most worth catching had no wire on them.
 *
 * Derived by subtraction rather than listed, so a package added to the manifest is covered without
 * anyone remembering to come back here.
 */
function forbiddenPackages(): string[] {
  const declared = manifest();
  const names = new Set([
    ...Object.keys(declared.dependencies ?? {}),
    ...Object.keys(declared.peerDependencies ?? {}),
  ]);
  const forbidden = [...names]
    .filter(name => !SERVER_SAFE_ALLOWED_PACKAGES.has(name))
    .sort();
  if (forbidden.length === 0) {
    throw new Error(
      "Every package this one ships with is on the server-safe allow-list, so there is nothing to " +
        "place a tripwire on. A run in that state asserts only that the allowed packages load."
    );
  }
  return forbidden;
}

/**
 * Packages present at the top level of the probe project that the allow-list does not name.
 *
 * A scope directory is not a package — `@radix-ui` holds them — so it is descended into and its
 * children reported as scoped names. `@nextlyhq/ui` is excluded because it is the subject.
 *
 * Read from disk rather than from any manifest, because the packages this exists to catch are the
 * ones no manifest here mentions: a transitive dependency of an allowed package, hoisted to the top
 * level by npm's default install strategy, is resolvable by the package under test and invisible to
 * `forbiddenPackages()`.
 */
function installedForbidden(target: string): string[] {
  const root = join(target, "node_modules");
  if (!existsSync(root)) return [];
  const names: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    if (entry.name.startsWith("@")) {
      for (const scoped of readdirSync(join(root, entry.name))) {
        if (!scoped.startsWith(".")) names.push(`${entry.name}/${scoped}`);
      }
      continue;
    }
    names.push(entry.name);
  }
  return names.filter(
    name => name !== "@nextlyhq/ui" && !SERVER_SAFE_ALLOWED_PACKAGES.has(name)
  );
}

/** The server-safe subpaths, as the export map spells them. */
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
 * The server-safe subpaths as a CONSUMER spells them, which is what both probes import.
 *
 * The writer and the verifier must agree exactly: the probes record what they loaded under these
 * names and the verifier looks each one up. Computed in two places, a change to how an export key
 * becomes a specifier lands in one of them, and the verifier then either misses a subpath the probe
 * covered or demands one it never imported — reading, in both directions, as a fault in the package.
 */
function consumerSpecifiers(): string[] {
  return serverSafeSubpaths().map(subpath => `@nextlyhq/ui${subpath.slice(1)}`);
}

/**
 * Write the project, its manifest, and both probes.
 *
 * The manifest declares the allow-list and nothing else, so `npm install` here brings in exactly
 * the packages a server-safe entry point is permitted to reach. The package under test is placed
 * beside them afterwards rather than installed, so its own dependency set is never resolved, and
 * the tripwires then occupy the names that set would have filled.
 */
function write(target: string): void {
  mkdirSync(target, { recursive: true });

  // A marker or log left by an earlier run survives the failure they exist to catch: an artifact
  // calling `process.exit(0)` during initialisation ends its probe with status 0 before the final
  // write, and verification then reads the previous run's evidence about artifacts never loaded.
  for (const stale of [
    ...Object.values(MARKERS),
    REACHED_LOG,
    WIRED_MANIFEST,
  ]) {
    rmSync(join(target, stale), { force: true });
  }

  writeFileSync(
    join(target, "package.json"),
    `${JSON.stringify(
      {
        name: "server-safe-isolation-probe",
        private: true,
        version: "1.0.0",
        dependencies: allowedDependencies(),
      },
      null,
      2
    )}\n`
  );

  const specifiers = consumerSpecifiers();

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
writeFileSync(${JSON.stringify(MARKERS.esm)}, JSON.stringify({ loaded }));
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
writeFileSync(${JSON.stringify(MARKERS.cjs)}, JSON.stringify({ loaded }));
`
  );

  console.log(
    `Wrote an isolation probe for ${specifiers.length} server-safe subpaths to ${target}. Allowed: ` +
      `${Object.keys(allowedDependencies()).join(", ")}.`
  );
}

/**
 * Place a tripwire at every forbidden name, and remove the artifacts the server-safe subpaths do
 * not own.
 *
 * Runs after the install and the unpack, because both would overwrite what it puts down.
 *
 * The log path is RESOLVED to an absolute one before being baked in. A tripwire runs with the probe
 * directory as its working directory, so a relative target such as `./probe` would otherwise be
 * appended to itself and the evidence written under `./probe/probe/...`; if the caller catches the
 * resulting `ENOENT`, no log exists and verification passes. A wire that writes its evidence to the
 * wrong path reports nothing, which is the one failure mode that looks exactly like success.
 *
 * The wired set is taken from what is INSTALLED as well as what the manifest names. A transitive
 * dependency of an allowed package is placed at the top level by npm's default layout, is
 * resolvable by the package under test, and appears in no manifest this script reads — so deriving
 * from the manifest alone leaves exactly the packages nobody predicted without a wire.
 */
function arm(target: string): void {
  const dist = join(target, INSTALLED, "dist");
  if (!existsSync(dist)) {
    throw new Error(
      `${dist} does not exist, so the package under test was never placed and the probe would run ` +
        "against nothing. Extract the packed tarball there first."
    );
  }

  const logPath = resolvePath(target, REACHED_LOG);
  const wired = [
    ...new Set([...forbiddenPackages(), ...installedForbidden(target)]),
  ].sort();
  for (const name of wired) {
    const home = join(target, "node_modules", ...name.split("/"));
    mkdirSync(home, { recursive: true });

    // `appendFileSync` before the throw, so evidence exists whatever the caller does with the
    // error. Appended rather than written, because several tripwires may be reached in one run and
    // a rewrite would leave only the last.
    const body =
      `require("node:fs").appendFileSync(${JSON.stringify(logPath)}, ${JSON.stringify(`${name}\n`)});\n` +
      `throw new Error(${JSON.stringify(`${name} is not available to a server-safe entry point.`)});\n`;
    writeFileSync(join(home, "index.cjs"), body);
    writeFileSync(
      join(home, "index.mjs"),
      `import { appendFileSync } from "node:fs";\n` +
        `appendFileSync(${JSON.stringify(logPath)}, ${JSON.stringify(`${name}\n`)});\n` +
        `throw new Error(${JSON.stringify(`${name} is not available to a server-safe entry point.`)});\n`
    );
    writeFileSync(
      join(home, "package.json"),
      `${JSON.stringify(
        {
          name,
          version: "0.0.0",
          main: "index.cjs",
          exports: {
            ".": { import: "./index.mjs", require: "./index.cjs" },
            "./*": "./index.cjs",
          },
        },
        null,
        2
      )}\n`
    );
    writeFileSync(join(home, TRIPWIRE_MARKER), "");
  }

  // Recorded rather than recomputed. Verification has to check the wires that were actually
  // placed, and the installed half of that set depends on what the install produced — so a second
  // derivation at verify time can legitimately differ from this one and would report wires as
  // missing that were never asked for.
  writeFileSync(
    join(target, WIRED_MANIFEST),
    `${JSON.stringify(wired, null, 2)}\n`
  );

  // The export map refuses a deep import, so a client subpath cannot be reached by name. A
  // RELATIVE import from inside a server-safe artifact is a different route the map says nothing
  // about, so those files are deleted rather than left present.
  const removed = clientArtifacts().filter(artifact => {
    const path = join(dist, artifact);
    if (!existsSync(path)) return false;
    rmSync(path);
    return true;
  });
  if (removed.length === 0) {
    throw new Error(
      "No client artifacts were removed. Either the build produced none — in which case the " +
        "package has no client surface and this check asserts less than it appears to — or the " +
        "tarball was extracted somewhere other than the path above."
    );
  }
  console.log(
    `Armed ${wired.length} tripwires and removed ${removed.length} client artifacts.`
  );
}

/**
 * Read what the run left behind, rather than trusting that the probes exited 0.
 *
 * A module that ends the process while it initialises exits 0 from inside the import being checked,
 * so the exit status of a probe cannot distinguish "imported everything" from "died on the first
 * one". The marker is written last and is the only evidence that a run completed.
 */
function verify(target: string): void {
  const expected = consumerSpecifiers();
  const problems: string[] = [];

  // The instrument first. A tripwire that is no longer a tripwire means the real package was
  // installed over it, and every "no wire tripped" result below would then be reporting on a
  // project that never had the boundary it claims to be testing.
  //
  // The set comes from what `--arm` RECORDED, not from a second derivation. Half of it depends on
  // what the install produced, so recomputing here could legitimately differ and would report
  // wires as missing that were never asked for.
  const wiredPath = join(target, WIRED_MANIFEST);
  const wired: string[] = existsSync(wiredPath)
    ? (JSON.parse(readFileSync(wiredPath, "utf8")) as string[])
    : [];
  if (wired.length === 0) {
    problems.push(
      `${WIRED_MANIFEST} is absent or empty, so no tripwires were placed and nothing was watching ` +
        "any forbidden name during this run. Run --arm after installing and unpacking."
    );
  }

  const disarmed = wired.filter(
    name =>
      !existsSync(
        join(target, "node_modules", ...name.split("/"), TRIPWIRE_MARKER)
      )
  );
  if (disarmed.length > 0) {
    problems.push(
      `${disarmed.length} of ${wired.length} tripwires are missing or were replaced ` +
        `by a real package (${disarmed.slice(0, 5).join(", ")}${disarmed.length > 5 ? ", ..." : ""}). ` +
        "Nothing was watching those names, so this run cannot report on them either way."
    );
  }

  const logPath = join(target, REACHED_LOG);
  if (existsSync(logPath)) {
    const reached = [
      ...new Set(
        readFileSync(logPath, "utf8")
          .split("\n")
          .filter(line => line.length > 0)
      ),
    ].sort();
    if (reached.length > 0) {
      problems.push(
        `A server-safe entry point reached ${reached.join(", ")}. Whether the attempt threw is not ` +
          "the question: it fails here only because this package is a stand-in, and the same " +
          "request succeeds in a consumer where the real package is installed."
      );
    }
  }

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
    };

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
      `none of the ${wired.length} tripwires was reached.`
  );
}

const MODES = new Set(["--arm", "--verify"]);
const flag = process.argv[2];
const mode = MODES.has(flag) ? flag : undefined;

// A mistyped mode must not fall through to the target. `--verfy` is not in MODES, so it would be
// taken as a directory name, written as one, and exited 0 from — the verification never runs and
// the caller is told it succeeded. Anything that looks like a flag is therefore refused rather
// than reinterpreted, which is the same rule the rest of this file applies to its subject.
if (mode === undefined && flag !== undefined && flag.startsWith("-")) {
  console.error(
    `${flag} is not a mode. Use --arm, --verify, or no flag at all to write the project.`
  );
  process.exit(1);
}

const target = mode === undefined ? process.argv[2] : process.argv[3];

if (target === undefined) {
  console.error(
    "Usage: tsx scripts/write-server-safe-isolation-probe.ts [--arm|--verify] <directory>. The " +
      "directory is where the probe project is written; it is created if it does not exist."
  );
  process.exit(1);
}

if (mode === "--arm") arm(target);
else if (mode === "--verify") verify(target);
else write(target);
