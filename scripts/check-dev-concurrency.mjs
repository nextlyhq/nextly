#!/usr/bin/env node

/**
 * Every root script running `turbo run dev` must allow more concurrency than
 * there are persistent `dev` tasks to run.
 *
 * Turbo refuses to start when the two are equal, because a persistent task holds
 * its slot for as long as it lives and a scheduler with no free slot can never
 * make progress:
 *
 *   x You have 20 persistent tasks but `turbo` is configured for concurrency of
 *     20. Set `--concurrency` to at least 21
 *
 * That number is written into `package.json` by hand and the task count grows
 * whenever any workspace package gains a `dev` script, so the two drift apart
 * with nothing connecting them. Measured: the count reached 20 against a limit
 * of 20 and `pnpm dev` stopped starting at all, in a repository where every
 * other gate was green — the failure is in the launcher, so no build, test or
 * type check can see it.
 *
 * Both sides are DERIVED rather than restated. The count comes from reading the
 * workspace's own manifests, and the limit comes from parsing the flag out of
 * the scripts that actually run, so neither is a number kept in step by hand.
 *
 * Usage:
 *   node scripts/check-dev-concurrency.mjs
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Workspace roots, read from the pnpm workspace file rather than assumed. */
function workspaceDirs() {
  const file = join(root, "pnpm-workspace.yaml");
  const globs = [];
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*-\s*["']?([^"'#]+?)["']?\s*$/.exec(line);
    if (match) globs.push(match[1].trim());
  }

  const dirs = [];
  for (const glob of globs) {
    // Only the shapes this workspace file uses: a literal directory, or one
    // level of `*`. Enough to enumerate the real entries, and a glob it cannot
    // read is reported rather than skipped, because silently covering fewer
    // packages is how this check would pass while missing the task that broke
    // the limit.
    if (glob.endsWith("/*")) {
      const parent = join(root, glob.slice(0, -2));
      let entries;
      try {
        entries = readdirSync(parent);
      } catch {
        throw new Error(`cannot read workspace directory: ${parent}`);
      }
      for (const entry of entries) {
        const full = join(parent, entry);
        if (statSync(full).isDirectory()) dirs.push(full);
      }
    } else if (!glob.includes("*")) {
      dirs.push(join(root, glob));
    } else {
      throw new Error(`unsupported workspace glob, teach this script it: ${glob}`);
    }
  }
  return dirs;
}

/** Packages declaring a `dev` script, which is what turbo counts. */
function persistentDevTasks() {
  const names = [];
  for (const dir of workspaceDirs()) {
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    } catch {
      continue;
    }
    if (manifest.scripts?.dev) names.push(manifest.name ?? dir);
  }
  return names;
}

const rootScripts = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8")
).scripts;

const tasks = persistentDevTasks();
const failures = [];

// Only the scripts that run every package's `dev`. A filtered one runs a
// subset, so the whole-workspace count says nothing about it.
//
// Selected ONCE, and the emptiness check below reads this same list. Deciding
// membership inside the loop and then asking a differently-worded question
// afterwards is how a check comes to certify a set it never looked at: the
// first version of this file tested whether ANY script mentioned `turbo run
// dev`, which the three filtered scripts satisfy on their own, so deleting
// every unfiltered one left it reporting success.
const wholeWorkspace = Object.entries(rootScripts).filter(
  ([, command]) => /\bturbo run dev\b/.test(command) && !/--filter/.test(command)
);

for (const [name, command] of wholeWorkspace) {
  const flag = /--concurrency=(\d+)/.exec(command);
  if (flag === null) {
    failures.push(
      `${name}: runs every package's dev task with no --concurrency, so turbo's ` +
        `default of 10 applies and ${tasks.length} persistent tasks cannot start.`
    );
    continue;
  }

  const limit = Number(flag[1]);
  if (limit <= tasks.length) {
    failures.push(
      `${name}: --concurrency=${limit} with ${tasks.length} persistent dev ` +
        `tasks. Turbo needs at least ${tasks.length + 1}; raise the flag in ` +
        `the root package.json.`
    );
  }
}

// A check that inspects nothing passes, and this one selects scripts by
// pattern, so an edit that renames or restructures them would leave it
// examining an empty set and reporting success.
if (wholeWorkspace.length === 0) {
  console.error(
    "check-dev-concurrency: no root script runs every package's `dev` task. " +
      "Either those scripts were renamed and this check needs teaching, or it " +
      "is now inspecting nothing and reporting success."
  );
  process.exit(2);
}

if (failures.length > 0) {
  console.error("check-dev-concurrency: FAILED\n");
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error(`\npersistent dev tasks (${tasks.length}):`);
  for (const task of tasks) console.error(`  ${task}`);
  process.exit(1);
}

console.log(
  `check-dev-concurrency: ok — ${tasks.length} persistent dev tasks, every ` +
    `whole-workspace dev script allows more than that.`
);
