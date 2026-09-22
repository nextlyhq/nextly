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
    // `turbo run test` does not reach `scripts/` — gate-scope.mjs records that
    // explicitly — so without this a change confined to the repository's own
    // tooling passes both documented entry points without running its tests.
    //
    // vitest is invoked DIRECTLY rather than through `pnpm run test:scripts`,
    // and the reason is measurable rather than stylistic. `pnpm run <script> --
    // <args>` forwards the arguments but KEEPS the separator, so the script
    // runs as `vitest run --dir scripts -- --maxWorkers=2` and vitest reads
    // everything after `--` as a test-name filter rather than as options. The
    // cap is silently ignored and the run reports success, so the phase looks
    // bounded and is not. Verified with a deliberately invalid flag: through
    // `pnpm run ... --` it is accepted and ignored; passed directly it is
    // rejected with `Unknown option`.
    //
    // turbo's `--` behaves the opposite way and does forward options, which is
    // why the phases above can keep using it.
    //
    // `test:scripts` is exactly this command with no wrapper of its own, so
    // nothing is bypassed by going direct.
    { name: "script tests", argv: ["exec", "vitest", "run", "--dir", "scripts", workers] },
  ];
  if (scope === "pr") return pr;
  return [
    ...pr,
    { name: "repo-wide lints", argv: ["run", "lint:design"] },
    { name: "workspace lint", argv: ["run", "lint:workspace"] },
    { name: "script lint", argv: ["run", "lint:scripts"] },
    // Invoked as turbo directly rather than through `test:integration:sqlite`,
    // which is exactly `turbo run test:integration` with no environment of its
    // own — the sqlite leg needs no connection URL. Going direct is what lets
    // the worker cap be forwarded; appending it to the script would hand
    // `--maxWorkers` to turbo, which does not know the flag.
    //
    // The integration configs already pin `singleFork: true`, so this changes
    // nothing at runtime. It makes the bound VERIFIABLE rather than resting on
    // a config the checker does not read.
    { name: "integration (sqlite)", argv: ["turbo", "run", "test:integration", "--", workers] },
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
