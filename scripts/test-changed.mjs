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
 * - a change to what every test compiles against (the lockfile, `.nvmrc`, a
 *   root tsconfig, the shared tsconfig package) touches no recorded module, and
 *   gate-scope scopes it to no package that has tests: EVERY package runs in
 *   full. A package's own tsconfig runs that package in full. Vitest already
 *   reruns everything for its own config, setup files, `.env` and
 *   `package.json`.
 *
 * Anything this cannot decide runs the package in full, never nothing: a test
 * file without a record always runs, a failed selection falls back to the whole
 * suite, and an empty selection stands only while Vitest still discovers tests
 * in the package; otherwise the package's own `test` script decides.
 *
 * Usage (from the pre-push, after the build):
 *   node scripts/test-changed.mjs [base] [--max-workers=N]   # base defaults to origin/main
 *
 * @module scripts/test-changed
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";

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
 * Whether a change reaches the root `scripts/` tests: any path outside every
 * workspace, or any Vitest config. `turbo run test` never runs those tests, and
 * they read the root's files directly — the hooks, the workflows, the lockfile,
 * the turbo config, the docs — with `fs`, which no dependency record names. So
 * a root path is not matched against a list of the ones they read, which would
 * drift behind the tests; every one of them runs the suite.
 *
 * `workspaceDirs` are the workspaces' directories relative to the root.
 */
export function scriptTestsNeeded(paths, workspaceDirs) {
  const inWorkspace = path => workspaceDirs.some(dir => path.startsWith(`${dir}/`));
  return paths.some(
    path => !inWorkspace(path) || /(^|\/)vitest[^/]*\.config\.[cm]?[jt]s$/.test(path)
  );
}

/** Whether a changed path is one every package's tests compile or resolve against. */
function isGlobalInput(path) {
  return ROOT_GLOBAL_INPUTS.some(input => input.test(path));
}

/**
 * What turbo declares the test tasks read OUTSIDE the packages that own them,
 * from one `turbo run test --dry=json`: the files it hashes into every task,
 * and per package the root files its test task lists as inputs (templates,
 * skills, a shared Vitest setup file). Path ownership cannot see those, and
 * turbo's own `--affected` does not follow a task's root inputs either, so the
 * declaration itself is read rather than a second list kept here.
 *
 * Returns `{ everyReason, packages }`: why every package must run in full, or
 * null, and for each package one of these root inputs reached, why it must.
 * Null when the dry run cannot be read as one, which the caller treats as
 * "everything", never as "nothing declared".
 */
export function declaredReaders(dry, paths) {
  if (!Array.isArray(dry?.tasks)) return null;
  const changed = new Set(paths);
  return { everyReason: globalInputReason(dry, changed), packages: testTaskHits(dry.tasks, changed) };
}

/** Each test task's package mapped to why a changed root input it declares runs it in full. */
function testTaskHits(tasks, changed) {
  const hits = tasks
    .filter(task => task?.task === "test")
    .map(task => [task.package, rootInputHit(task, changed)])
    .filter(([, hit]) => hit);
  return new Map(hits.map(([name, hit]) => [name, `${hit} changed, which its test task declares as an input`]));
}

/** Why a changed file turbo hashes into every task runs everything, or null. */
function globalInputReason(dry, changed) {
  const files = Object.keys(dry.globalCacheInputs?.files ?? {});
  const global = files.find(file => changed.has(file));
  return global ? `${global} changed, which turbo hashes into every task` : null;
}

/** The first changed file a test task declares outside its own package, as a repository path. */
function rootInputHit(task, changed) {
  return Object.keys(task.inputs ?? {})
    .filter(input => input.startsWith("../"))
    .map(input => posix.normalize(posix.join(String(task.directory), input)))
    .find(path => changed.has(path));
}

/** The declaration when turbo could not give one: everything runs. */
const UNDECLARED = {
  everyReason: "turbo could not list what the test tasks read",
  packages: new Map(),
};

/**
 * The workspaces a push tests: the ones gate-scope scoped it to, the ones whose
 * test task declares a changed root file (`declared`, from `declaredReaders`),
 * or EVERY workspace when a global input changed. Gate-scope scopes `.nvmrc`
 * and a root `tsconfig` to no package and `packages/tsconfig/` to itself, so
 * without the widening the packages that compile against them are never
 * reached at all.
 *
 * `testScriptOf` answers a workspace's `test` script. A workspace without one
 * has nothing to run, and is returned under `untestable` so the run can say so.
 */
