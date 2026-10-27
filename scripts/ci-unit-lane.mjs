#!/usr/bin/env node

/**
 * A CI unit lane narrowed to the test files a pull request can affect, the
 * same selection the pre-push makes (`scripts/test-changed.mjs`), applied to
 * every package the lane's script runs.
 *
 * Whether a run narrows at all is `scripts/merge-path.mjs`'s answer. This
 * module only plans and runs:
 *
 * - `plan <lane> [--out file]`: what each package of the lane would run, one
 *   `selection-shadow:` line each. In shadow mode it runs BEFORE the lane's
 *   full run, against the records restored from `main`, so the plan is the one
 *   a selecting run would have made.
 * - `run <lane>`: the plan, executed through turbo, so each package's test
 *   task keeps its dependencies' builds and its cache: the packages that must
 *   run in full in one call, each narrowed package in a call of its own with
 *   its files passed through.
 * - `misses <plan file> <since ms>`: after a shadow run's full lane, each test
 *   file Vitest recorded as failed in this job that the plan left out, one
 *   `selection-miss:` line each. A package whose results show nothing run in
 *   this job (a turbo replay, or a lane stopped by an earlier failure) is
 *   reported as unread, never as clean.
 * - `stamp <lane> <since ms>`: after a passing full run on `main`, records
 *   which commit each package's dependency records now describe. Only a
 *   package whose records this job rewrote is stamped; one turbo replayed
 *   keeps its earlier stamp, which still describes it, since a replay means
 *   its inputs did not change. A package with no records at all (one turbo
 *   has replayed since before records were kept) is run once more with
 *   `--force` so it gains them; without that it would run in full on every
 *   pull request.
 *
 * A pull request's run tests GitHub's merge commit, so the change under test is
 * that commit against its first parent, `main` as tested (`HEAD^1`, the default
 * base). The records come from a `main` run whose commit may be older or newer
 * than that parent, so a package runs in full when any of its files differ
 * between the two, in either direction.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { packagesInPlan, planForScript } from "./check-test-lanes.mjs";
import { isCliEntry } from "./cli-entry.mjs";
import { changedPaths, deletedPaths, filtersFor, pnpmWorkspaces, workspacesFrom } from "./gate-scope.mjs";
import { pnpmInvocation } from "./pnpm-invocation.mjs";
import {
  manifestOf,
  planFor,
  readStamp,
  stampFullRun,
  turboDeclaration,
  vitestList,
  workspaceDependencies,
} from "./test-changed.mjs";

/**
 * The changed packages and every package that depends on one, directly or
 * through others. A test reaches a workspace dependency through its built
 * output, which no record names, so any package in this set whose dependency
 * changed runs in full; one level of dependency is not enough when the change
 * arrives through a package in between.
 */
export function affectedPackages(changed, dependenciesOf) {
  const affected = new Set(changed);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [name, dependencies] of dependenciesOf) {
      if (!affected.has(name) && dependencies.some(dependency => affected.has(dependency))) {
        affected.add(name);
        grew = true;
      }
    }
  }
  return affected;
}

/**
 * Why a package's restored records cannot be trusted for this run, or null.
 * `drift` is the package's files that differ between the commit the records
 * describe and the base, or null when that commit is unknown here.
 */
export function recordsDriftReason(drift) {
  if (drift === null) return "no records restored here say which commit they describe";
  return drift.length > 0
    ? `${drift[0]} differs between the commit its records describe and main as tested`
    : null;
}

/**
 * The turbo flags a lane's own script passes, other than its filters: its
 * `--concurrency` above all, which sizes the run to the runner. Every turbo
 * call this makes for the lane carries them, so narrowing never runs more
 * tasks at once than the lane does.
 */
export function laneTurboFlags(script) {
  return String(script ?? "")
    .split(/\s+/)
    .filter(token => token.startsWith("--") && !token.startsWith("--filter"));
}

/** One package's plan as the line shadow mode prints, in a form a search can count. */
export function shadowLine(name, plan, total) {
  if (plan.full) return `selection-shadow: ${name} full=${plan.reason}`;
  return `selection-shadow: ${name} selected=${plan.files.length} total=${total ?? "unknown"}`;
}

