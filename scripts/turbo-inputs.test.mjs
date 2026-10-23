/**
 * Every TypeScript module a package ships must be part of what turbo HASHES for
 * that package's `check-types`.
 *
 * A task's inputs decide when its cached result is still valid. A source file
 * outside them cannot move the hash however badly it breaks, so turbo replays
 * the previous run and reports `Tasks: N successful` for code that was never
 * compiled — and because turbo does not cache failures, the replayed result is
 * a green from before the break. The failure is silent in the only direction
 * that matters: the job is green, the log says `cache hit, replaying logs`, and
 * the type error lives on `main` until an unrelated edit happens to move the
 * hash.
 *
 * This asserts the property structurally rather than reviewing the globs.
 * Reading `turbo.jsonc` and judging whether its patterns look complete is the
 * same act that produced the gap: the list had already been widened once along
 * the EXTENSION axis and still missed the DIRECTORY axis, because `e2e` keeps
 * its modules in `tests/` rather than `src/`. So the inputs are taken from
 * turbo itself, via `--dry=json`, and compared against the files git actually
 * tracks. A glob that stops covering a tree fails here whichever axis it fails
 * along.
 *
 * @module turbo-inputs.test
 */
import { execFileSync } from "node:child_process";
import { existsSync, globSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { literalText, parseSource, walk } from "@nextlyhq/module-specifiers/parse-source";
import { describe, expect, it } from "vitest";

/**
 * The repository root, derived from this module rather than `process.cwd()`,
 * which differs between a run from the root and one filtered to `scripts`.
 */
const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** Extensions the TypeScript compiler follows, so a change to one can break a build. */
const TYPESCRIPT_EXTENSIONS = /\.(?:ts|tsx|mts|cts)$/;

/**
 * Turbo's own view of what it hashes, rather than a second reading of the
 * config. `--dry=json` resolves every glob against the working tree, so the
 * answer accounts for `$TURBO_DEFAULT$`, negations and per-package overrides
 * that a pattern-by-pattern re-implementation here would have to model.
 */
/**
 * Long enough for a real compiler probe.
 *
 * Each case launches `tsc` synchronously, which takes seconds rather than
 * milliseconds — and Vitest's 5s default applies per case, so the suite fails
 * on duration while every assertion in it is correct. That failure is
 * indistinguishable from a hash gap in the summary line, which is the reason
 * this is a named constant rather than a number tucked into one call.
 */

import { parseTurboPlan } from "./turbo-plan.mjs";

const PROBE_TIMEOUT_MS = 180_000;

function dryRun(env = process.env) {
  const raw = execFileSync(
    "pnpm",
    ["exec", "turbo", "run", "check-types", "--dry=json"],
    { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env }
  );
  // Located rather than assumed: pnpm emits config warnings and turbo a
  // version banner, and which stream each uses varies between a terminal and a
  // runner. `parseTurboPlan` is the one reader of a turbo plan in this repo,
  // so the rule about where the document starts is stated once.
  return parseTurboPlan(raw, "turbo run check-types --dry=json");
}

/**
 * Whether a check-types command writes no build-info file: it runs `tsc` at
 * least once, and every run ends up with `--incremental false`. One `tsc`
 * without it writes the file, so the command still races its own build. tsc
 * keeps the LAST value of a repeated flag, and a bare `--incremental` means
 * true, so only the last `--incremental` in each run decides.
 */
function writesNoBuildInfo(command) {
  const runs = command.match(/\btsc\b[^&|;]*/g) ?? [];
  return (
    runs.length > 0 &&
    runs.every(run => {
      const flags = run.match(/--incremental(?:\s+(?:true|false)\b)?/g) ?? [];
      return flags.at(-1)?.replace(/\s+/g, " ") === "--incremental false";
    })
  );
}

function resolvedTasks() {
  // The `check-types` tasks ONLY, rather than everything the run contains.
  //
  // `check-types` depends on `^build`, so the graph carries a `build` task for
  // every dependency as well, and each assertion below is about how a package's
  // TYPE-CHECK is hashed and what it depends on. Unfiltered, they read a
  // `build` task's definition and report it under a check-types message — which
  // is how a correct `build` (`dependsOn: ["^build"]`, and no command at all in
  // a package that ships no build) arrives as a package that "has no runnable
  // check-types command".
  return dryRun().tasks.filter(entry => entry.task === "check-types");
}

/** The TypeScript modules git tracks inside a package. */
function trackedTypeScript(directory) {
  const raw = execFileSync("git", ["ls-files", "--", directory], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return raw
    .split("\n")
    .filter(line => TYPESCRIPT_EXTENSIONS.test(line))
    .map(line => line.slice(`${directory}/`.length));
}

describe("turbo hashes every TypeScript module it type-checks", () => {
  const tasks = resolvedTasks();

  // The population, before any verdict, and asserted by MEMBERSHIP rather than
  // by a count. "No package has an unhashed module" is satisfied perfectly by a
  // run that read nothing — a failed dry run, a renamed task, a listing that
  // resolved to the wrong directory. Naming packages that must be present, and
  // a tree whose size is known, means silence has to be earned.
  //
  // `e2e` is named because it is the package this guard exists for: 30 modules
  // under `tests/`, none of which the previous input globs reached.
  it("reads a populated set of packages and their TypeScript", () => {
    expect(tasks.length).toBeGreaterThan(15);
    const names = tasks.map(task => task.package);
    expect(names).toContain("@nextlyhq/e2e");
    expect(names).toContain("@nextlyhq/builder");

    const e2e = tasks.find(task => task.package === "@nextlyhq/e2e");
    const underTests = trackedTypeScript(e2e.directory).filter(file =>
      file.startsWith("tests/")
    );

    // MEMBERSHIP, not a count. A threshold here is a snapshot of how many specs
    // happened to exist when it was written, so it goes stale on any unrelated
    // change to the suite: retiring the canvas suite alongside the canvas it
    // drove removed ten modules and turned this red, with nothing wrong. A
    // number cannot tell a legitimate deletion from a broken listing, and
    // re-tuning it each time teaches the next reader to re-tune rather than
    // look.
    //
    // Naming modules that must be present answers what the threshold was really
    // reaching for -- that the listing resolved to the right directory and read
    // something real -- and it fails only when one of these actually goes.
    expect(underTests).toContain("tests/admin-smoke.spec.ts");
    expect(underTests).toContain("tests/permissions-matrix.spec.ts");
    // A third name, in a third AREA. Two files in ONE directory survive a size
    // change but not that directory being retired -- which is exactly what
    // happened here. Spanning three areas means no single retirement can empty
    // the list.
    expect(underTests).toContain("tests/support/admin.ts");
    // A floor as well, low enough to survive ordinary churn: it catches a
    // listing that collapsed to just the named files without pretending to
    // measure coverage.
    expect(underTests.length).toBeGreaterThan(10);
  });

  it.each(tasks.map(task => [task.package, task]))(
    "%s hashes all of its TypeScript",
    (_name, task) => {
      const hashed = new Set(Object.keys(task.inputs));
      const tracked = trackedTypeScript(task.directory);

      // A package may legitimately ship no TypeScript at all — `tsconfig`,
      // `eslint-config`, `prettier-config` and `admin-css` are configuration
      // and CSS, and all four still declare `check-types`. So emptiness is a
      // valid answer HERE, and the population is asserted once above instead,
      // where an empty read cannot be mistaken for a clean one.
      // A task appears in the dry run whether or not the package defines the
      // script: turbo marks the missing case `<NONEXISTENT>` and skips it,
      // while a filtered run exits 0 with `Tasks: 0 successful, 0 total`. So
      // membership in this list is not evidence that anything is checked, and
      // deleting a package's `check-types` script would otherwise leave every
      // assertion here green while its gate quietly stopped existing.
      //
      // Only required of packages that SHIP TypeScript. `tsconfig`,
      // `eslint-config`, `prettier-config` and `admin-css` are configuration
      // and CSS, and are legitimately `<NONEXISTENT>`.
      if (tracked.length > 0) {
        expect(
          String(task.command),
          `${task.package} ships TypeScript but has no runnable check-types command, so nothing type-checks it`
        ).not.toContain("NONEXISTENT");
      }

      const unhashed = tracked.filter(file => !hashed.has(file));
      // Worded as SHIPS rather than type-checks, because that is what this
      // measures. Whether a given module is inside the package's `tsc` program
      // is a separate question this cannot see, and claiming it would overstate
      // the finding for a file the compiler never reads. Hashing a module the
      // program excludes costs a cache miss; failing to hash one it includes
      // costs a replayed green, so the coverage is deliberately the wider set.
      expect(
        unhashed,
        `${task.package} ships ${String(unhashed.length)} TypeScript module(s) that turbo does not hash, so editing one leaves the cache valid and CI replays the previous result:\n  ${unhashed.slice(0, 10).join("\n  ")}`
      ).toEqual([]);
    }
  );
});

/** Every path git tracks, so a generated file is never mistaken for a source input. */
function trackedPaths() {
  // `cwd` pinned to the repository root, as everywhere else here: `git ls-files`
  // prints paths relative to the working directory, so running this suite from
  // `scripts/` would yield a set that shares no member with the
  // repository-relative paths the compiler reports — and every program file
  // would then read as untracked and be skipped as generated output. The guard
  // would pass by checking nothing.
  return new Set(
    execFileSync("git", ["ls-files"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    }).split("\n")
  );
}

/**
 * Every tsconfig a package's `check-types` command actually compiles.
 *
 * Five packages here run TWO passes — `tsc --noEmit && tsc --noEmit -p
 * tsconfig.tests.json` — because their shipping config excludes the test files.
 * Probing only the implicit `tsconfig.json` leaves whatever is unique to the
 * second program invisible, so an unhashed input reachable only from a test
 * would pass this guard: the same too-narrow-population defect the guard exists
 * to catch, one level up.
 *
 * Derived from the command rather than from a list of packages, so a package
 * that gains or loses a pass is covered without anyone editing this.
 */
function projectConfigs(command) {
  const configs = [];
  for (const invocation of String(command).split("&&")) {
    if (!/\btsc\b/.test(invocation)) continue;
    const explicit = /(?:-p|--project)\s+(\S+)/.exec(invocation);
    configs.push(explicit ? explicit[1] : "tsconfig.json");
  }
  return configs;
}

/**
 * A task's command with each `pnpm <script>` or `pnpm run <script>` step
 * replaced by the package script it runs, so a build that delegates
 * (`pnpm build:js && …`) is read for what it executes. A name the package
 * has no script for, such as `pnpm exec`, is left as written.
 */
function expandedCommand(scripts, command, depth = 0) {
  return String(command).replace(/\bpnpm\s+(?:run\s+)?([\w:-]+)/g, (step, name) =>
    depth < 5 && Object.hasOwn(scripts, name)
      ? expandedCommand(scripts, scripts[name], depth + 1)
      : step
  );
}

/** The config file each `tsdown` step in a command builds with. */
function tsdownConfigs(command) {
  const configs = [];
  for (const invocation of String(command).split("&&")) {
    if (!/\btsdown\b/.test(invocation)) continue;
    const explicit = /(?:-c|--config)[\s=](\S+)/.exec(invocation);
    configs.push(explicit ? explicit[1] : "tsdown.config.ts");
  }
  return configs;
}

/**
 * Prints, for one tsdown config file, each build's entries and the tsconfig it
 * compiles declarations with. The file is loaded as tsdown loads it, through
 * tsx, so an entry list computed in the config is read as computed. A config
 * exported as a function is refused rather than guessed at.
 */
const ENTRY_READER = `
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
const loaded = (await import(pathToFileURL(resolve(process.argv[1])).href)).default;
if (typeof loaded === "function") throw new Error("a tsdown config exported as a function cannot be read");
const entries = entry =>
  typeof entry === "string" ? [entry] : Array.isArray(entry) ? entry : Object.values(entry ?? {});
console.log(JSON.stringify([loaded].flat().map(build => ({
  entries: entries(build.entry),
  tsconfig: typeof build.tsconfig === "string" ? build.tsconfig : "tsconfig.json",
}))));
`;

function tsdownBuilds(directory, config) {
  const output = execFileSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", ENTRY_READER, config],
    { cwd: join(REPO_ROOT, directory), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  return JSON.parse(output.trim().split("\n").at(-1));
}

/**
 * The files a tsdown build reads: its entries and everything they import.
 *
 * Not the whole tsconfig, which is what made a build's hash follow its tests
 * while it was tsup: rolldown bundles from the entries, and rolldown-plugin-dts
 * roots its declaration program at them too. So the program is the compiler's
 * own answer for a tsconfig that extends the build's and names only the
 * entries, written beside it for the probe and removed afterwards.
 */
function tsdownProgram(directory, configs) {
  return configs
    .flatMap(config => tsdownBuilds(directory, config))
    .flatMap(({ entries, tsconfig }) => {
      const files = entries.flatMap(entry =>
        entry.includes("*") ? globSync(entry, { cwd: join(REPO_ROOT, directory) }) : [entry]
      );
      const probe = `tsconfig.turbo-inputs-${process.pid}-${Math.random().toString(36).slice(2)}.json`;
      const path = join(REPO_ROOT, directory, probe);
      writeFileSync(
        path,
        JSON.stringify({ extends: `./${tsconfig}`, include: [], files: files.map(file => `./${file}`) }),
        { flag: "wx" }
      );
      try {
        return programFiles(directory, probe);
      } finally {
        rmSync(path, { force: true });
      }
    });
}

/**
 * Every file a task's compiler reads: each tsconfig its `tsc` steps compile,
 * and each tsdown build's entry graph. A command running neither, such as
 * `next build`, is taken to read the package's whole tsconfig.
 */
function taskProgram(task) {
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, task.directory, "package.json"), "utf8"));
  const command = expandedCommand(manifest.scripts ?? {}, task.command);
  const projects = projectConfigs(command);
  const builds = tsdownConfigs(command);
  const files = [
    ...projects.flatMap(config => programFiles(task.directory, config)),
    ...tsdownProgram(task.directory, builds),
  ];
  if (projects.length === 0 && builds.length === 0) {
    files.push(...programFiles(task.directory, "tsconfig.json"));
  }
  return [...new Set(files)];
}