export function workspacesToTest({ workspaces, filters, paths, testScriptOf, declared = UNDECLARED }) {
  const every = paths.some(isGlobalInput) || declared.everyReason !== null;
  const scoped = workspaces.filter(
    workspace => every || filters.includes(workspace.name) || declared.packages.has(workspace.name)
  );
  return {
    testable: scoped.filter(workspace => typeof testScriptOf(workspace) === "string"),
    untestable: scoped.filter(workspace => typeof testScriptOf(workspace) !== "string"),
  };
}

/**
 * Why a selection that came back empty must run the package in full, or null
 * when the empty selection stands. `discoverable` is every unit test file Vitest
 * finds in the package, or null when it could not say.
 *
 * An empty selection over a suite that still exists means the change reaches
 * no test. Over a suite that has disappeared — a config edit that excludes
 * everything, a deleted directory — it means the opposite, and the package's
 * own `test` script is what decides whether no tests is a pass.
 */
export function emptySelectionReason(discoverable) {
  if (discoverable === null) return "`vitest list` could not say which tests the package has";
  if (discoverable.length === 0) {
    return "Vitest discovers no test file in it, so its own test script decides whether that passes";
  }
  return null;
}

/**
 * Why a package's dependency records cannot be trusted for this push, or null
 * when they can.
 *
 * A record is what a test imported when it last ran, so it lags behind an
 * import gained since. A change on this branch is in the push's diff, and the
 * test reaching it through a file it already imported is selected. A change
 * that arrived any other way — a pull, a rebase, a switch from another branch —
 * is not, and a test that now reaches a changed file through it is missed. So
 * the records are trusted only when every file in the package that changed
 * since the last full run passed (`sinceFullRun`, null when that commit is
 * unknown here) is one this push changes too (`pushed`).
 */