/**
 * The test files a package's Vitest results record as failed at or after
 * `since`, and how many files ran then at all, from every `results.json` under
 * its records. Paths are relative to the package.
 */
export function failuresSince(resultFiles, since) {
  const ran = [...fileResults(resultFiles)].filter(([, result]) => result?.lastRun >= since);
  const failed = new Set(ran.filter(([, result]) => result.failed).map(([file]) => file));
  return { ran: ran.length, failed: [...failed].sort() };
}

/** Every `[file, result]` pair across the parsed results files and their projects. */
function* fileResults(resultFiles) {
  for (const results of resultFiles) {
    for (const project of Object.values(results?.projects ?? {})) {
      yield* Object.entries(project?.files ?? {});
    }
  }
}

/** The failed files a plan left out: every one, for a package the plan ran in full, is none. */
export function missesOf(plan, failed) {
  if (plan.full) return [];
  const selected = new Set(plan.files);
  return failed.filter(file => !selected.has(file));
}

function git(root, args) {
  return spawnSync("git", args, { cwd: root, encoding: "utf8" });
}

/** The package's files that differ between the commit its records describe and `base`, or null when unknown. */
function recordsDrift(root, dir, base) {
  const stamped = readStamp(root, dir);
  if (stamped === null) return null;
  // A shallow checkout lacks the records' commit; one commit of it is enough for a tree diff.
  if (git(root, ["cat-file", "-e", `${stamped}^{commit}`]).status !== 0) {
    git(root, ["fetch", "--no-tags", "--depth=1", "origin", stamped]);
  }
  const diff = git(root, ["diff", "--name-only", "--no-renames", stamped, base, "--", dir]);
  return diff.status === 0 ? diff.stdout.split("\n").filter(Boolean) : null;
}

/** The workspaces the lane's script runs `test` in, as turbo plans it. */
function laneWorkspaces(root, lane, workspaces) {
  const names = new Set(packagesInPlan(planForScript(lane, root), "test"));
  return workspaces.filter(workspace => names.has(workspace.name));
}

/** Every package of the lane with what it should run. */
function planLane(root, lane, base) {
  const workspaces = workspacesFrom(pnpmWorkspaces(root), root);
  const paths = changedPaths(root, base);
  const { filters } = filtersFor(paths, workspaces, new Set(deletedPaths(root, base)));
  const dependenciesOf = new Map(
    workspaces.map(workspace => [workspace.name, workspaceDependencies(manifestOf(root, workspace))])
  );
  const context = {
    paths,
    filters: [...affectedPackages(filters, dependenciesOf)],
    declared: turboDeclaration(root, paths),
    all: null,
    mergeBase: base,
    recordsReason: workspace => recordsDriftReason(recordsDrift(root, workspace.dir, base)),
  };
  return laneWorkspaces(root, lane, workspaces).map(workspace => {
    const plan = planFor(root, workspace, context);
    const total = plan.full ? null : vitestList(root, workspace.dir, [])?.length;
    return { name: workspace.name, dir: workspace.dir, plan, total };
  });
}

/** The lane's own turbo flags, read from the root manifest's script of that name. */
function laneFlags(root, lane) {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  return laneTurboFlags(manifest.scripts?.[lane]);
}

function turbo(root, args) {
  const { command, args: argv, shell } = pnpmInvocation(["turbo", "run", "test", ...args]);
  return spawnSync(command, argv, { cwd: root, stdio: "inherit", shell }).status ?? 1;
}

/** Runs a planned lane with the lane's own turbo flags, and returns how many turbo calls failed. */
function runLane(root, planned, flags) {
  let failures = 0;
  const full = planned.filter(entry => entry.plan.full);
  if (full.length > 0) {
    for (const entry of full) console.log(`ci-unit-lane: ${entry.name}: every test, because ${entry.plan.reason}`);
    if (turbo(root, [...flags, "--continue", ...full.map(entry => `--filter=${entry.name}`)]) !== 0) failures += 1;
  }
  for (const entry of planned.filter(item => !item.plan.full)) {
    if (entry.plan.files.length === 0) {
      console.log(`ci-unit-lane: ${entry.name}: no test file this change can affect`);
      continue;
    }
    console.log(`ci-unit-lane: ${entry.name}: ${entry.plan.files.length} of ${entry.total ?? "?"} test file(s)`);
    if (turbo(root, [...flags, `--filter=${entry.name}`, "--", ...entry.plan.files]) !== 0) failures += 1;
  }
  return failures;
}

