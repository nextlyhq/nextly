#!/usr/bin/env node

/**
 * The local gates must declare how much of the machine they may take.
 *
 * 🔴 Unbounded, `.husky/pre-push` exhausts an ordinary development machine, and
 * the arithmetic is the finding rather than an estimate. Turbo's
 * `--concurrency` defaults to 10. Vitest's `maxWorkers` defaults to
 * `os.availableParallelism()` when watch mode is off, and 23 of the 24 packages
 * declaring a `test` script set no cap of their own. Ten packages times eight
 * cores is up to 80 concurrent Node processes, each carrying a V8 heap. Once
 * memory runs out the kernel kills processes rather than slowing down, and what
 * it picks is not necessarily the build — an init or session daemon going first
 * takes the whole desktop with it.
 *
 * The comment explaining that lives in the hook, and a comment is not a
 * control: the next person to add a turbo invocation there will not read it.
 * This is the control. It asserts the bounds exist, and that they are
 * established BEFORE anything they are meant to bound.
 *
 * What it deliberately does NOT assert is the VALUE. A machine with headroom
 * should be free to raise it, and a check that pins the number would make the
 * documented override a violation.
 *
 * Usage:
 *   node scripts/check-local-gate-bounds.mjs
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The hook whose resource usage is bounded. */
export const HOOK = ".husky/pre-push";

/**
 * Root scripts that run the heavy tasks locally, and must carry the same bound.
 *
 * Two places now decide how much of the machine a local run may take — the
 * hook and these scripts — which is a derived view of one decision and the
 * kind that drifts silently. Holding both to the same assertion is what stops
 * `verify:pr` quietly becoming the unbounded path the hook stopped being.
 */
export const BOUNDED_SCRIPTS = ["verify:pr", "verify:full"];

/** The runner that derives the limits and applies them to every phase. */
export const BOUNDED_RUNNER = "scripts/verify.mjs";

/**
 * What every heavy command runs through: the derived limits, the machine-wide
 * heavy slot, a process group of its own, and a stop when whatever started it
 * is gone (`scripts/bounded.mjs`).
 */
export const HEAVY_RUNNER = "scripts/bounded.mjs";

/**
 * Root scripts that run heavy work, each of which must run it through
 * {@link HEAVY_RUNNER}.
 *
 * 🔴 These are the commands agents are TOLD to run, and until this list existed
 * they were the unbounded ones: `pnpm test` was a bare `turbo run test`, turbo's
 * default of 10 package tasks times one Vitest worker per core — the arithmetic
 * the hook's bound exists to stop, one command away from it.
 *
 * `test:watch` and `test:ui` are deliberately absent: they are interactive and
 * long-lived, and one holding the machine's only heavy slot would block every
 * other checkout for as long as it stayed open.
 */
export const HEAVY_SCRIPTS = [
  "build",
  "build:all",
  "check-types",
  "lint",
  "lint:fix",
  "test",
  "test:unit",
  "test:coverage",
  "test:scripts",
  "test:integration",
  "test:integration:postgres15",
  "test:integration:postgres17",
  "test:integration:mysql",
  "test:integration:sqlite",
  "verify:pr",
  "verify:full",
];

/**
 * Whether the delegated runner actually applies the bounds it is trusted for.
 *
 * 🔴 Accepting `node scripts/verify.mjs` on the strength of the filename means
 * the runner could drop its concurrency environment or its worker flag and
 * both entry points would still be certified clean — a control that cannot
 * enforce the rule it names. The filename is a claim; these are the two
 * properties that make it true.
 */
