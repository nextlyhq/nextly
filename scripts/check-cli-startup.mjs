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
 * Then every command that runs an action is timed until its own code has
 * loaded (`codeLoadInvocations`). Run with the start-up probe set
 * (`STARTUP_PROBE_ENV` in `cli/startup-probe.ts`), a command writes one line
 * once its action's module is imported and ends there, doing none of its
 * work. Each is run 5 times in the same project, and once more with a loader
 * hook that counts the modules it resolved. This pass reports and enforces no
 * budget yet, but a run must end with the line and the probe's own exit code
 * (`STARTUP_PROBE_EXIT`), or with exit 0 and no line; any other end fails the
 * check, as does a counting run that does not end with the line or writes no
 * count. A command that exits 0 without the line runs an action written inline
 * rather than through `lazyAction`: it is named as such and held to the
 * answer-only budget, so code that action imports for itself cannot load
 * untimed.
 *
 * Last, every command that declares it may reach a database, except one that
 * declares why it must not be run, is timed until it has connected
 * (`connectInvocations`), by the probe's second point. Code a
 * command imports after its own module, on the way to its database, is in this
 * time and not in the one before, so moving an import past the first point
 * does not read as a saving. Each command runs in a copy of the project of its own, on that
 * copy's SQLite file, which it is handed by an absolute URL: a run that stops
 * short of the connection goes on with its work, and must find no other
 * command's leftovers and no database but the copy. The pass reports, and
 * enforces no budget: a command that ends without connecting (it asked for
 * consent, or refused) is named as not reached, as are the commands it does
 * not run, each with why. A run that hangs, starts a package manager, or
 * connects without ending there fails the check, and so does a pass in which
 * no command connects.
 *
 * Run after the build: `node scripts/check-cli-startup.mjs`.
 */
