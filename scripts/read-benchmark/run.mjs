/**
 * The single-language read benchmark: list and detail reads, through the
 * Direct API and REST, on two storage modes of one site, on each database.
 * `--modes base,candidate` names them, from the fixture's: its translatable
 * fields on the main table (`main`, today), per language from the start as a
 * one-language translated site (`per-language`), or per language from the
 * start under the site-wide storage option (`e4`). Prints a table and a
 * verdict on the candidate against the base; `--out` keeps every measurement
 * as JSON.
 *
 *   node scripts/read-benchmark/run.mjs [--modes main,per-language]
 *     [--dialects sqlite,postgresql,mysql]
 *     [--runs 4] [--max-runs 6] [--docs 1000] [--iterations 3000] [--warmup 300]
 *     [--rest-iterations 600] [--seed 1] [--max-load <cores>] [--spread-limit 0.05]
 *     [--bound 10] [--save measurements.jsonl] [--out results.json]
 *
 * PostgreSQL and MySQL need TEST_POSTGRES_URL and TEST_MYSQL_URL, as the
 * integration tests do; each measurement creates its own database and drops it.
 * Build nextly and the adapters first: the measurement imports their dist.
 *
 * Noise on a shared machine is handled three ways. The modes alternate within
 * every run (A then B, then B then A), so drift over a run falls on both. Each
 * measurement waits until the one-minute load is at most `--max-load`, runs
 * under the heavy-job bound so no build or suite shares its slot, and is taken
 * again if the load ended above the limit. Runs are added, up to `--max-runs`,
 * while the p95s of a mode's runs spread by more than `--spread-limit`, and
 * always in pairs, so each mode is measured first as often as second.
 *
 * `--save` keeps every measurement as it is taken, and a run started again
 * with the same file, settings and code reuses what it holds, so a run stopped
 * part way loses at most the pair of measurements it was on: half a pair is
 * taken again whole, so its two modes are never measured in different sessions. A measurement whose process
 * fails (a dropped database connection, say) is taken again, like one taken
 * under too much load.
 */
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { availableParallelism, loadavg } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { isCliEntry } from "../cli-entry.mjs";

import { MODES } from "./fixture.mjs";
import { PAGE_SIZE } from "./measure.mjs";
import { keyFor, openSaved } from "./saved.mjs";
import { median, spread } from "./stats.mjs";
import { verdictFor } from "./verdict.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const MAX_RETAKES = 3;

/**
 * The two modes a run compares, base first, from `--modes base,candidate`: two
 * different modes the fixture knows, or nothing is measured. One alone has
 * nothing to compare with, and a mode against itself measures only noise.
 */
export function modePair(value) {
  const modes = String(value).split(",");
  if (modes.length !== 2 || modes[0] === modes[1] || !modes.every(mode => MODES.includes(mode))) {
    throw new RangeError(`--modes ${value} is not two different modes of ${MODES.join(", ")}`);
  }
  return modes;
}

/** The order a run measures `modes` in: A then B on even runs, B then A on odd ones. */
export function orderFor(runIndex, modes) {
  return runIndex % 2 === 0 ? [...modes] : [...modes].reverse();
}

/** Whether every read's p95 agrees across a database's runs, for each mode the runs hold. */
export function runsAgree(runs, spreadLimit) {
  const modes = Object.keys(runs[0]);
  const reads = Object.keys(runs[0][modes[0]].results);
  return reads.every(read => modes.every(mode => spread(runs.map(run => run[mode].results[read].p95)) <= spreadLimit));
}

/**
 * Whether a database needs another run: too few yet, an odd number, or runs
 * that disagree and room for more. An odd number measured one mode first once
 * more than the other, so a drift within each run would fall on one mode more.
 */
export function needsAnotherRun(runs, { minRuns, maxRuns, spreadLimit }) {
  if (runs.length < minRuns || runs.length % 2 === 1) return true;
  return runs.length < maxRuns && !runsAgree(runs, spreadLimit);
}

/** A whole number of at least `lowest`. */
const wholeFrom = lowest => [value => Number.isInteger(value) && value >= lowest, `a whole number from ${lowest}`];
/** A finite number above zero. */
const positive = [value => Number.isFinite(value) && value > 0, "a finite number above 0"];

/**
 * What each numeric option must be. Anything else would quietly turn a control
 * off: a negative warm-up does none, an infinite load limit or bound accepts
 * everything, and fewer articles than a page cannot fill one.
 */
const NUMBERS = {
  runs: wholeFrom(1),
  "max-runs": wholeFrom(2),
  docs: wholeFrom(PAGE_SIZE),
  iterations: wholeFrom(1),
  warmup: wholeFrom(0),
  "rest-iterations": wholeFrom(1),
  seed: wholeFrom(0),
  "max-load": positive,
  "spread-limit": positive,
  bound: positive,
};

