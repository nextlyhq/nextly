#!/usr/bin/env node
/**
 * Holds the CLI's answer-only invocations to their start-up budget.
 *
 * `nextly --version`, `nextly --help`, an unknown command and every command's
 * `--help` must answer within 500 ms: the median of 10 runs of the built bin,
 * started with node directly, in an empty folder. The commands come from the
 * program's own list, so a command is timed by being defined, and its help
 * cannot ship untimed.
 *
 * Each answer is also checked for what it is (help or a version on stdout and
 * exit 0, or the unknown command refused), so a bin that fails fast does not
 * pass as one that answers fast.
 *
 * Run after the build: `node scripts/check-cli-startup.mjs`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { tsImport } from "tsx/esm/api";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE = join(ROOT, "packages", "nextly");
const BIN = join(PACKAGE, "dist", "cli", "nextly.mjs");
const PROGRAM = join(PACKAGE, "src", "cli", "program.ts");

const HELPERS = join(
  PACKAGE,
  "src",
  "cli",
  "__tests__",
  "helpers",
  "answer-only-invocations.ts"
);

const BUDGET_MS = 500;
const RUNS = 10;
// One run that takes this long has hung: an answer is a few hundred ms.
const RUN_TIMEOUT_MS = 10_000;

/**
 * The program and the helpers that list its answer-only invocations and judge
 * each answer, read from the source through the TypeScript loader the package
 * already uses: the same helpers the test that holds these invocations to
 * reading nothing uses.
 */
async function loadSource() {
  const [{ createProgram }, helpers] = await Promise.all([
    tsImport(pathToFileURL(PROGRAM).href, import.meta.url),
    tsImport(pathToFileURL(HELPERS).href, import.meta.url),
  ]);
  return {
    invocations: helpers.answerOnlyInvocations(createProgram()),
    wrongAnswer: helpers.wrongAnswer,
  };
}

/** One run of the built bin in `folder`, with its wall time in milliseconds. */
function timed(args, folder) {
  const started = process.hrtime.bigint();
  const run = spawnSync(process.execPath, [BIN, ...args], {
    cwd: folder,
    encoding: "utf8",
    env: { ...process.env, NEXTLY_TELEMETRY_DISABLED: "1" },
    timeout: RUN_TIMEOUT_MS,
  });
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  return { ms, run };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

/** Why a run that did not finish failed, or `undefined` when it finished. */
function unfinished(run) {
  if (run.error) return `did not finish: ${run.error.message}`;
  if (run.signal) return `stopped by ${run.signal}`;
  return undefined;
}

/**
 * `args` run `RUNS` times in `folder`: the reason it failed (a wrong answer,
 * a run that did not finish, or a median over the budget), or `undefined`.
 */
function measure(args, folder, wrongAnswer) {
  const name = `nextly ${args.join(" ")}`;
  const times = [];
  for (let index = 0; index < RUNS; index += 1) {
    const { ms, run } = timed(args, folder);
    const wrong = unfinished(run) ?? wrongAnswer(args, run);
    if (wrong) return `${name}: ${wrong}`;
    times.push(ms);
  }
  const answer = median(times);
  const over = answer > BUDGET_MS;
  console.log(
    `${over ? "FAIL" : "ok  "} ${answer.toFixed(0).padStart(5)} ms  ${name}`
  );
  return over
    ? `${name}: median ${answer.toFixed(0)} ms, over ${BUDGET_MS} ms`
    : undefined;
}

async function main() {
  if (!existsSync(BIN)) {
    console.error(`No built CLI at ${BIN}: build nextly first.`);
    process.exit(1);
  }
  const { invocations, wrongAnswer } = await loadSource();
  console.log(
    `answer-only invocations: ${invocations.length}, ${RUNS} runs each, budget ${BUDGET_MS} ms (median)`
  );
  const folder = mkdtempSync(join(tmpdir(), "nextly-startup-"));
  let failures;
  try {
    failures = invocations
      .map(args => measure(args, folder, wrongAnswer))
      .filter(failure => failure !== undefined);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
  if (failures.length > 0) {
    console.error(`\n${failures.length} answer-only invocation(s) failed:`);
    for (const failure of failures) console.error(`  ${failure}`);
    process.exit(1);
  }
  console.log("\nEvery answer-only invocation is within the budget.");
}

await main();
