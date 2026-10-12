#!/usr/bin/env node

/**
 * How many heavy processes this machine can run at once.
 *
 * The local gates fan out two levels: turbo runs several package tasks
 * concurrently, and each task that runs Vitest spawns several workers. The
 * product is what consumes the machine, and left to the defaults it is large —
 * turbo's `--concurrency` defaults to 10 and Vitest's `maxWorkers` defaults to
 * `os.availableParallelism()`, so an eight-core machine can reach 80 Node
 * processes, each with its own V8 heap.
 *
 * 🔴 A FIXED number is the wrong answer, and the first version of this was one.
 * A constant tuned on the machine that hit the problem is too slow for a
 * workstation and still too generous for a 8 GiB laptop — so it is either
 * ignored or it keeps failing, and both end in `--no-verify`.
 *
 * So the budget is DERIVED. `os.totalmem()` and `os.availableParallelism()`
 * read correctly on macOS, Linux, Windows and WSL2, which is every environment
 * this repository is developed in.
 *
 * Both values are advisory ceilings rather than measurements of the current
 * moment: `os.freemem()` is deliberately NOT used, because it swings with page
 * cache and would make the same command bounded differently on two consecutive
 * runs — a gate whose strictness depends on when you ran it is one nobody can
 * reason about.
 *
 * Usage:
 *   node scripts/local-limits.mjs              # human-readable
 *   node scripts/local-limits.mjs --concurrency
 *   node scripts/local-limits.mjs --max-workers
 *   node scripts/local-limits.mjs --json
 */

import os from "node:os";

const GIB = 1024 ** 3;

/**
 * Memory a heavy gate process occupies, in GiB.
 *
 * Measured rather than guessed: during a real pre-push run the `eslint` tasks
 * sat at roughly 1.9 GiB resident each. 1.5 is the planning figure because
 * Vitest workers are lighter than a lint task and the mix is what runs.
 */
export const GIB_PER_PROCESS = 1.5;

/** Never take the whole machine: the OS, an editor and a browser need room. */
export const MIN_RESERVED_GIB = 2;
export const RESERVED_FRACTION = 0.3;

/** Ceilings, so a very large machine does not start 50 processes. */
export const MAX_CONCURRENCY = 4;
export const MAX_WORKERS = 4;

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

/** An explicit override, or null when unset or not a positive integer. */
export function parseOverride(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * The limits for a machine.
 *
 * Budget the total number of heavy PROCESSES first, because that is the
 * quantity the machine actually constrains, then split it into the two knobs.
 * Deriving each knob independently gets this wrong: two knobs that each look
 * modest multiply into a number neither of them names.
 */
export function deriveLimits({ totalBytes, cpus, env = {} }) {
  const totalGiB = totalBytes / GIB;
  const reserved = Math.max(MIN_RESERVED_GIB, totalGiB * RESERVED_FRACTION);
  const usableGiB = Math.max(0, totalGiB - reserved);

  // Cores bound it as well as memory: more processes than cores buys nothing
  // and costs context switching.
  const processBudget = clamp(Math.floor(usableGiB / GIB_PER_PROCESS), 1, Math.max(1, cpus));

  const derivedConcurrency = clamp(Math.floor(Math.sqrt(processBudget)), 1, MAX_CONCURRENCY);
  const derivedWorkers = clamp(
    Math.floor(processBudget / derivedConcurrency),
    1,
    MAX_WORKERS
  );

  const overrideConcurrency = parseOverride(env.NEXTLY_LOCAL_CONCURRENCY);
  const overrideWorkers = parseOverride(env.NEXTLY_LOCAL_MAX_WORKERS);

  return {
    concurrency: overrideConcurrency ?? derivedConcurrency,
    maxWorkers: overrideWorkers ?? derivedWorkers,
    derivedConcurrency,
    derivedWorkers,
    overridden: overrideConcurrency !== null || overrideWorkers !== null,
    totalGiB: Number(totalGiB.toFixed(1)),
    usableGiB: Number(usableGiB.toFixed(1)),
    processBudget,
    cpus,
  };
}

/** The limits for THIS machine. */
export function localLimits(env = process.env) {
  return deriveLimits({
    totalBytes: os.totalmem(),
    cpus: os.availableParallelism(),
    env,
  });
}

function main() {
  const limits = localLimits();
  const argv = process.argv.slice(2);

  // Single values, for a shell that wants to capture one.
  if (argv.includes("--concurrency")) return console.log(limits.concurrency);
  if (argv.includes("--max-workers")) return console.log(limits.maxWorkers);
  if (argv.includes("--json")) return console.log(JSON.stringify(limits, null, 2));

  console.log(
    `local-limits: ${limits.concurrency} package task(s) x ${limits.maxWorkers} worker(s)` +
      `${limits.overridden ? " (overridden)" : ""}`
  );
  console.log(
    `  ${limits.totalGiB} GiB total, ${limits.usableGiB} GiB usable, ${limits.cpus} cpu(s)` +
      ` -> budget ${limits.processBudget} heavy process(es)`
  );
  if (!limits.overridden) {
    console.log(
      "  raise it for one command with NEXTLY_LOCAL_CONCURRENCY / NEXTLY_LOCAL_MAX_WORKERS"
    );
  }
}

if (process.argv[1] && process.argv[1].endsWith("local-limits.mjs")) {
  main();
}