/**
 * The files a package's compiler actually READS, repo-relative.
 *
 * `--listFilesOnly` resolves the program without type-checking it, so this is
 * the compiler's own answer rather than a second reading of `tsconfig`. A
 * failing invocation still prints the list it built, so its output is used
 * either way: the question here is which files were reached, not whether they
 * compiled.
 */
function programFiles(directory, config) {
  let output = "";
  try {
    output = execFileSync(
      "pnpm",
      ["exec", "tsc", "--noEmit", "--listFilesOnly", "-p", config],
      {
        cwd: join(REPO_ROOT, directory),
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
      }
    );
  } catch (error) {
    output = typeof error.stdout === "string" ? error.stdout : "";
  }
  return output
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .map(file => relative(REPO_ROOT, file))
    .filter(file => !file.startsWith("..") && !file.includes("node_modules"));
}

describe("every tracked file a compiler reads is covered by some hash", () => {
  // The package-scoped check above found its gap along one axis, `^check-types`
  // closed a second, and a root script sat outside both. Three axes, three
  // fixes, each invisible until someone happened to look — which is the shape
  // that says the INSTRUMENT is wrong rather than that the fixes were.
  //
  // So the population here is not "files under the package directory" but the
  // program the compiler resolves, which is the thing the property is actually
  // about. A future axis nobody has thought of fails this without anyone having
  // to predict it.
  const dry = dryRun();
  const globalFiles = new Set(Object.keys(dry.globalCacheInputs.files));
  const byPackage = new Map(dry.tasks.map(task => [task.package, task]));
  // Every runnable task in the run, `build` included — not just `check-types`.
  //
  // Unlike `resolvedTasks`, this block asks what a task's compiler READS and
  // whether the hash covers it, which is as true of a build as of a typecheck:
  // inputs that miss a source file leave the cache valid across an edit to it
  // either way. `check-types` depends on `^build`, so the build tasks arrive
  // here through that edge rather than by being asked for, and stating it is
  // what stops them disappearing unremarked if the edge ever moves.
  const runnable = dry.tasks.filter(
    task => !String(task.command).includes("NONEXISTENT")
  );
  const tracked = trackedPaths();

  it("reads a populated task list", () => {
    expect(runnable.length).toBeGreaterThan(15);
    expect(runnable.map(task => task.package)).toContain("playground");
  });

  it.each(runnable.map(task => [task.package, task]))(
    "%s: every tracked file its compiler reads moves its hash",
    (_name, task) => {
      const own = new Set(Object.keys(task.inputs));
      // A dependency's files are covered transitively: `^check-types` folds its
      // hash in, and that hash is computed from those files.
      const dependencyDirs = (task.dependencies ?? [])
        .map(id => byPackage.get(id.split("#")[0])?.directory)
        .filter(Boolean);

      // The UNION over every config the package's command compiles, not just
      // the implicit one, and over every tsdown build it runs.
      const program = taskProgram(task);
      // Guards the guard: a compiler that produced no list would satisfy the
      // assertion below by having read nothing.
      expect(
        program.length,
        `no program resolved for ${task.package} from ${String(task.command)} — the invocation, not the package, is probably wrong`
      ).toBeGreaterThan(0);

      const uncovered = program.filter(file => {
        // Generated output is not a source input: its content is derived from
        // files that ARE tracked, and those are what a hash must follow.
        if (!tracked.has(file)) return false;
        if (globalFiles.has(file)) return false;
        if (
          file.startsWith(`${task.directory}/`) &&
          own.has(file.slice(task.directory.length + 1))
        ) {
          return false;
        }
        return !dependencyDirs.some(dir => file.startsWith(`${dir}/`));
      });

      expect(
        uncovered,
        `${task.package} compiles ${String(uncovered.length)} tracked file(s) that no hash covers, so editing one leaves its cache valid:\n  ${uncovered.slice(0, 10).join("\n  ")}`
      ).toEqual([]);
    },
    PROBE_TIMEOUT_MS
  );
});