/** Refuses a numeric option outside what it must be, before anything is measured or saved. */
export function checkNumbers(options) {
  for (const [name, [accepts, what]] of Object.entries(NUMBERS)) {
    if (!accepts(Number(options[name]))) throw new RangeError(`--${name} ${options[name]} is not ${what}`);
  }
}

/** Refuses run limits under which the runs could not end in balanced pairs. */
export function checkLimits({ minRuns, maxRuns }) {
  if (maxRuns % 2 === 1) throw new RangeError(`--max-runs ${maxRuns} is odd: runs come in pairs, each mode first once`);
  if (minRuns > maxRuns) throw new RangeError(`--runs ${minRuns} is above --max-runs ${maxRuns}`);
}

/** The settings every measurement in a report was taken with: the modes, and the rest as numbers. */
export function reportSettings(options) {
  const number = name => Number(options[name]);
  return {
    revision: options.revision,
    modes: modePair(options.modes),
    seed: number("seed"),
    docs: number("docs"),
    iterations: number("iterations"),
    warmup: number("warmup"),
    restIterations: number("rest-iterations"),
    maxLoad: number("max-load"),
  };
}

/** The call over every database's gating reads: pass, over or inconclusive. */
export function overallCall(dialects) {
  const gating = Object.values(dialects).flatMap(d => d.verdict.reads.filter(r => r.gates));
  if (gating.every(r => r.verdict === "pass")) return "pass";
  return gating.some(r => r.verdict === "over") ? "over" : "inconclusive";
}

/** The report as a Markdown table, one row per database and read, `modes` named as compared. */
export function tableLines(dialects, modes) {
  const [base, candidate] = modes;
  const ms = v => v.toFixed(2);
  const pct = v => `${(v * 100).toFixed(1)}%`;
  const lines = [
    `| Database | Read | ${base} p50 / p95 (median of runs) | ${candidate} p50 / p95 | p95 ratio | p95 spread (${base}, ${candidate}) | Verdict |`,
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const [dialect, { runs, verdict }] of Object.entries(dialects)) {
    for (const row of verdict.reads) {
      const at = (mode, stat) => median(runs.map(run => run[mode].results[row.read][stat]));
      lines.push(
        `| ${dialect} | ${row.read} | ${ms(at(base, "p50"))} / ${ms(at(base, "p95"))} ms | ${ms(at(candidate, "p50"))} / ${ms(at(candidate, "p95"))} ms | ${row.ratio.toFixed(3)} | ${pct(row.spread[base])}, ${pct(row.spread[candidate])} | ${row.verdict} |`
      );
    }
  }
  return lines;
}

/**
 * The code being measured: the commit, and a digest of what the benchmark and
 * the packages differ from it by, when they do. A saved file records it, so
 * measurements taken by other code are never mixed into one verdict. The
 * packages' builds are what run, so build them from this tree first.
 */
export function revisionOf(dir) {
  const git = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  const changes = git("diff", "HEAD", "--", "scripts/read-benchmark", "packages");
  const digest = changes === "" ? "" : `+${createHash("sha256").update(changes).digest("hex").slice(0, 12)}`;
  return `${git("rev-parse", "HEAD").trim()}${digest}`;
}

/** Whether a measurement's load was within the limit when it started and when it ended. */
export function withinLoad(result, maxLoad) {
  return result.loadStart <= maxLoad && result.loadEnd <= maxLoad;
}

/** Resolves once the one-minute load average is at most `maxLoad`. */
async function loadBelowLimit(maxLoad) {
  while (loadavg()[0] > maxLoad) {
    console.error(`  load ${loadavg()[0].toFixed(1)} is above ${maxLoad}; waiting`);
    await new Promise(resolve => setTimeout(resolve, 30_000));
  }
}

/** One measurement in its own process, under the heavy-job bound. */
function measure(dialect, mode, options) {
  const childArgs = [
    join(root, "scripts", "bounded.mjs"),
    "node",
    join(here, "measure.mjs"),
    ...["--mode", mode, "--dialect", dialect, "--docs", options.docs, "--iterations", options.iterations],
    ...["--warmup", options.warmup, "--rest-iterations", options["rest-iterations"], "--seed", options.seed],
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, childArgs, { cwd: root, stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    child.stdout.on("data", chunk => (out += chunk));
    child.on("error", reject);
    child.on("close", code => {
      const line = out.trim().split("\n").reverse().find(l => l.startsWith("{"));
      if (code !== 0 || !line) reject(new Error(`${dialect} ${mode} exited ${code}`));
      else resolve(JSON.parse(line));
    });
  });
}

/**
 * One attempt at a measurement: its result when the load stayed at or under
 * the limit, otherwise `null` with the reason recorded in `skipped`.
 */