import { spawn, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";

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
// A command's own code, timed to the line it writes once that code has loaded.
const CODE_LOAD_RUNS = 5;
// One load that takes this long has hung: the heaviest takes a few seconds.
const CODE_LOAD_TIMEOUT_MS = 60_000;
// The one dialect the connect pass runs on, whose database is a file of its own.
const CONNECT_DIALECT = "sqlite";
// What a command could install a package with, stood in for in the connect pass.
const PACKAGE_MANAGERS = [
  "npm",
  "npx",
  "pnpm",
  "pnpx",
  "yarn",
  "bun",
  "bunx",
  "corepack",
];
// The variable that names the file a stand-in notes itself in, and its exit code.
const NOTES_ENV = "NEXTLY_STARTUP_CHECK_NOTES";
const STUB_EXIT = 99;
// The file of the project's database, within it.
const PROJECT_DATABASE = "startup.db";
// The line the module-counting hook writes as a run ends.
const MODULES_LINE = "nextly: modules resolved ";
// Loaded with `--import` into the counting run only, so the timed runs carry
// no hook: every module the run resolved from a file, written as it exits.
// Written straight to the file descriptor, since nothing written through a
// stream after `exit` is waited for.
const MODULE_COUNT_HOOK = `data:text/javascript,${encodeURIComponent(
  [
    'import { writeSync } from "node:fs";',
    'import { registerHooks } from "node:module";',
    "const seen = new Set();",
    "registerHooks({ resolve(specifier, context, next) {",
    "  const resolved = next(specifier, context);",
    '  if (!resolved.url.startsWith("node:")) seen.add(resolved.url);',
    "  return resolved;",
    "} });",
    `process.on("exit", () => writeSync(2, ${JSON.stringify(MODULES_LINE)} + seen.size + "\\n"));`,
  ].join("\n")
)}`;

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
    // Every command that runs an action, and the variants timed beside them.
    codeLoads: source.codeLoadInvocations(createProgram()),
    // Every command timed to its connection, and those that are not, each with why.
    connects: source.connectInvocations(createProgram()),
    // The variable that stops a run at a named point, and the line it writes at each.
    probe: {
      env: source.STARTUP_PROBE_ENV,
      lines: source.STARTUP_PROBE_LINES,
      // The code a run the probe stopped exits with, which no command uses otherwise.
      exit: source.STARTUP_PROBE_EXIT,
    },
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
    `DB_DIALECT=sqlite\nDATABASE_URL=file:./${PROJECT_DATABASE}\n`
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
async function firstLineFailures(commands, helpers, { project, env }) {
  console.log(
    `\ncommands: ${commands.length}, ${RUNS} runs each to the first line, budget ${FIRST_LINE_BUDGET_MS} ms (median)`
  );
  const failures = [];
  for (const args of commands) {
    const failure = await measureFirstLine(args, project, env, helpers);
    if (failure !== undefined) failures.push(failure);
  }
  return failures;
}

/** One run of `args` under the start-up probe's `point`, with its wall time in milliseconds. */
function probed(args, { project, env }, probe, point, nodeArgs = []) {
  const started = process.hrtime.bigint();
  const run = spawnSync(process.execPath, [...nodeArgs, BIN, ...args], {
    cwd: project,
    encoding: "utf8",
    env: { ...env, [probe.env]: point },
    timeout: CODE_LOAD_TIMEOUT_MS,
  });
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  return { ms, run };
}

/** The last lines a run wrote that are not blank, on one line, its colour codes removed. */
function lastSaid(run) {
  return stripVTControlCharacters(run.stderr || run.stdout)
    .split("\n")
    .map(line => line.trim())
    .filter(line => line !== "")
    .slice(-3)
    .join(" / ");
}

/** Whether a probed run wrote the line of `point`. */
function wroteLine(run, probe, point) {
  return run.stderr.split("\n").some(line => line === probe.lines[point]);
}

/**
 * How a probed run ended: `loaded` once it wrote the probe's line and exited
 * with the probe's code, `none` when it exited 0 without the line (its action
 * is written inline), or why it failed.
 */
function probedOutcome(run, probe) {
  const failed = unfinished(run);
  if (failed) return { failure: failed };
  const loaded = wroteLine(run, probe, "loaded");
  if (loaded && run.status === probe.exit) return { kind: "loaded" };
  if (!loaded && run.status === 0) return { kind: "none" };
  return {
    failure: `ended (exit ${String(run.status)}) without loading: ${lastSaid(run)}`,
  };
}

/**
 * The modules a run of `args` resolved from files before its code had loaded,
 * or why the counting run does not say: it must end as the timed runs did,
 * since the hook writes its count however a run ends.
 */
function modulesResolved(args, where, probe) {
  const { run } = probed(args, where, probe, "loaded", [
    "--import",
    MODULE_COUNT_HOOK,
  ]);
  const outcome = probedOutcome(run, probe);
  if (outcome.failure)
    return { failure: `the counting run ${outcome.failure}` };
  if (outcome.kind !== "loaded") {
    return { failure: "the counting run ended before its code loaded" };
  }
  const line = run.stderr
    .split("\n")
    .find(text => text.startsWith(MODULES_LINE));
  return line === undefined
    ? { failure: "the counting run wrote no module count" }
    : { count: Number(line.slice(MODULES_LINE.length)) };
}

/**
 * `args` run `CODE_LOAD_RUNS` times under the probe: its times and how every
 * run ended (`loaded` or `none`, the same each time), or why one failed.
 */
function probedRuns(args, where, probe) {
  const times = [];
  const kinds = new Set();
  for (let index = 0; index < CODE_LOAD_RUNS; index += 1) {
    const { ms, run } = probed(args, where, probe, "loaded");
    const outcome = probedOutcome(run, probe);
    if (outcome.failure) return { failure: outcome.failure };
    kinds.add(outcome.kind);
    times.push(ms);
  }
  if (kinds.size > 1) return { failure: "loaded its code in some runs only" };
  return { times, kind: [...kinds][0] };
}

/**
 * An action written inline, which exits without the probe's line: held to the
 * answer-only budget, since nothing times what it imports for itself.
 */
function inlineActionFailure(name, ms) {
  const over = ms > BUDGET_MS;
  console.log(
    `${over ? "FAIL" : "ok  "} ${ms.toFixed(0).padStart(5)} ms                ${name}  (inline action, loads no code of its own)`
  );
  return over
    ? `${name}: an inline action ran ${ms.toFixed(0)} ms (median), over ${BUDGET_MS} ms; load its code through lazyAction`
    : undefined;
}

/**
 * `args` timed `CODE_LOAD_RUNS` times to its code loaded, and its modules
 * counted: the reason it failed, or `undefined`. The times are reported, not
 * judged, except an inline action's.
 */
function measureCodeLoad(args, where, probe) {
  const name = `nextly ${args.join(" ")}`;
  const runs = probedRuns(args, where, probe);
  if (runs.failure) return `${name}: ${runs.failure}`;
  const ms = median(runs.times);
  if (runs.kind === "none") return inlineActionFailure(name, ms);
  const modules = modulesResolved(args, where, probe);
  console.log(
    `     ${ms.toFixed(0).padStart(5)} ms  ${String(modules.count ?? "?").padStart(5)} modules  ${name}`
  );
  return modules.failure ? `${name}: ${modules.failure}` : undefined;
}

/** Every command that runs an action, each timed to its code loaded: the failures. */
function codeLoadFailures(runs, where, probe) {
  console.log(
    `\ncode loads: ${runs.length}, ${CODE_LOAD_RUNS} runs each to the line written once a command's code has loaded (median); reported, no budget yet`
  );
  return runs
    .map(args => measureCodeLoad(args, where, probe))
    .filter(failure => failure !== undefined);
}

/**
 * A folder of stand-ins for the package managers, each of which notes its name
 * in the file `NOTES_ENV` names and fails: a run that goes on to its work and
 * installs a package reaches a stand-in, and the note outlasts whatever the
 * run does with the stand-in's output.
 */
function packageManagerStubs(scratch) {
  const folder = join(scratch, "package-managers");
  mkdirSync(folder);
  for (const name of PACKAGE_MANAGERS) {
    writeFileSync(
      join(folder, name),
      `#!/bin/sh\necho ${name} >> "$${NOTES_ENV}"\nexit ${STUB_EXIT}\n`,
      { mode: 0o755 }
    );
  }
  return folder;
}

/**
 * Throws where a package manager's name does not start its stand-in, such as
 * in a folder mounted so that nothing in it runs: the real one would be found
 * instead, and no run of the pass would be held to anything. `where` is one no
 * command runs in, so its notes hold only what is started here.
 */
function assertStubsAnswer({ env, notes }) {
  const answered = [];
  for (const name of PACKAGE_MANAGERS) {
    const run = spawnSync(name, ["--version"], { env, encoding: "utf8" });
    answered.push(name);
    if (run.status !== STUB_EXIT || notesOf(notes) !== answered.join(", ")) {
      throw new Error(
        `The connect pass could not stand in for ${name}, so it runs nothing.`
      );
    }
  }
}

/** The package managers noted in `notes`, or nothing. */
function notesOf(notes) {
  return existsSync(notes)
    ? readFileSync(notes, "utf8").trim().split("\n").join(", ")
    : "";
}

/**
 * A copy of the project as it was made, for one command of the connect pass, and the
 * environment that hands the command the copy's own database: its dialect and
 * an absolute URL, which win over the project's `.env` and over anything the
 * shell names.
 */
function connectWhere({ pristine, env, stubs }, index) {
  const copy = `${pristine}-${String(index)}`;
  const notes = `${copy}-package-managers`;
  cpSync(pristine, copy, { recursive: true });
  const database = join(copy, PROJECT_DATABASE);
  return {
    project: copy,
    database,
    env: {
      ...env,
      DB_DIALECT: CONNECT_DIALECT,
      DATABASE_URL: `file:${database}`,
      // Found before the real ones, so no run of this pass installs anything.
      PATH: `${stubs}${delimiter}${env.PATH ?? ""}`,
      [NOTES_ENV]: notes,
    },
    notes,
  };
}

/**
 * Throws where the database `where` hands a command is not the copy's own
 * SQLite file. Asked before each run, so whatever sets the environment up, no
 * run of this pass opens a server's database: a PostgreSQL connection made
 * with a configured schema creates that schema.
 */
function assertThrowawayDatabase({ env, database }) {
  if (
    env.DB_DIALECT !== CONNECT_DIALECT ||
    env.DATABASE_URL !== `file:${database}` ||
    !existsSync(database)
  ) {
    throw new Error(
      `The connect pass runs only on a throwaway SQLite file, not on ${String(env.DB_DIALECT)}.`
    );
  }
}

/**
 * How a run ended under the probe's connected point: `connected`, `short` when
 * it ended by itself before it connected, with what it said, or why it failed.
 */
function connectOutcome(run, probe) {
  const failed = unfinished(run);
  if (failed) return { failure: failed };
  const connected = wroteLine(run, probe, "connected");
  if (connected && !/^Database: SQLite /m.test(run.stderr)) {
    return { failure: "connected to a database it did not name as SQLite" };
  }
  if (connected && run.status === probe.exit) return { kind: "connected" };
  if (connected || run.status === probe.exit) {
    return {
      failure: `${connected ? "connected" : "did not connect"}, yet ended with exit ${String(run.status)}`,
    };
  }
  return {
    kind: "short",
    reason: `exit ${String(run.status)}: ${lastSaid(run)}`,
  };
}

/**
 * `args` timed `CODE_LOAD_RUNS` times to its connection, in `where`: whether
 * it connected, or the reason it failed. A run that ends before it connects
 * is reported once, since the runs after it would only end the same way.
 */
function measureConnect(args, where, probe) {
  const name = `nextly ${args.join(" ")}`;
  const times = [];
  for (let index = 0; index < CODE_LOAD_RUNS; index += 1) {
    assertThrowawayDatabase(where);
    const { ms, run } = probed(args, where, probe, "connected");
    const outcome = connectOutcome(run, probe);
    if (outcome.failure) return { failure: `${name}: ${outcome.failure}` };
    if (outcome.kind === "short") {
      if (times.length > 0)
        return { failure: `${name}: connected in some runs only` };
      console.log(`     not reached  ${name}  (${outcome.reason})`);
      return { connected: false };
    }
    times.push(ms);
  }
  console.log(`     ${median(times).toFixed(0).padStart(5)} ms     ${name}`);
  return { connected: true };
}

/** Of `runs`, those that started a package manager, each with the names noted for it. */
function startedPackageManagers(runs) {
  return new Map(
    runs
      .map(run => [run, notesOf(run.ranIn.notes)])
      .filter(([, names]) => names !== "")
  );
}

/** Every command `connectInvocations` names, each timed to its connection: the failures. */
function connectFailures({ timed, untimed }, where, probe) {
  console.log(
    `\nconnections: ${timed.length}, ${CODE_LOAD_RUNS} runs each to the line written once a command has connected (median); reported, no budget yet`
  );
  // Starts every stand-in, so what reads the notes is always given some to find.
  const control = { args: [], ranIn: connectWhere(where, "stubs") };
  assertStubsAnswer(control.ranIn);
  const runs = timed.map((args, index) => ({
    args,
    ranIn: connectWhere(where, index),
  }));
  const results = runs.map(({ args, ranIn }) =>
    measureConnect(args, ranIn, probe)
  );
  const failures = results.flatMap(({ failure }) => failure ?? []);
  // Read once every run has ended: a run may start one that outlives it.
  const installers = startedPackageManagers([...runs, control]);
  if (!installers.has(control)) {
    failures.push(
      "the package managers the pass started itself went unnoticed, so it would notice none"
    );
  }
  for (const run of runs) {
    if (!installers.has(run)) continue;
    failures.push(
      `nextly ${run.args.join(" ")}: started a package manager (${installers.get(run)})`
    );
  }
  // A probe nothing reaches would otherwise read as commands that all ended early.
  if (!results.some(({ connected }) => connected)) {
    failures.push("no command connected, so the pass timed nothing");
  }
  for (const { name, why } of untimed) {
    console.log(`     not run      nextly ${name}  (${why})`);
  }
  return failures;
}

/** `work` given a throwaway SQLite project in step and the environment its commands run with. */
async function withProject(work) {
  const scratch = mkdtempSync(join(tmpdir(), "nextly-first-line-"));
  try {
    const env = commandEnvironment(scratch);
    const project = makeProject(scratch, env);
    // Kept as made: the runs of the other passes, stopped partway, leave marks.
    const pristine = `${project}-as-made`;
    cpSync(project, pristine, { recursive: true });
    const stubs = packageManagerStubs(scratch);
    return await work({ project, pristine, env, stubs });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

async function main() {
  if (!existsSync(BIN)) {
    console.error(`No built CLI at ${BIN}: build nextly first.`);
    process.exit(1);
  }
  const {
    invocations,
    wrongAnswer,
    commands,
    codeLoads,
    connects,
    probe,
    firstLineHelpers,
  } = await loadSource();
  const failures = [
    ...answerOnlyFailures(invocations, wrongAnswer),
    ...(await withProject(async where => [
      ...(await firstLineFailures(commands, firstLineHelpers, where)),
      ...codeLoadFailures(codeLoads, where, probe),
      ...connectFailures(connects, where, probe),
    ])),
  ];
  if (failures.length > 0) {
    console.error(`\n${failures.length} start-up check(s) failed:`);
    for (const failure of failures) console.error(`  ${failure}`);
    process.exit(1);
  }
  console.log(
    "\nEvery answer-only invocation and every command's first line is within its budget, every command's code load was timed, and so was every connection reached."
  );
}

await main();