/**
 * The directories a package's Tailwind stylesheets scan for class names,
 * repository-relative. Each `@source "<dir>"` names one, relative to the sheet;
 * `@import "tailwindcss"` adds automatic detection, which starts where the
 * build runs the CLI, the package root. `@source not` and `@source inline(…)`
 * name no directory.
 */
function tailwindScans(directory, tracked) {
  const sheets = [...tracked].filter(
    file => file.startsWith(`${directory}/src/`) && file.endsWith(".css")
  );
  const scans = new Set();
  for (const sheet of sheets) {
    const text = readFileSync(join(REPO_ROOT, sheet), "utf8");
    if (/@import\s+["']tailwindcss["']/.test(text)) scans.add(directory);
    for (const [, dir] of text.matchAll(/@source\s+["']([^"']+)["']/g)) {
      scans.add(relative(REPO_ROOT, resolve(REPO_ROOT, dirname(sheet), dir)));
    }
  }
  return [...scans];
}

describe("every file a Tailwind build scans is in some build hash", () => {
  // Tailwind reads class names out of every file under the directories it
  // scans, tests and Markdown included, so a build that compiles it must hash
  // all of them, or an edit to a class used only there replays a stale sheet.
  // This is the input the TypeScript-program check above cannot see: the
  // build reads these files through the Tailwind CLI, not through a compiler.
  const tracked = trackedPaths();
  const plan = parseTurboPlan(
    execFileSync("pnpm", ["exec", "turbo", "run", "build", "--dry=json"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    }),
    "turbo run build --dry=json"
  );
  const builds = plan.tasks.filter(task => task.task === "build");
  /** Each build's inputs, as repository paths. */
  const hashedBy = new Map(
    builds.map(task => [
      task.package,
      new Set(Object.keys(task.inputs).map(file => join(task.directory, file))),
    ])
  );
  const withSheets = builds
    .map(task => [task, tailwindScans(task.directory, tracked)])
    .filter(([, scans]) => scans.length > 0);

  it("finds the packages that compile Tailwind", () => {
    // The control: a reader that found no sheet would assert nothing.
    expect(withSheets.map(([task]) => task.package).sort()).toEqual(
      expect.arrayContaining(["@nextlyhq/admin", "@nextlyhq/builder", "@nextlyhq/ui"])
    );
  });

  it.each(withSheets.map(([task, scans]) => [task.package, task, scans]))(
    "%s: hashes every tracked file its stylesheets scan",
    (_name, task, scans) => {
      // A file in another package's directory counts as covered when that
      // package's build hashes it and this build depends on that build, the
      // edge through which its hash moves this one.
      const dependencyBuilds = (task.dependencies ?? [])
        .filter(id => id.endsWith("#build"))
        .map(id => hashedBy.get(id.split("#")[0]))
        .filter(Boolean);
      const own = hashedBy.get(task.package);
      const scanned = [...tracked].filter(
        file =>
          !file.endsWith(".css") &&
          scans.some(dir => file.startsWith(`${dir}/`))
      );
      expect(scanned.length, `no tracked file under ${scans.join(", ")}`).toBeGreaterThan(0);
      const unhashed = scanned.filter(
        file => !own.has(file) && !dependencyBuilds.some(inputs => inputs.has(file))
      );
      expect(
        unhashed,
        `${task.package} compiles Tailwind over ${String(unhashed.length)} file(s) no build hash covers, so editing a class in one replays a stale stylesheet:\n  ${unhashed.slice(0, 10).join("\n  ")}`
      ).toEqual([]);
    },
    PROBE_TIMEOUT_MS
  );
});

describe("what a build's compiler reads", () => {
  it("follows a delegated script to the steps it runs", () => {
    const scripts = { "build:js": "tsdown && tsdown --config tsdown.server-safe.config.ts" };
    const command = expandedCommand(scripts, "pnpm build:js && node scripts/build-css.mjs");
    expect(command).toBe(
      "tsdown && tsdown --config tsdown.server-safe.config.ts && node scripts/build-css.mjs"
    );
    expect(tsdownConfigs(command)).toEqual(["tsdown.config.ts", "tsdown.server-safe.config.ts"]);
    // `pnpm exec` names no script, and a tsc step is no tsdown build.
    expect(expandedCommand(scripts, "pnpm exec tsc --noEmit")).toBe("pnpm exec tsc --noEmit");
    expect(tsdownConfigs("tsc --noEmit -p tsconfig.tests.json")).toEqual([]);
  });

  it(
    "reads a tsdown build from its entries, not from its whole tsconfig",
    () => {
      // The control for the narrowing: builder's tsconfig compiles its tests,
      // and the build's own program reaches none of them but does reach its entry.
      const directory = "packages/builder";
      const isTest = file => /(?:\.test\.tsx?|\/__tests__\/)/.test(file);
      expect(programFiles(directory, "tsconfig.json").some(isTest)).toBe(true);
      const build = tsdownProgram(directory, ["tsdown.config.ts"]);
      expect(build).toContain(`${directory}/src/shell.ts`);
      expect(build.filter(isTest)).toEqual([]);
    },
    PROBE_TIMEOUT_MS
  );
});

describe("a package's hash covers the program it actually compiles", () => {
  // The package-scoped assertion above cannot see this axis. A tsconfig `paths`
  // entry pointing at a sibling's SOURCE puts that sibling's files in this
  // package's program, and no per-package input glob reaches them — measured:
  // `packages/admin` compiles `packages/nextly/src/schemas/_zod/rbac.ts`, and
  // before this edge existed, editing it left admin's hash unmoved.
  //
  // Asserted as the EDGE rather than by re-deriving each program, because the
  // edge is what makes the property hold for every pair, including ones no
  // `paths` entry has created yet.
  it("folds each dependency's hash in via ^check-types", () => {
    const withCommand = resolvedTasks().filter(
      task => !String(task.command).includes("NONEXISTENT")
    );
    expect(withCommand.length).toBeGreaterThan(15);
    for (const task of withCommand) {
      expect(
        task.resolvedTaskDefinition.dependsOn,
        `${task.package} does not depend on its dependencies' check-types, so a change in one cannot move its hash`
      ).toContain("^check-types");
    }
  });

  // Each edge gets its own case, because they answer different questions and a
  // single assertion over the array would report the wrong one as missing.
  it("reads each dependency's BUILD, not only its hash", () => {
    // Five packages map a neighbour at its source; every other one resolves
    // `@nextlyhq/*` through package exports, which point at `dist`. Without
    // this edge such a package typechecks against whatever artifact survived,
    // and a stale one answers about code that is gone — silently, in the
    // passing direction.
    const withCommand = resolvedTasks().filter(
      task => !String(task.command).includes("NONEXISTENT")
    );
    expect(withCommand.length).toBeGreaterThan(15);
    for (const task of withCommand) {
      expect(
        task.resolvedTaskDefinition.dependsOn,
        `${task.package} typechecks without building its dependencies, so a stale dist answers for them`
      ).toContain("^build");
    }
  });

  it("orders its OWN build before it, so one build-info file has one writer", () => {
    // `${configDir}/.tsbuildinfo` is one file per package and both tasks write
    // it. The `^build` edge above puts both in a single run, so without this
    // they are unordered siblings free to write and restore it at once.
    // Asserted as the un-prefixed `build`: `^build` is a different edge and
    // satisfies neither this nor the case above.
    //
    // A task whose every `tsc` runs with `--incremental false` writes no
    // build-info file, so it has nothing to race its build over and need not
    // wait for it. That is how the playground type-checks without its
    // production build (`next build`); the exempt set is pinned so the
    // exemption cannot spread unnoticed.
    const withCommand = resolvedTasks().filter(
      task => !String(task.command).includes("NONEXISTENT")
    );
    const exempt = withCommand.filter(task => writesNoBuildInfo(String(task.command)));
    expect(exempt.map(task => task.package)).toEqual(["playground"]);
    // And the exemption is used: an exempt task that still waited for its own
    // build would keep that build (for the playground, `next build`) in every
    // type-check's graph.
    for (const task of exempt) {
      expect(task.resolvedTaskDefinition.dependsOn, `${task.package} writes no build-info yet still waits for its own build`).not.toContain("build");
    }
    for (const task of withCommand.filter(candidate => !exempt.includes(candidate))) {
      expect(
        task.resolvedTaskDefinition.dependsOn,
        `${task.package} may typecheck while its own build writes the same .tsbuildinfo`
      ).toContain("build");
    }
  });

  it("counts a type-check as writing no build-info only when every tsc in it says so", () => {
    expect(writesNoBuildInfo("next typegen && tsc --noEmit --incremental false")).toBe(true);
    expect(writesNoBuildInfo("tsc --noEmit")).toBe(false);
    expect(writesNoBuildInfo("tsc --noEmit --incremental false && tsc --noEmit -p tsconfig.tests.json")).toBe(false);
    expect(writesNoBuildInfo("next typegen")).toBe(false);
    expect(writesNoBuildInfo("tsc --noEmit --incremental false --incremental")).toBe(false);
    expect(writesNoBuildInfo("tsc --noEmit --incremental false --incremental true")).toBe(false);
    expect(writesNoBuildInfo("tsc --incremental --noEmit --incremental false")).toBe(true);
  });
});

describe("the runner's platform is hashed", () => {
  // The shared remote cache serves Linux, macOS and Windows jobs. A task
  // hashed without the platform would let a Linux output skip the Windows
  // job that exists to catch what differs there.
  it("gives the same task a different hash on another operating system or architecture", () => {
    const hashOf = (os, arch) => {
      const plan = dryRun({ ...process.env, RUNNER_OS: os, RUNNER_ARCH: arch });
      return plan.tasks.find(task => task.taskId === "nextly#check-types")?.hash;
    };
    const linux = hashOf("Linux", "X64");
    expect(linux).toBeTruthy();
    expect(hashOf("Windows", "X64")).not.toBe(linux);
    expect(hashOf("Linux", "ARM64")).not.toBe(linux);
    expect(hashOf("Linux", "X64")).toBe(linux);
  });
});

describe("the shared TypeScript config is hashed", () => {
  // 22 packages extend `@nextlyhq/tsconfig`'s `base.json`, which decides
  // `strict`, `target` and `lib`. The `^check-types` edge gives most of them a
  // graph edge to it, so this is no longer the only cover — it is asserted
  // because that edge is a property of the task graph rather than of the
  // configs, and reaches neither a task without one nor a consumer that reads
  // these files by relative path. Without the global entry, changing a compiler
  // setting can leave hashes unmoved across the whole repository at once.
  it("counts packages/tsconfig among the global dependencies", () => {
    const globalFiles = Object.keys(dryRun().globalCacheInputs.files);
    expect(globalFiles).toContain("packages/tsconfig/base.json");
  });
});

describe("a root script in the global inputs brings its imports with it", () => {
  // The global inputs name root scripts one by one, because packages read only
  // a few of the ~200. A listed script that imports another root script makes
  // that one an input as well: `create-nextly-app`'s build loads
  // `agent-skills.mjs`, which imports `agent-instructions.mjs`, so an edit to
  // the latter changes the build while, unlisted, it leaves the hash unmoved.
  // Every string literal in the script that names an existing file beside it
  // counts, not only `import`/`require` specifiers: `dev-doctor.mjs` loads
  // `cli-entry.mjs` through `import(pathToFileURL(path.join(HERE,
  // "cli-entry.mjs")).href)`, a path built at run time that no specifier
  // pattern sees. Read from the parsed source, so a file named in a comment
  // is no edge, and erring only toward listing a file that is merely named.
  // Running the scripts to record what they load is no option: they act on
  // the machine when run.
  const EXTENSIONS = ["", ".mjs", ".js", ".ts", ".cjs"];

  function namedFile(from, text) {
    const base = normalize(join(dirname(from), text));
    return EXTENSIONS.map(ext => base + ext).find(candidate => {
      const path = join(REPO_ROOT, candidate);
      return existsSync(path) && statSync(path).isFile();
    });
  }

  /**
   * The text of every string literal in the file, from its syntax tree: quoted strings and
   * templates with no substitutions, which are as statically known.
   */
  function stringLiterals(file) {
    const texts = [];
    walk(parseSource(readFileSync(join(REPO_ROOT, file), "utf8"), file).program, node => {
      const text = literalText(node);
      if (text !== null) texts.push(text);
    });
    return texts;
  }

  function rootScriptImports(file) {
    const targets = stringLiterals(file).map(text => namedFile(file, text));
    return [...new Set(targets.filter(target => target?.startsWith("scripts/") && target !== file))];
  }

  it("follows a script loaded through a path built at run time, and ignores one named in a comment", () => {
    // `dev-doctor.mjs` builds the path to `cli-entry.mjs`, and
    // `pnpm-invocation.mjs` names `verify-merge.mjs` only in its comments.
    expect(rootScriptImports("scripts/dev-doctor.mjs")).toContain("scripts/cli-entry.mjs");
    expect(rootScriptImports("scripts/pnpm-invocation.mjs")).not.toContain("scripts/verify-merge.mjs");
  });

  it("lists every root script a listed one imports", () => {
    const globalFiles = new Set(Object.keys(dryRun().globalCacheInputs.files));
    const listed = [...globalFiles].filter(file => file.startsWith("scripts/"));
    // Guards the guard: with no root script listed there is nothing to follow.
    expect(listed.length).toBeGreaterThan(0);
    const missing = listed.flatMap(file =>
      rootScriptImports(file)
        .filter(target => !globalFiles.has(target))
        .map(target => `${file} imports ${target}`)
    );
    expect(missing).toEqual([]);
  });
});
