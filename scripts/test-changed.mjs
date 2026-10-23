#!/usr/bin/env node
/**
 * The pre-push's unit tests for the packages a push touches, narrowed to the
 * test FILES the change can affect.
 *
 * `gate-scope.mjs` already narrows to the touched packages. Inside each one,
 * Vitest 5's `--changed` picks the test files that loaded a changed file on
 * their last run, from the records `experimental.recordDependencies` keeps in
 * the package's Vite cache. Those records are exact for what a test imports,
 * and blind to three things, which decide everything below:
 *
 * - a file a test reads with `fs`, or a process it spawns, is not a record:
 *   those tests (the GUARDS) always run;
 * - a workspace dependency arrives through its built `dist`, which no diff
 *   names: a package whose workspace dependency also changed runs in full;
 * - a change to what every test compiles against (the lockfile, a tsconfig, the
 *   shared tsconfig package) touches no recorded module: the package runs in
 *   full. Vitest already reruns everything for its own config, setup files,
 *   `.env` and `package.json`.
 *
 * Anything this cannot decide runs the package in full, never nothing: a test
 * file without a record always runs, a failed selection falls back to the whole
 * suite, and an empty selection is reported, not assumed.
 *
 * Usage (from the pre-push, after the build):
 *   node scripts/test-changed.mjs [base] [--max-workers=N]   # base defaults to origin/main
 *
 * @module scripts/test-changed
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  changedPaths,
  deletedPaths,
  filtersFor,
  pnpmWorkspaces,
  workspacesFrom,
} from "./gate-scope.mjs";
import { isCliEntry } from "./cli-entry.mjs";
import { pnpmInvocation } from "./pnpm-invocation.mjs";

/**
 * Inputs every test of a package compiles or resolves against, at the root.
 * The lockfile and the workspace file also make `gate-scope` widen to every
 * workspace; they are listed so this module's answer does not depend on that.
 */
const ROOT_GLOBAL_INPUTS = [
  /^pnpm-lock\.yaml$/,
  /^pnpm-workspace\.yaml$/,
  /^tsconfig[^/]*\.json$/,
  /^packages\/tsconfig\//,
  /^\.nvmrc$/,
];

/** The same, inside a package: its tsconfigs. Vitest covers its config, setup files and manifest itself. */
const PACKAGE_GLOBAL_INPUTS = [/^tsconfig[^/]*\.json$/];

/**
 * Whether a test file's source reaches outside the module graph: it imports
 * `fs`, `fs-extra` or `child_process` (or `execa`), so what it reads or runs is
 * not in its record. Over-inclusive on purpose, for a test that only writes a
 * temporary file: running a guard that did not need it costs seconds, and
 * skipping one that did lets a change through untested.
 */
export function readsOutsideTheGraph(source) {
  return /from\s*["'](?:node:)?(?:fs|fs\/promises|child_process)["']|from\s*["'](?:fs-extra|execa)["']|require\(\s*["'](?:node:)?(?:fs|child_process)["']\s*\)|import\(\s*["'](?:node:)?(?:fs|fs\/promises|child_process)["']\s*\)/.test(
    source
  );
}

/**
 * Whether a change reaches the root `scripts/` tests: a script itself, the
 * turbo config, or any Vitest config. `turbo run test` never runs those tests,
 * and they are what hold the task graph, the hooks and the configs to what
 * these gates assume.
 */
export function scriptTestsNeeded(paths) {
  return paths.some(
    path =>
      path.startsWith("scripts/") ||
      /^turbo\.jsonc?$/.test(path) ||
      /(^|\/)vitest[^/]*\.config\.[cm]?[jt]s$/.test(path)
  );
}

/** Whether a repository path is a unit test file, as the packages' Vitest configs name them. */
export function isUnitTestFile(path) {
  return /\.test\.(?:[cm]?[jt]sx?)$/.test(path) && !/\.integration\.test\./.test(path);
}

/**
 * Why a package must run in full, or null when its tests can be selected.
 *
 * `changed` are repository paths; `dir` is the package's directory; `changedPackages`
 * the names of every workspace this push touches; `manifest` the package's own.
 */
export function fullRunReason({ dir, manifest, changed, changedPackages }) {
  const root = changed.find(path => ROOT_GLOBAL_INPUTS.some(input => input.test(path)));
  if (root) return `${root} changed, which every test compiles or resolves against`;
  const prefix = `${dir}/`;
  const own = changed
    .filter(path => path.startsWith(prefix))
    .map(path => path.slice(prefix.length))
    .find(path => PACKAGE_GLOBAL_INPUTS.some(input => input.test(path)));
  if (own) return `${dir}/${own} changed, which every test compiles against`;
  const dependency = workspaceDependencies(manifest).find(
    name => name !== manifest?.name && changedPackages.includes(name)
  );
  if (dependency) {
    return `${dependency} changed too, and its tests reach it through its built output, which no record names`;
  }
  return null;
}

/** The workspace packages a manifest declares, in any dependency field. */
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

function workspaceDependencies(manifest) {
  const entries = DEPENDENCY_FIELDS.flatMap(field =>
    Object.entries(manifest?.[field] ?? {})
  );
  return [
    ...new Set(
      entries
        .filter(([, spec]) => String(spec).startsWith("workspace:"))
        .map(([name]) => name)
    ),
  ];
}

/**
 * The test files one selected run covers: the ones `--changed` picked, then the
 * guards, each once and in a stable order. Paths are relative to the package.
 */
export function selectedFiles(changedSelection, guards) {
  return [...new Set([...changedSelection, ...guards])].sort();
}

