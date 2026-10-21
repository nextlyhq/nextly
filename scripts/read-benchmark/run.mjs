/**
 * The single-language read benchmark: list and detail reads, through the
 * Direct API and REST, on a site storing its translatable fields on the main
 * table (`main`, today) and per language from the start (`per-language`), on
 * each database. Prints a table and a verdict; `--out` keeps every
 * measurement as JSON.
 *
 *   node scripts/read-benchmark/run.mjs [--dialects sqlite,postgresql,mysql]
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
 * with the same file and settings reuses what it holds, so a run stopped part
 * way loses at most the measurement it was on. A measurement whose process
 * fails (a dropped database connection, say) is taken again, like one taken
 * under too much load.
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { availableParallelism, loadavg } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { isCliEntry } from "../cli-entry.mjs";

import { MODES } from "./fixture.mjs";
import { keyFor, openSaved } from "./saved.mjs";
import { median, spread } from "./stats.mjs";
import { verdictFor } from "./verdict.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const MAX_RETAKES = 3;

/** The order a run measures the modes in: A then B on even runs, B then A on odd ones. */
export function orderFor(runIndex) {
  return runIndex % 2 === 0 ? [...MODES] : [...MODES].reverse();
}

/** Whether every read's p95 agrees across a database's runs, mode by mode. */
export function runsAgree(runs, spreadLimit) {
  const reads = Object.keys(runs[0][MODES[0]].results);
  return reads.every(read => MODES.every(mode => spread(runs.map(run => run[mode].results[read].p95)) <= spreadLimit));
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

/** Refuses run limits under which the runs could not end in balanced pairs. */
export function checkLimits({ minRuns, maxRuns }) {
  if (maxRuns % 2 === 1) throw new RangeError(`--max-runs ${maxRuns} is odd: runs come in pairs, each mode first once`);
  if (minRuns > maxRuns) throw new RangeError(`--runs ${minRuns} is above --max-runs ${maxRuns}`);
}

/** The settings every measurement in a report was taken with, as numbers. */
export function reportSettings(options) {
  const number = name => Number(options[name]);
  return {
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

/** The report as a Markdown table, one row per database and read. */
export function tableLines(dialects) {
  const ms = v => v.toFixed(2);
  const pct = v => `${(v * 100).toFixed(1)}%`;
  const lines = [
    "| Database | Read | main p50 / p95 (median of runs) | per-language p50 / p95 | p95 ratio | p95 spread (main, per-language) | Verdict |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const [dialect, { runs, verdict }] of Object.entries(dialects)) {
    for (const row of verdict.reads) {
      const at = (mode, stat) => median(runs.map(run => run[mode].results[row.read][stat]));
      lines.push(
        `| ${dialect} | ${row.read} | ${ms(at("main", "p50"))} / ${ms(at("main", "p95"))} ms | ${ms(at("per-language", "p50"))} / ${ms(at("per-language", "p95"))} ms | ${row.ratio.toFixed(3)} | ${pct(row.spread.main)}, ${pct(row.spread["per-language"])} | ${row.verdict} |`
      );
    }
  }
  return lines;
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
  if (result === null || result.loadEnd <= maxLoad) return result;
  skipped.push({ dialect, mode, loadStart: result.loadStart, loadEnd: result.loadEnd });
  console.error(`  ${dialect} ${mode}: load ended at ${result.loadEnd.toFixed(1)}, above ${maxLoad}; taking it again`);
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

/** A run's measurement of `mode`: the saved one, or one taken now and saved. */
async function measurementFor(dialect, runIndex, mode, context) {
  const { options, skipped, store } = context;
  const saved = store.saved.get(keyFor(dialect, runIndex, mode));
  if (saved) return saved;
  console.error(`${dialect} run ${runIndex + 1}: ${mode}`);
  const result = await steadyMeasure(dialect, mode, options, skipped);
  store.save(dialect, runIndex, mode, result);
  return result;
}

/** One database's runs: as many as `needsAnotherRun` asks for, each mode alternating. */
async function runsFor(dialect, limits, context) {
  const runs = [];
  while (needsAnotherRun(runs, limits)) {
    const run = {};
    for (const mode of orderFor(runs.length)) run[mode] = await measurementFor(dialect, runs.length, mode, context);
    runs.push(run);
  }
  return runs;
}

/** Keeps every measurement as JSON at `out`, when one is named; never over an existing file. */
function writeReport(out, report) {
  if (out) writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
}

/** Runs the benchmark and prints its table and verdict. */
async function main(argv) {
  const { values: options } = parseArgs({
    args: argv,
    options: {
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
  const limits = { minRuns: Number(options.runs), maxRuns: Number(options["max-runs"]), spreadLimit: Number(options["spread-limit"]) };
  checkLimits(limits);
  const bound = Number(options.bound) / 100;
  const report = { ...reportSettings(options), ...limits, bound, dialects: {}, skipped: [] };
  const context = { options, skipped: report.skipped, store: openSaved(options.save, options) };
  for (const dialect of options.dialects.split(",")) {
    const runs = await runsFor(dialect, limits, context);
    report.dialects[dialect] = { runs, verdict: verdictFor(runs, { bound }) };
  }
  writeReport(options.out, report);
  console.log(tableLines(report.dialects).join("\n"));
  const counts = Object.entries(report.dialects).map(([d, { runs }]) => `${d} ${runs.length}`).join(", ");
  console.log(`\nRuns per database: ${counts}. Measurements retaken for load: ${report.skipped.length}.`);
  console.log(`Verdict on the Direct API reads, bound ${(bound * 100).toFixed(0)}%: ${overallCall(report.dialects)}.`);
}

if (isCliEntry(import.meta.url)) await main(process.argv.slice(2));
