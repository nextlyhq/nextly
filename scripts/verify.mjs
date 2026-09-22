#!/usr/bin/env node

/**
 * The bounded local verification entry points.
 *
 * 🔴 These were `package.json` one-liners using `TURBO_CONCURRENCY=${VAR:-2}
 * turbo ... && ...`. That spelling is POSIX shell: on Windows outside a
 * bash-alike, `${VAR:-2}` is not expanded and the assignment prefix is not a
 * thing, so the command either fails or — worse — runs with the literal string
 * as the concurrency and turbo falls back to its default of 10. A gate that
 * silently unbounds itself on one operating system is the failure this whole
 * file exists to prevent, wearing a different costume.
 *
 * Node runs identically on every platform this repository is developed on, so
 * the sequencing and the limits live here instead.
 *
 * Phases run SEQUENTIALLY and the first failure stops the run. They are not
 * independent: `check-types` reads what `build` produced, so running them
 * together reports a missing `dist` as a type error in the diff.
 *
 * Usage:
 *   node scripts/verify.mjs pr
 *   node scripts/verify.mjs full
 */

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { localLimits } from "./local-limits.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * What each scope runs, in order.
 *
 * `full` extends `pr` rather than restating it, so the two cannot drift into
 * disagreeing about what a PR needs.
 */
export function phasesFor(scope, limits) {
  const workers = `--maxWorkers=${limits.maxWorkers}`;
  const pr = [
    { name: "build", argv: ["turbo", "run", "build"] },
    { name: "lint + types", argv: ["turbo", "run", "lint", "check-types", "--continue"] },
    { name: "unit tests", argv: ["turbo", "run", "test", "--continue", "--", workers] },
  ];
  if (scope === "pr") return pr;
  return [
    ...pr,
    { name: "repo-wide lints", argv: ["run", "lint:design"] },
    { name: "workspace lint", argv: ["run", "lint:workspace"] },
    { name: "script lint", argv: ["run", "lint:scripts"] },
    { name: "integration (sqlite)", argv: ["run", "test:integration:sqlite"] },
  ];
}

function run(argv, limits) {
  // `shell` on Windows because the launcher is `pnpm.cmd` there and Node will
  // not execute it directly. Everywhere else it stays off, so no argument
  // passes through a shell that could reinterpret it.
  const result = spawnSync("pnpm", argv, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      // turbo's own variable, so it reaches every nested invocation.
      TURBO_CONCURRENCY: String(limits.concurrency),
    },
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function main() {
  const scope = process.argv[2];
  if (scope !== "pr" && scope !== "full") {
    console.error("verify: usage — node scripts/verify.mjs pr|full");
    process.exit(2);
  }

  const limits = localLimits();
  console.log(
    `verify (${scope}): ${limits.concurrency} package task(s) x ${limits.maxWorkers} worker(s)` +
      `${limits.overridden ? " (overridden)" : ""} on ${limits.totalGiB} GiB / ${limits.cpus} cpu(s)\n`
  );

  for (const phase of phasesFor(scope, limits)) {
    console.log(`\n--- ${phase.name} ---`);
    const status = run(phase.argv, limits);
    if (status !== 0) {
      // Name the phase. A bare non-zero exit from a seven-phase run sends the
      // reader to the top of a very long log to work out which one it was.
      console.error(`\nverify (${scope}): FAILED at '${phase.name}' (exit ${status})`);
      process.exit(status);
    }
  }

  console.log(`\nverify (${scope}): OK`);
}

if (process.argv[1] && process.argv[1].endsWith("verify.mjs")) {
  main();
}