/** Every `results.json` Vitest keeps for a package, parsed; unreadable ones are left out. */
function resultFilesOf(root, dir) {
  const records = join(root, dir, "node_modules", ".vite", "vitest");
  let entries = [];
  try {
    entries = readdirSync(records);
  } catch {
    return [];
  }
  return entries.flatMap(entry => {
    try {
      return [JSON.parse(readFileSync(join(records, entry, "results.json"), "utf8"))];
    } catch {
      return [];
    }
  });
}

/** Whether a package holds any dependency records at all. */
function hasRecords(root, dir) {
  return recordsRewrittenSince(root, dir, 0);
}

/** Whether Vitest rewrote any of a package's dependency records at or after `since`. */
function recordsRewrittenSince(root, dir, since) {
  const records = join(root, dir, "node_modules", ".vite", "vitest");
  try {
    return readdirSync(records).some(entry => {
      try {
        return statSync(join(records, entry, "dependencies.json")).mtimeMs >= since;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

function rootOf() {
  return git(process.cwd(), ["rev-parse", "--show-toplevel"]).stdout.trim();
}

/** `plan` and `run`: prints the plan, writes it to `--out=`, and for `run` executes it. */
function planCommand(root, [command, lane, ...rest]) {
  const planned = planLane(root, lane, "HEAD^1");
  for (const entry of planned) console.log(shadowLine(entry.name, entry.plan, entry.total));
  const out = rest.find(arg => arg.startsWith("--out="))?.slice("--out=".length);
  if (out) writeFileSync(out, JSON.stringify(planned));
  return command === "run" && runLane(root, planned, laneFlags(root, lane)) > 0 ? 1 : 0;
}

/** `misses`: the failed files each planned package's selection left out, after the full run. */
function missesCommand(root, [, planFile, since]) {
  let misses = 0;
  for (const entry of JSON.parse(readFileSync(planFile, "utf8"))) {
    const { ran, failed } = failuresSince(resultFilesOf(root, entry.dir), Number(since));
    if (ran === 0) {
      console.log(`selection-shadow: ${entry.name} unread=no test file ran in this job`);
      continue;
    }
    for (const file of missesOf(entry.plan, failed)) {
      console.log(`selection-miss: ${entry.name} ${file}`);
      misses += 1;
    }
  }
  console.log(`selection-shadow: misses=${misses}`);
  return 0;
}

/**
 * `stamp`: marks each lane package whose records this job rewrote as describing
 * HEAD, after running once more, with `--force`, each package that has none.
 * A seeding run that fails stamps nothing and fails nothing: the lane already
 * passed, and that package keeps running in full until a later run records it.
 */
function stampCommand(root, [, lane, since]) {
  const workspaces = laneWorkspaces(root, lane, workspacesFrom(pnpmWorkspaces(root), root));
  const unrecorded = workspaces.filter(workspace => !hasRecords(root, workspace.dir));
  if (unrecorded.length > 0) {
    console.log(`ci-unit-lane: recording ${unrecorded.map(workspace => workspace.name).join(", ")}, which hold no records yet`);
    turbo(root, [...laneFlags(root, lane), "--force", "--continue", ...unrecorded.map(workspace => `--filter=${workspace.name}`)]);
  }
  for (const workspace of workspaces) {
    if (!recordsRewrittenSince(root, workspace.dir, Number(since))) continue;
    stampFullRun(root, workspace.dir);
    console.log(`ci-unit-lane: ${workspace.name}: records stamped at HEAD`);
  }
  return 0;
}

const COMMANDS = { plan: planCommand, run: planCommand, misses: missesCommand, stamp: stampCommand };

function main(argv = process.argv.slice(2)) {
  const command = COMMANDS[argv[0]];
  if (command) return command(rootOf(), argv);
  console.log("usage: ci-unit-lane.mjs plan|run <lane> [--out=file] | misses <plan file> <since ms> | stamp <lane> <since ms>");
  return 2;
}

if (isCliEntry(import.meta.url)) process.exit(main());
