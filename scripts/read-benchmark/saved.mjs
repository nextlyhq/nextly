/**
 * The measurements a benchmark run has already taken, kept as it goes, so a
 * run stopped by a lost connection, a reboot or a timeout carries on from the
 * last one rather than from the start. One JSON line per measurement, after a
 * header line naming the settings they were taken with: a file taken with
 * other settings is refused, since mixing them would compare unlike things.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";

/**
 * The settings that make two measurements comparable. The load limit is one: a
 * run started again with a stricter limit must not reuse measurements taken
 * above it.
 */
const SETTINGS = ["docs", "iterations", "warmup", "rest-iterations", "seed", "max-load"];

/** Where a measurement sits in a run: its database, run number and mode. */
export function keyFor(dialect, run, mode) {
  return `${dialect}|${run}|${mode}`;
}

/** The settings of `options`, as a header records them. */
export function settingsOf(options) {
  return Object.fromEntries(SETTINGS.map(name => [name, String(options[name])]));
}

/**
 * The measurements saved in `text`, by `keyFor`, once its header is found to
 * match `settings`. An empty text is a new file.
 */
export function readSaved(text, settings) {
  const lines = text.split("\n").filter(Boolean).map(line => JSON.parse(line));
  const saved = new Map();
  if (lines.length === 0) return saved;
  const [header, ...entries] = lines;
  if (JSON.stringify(header.settings) !== JSON.stringify(settings)) {
    throw new Error(`the saved measurements were taken with ${JSON.stringify(header.settings)}, not ${JSON.stringify(settings)}`);
  }
  for (const entry of entries) saved.set(keyFor(entry.dialect, entry.run, entry.mode), entry.result);
  return saved;
}

/** A store at `file` for one run of the benchmark, or one that keeps nothing. */
export function openSaved(file, options) {
  if (!file) return { saved: new Map(), save: () => {} };
  const settings = settingsOf(options);
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  const saved = readSaved(text, settings);
  // A file that exists but holds nothing, as one `mktemp` made does, is new too.
  if (text.trim() === "") appendFileSync(file, `${JSON.stringify({ settings })}\n`);
  return {
    saved,
    save: (dialect, run, mode, result) => appendFileSync(file, `${JSON.stringify({ dialect, run, mode, result })}\n`),
  };
}