export function runnerProblems(source, phases = null) {
  const problems = [];
  // Comments stripped first: this module's own header names the variable, and
  // a guard that its subject's prose can satisfy is checking the wrong thing.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
  if (!/TURBO_CONCURRENCY:/.test(code)) {
    problems.push(
      `${BOUNDED_RUNNER}: does not set TURBO_CONCURRENCY on the commands it spawns`
    );
  }

  // 🔴 Grepping the source for one `--maxWorkers=` was the first version, and
  // one occurrence anywhere satisfied it — so a SECOND phase could run vitest
  // uncapped while the runner reported the smaller derived number. The phases
  // are asked for instead, and every one that runs tests is held to the cap.
  if (phases === null) {
    if (!/--maxWorkers=/.test(source)) {
      problems.push(`${BOUNDED_RUNNER}: does not pass --maxWorkers to any test phase`);
    }
    return problems;
  }

  for (const phase of phases) {
    const argv = phase.argv.join(" ");
    // 🔴 Matching a standalone `test` token alone skipped the phase that
    // invokes vitest DIRECTLY — `exec vitest run --dir scripts` contains no
    // such token, so the one phase whose cap is not carried by turbo was the
    // one phase never checked. Verified: removing its cap reported zero
    // problems. The runner is named as well as the task.
    if (!/\btest\b/.test(argv) && !/\bvitest\b/.test(argv)) continue;
    if (!/--maxWorkers=/.test(argv)) {
      problems.push(
        `${BOUNDED_RUNNER}: phase '${phase.name}' runs tests without --maxWorkers — '${argv}'`
      );
    }
  }
  return problems;
}

/**
 * Lines that invoke turbo, with the line number, comments and strings removed.
 *
 * A `#` comment is dropped first, because this file's own explanation NAMES
 * every command it is looking for — scanning the raw text would find the prose
 * and report the hook as bounded on the strength of a paragraph about
 * boundedness. That is the shape the `auditing-an-instrument` skill collects:
 * an instrument reading something adjacent to its subject.
 */
