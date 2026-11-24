#!/usr/bin/env node
/**
 * Holds the CLI to its start-up budgets.
 *
 * First, the answer-only invocations:
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
 * Then every command the program defines must print its first line within
 * 1 s, by the same measure, run in a throwaway SQLite project brought in step
 * with its migrations, with arguments it accepts from the table the program's
 * own test uses (`first-line-invocations.ts`). A command missing from that
 * table fails the check, so a new command cannot ship untimed. Each run is
 * stopped at its first line that is not blank, so what the command would go
 * on to do never happens, and each that takes `--dry-run` is run with it. The
 * line must be the one the command declared (the `Database: …` line or its
 * start line), so a stray warning or Commander's refusal of the arguments
 * does not pass as a fast answer.
 *
 * Run after the build: `node scripts/check-cli-startup.mjs`.
 */
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { tsImport } from "tsx/esm/api";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE = join(ROOT, "packages", "nextly");
const BIN = join(PACKAGE, "dist", "cli", "nextly.mjs");
// The program and the helpers that list and judge its invocations, in one
// module, so the first-line declarations the program records are the ones
// the judge reads.
const SOURCE = join(
  PACKAGE,
  "src",
  "cli",
  "__tests__",
  "helpers",
  "startup-checks.ts"
);

const BUDGET_MS = 500;
// A command's first line, which it prints before its own code loads.
const FIRST_LINE_BUDGET_MS = 1000;
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
  const source = await tsImport(pathToFileURL(SOURCE).href, import.meta.url);
  const { createProgram } = source;
  return {
    invocations: source.answerOnlyInvocations(createProgram()),
    wrongAnswer: source.wrongAnswer,
    // Throws naming a command the table leaves out: the check fails on it.
    commands: source.firstLineInvocations(createProgram()),
    firstLineHelpers: {
      firstNonBlankLine: source.firstNonBlankLine,
      // The line each command declared, as the program's own test judges it.
      wrongFirstLine: (args, line) => {
        const program = createProgram();
        return source.wrongFirstLine(
          program,
          source.commandPathOf(program, args),
          line
        );
      },
    },
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

/**
 * The environment every command runs with: the project's own database, never
 * one the runner's shell names, and the telemetry consent kept in a folder of
 * the check's own rather than the user's configuration folder.
 */
function commandEnvironment(scratch) {
  const env = {
    ...process.env,
    NEXTLY_TELEMETRY_DISABLED: "1",
    XDG_CONFIG_HOME: join(scratch, "config"),
  };
  delete env.DATABASE_URL;
  delete env.DB_DIALECT;
  return env;
}

/**
 * A SQLite project in `scratch`, its database brought in step with its
 * migrations, as `migrate:create` and `migrate` leave it. Its configuration
 * imports nothing, so it loads from a folder outside the repository.
 */
function makeProject(scratch, env) {
  const project = join(scratch, "project");
  mkdirSync(project);
  writeFileSync(
    join(project, "nextly.config.ts"),
    [
      "export default {",
      '  db: { migrationsDir: "./migrations" },',
      '  collections: [{ slug: "fl_posts", fields: [{ name: "title", type: "text" }] }],',
      "};",
      "",
    ].join("\n")
  );
  writeFileSync(
    join(project, ".env"),
    "DB_DIALECT=sqlite\nDATABASE_URL=file:./startup.db\n"
  );
  writeFileSync(
    join(project, "package.json"),
    '{ "name": "startup-project", "private": true }\n'
  );
  for (const args of [
    ["migrate:create", "--name", "start", "--non-interactive"],
    ["migrate", "--non-interactive"],
  ]) {
    const run = spawnSync(process.execPath, [BIN, ...args], {
      cwd: project,
      encoding: "utf8",
      env,
      timeout: 120_000,
    });
    if (run.status !== 0) {
      throw new Error(
        `The project could not be set up (nextly ${args[0]}, exit ${String(run.status)}):\n${run.stderr}${run.stdout}`
      );
    }
  }
  return project;
}

/**
 * One run of `args` in `project`, stopped at its first line that is not blank:
 * the time to that line in milliseconds and the line, or why it ended without
 * one.
 */
function timedToFirstLine(args, project, env, firstNonBlankLine) {
  return new Promise(resolve => {
    const started = process.hrtime.bigint();
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd: project,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output = { stdout: "", stderr: "" };
    let settled = false;
    const settle = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      resolve(result);
    };
    const timer = setTimeout(
      () => settle({ failure: `no line within ${RUN_TIMEOUT_MS} ms` }),
      RUN_TIMEOUT_MS
    );
    for (const stream of ["stdout", "stderr"]) {
      child[stream].on("data", chunk => {
        output[stream] += String(chunk);
        const line = firstNonBlankLine(output[stream]);
        if (line === undefined) return;
        const ms = Number(process.hrtime.bigint() - started) / 1e6;
        settle({ ms, line });
      });
    }
    child.on("error", error => settle({ failure: error.message }));
    // `close`, not `exit`: it comes once both streams have delivered all they
    // hold, so a command that prints its line and exits at once is not taken
    // for one that printed nothing.
    child.on("close", code =>
      settle({ failure: `ended (exit ${String(code)}) without a line` })
    );
  });
}