export function staleRecordsReason(sinceFullRun, pushed) {
  if (sinceFullRun === null) {
    return "no full run here has recorded the commit its dependency records describe";
  }
  const arrived = sinceFullRun.find(path => !pushed.has(path));
  return arrived
    ? `${arrived} changed since the last full run without being part of this push, and a record lags behind an import it gained`
    : null;
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
  const root = changed.find(isGlobalInput);
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

export function workspaceDependencies(manifest) {
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

/**
 * The test files `vitest list` prints for a package, with `extra` arguments
 * (`--changed <base>` to select), or null when it could not say.
 */
export function vitestList(root, dir, extra) {
  const { command, args, shell } = pnpmInvocation([
    "exec",
    "vitest",
    "list",
    ...extra,
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
 * suite with no worker limit. No `--passWithNoTests` either: a full run that
 * finds no tests is the package script's verdict to give, and a file list that
 * matches nothing is a selection gone wrong, not a pass.
 */
export function testArgs(name, files, workers) {
  return ["--filter", name, "run", "test", ...files, `--maxWorkers=${workers}`];
}

/** Runs one package's tests: in full, or on the selected files. Returns the exit status. */
function testPackage(root, workspace, plan, workers) {
  if (plan.full) {
    console.log(`test-changed: ${workspace.name}: every test, because ${plan.reason}`);
    const status = run(testArgs(workspace.name, [], workers), root);
    if (status === 0) stampFullRun(root, workspace.dir);
    return status;
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

/** A workspace's own manifest. */
export function manifestOf(root, workspace) {
  return JSON.parse(readFileSync(join(root, workspace.dir, "package.json"), "utf8"));
}

/**
 * Where a package keeps the commit its last passing full run tested, beside the
 * dependency records that run refreshed. Local and untracked, like the records.
 */
function stampPath(root, dir) {
  return join(root, dir, "node_modules", ".vite", "test-changed-full-run");
}

/** Records that every test of a package just passed at HEAD, so every record describes HEAD. */
export function stampFullRun(root, dir) {
  const path = stampPath(root, dir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${git(root, ["rev-parse", "HEAD"]).trim()}\n`);
}

/** The commit a package's dependency records describe, or null when no full run here has stamped one. */
export function readStamp(root, dir) {
  try {
    const stamped = readFileSync(stampPath(root, dir), "utf8").trim();
    return /^[0-9a-f]{40}$/.test(stamped) ? stamped : null;
  } catch {
    return null;
  }
}

/** The package's files changed since its last passing full run, or null when that commit is unknown here. */
function changedSinceFullRun(root, dir) {
  const stamped = readStamp(root, dir);
  if (stamped === null) return null;
  const diff = spawnSync("git", ["diff", "--name-only", stamped, "HEAD", "--", dir], {
    cwd: root,
    encoding: "utf8",
  });
  return diff.status === 0 ? diff.stdout.split("\n").filter(Boolean) : null;
}

/** Why one package must run in full, checked cheapest first, or null when its tests can be selected. */
function fullReasonFor(root, workspace, context) {
  const { paths, filters, declared, all } = context;
  // Lazily, in this order, so a package already sent to its full suite never
  // reads its manifest or asks git about its records.
  const checks = [
    () => all,
    () => declared.everyReason,
    () => declared.packages.get(workspace.name),
    () =>
      fullRunReason({
        dir: workspace.dir,
        manifest: manifestOf(root, workspace),
        changed: paths,
        changedPackages: filters,
      }),
    // Whether the records still describe the tree: the pre-push's own rule
    // unless the caller judges them another way (CI, against main as tested).
    () =>
      context.recordsReason
        ? context.recordsReason(workspace)
        : staleRecordsReason(changedSinceFullRun(root, workspace.dir), new Set(paths)),
  ];
  for (const check of checks) {
    const reason = check();
    if (reason) return reason;
  }
  return null;
}

/** What to run for one package. */
export function planFor(root, workspace, context) {
  const reason = fullReasonFor(root, workspace, context);
  return reason ? { full: true, reason } : selectionPlan(root, workspace.dir, context.mergeBase);
}

/** The selected files for a package that need not run in full, or the reason it must after all. */
function selectionPlan(root, dir, mergeBase) {
  const selection = vitestList(root, dir, ["--changed", mergeBase]);
  if (selection === null) {
    return { full: true, reason: "`vitest list --changed` could not say which tests the change affects" };
  }
  const guards = guardsIn(root, dir);
  const empty = selection.length + guards.length === 0 && emptySelectionReason(vitestList(root, dir, []));
  if (empty) return { full: true, reason: empty };
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

/** What turbo declares the test tasks read outside their packages, or everything when it cannot say. */
export function turboDeclaration(root, paths) {
  const { command, args, shell } = pnpmInvocation(["turbo", "run", "test", "--dry=json"]);
  const dry = spawnSync(command, args, { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 * 64, shell });
  return (dry.status === 0 && declaredReaders(parsedJson(dry.stdout), paths)) || UNDECLARED;
}

/**
 * Tests every package the change reaches, and returns how many failed. `all`
 * is the reason to run each of them in full regardless, or null.
 */
function testTouchedPackages(root, base, paths, workers, all) {
  const mergeBase = git(root, ["merge-base", base, "HEAD"]).trim();
  const workspaces = workspacesFrom(pnpmWorkspaces(root), root);
  const { filters } = filtersFor(paths, workspaces, new Set(deletedPaths(root, base)));
  const declared = turboDeclaration(root, paths);
  const { testable, untestable } = workspacesToTest({
    workspaces,
    filters,
    paths,
    declared,
    testScriptOf: workspace => manifestOf(root, workspace)?.scripts?.test,
  });
  for (const workspace of untestable) {
    console.log(`test-changed: ${workspace.name}: no test script, nothing to run`);
  }
  const context = { paths, filters, declared, all, mergeBase };
  let failed = 0;
  for (const workspace of testable) {
    if (testPackage(root, workspace, planFor(root, workspace, context), workers) !== 0) failed += 1;
  }
  return failed;
}

/** Runs the root scripts tests when the change reaches them, and returns how many failed. */
function testScripts(root, paths) {
  const dirs = workspacesFrom(pnpmWorkspaces(root), root).map(workspace => workspace.dir);
  if (!scriptTestsNeeded(paths, dirs)) return 0;
  console.log("test-changed: the root scripts tests, because a root file or a Vitest config changed");
  return run(["test:scripts"], root) === 0 ? 0 : 1;
}

/**
 * The command line as options. `--scripts-only` is for a run whose packages are
 * already being tested in full, as the pre-push does when the change redefines
 * the workspace graph. `--all` keeps the same scope and runs each package in
 * full, for `NEXTLY_PREPUSH_ALL_TESTS=1`.
 */
function optionsFrom(argv) {
  return {
    base: argv.find(arg => !arg.startsWith("--")) ?? "origin/main",
    scriptsOnly: argv.includes("--scripts-only"),
    all: argv.includes("--all") ? "every test was asked for (NEXTLY_PREPUSH_ALL_TESTS=1)" : null,
    workers: workersFrom(argv),
  };
}

function main() {
  const { base, scriptsOnly, all, workers } = optionsFrom(process.argv.slice(2));
  const root = git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
  const paths = changedPaths(root, base);
  const packageFailures = scriptsOnly ? 0 : testTouchedPackages(root, base, paths, workers, all);
  process.exitCode = packageFailures + testScripts(root, paths) === 0 ? 0 : 1;
}

if (isCliEntry(import.meta.url, process.argv[1])) main();