export function turboInvocations(script) {
  const found = [];
  script.split("\n").forEach((raw, index) => {
    const line = raw.replace(/#.*$/, "").trim();
    if (!/(^|\s|;)(pnpm\s+)?turbo\s/.test(line) && !/pnpm\s+run\s+build\b/.test(line)) return;
    found.push({ line: index + 1, text: line });
  });
  return found;
}

/**
 * The line on which the hook hands its gates to {@link HEAVY_RUNNER}, or null.
 *
 * The hook re-runs itself under the runner, so what follows the hand-over is
 * what takes the heavy slot and dies with a killed push. A turbo invocation
 * ABOVE it would run before either is in place.
 */
export function handoverLine(script) {
  const found = codeLines(script).find(({ text }) => /^exec\s+node\s+scripts\/bounded\.mjs\s/.test(text));
  return found ? found.line : null;
}

/** Each line with its number, the `#` comment removed — prose is not a command. */
function codeLines(script) {
  return script.split("\n").map((raw, index) => ({ line: index + 1, text: raw.replace(/#.*$/, "").trim() }));
}

/** The line that exports turbo's concurrency variable, or null. */
export function concurrencyExportLine(script) {
  const lines = script.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].replace(/#.*$/, "").trim();
    // `export VAR=value` in one statement. The `=` is required: a bare
    // `export TURBO_CONCURRENCY` exports an unset variable, which turbo reads
    // as absent and answers with its default of 10 — a hook that looks bounded
    // and is not.
    if (/^export\s+TURBO_CONCURRENCY=\S/.test(line)) return i + 1;
    // `VAR=value` on one line and `export VAR` on the next is the POSIX-portable
    // spelling, and the export is what makes it reach a child process.
    if (/^TURBO_CONCURRENCY=\S/.test(line)) {
      for (let j = i + 1; j < lines.length; j += 1) {
        const next = lines[j].replace(/#.*$/, "").trim();
        if (/^export\s+TURBO_CONCURRENCY\b/.test(next)) return j + 1;
        if (next !== "") break;
      }
    }
  }
  return null;
}

/**
 * Every problem with the bounds, as messages.
 *
 * Both halves are needed and they fail differently. Without the export, turbo
 * runs ten package tasks at once. Without `--maxWorkers`, each of those tasks
 * spawns one Vitest worker per core. Either alone still multiplies into the
 * OOM, so neither is optional.
 */
export function boundsProblems(script) {
  const problems = [];
  const invocations = turboInvocations(script);

  // Population first: a scan that found no invocation reports no problem,
  // which is byte-identical to a hook that is correctly bounded.
  if (invocations.length === 0) {
    return [
      `${HOOK}: no turbo invocation found — NOT CHECKABLE, which is not clean`,
    ];
  }

  const exported = concurrencyExportLine(script);
  if (exported === null) {
    problems.push(
      `${HOOK}: TURBO_CONCURRENCY is never exported, so turbo runs its default of 10 package tasks at once`
    );
  } else {
    // Establishing the bound AFTER the command it bounds is the same as not
    // establishing it, and reads as correct in a diff.
    for (const { line, text } of invocations) {
      if (line < exported) {
        problems.push(
          `${HOOK}:${line}: runs turbo before TURBO_CONCURRENCY is exported on line ${exported} — '${text}'`
        );
      }
    }
  }

  for (const { line, text } of invocations) {
    if (!/\bturbo\s+(run\s+)?test\b/.test(text)) continue;
    if (!/--maxWorkers/.test(text)) {
      problems.push(
        `${HOOK}:${line}: runs tests without forwarding --maxWorkers, so each package spawns one Vitest worker per core — '${text}'`
      );
    }
  }

  return problems;
}

/**
 * Problems with the bounded root scripts.
 *
 * `verify:full` delegates to `verify:pr`, so a script that only composes
 * already-bounded ones needs no bound of its own; requiring one there would
 * make the honest spelling a violation.
 */
export function scriptProblems(scripts) {
  const problems = [];
  for (const name of BOUNDED_SCRIPTS) {
    const body = scripts[name];
    if (body === undefined) {
      problems.push(`package.json: '${name}' is missing, so there is no bounded local entry point`);
      continue;
    }
    // Delegating to the bounded runner IS the bound: it derives the limits
    // from the machine and applies them to every phase it spawns. Requiring
    // the variable inline as well would reward restating the limit in a second
    // place, which is the drift this file exists to stop.
    if (new RegExp(`node\\s+${BOUNDED_RUNNER}`).test(body)) continue;
    // Composing another already-bounded script is equally fine.
    if (BOUNDED_SCRIPTS.some(other => other !== name && body.includes(`pnpm ${other}`))) continue;

    if (!/TURBO_CONCURRENCY=/.test(body)) {
      problems.push(
        `package.json: '${name}' runs turbo without setting TURBO_CONCURRENCY or delegating to ${BOUNDED_RUNNER}`
      );
    }
    if (/turbo run test|turbo test/.test(body) && !/--maxWorkers/.test(body)) {
      problems.push(`package.json: '${name}' runs tests without capping --maxWorkers`);
    }
  }
  return problems;
}

/**
 * Problems with how the hook hands its gates to {@link HEAVY_RUNNER}.
 *
 * Separate from {@link boundsProblems} because it is a different property:
 * those bound how MUCH of the machine a run takes, this is what makes it take
 * turns with other checkouts and stop when its push is killed. A hook can have
 * either without the other.
 */
export function handoverProblems(script) {
  const handover = handoverLine(script);
  if (handover === null) {
    return [
      `${HOOK}: never hands its gates to ${HEAVY_RUNNER}, so they take no heavy slot and outlive a killed push`,
    ];
  }
  return turboInvocations(script)
    .filter(({ line }) => line < handover)
    .map(
      ({ line, text }) =>
        `${HOOK}:${line}: runs turbo before handing over to ${HEAVY_RUNNER} on line ${handover} — '${text}'`
    );
}

/**
 * Problems with the heavy root scripts: each must run through
 * {@link HEAVY_RUNNER}, and one that runs tests must hand it the worker cap.
 *
 * The runner is required as the COMMAND — `node scripts/bounded.mjs` first,
 * after any environment assignments — because an occurrence anywhere else in
 * the body, as an argument or in an echo, would satisfy a looser match without
 * bounding anything.
 */
export function heavyScriptProblems(scripts) {
  return HEAVY_SCRIPTS.map(name => heavyScriptProblem(name, scripts[name])).filter(Boolean);
}

/** The runner, as the command itself. */
const RUNS_BOUNDED = /^node\s+scripts\/bounded\.mjs(\s|$)/;

/**
 * The runner's worker-cap flag, in the one position the runner reads it: first.
 * Anywhere else it is handed to turbo, and Vitest runs uncapped.
 */
const CAPS_WORKERS = /^node\s+scripts\/bounded\.mjs\s+--vitest-workers(\s|$)/;

/**
 * Shell syntax that runs a second command. `bounded … && turbo run build`
 * starts with the runner and then runs the build outside it — no slot and no
 * bound — so a heavy script is one command, and composes bounded scripts
 * rather than commands if it needs more.
 */
const COMPOSES = /[;&|`\n]|\$\(/;

/** What is wrong with one heavy script, or null. */
function heavyScriptProblem(name, body) {
  if (body === undefined) {
    return `package.json: '${name}' is missing — update HEAVY_SCRIPTS if it was removed on purpose`;
  }
  // The integration legs set their database URL for the whole run with an
  // assignment in front of the command.
  return commandProblem(name, body.replace(/^(\s*[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*/, ""));
}

function commandProblem(name, command) {
  if (!RUNS_BOUNDED.test(command)) {
    return `package.json: '${name}' runs heavy work without ${HEAVY_RUNNER}, so it takes no heavy slot and turbo runs its default of 10 package tasks`;
  }
  if (COMPOSES.test(command)) {
    return `package.json: '${name}' runs a second command after ${HEAVY_RUNNER}, outside its slot and its bounds`;
  }
  if (missesWorkerCap(command)) {
    return `package.json: '${name}' runs tests without --vitest-workers straight after ${HEAVY_RUNNER}, so Vitest spawns one worker per core`;
  }
  return null;
}

function missesWorkerCap(command) {
  return /\bturbo\s+run\s+test\S*|\bvitest\b/.test(command) && !CAPS_WORKERS.test(command);
}

async function main() {
  const script = readFileSync(join(root, HOOK), "utf8");
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const runner = existsSync(join(root, BOUNDED_RUNNER))
    ? readFileSync(join(root, BOUNDED_RUNNER), "utf8")
    : null;
  // The phases as the runner actually builds them, rather than as its source
  // text reads. A grep cannot tell which phase an occurrence belongs to.
  let runnerPhases = null;
  if (runner !== null) {
    const { phasesFor } = await import("./verify.mjs");
    runnerPhases = [
      ...phasesFor("pr", { concurrency: 2, maxWorkers: 2 }),
      ...phasesFor("full", { concurrency: 2, maxWorkers: 2 }),
    ];
  }
  const problems = [
    ...boundsProblems(script),
    ...handoverProblems(script),
    ...scriptProblems(manifest.scripts ?? {}),
    ...heavyScriptProblems(manifest.scripts ?? {}),
    ...(existsSync(join(root, HEAVY_RUNNER))
      ? []
      : [`${HEAVY_RUNNER}: missing, but the heavy root scripts and the hook run through it`]),
    // A missing runner is not a pass: the scripts delegate to it.
    ...(runner === null
      ? [`${BOUNDED_RUNNER}: missing, but the root scripts delegate their bounds to it`]
      : runnerProblems(runner, runnerPhases)),
  ];

  if (problems.length > 0) {
    // Verdict first: a refusal printed under a reader's `head` is a refusal
    // nobody saw.
    console.error(`local-gate-bounds: FAIL — ${problems.length} unbounded gate(s)`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }

  const invocations = turboInvocations(script);
  console.log(
    `local-gate-bounds: OK — ${invocations.length} turbo invocation(s) in ${HOOK} ` +
      `and ${HEAVY_SCRIPTS.length} heavy root script(s), all bounded`
  );
}

if (process.argv[1] && resolve(process.argv[1]).endsWith("check-local-gate-bounds.mjs")) {
  await main();
}
