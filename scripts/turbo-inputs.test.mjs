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
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
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
function dryRun() {
  const raw = execFileSync(
    "pnpm",
    ["exec", "turbo", "run", "check-types", "--dry=json"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );
  // Turbo's document is pretty-printed from column zero, while the tools around
  // it are not silent: pnpm emits config warnings and turbo a version banner,
  // and which stream each uses varies between a terminal and a runner. So the
  // document is located by the first line that OPENS it, rather than by the
  // first `{` anywhere — a brace inside a warning would otherwise start the
  // parse mid-sentence and fail on the character after it.
  const lines = raw.split("\n");
  const start = lines.findIndex(line => line.startsWith("{"));
  if (start === -1) {
    throw new Error(
      `turbo --dry=json produced no JSON document. First 400 chars:\n${raw.slice(0, 400)}`
    );
  }
  const document = lines.slice(start).join("\n");
  try {
    return JSON.parse(document);
  } catch (cause) {
    // Naming what was actually received, because the parser's own message
    // ("Expected property name at position 1") describes the text and not
    // where it came from, which leaves the next reader with nothing to act on.
    throw new Error(
      `turbo --dry=json did not parse. First 400 chars of the document:\n${document.slice(0, 400)}`,
      { cause }
    );
  }
}

function resolvedTasks() {
  return dryRun().tasks;
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
    expect(underTests.length).toBeGreaterThan(25);
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
  return new Set(
    execFileSync("git", ["ls-files"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    }).split("\n")
  );
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
function programFiles(directory) {
  let output = "";
  try {
    output = execFileSync("pnpm", ["exec", "tsc", "--noEmit", "--listFilesOnly"], {
      cwd: join(REPO_ROOT, directory),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
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

      const program = programFiles(task.directory);
      // Guards the guard: a compiler that produced no list would satisfy the
      // assertion below by having read nothing.
      expect(
        program.length,
        `no program resolved for ${task.package} — the tsc invocation, not the package, is probably wrong`
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
    }
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
});

describe("the shared TypeScript config is hashed", () => {
  // `check-types` declares `dependsOn: []`, so no package has a graph edge to
  // `@nextlyhq/tsconfig` — yet 22 of them extend its `base.json`, which decides
  // `strict`, `target` and `lib`. Without a global entry, changing a compiler
  // setting leaves every hash in the repository unmoved at once, which is the
  // same defect as above with the blast radius of the whole monorepo.
  it("counts packages/tsconfig among the global dependencies", () => {
    const globalFiles = Object.keys(dryRun().globalCacheInputs.files);
    expect(globalFiles).toContain("packages/tsconfig/base.json");
  });
});