/**
 * `args` run `RUNS` times in `project`, each to its first line: the reason it
 * failed (a run without a line, a refusal, or a median over the budget), or
 * `undefined`.
 */
async function measureFirstLine(args, project, env, helpers) {
  const name = `nextly ${args.join(" ")}`;
  const times = [];
  for (let index = 0; index < RUNS; index += 1) {
    const run = await timedToFirstLine(
      args,
      project,
      env,
      helpers.firstNonBlankLine
    );
    const wrong = run.failure ?? helpers.wrongFirstLine(args, run.line);
    if (wrong) return `${name}: ${wrong}`;
    times.push(run.ms);
  }
  const answer = median(times);
  const over = answer > FIRST_LINE_BUDGET_MS;
  console.log(
    `${over ? "FAIL" : "ok  "} ${answer.toFixed(0).padStart(5)} ms  ${name}`
  );
  return over
    ? `${name}: first line after ${answer.toFixed(0)} ms (median), over ${FIRST_LINE_BUDGET_MS} ms`
    : undefined;
}

/** The answer-only invocations, each timed in an empty folder: the failures. */
function answerOnlyFailures(invocations, wrongAnswer) {
  console.log(
    `answer-only invocations: ${invocations.length}, ${RUNS} runs each, budget ${BUDGET_MS} ms (median)`
  );
  const folder = mkdtempSync(join(tmpdir(), "nextly-startup-"));
  try {
    return invocations
      .map(args => measure(args, folder, wrongAnswer))
      .filter(failure => failure !== undefined);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

/** Every command, each timed to its first line in a project in step: the failures. */
async function firstLineFailures(commands, helpers) {
  console.log(
    `\ncommands: ${commands.length}, ${RUNS} runs each to the first line, budget ${FIRST_LINE_BUDGET_MS} ms (median)`
  );
  const scratch = mkdtempSync(join(tmpdir(), "nextly-first-line-"));
  try {
    const env = commandEnvironment(scratch);
    const project = makeProject(scratch, env);
    const failures = [];
    for (const args of commands) {
      const failure = await measureFirstLine(args, project, env, helpers);
      if (failure !== undefined) failures.push(failure);
    }
    return failures;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

async function main() {
  if (!existsSync(BIN)) {
    console.error(`No built CLI at ${BIN}: build nextly first.`);
    process.exit(1);
  }
  const { invocations, wrongAnswer, commands, firstLineHelpers } =
    await loadSource();
  const failures = [
    ...answerOnlyFailures(invocations, wrongAnswer),
    ...(await firstLineFailures(commands, firstLineHelpers)),
  ];
  if (failures.length > 0) {
    console.error(`\n${failures.length} start-up check(s) failed:`);
    for (const failure of failures) console.error(`  ${failure}`);
    process.exit(1);
  }
  console.log(
    "\nEvery answer-only invocation and every command's first line is within its budget."
  );
}

await main();