async function attempt(dialect, mode, options, skipped) {
  const maxLoad = Number(options["max-load"]);
  await loadBelowLimit(maxLoad);
  const result = await measure(dialect, mode, options).catch(error => {
    skipped.push({ dialect, mode, failed: error.message });
    console.error(`  ${dialect} ${mode}: ${error.message}; taking it again`);
    return null;
  });
  if (result === null || withinLoad(result, maxLoad)) return result;
  skipped.push({ dialect, mode, loadStart: result.loadStart, loadEnd: result.loadEnd });
  console.error(`  ${dialect} ${mode}: load went from ${result.loadStart.toFixed(1)} to ${result.loadEnd.toFixed(1)}, above ${maxLoad}; taking it again`);
  return null;
}

/** A measurement taken under the load limit, attempted up to MAX_RETAKES + 1 times. */
async function steadyMeasure(dialect, mode, options, skipped) {
  for (let n = 0; n <= MAX_RETAKES; n++) {
    const result = await attempt(dialect, mode, options, skipped);
    if (result !== null) return result;
  }
  throw new Error(`${dialect} ${mode}: no steady measurement in ${MAX_RETAKES + 1} attempts`);
}

/** A run's saved measurements, only when both its modes were saved; `null` otherwise. */
export function savedRun(saved, dialect, runIndex, modes) {
  const pair = modes.map(mode => [mode, saved.get(keyFor(dialect, runIndex, mode))]);
  return pair.every(([, result]) => result !== undefined) ? Object.fromEntries(pair) : null;
}

/** A measurement of `mode` taken now, and saved. */
async function measured(dialect, runIndex, mode, context) {
  console.error(`${dialect} run ${runIndex + 1}: ${mode}`);
  const result = await steadyMeasure(dialect, mode, context.options, context.skipped);
  context.store.save(dialect, runIndex, mode, result);
  return result;
}

/** A run taken now: both modes, in the run's order. */
async function measuredRun(dialect, runIndex, context) {
  const run = {};
  for (const mode of orderFor(runIndex, context.modes)) run[mode] = await measured(dialect, runIndex, mode, context);
  return run;
}

/** One database's runs: as many as `needsAnotherRun` asks for, each saved one reused only whole. */
async function runsFor(dialect, limits, context) {
  const runs = [];
  while (needsAnotherRun(runs, limits)) {
    runs.push(savedRun(context.store.saved, dialect, runs.length, context.modes) ?? (await measuredRun(dialect, runs.length, context)));
  }
  return runs;
}

/** Keeps every measurement as JSON at `out`, when one is named; never over an existing file. */
function writeReport(out, report) {
  if (out) writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
}

/** The benchmark's options from its command line, with their defaults, as strings. */
export function optionsOf(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      modes: { type: "string", default: "main,per-language" },
      dialects: { type: "string", default: "sqlite,postgresql,mysql" },
      runs: { type: "string", default: "4" },
      "max-runs": { type: "string", default: "6" },
      docs: { type: "string", default: "1000" },
      iterations: { type: "string", default: "3000" },
      warmup: { type: "string", default: "300" },
      "rest-iterations": { type: "string", default: "600" },
      seed: { type: "string", default: "1" },
      "max-load": { type: "string", default: String(availableParallelism()) },
      "spread-limit": { type: "string", default: "0.05" },
      bound: { type: "string", default: "10" },
      save: { type: "string" },
      out: { type: "string" },
    },
  });
  return values;
}

/** Runs the benchmark and prints its table and verdict. */
async function main(argv) {
  const options = { ...optionsOf(argv), revision: revisionOf(root) };
  checkNumbers(options);
  const modes = modePair(options.modes);
  const limits = { minRuns: Number(options.runs), maxRuns: Number(options["max-runs"]), spreadLimit: Number(options["spread-limit"]) };
  checkLimits(limits);
  const bound = Number(options.bound) / 100;
  const report = { ...reportSettings(options), ...limits, bound, dialects: {}, skipped: [] };
  const context = { options, modes, skipped: report.skipped, store: openSaved(options.save, options) };
  for (const dialect of options.dialects.split(",")) {
    const runs = await runsFor(dialect, limits, context);
    report.dialects[dialect] = { runs, verdict: verdictFor(runs, { bound, modes }) };
  }
  writeReport(options.out, report);
  console.log(tableLines(report.dialects, modes).join("\n"));
  const counts = Object.entries(report.dialects).map(([d, { runs }]) => `${d} ${runs.length}`).join(", ");
  console.log(`\nRuns per database: ${counts}. Measurements retaken for load: ${report.skipped.length}.`);
  console.log(`Verdict on the Direct API reads, ${modes[1]} against ${modes[0]}, bound ${(bound * 100).toFixed(0)}%: ${overallCall(report.dialects)}.`);
}

if (isCliEntry(import.meta.url)) await main(process.argv.slice(2));
