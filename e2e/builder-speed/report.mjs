/**
 * Judges a speed run's results against the budgets (`budgets.mjs`) and the
 * expected failures (`expected-failures.mjs`), and words what it finds.
 *
 * For each budget, the outcome is one of:
 *
 * - `pass`: within its budget;
 * - `fail`: over its budget and not marked as a known miss; or not measured
 *   at all, marked or not (a measure that could not be taken is no evidence
 *   of speed, and a mark must not hide a check that stopped working);
 * - `expected`: over its budget, and marked as a known miss;
 * - `unexpected-pass`: within its budget while marked as a known miss. This
 *   fails the run too, so whichever change made it pass also removes its mark
 *   and the gain is kept;
 * - `skipped`: left out of this run on purpose (`--only`).
 *
 * A mark for a measure no budget names fails the run, so a renamed measure
 * cannot leave a stale mark behind.
 *
 * Pure: no browser, no files, so the unit test drives it with plain objects.
 *
 * @module builder-speed/report
 */

/**
 * The value at percentile `p` (0–100) of `values`, by the nearest-rank
 * method: the smallest value with at least `p`% of the values at or below it.
 * Null when there are none.
 *
 * @param {readonly number[]} values
 * @param {number} p
 * @returns {number | null}
 */
export function percentile(values, p) {
  const known = values.filter(v => Number.isFinite(v)).sort((a, b) => a - b);
  if (known.length === 0) return null;
  const rank = Math.max(1, Math.ceil((p / 100) * known.length));
  return known[rank - 1] ?? null;
}

/**
 * One result from a measure's samples, by the budget's `aggregate`. A sample
 * that could not be read (null: the result never showed) makes a p75 or max
 * unreadable too, rather than being dropped: dropping it would report the
 * fast samples as if the slow one never happened.
 *
 * @param {"p75" | "max" | "single"} aggregate
 * @param {readonly (number | null)[]} samples
 * @returns {number | null}
 */
export function aggregateOf(aggregate, samples) {
  if (samples.length === 0) return null;
  if (samples.some(s => s === null || !Number.isFinite(s))) return null;
  const known = /** @type {number[]} */ (samples);
  if (aggregate === "max") return Math.max(...known);
  if (aggregate === "single") return known[known.length - 1] ?? null;
  return percentile(known, 75);
}

/**
 * @typedef {object} Measured
 * @property {(number | null)[]} samples each sample's reading
 * @property {string} [note] what to know about the reading (why it is null)
 */

/**
 * @typedef {object} Row
 * @property {string} id
 * @property {string} label
 * @property {number} budget
 * @property {string} unit
 * @property {number | null} result
 * @property {(number | null)[]} samples
 * @property {"pass" | "fail" | "expected" | "unexpected-pass" | "skipped"} outcome
 * @property {string} [mark] the known miss's reason, when marked
 * @property {string} [note]
 */

/**
 * Every budget's outcome, and the lines that fail the run.
 *
 * @param {Record<string, Measured>} measured results by budget id
 * @param {readonly import("./budgets.mjs").Budget[]} budgets
 * @param {Readonly<Record<string, string>>} expected known misses, by id
 * @param {{ only?: readonly string[] }} [options]
 * @returns {{ rows: Row[], problems: string[] }}
 */
export function judge(measured, budgets, expected, options = {}) {
  const only = options.only === undefined ? null : new Set(options.only);
  const rows = [];
  const problems = [];
  // A run told to measure a measure no budget names measured nothing it
  // meant to: said, rather than passing as a table of skipped rows.
  const named = new Set(budgets.map(b => b.id));
  for (const id of only ?? [])
    if (!named.has(id))
      problems.push(`--only names "${id}", which no budget names`);
  for (const budget of budgets) {
    const mark = expected[budget.id];
    const base = {
      id: budget.id,
      label: budget.label,
      budget: budget.budget,
      unit: budget.unit,
      ...(mark === undefined ? {} : { mark }),
    };
    if (only !== null && !only.has(budget.id)) {
      rows.push({ ...base, result: null, samples: [], outcome: "skipped" });
      continue;
    }
    const entry = measured[budget.id];
    const samples = entry?.samples ?? [];
    const result = aggregateOf(budget.aggregate, samples);
    const note = entry === undefined ? "not measured" : entry.note;
    // A measure that could not be read fails whether or not it is a known
    // miss: the mark says how slow the builder is, not that the check may
    // stop measuring it.
    const within = result !== null && result <= budget.budget;
    const outcome =
      result === null
        ? "fail"
        : within
          ? mark === undefined
            ? "pass"
            : "unexpected-pass"
          : mark === undefined
            ? "fail"
            : "expected";
    rows.push({
      ...base,
      result,
      samples,
      outcome,
      ...(note === undefined ? {} : { note }),
    });
    const said = `${budget.label}: ${describe(result, budget.unit, note)}, budget ${String(budget.budget)} ${budget.unit}`;
    if (outcome === "fail") problems.push(said);
    if (outcome === "unexpected-pass") {
      problems.push(
        `${said}. It passes, but is marked as a known miss: remove its line from expected-failures.mjs`
      );
    }
  }
  for (const id of Object.keys(expected)) {
    if (!named.has(id)) {
      problems.push(
        `expected-failures.mjs marks "${id}", which no budget names: remove the line`
      );
    }
  }
  return { rows, problems };
}

/**
 * A result as a person reads it.
 *
 * @param {number | null} result
 * @param {string} unit
 * @param {string | undefined} note
 */
function describe(result, unit, note) {
  if (result === null) return note ?? "no reading";
  const rounded = Number.isInteger(result) ? result : Number(result.toFixed(2));
  return `${String(rounded)} ${unit}`;
}

/**
 * The rows as a plain-text table for the run's log.
 *
 * @param {readonly Row[]} rows
 * @returns {string}
 */
export function table(rows) {
  const tag = {
    pass: "pass",
    fail: "FAIL",
    expected: "known miss",
    "unexpected-pass": "FAIL (passes; remove its mark)",
    skipped: "skipped",
  };
  return rows
    .map(row => {
      const value =
        row.outcome === "skipped"
          ? "-"
          : describe(row.result, row.unit, row.note);
      return `${tag[row.outcome].padEnd(30)} ${row.label}: ${value} (budget ${String(row.budget)} ${row.unit})`;
    })
    .join("\n");
}
