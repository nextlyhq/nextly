#!/usr/bin/env node
/**
 * Lints the repository with oxlint in three passes rather than one, so that
 * lint fits the machines the pre-push hook runs on.
 *
 * One pass over everything holds two large processes at once: oxlint's, which
 * runs the JS plugins, and tsgolint's, which holds the TypeScript programs.
 * Measured on a 14-core Mac, that peaked at 4.5 to 4.7 GB, the largest step of
 * a push, where the target is an 8 GB laptop. Neither process has a knob that
 * trades memory for time: tsgolint's checkers follow GOMAXPROCS, which at 1
 * took the run from 8 s to 13 s and left the peak at 4.6 GB. Splitting the
 * files is what lowers it, because each pass loads only its own programs:
 * the three passes below peaked at 1.9, 2.2 and 1.7 GB, and took 9 s together.
 *
 * Splitting by RULE instead (type-aware rules in one pass, JS plugins in the
 * other) peaks about as low, but each pass then reports the other's
 * `eslint-disable` comments as unused, and the unused-directive check is part
 * of what lint enforces.
 *
 * The last pass lints `.` with the earlier passes' paths ignored, so the
 * passes cover the repository whatever is added to it: a new package lands in
 * the last pass without anyone listing it. `scripts/lint.test.mjs` holds that
 * the passes together lint exactly the files one pass would.
 *
 * Usage: `pnpm lint` (through scripts/bounded.mjs); any further arguments, such
 * as `--fix`, go to every pass.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** The repository's lint configuration. */
export const CONFIG = "oxlint.config.mjs";

/**
 * The paths each pass but the last lints, grouped so that no pass's programs
 * are much larger than another's: the core package alone, then the admin and
 * the two packages it is built from.
 */
export const NAMED_PASSES = [
  ["packages/nextly"],
  ["packages/admin", "packages/ui", "packages/builder"],
];

/** The oxlint arguments of every pass, each followed by `extra`. */
export function passes(config = CONFIG, extra = []) {
  const named = NAMED_PASSES.map(paths => ["-c", config, ...paths, ...extra]);
  const ignored = NAMED_PASSES.flat().flatMap(path => ["--ignore-pattern", `${path}/**`]);
  return [...named, ["-c", config, ".", ...ignored, ...extra]];
}

/** Runs one pass, and whether it passed. */
function runPass(args) {
  const { status, error } = spawnSync("oxlint", args, { stdio: "inherit" });
  if (error) throw error;
  return status === 0;
}

function main(extra) {
  // Every pass runs even after one fails, so a single run reports everything.
  const results = passes(CONFIG, extra).map(runPass);
  process.exitCode = results.every(Boolean) ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
