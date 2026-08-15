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
import { describe, expect, it } from "vitest";

/** Extensions the TypeScript compiler follows, so a change to one can break a build. */
const TYPESCRIPT_EXTENSIONS = /\.(?:ts|tsx|mts|cts)$/;

/**
 * Turbo's own view of what it hashes, rather than a second reading of the
 * config. `--dry=json` resolves every glob against the working tree, so the
 * answer accounts for `$TURBO_DEFAULT$`, negations and per-package overrides
 * that a pattern-by-pattern re-implementation here would have to model.
 */
function resolvedTasks() {
  const raw = execFileSync(
    "pnpm",
    ["exec", "turbo", "run", "check-types", "--dry=json"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );
  // Turbo prints its own preamble before the document on some terminals, so the
  // parse starts at the first brace rather than at byte zero.
  return JSON.parse(raw.slice(raw.indexOf("{"))).tasks;
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

describe("the shared TypeScript config is hashed", () => {
  // `check-types` declares `dependsOn: []`, so no package has a graph edge to
  // `@nextlyhq/tsconfig` — yet 22 of them extend its `base.json`, which decides
  // `strict`, `target` and `lib`. Without a global entry, changing a compiler
  // setting leaves every hash in the repository unmoved at once, which is the
  // same defect as above with the blast radius of the whole monorepo.
  it("counts packages/tsconfig among the global dependencies", () => {
    const raw = execFileSync(
      "pnpm",
      ["exec", "turbo", "run", "check-types", "--dry=json"],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
    );
    const globalFiles = Object.keys(
      JSON.parse(raw.slice(raw.indexOf("{"))).globalCacheInputs.files
    );
    expect(globalFiles).toContain("packages/tsconfig/base.json");
  });
});