/**
 * The files `vitest list --changed` printed, relative to the package, or null
 * when the output cannot be read as that list. Null is a reason to run in full.
 */
export function listedFiles(stdout, packageDir) {
  const parsed = parsedJson(stdout);
  if (!Array.isArray(parsed)) return null;
  const files = parsed.map(entryFile);
  if (files.some(file => file === null)) return null;
  const prefix = `${packageDir.replace(/\/$/, "")}/`;
  return files.map(file => (file.startsWith(prefix) ? file.slice(prefix.length) : file));
}

/** JSON text as a value, or undefined when it is not JSON. */
function parsedJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The path one listed entry names: the string itself, or its `file`; null for anything else. */
function entryFile(entry) {
  const file = typeof entry === "string" ? entry : entry?.file;
  return typeof file === "string" ? file : null;
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function run(args, cwd) {
  const { command, args: argv, shell } = pnpmInvocation(args);
  return spawnSync(command, argv, { cwd, stdio: "inherit", shell }).status ?? 1;
}

/** The guard test files in a package: tracked unit tests whose source reaches outside the module graph. */
function guardsIn(root, dir) {
  const tracked = git(root, ["ls-files", "-z", "--", dir]).split("\0").filter(Boolean);
  return tracked
    .filter(isUnitTestFile)
    .filter(path => readsOutsideTheGraph(readFileSync(join(root, path), "utf8")))
    .map(path => path.slice(dir.length + 1));
}

/** The files `--changed` selects in a package, or null when it could not say. */
function changedSelection(root, dir, mergeBase) {
  const { command, args, shell } = pnpmInvocation([
    "exec",
    "vitest",
    "list",
    "--changed",
    mergeBase,
    "--filesOnly",
    "--json",
  ]);
  const listing = spawnSync(command, args, {
    cwd: join(root, dir),
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 32,
    shell,
  });
  if (listing.status !== 0) return null;
  return listedFiles(listing.stdout, join(root, dir));
}

/**
 * The pnpm arguments that run one package's `test` script on `files` (all of
 * them when empty). No `--` after the script name: pnpm would hand it to
 * Vitest, which then ignores every file and flag after it and runs the whole
 * suite with no worker limit.
 */
export function testArgs(name, files, workers) {
  return [
    "--filter",
    name,
    "run",
    "test",
    ...files,
    `--maxWorkers=${workers}`,
    "--passWithNoTests",
  ];
}

/** Runs one package's tests: in full, or on the selected files. Returns the exit status. */
function testPackage(root, workspace, plan, workers) {
  if (plan.full) {
    console.log(`test-changed: ${workspace.name}: every test, because ${plan.reason}`);
    return run(testArgs(workspace.name, [], workers), root);
  }
  if (plan.files.length === 0) {
    console.log(`test-changed: ${workspace.name}: no test file this change can affect`);
    return 0;
  }
  console.log(
    `test-changed: ${workspace.name}: ${plan.files.length} test file(s) (${plan.selected} selected by --changed, ${plan.guards} guard(s))`
  );
  return run(testArgs(workspace.name, plan.files, workers), root);
}

/** What to run for one package. */
function planFor(root, workspace, paths, changedPackages, mergeBase) {
  const manifest = JSON.parse(readFileSync(join(root, workspace.dir, "package.json"), "utf8"));
  const reason = fullRunReason({ dir: workspace.dir, manifest, changed: paths, changedPackages });
  if (reason) return { full: true, reason };
  const selection = changedSelection(root, workspace.dir, mergeBase);
  if (selection === null) {
    return { full: true, reason: "`vitest list --changed` could not say which tests the change affects" };
  }
  const guards = guardsIn(root, workspace.dir);
  return {
    full: false,
    files: selectedFiles(selection, guards),
    selected: selection.length,
    guards: guards.length,
  };
}

/** The worker limit from `--max-workers=N`, 2 when it is not given. */
function workersFrom(argv) {
  const flag = argv.find(arg => arg.startsWith("--max-workers=")) ?? "";
  return /^--max-workers=(\d+)$/.exec(flag)?.[1] ?? "2";
}

/** Tests every package the change touches, and returns how many failed. */
function testTouchedPackages(root, base, paths, workers) {
  const mergeBase = git(root, ["merge-base", base, "HEAD"]).trim();
  const workspaces = workspacesFrom(pnpmWorkspaces(root), root);
  const { filters } = filtersFor(paths, workspaces, new Set(deletedPaths(root, base)));
  let failed = 0;
  for (const workspace of workspaces.filter(candidate => filters.includes(candidate.name))) {
    const plan = planFor(root, workspace, paths, filters, mergeBase);
    if (testPackage(root, workspace, plan, workers) !== 0) failed += 1;
  }
  return failed;
}

/** Runs the root scripts tests when the change reaches them, and returns how many failed. */
function testScripts(root, paths) {
  if (!scriptTestsNeeded(paths)) return 0;
  console.log("test-changed: the root scripts tests, because a script, the turbo config or a Vitest config changed");
  return run(["test:scripts"], root) === 0 ? 0 : 1;
}

function main() {
  const argv = process.argv.slice(2);
  const base = argv.find(arg => !arg.startsWith("--")) ?? "origin/main";
  const root = git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
  const paths = changedPaths(root, base);
  // `--scripts-only` is for a run whose packages are already being tested in
  // full, as the pre-push does when the change redefines the workspace graph.
  const packageFailures = argv.includes("--scripts-only")
    ? 0
    : testTouchedPackages(root, base, paths, workersFrom(argv));
  process.exitCode = packageFailures + testScripts(root, paths) === 0 ? 0 : 1;
}

if (isCliEntry(import.meta.url, process.argv[1])) main();
