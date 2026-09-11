#!/usr/bin/env node

/**
 * One check that can block a merge, standing for all of them.
 *
 * 🔴 The problem this solves is not hypothetical. Measured on this repository:
 * the only required status check is `Decide what this commit can affect`, a job
 * that computes which paths a commit touches and then succeeds. Every job that
 * actually verifies anything — lint, typecheck, the unit suites, the browser
 * tests — is advisory, so a red one can sit beside a merge that goes through.
 * Adding 15,764 tests to a job made them RUN; it did not make them gate.
 *
 * Listing those jobs individually as required checks is the obvious fix and it
 * does not work here, for two reasons this repository has both of:
 *
 *   - a job that is SKIPPED never reports, and a required check that never
 *     reports blocks the branch for ever. Every job here carries
 *     `if: needs.changes.outputs.inert != 'true'`, so a commit touching only
 *     inert paths skips them all — and could then never be merged.
 *   - a matrix job's check is named from the expression it interpolates
 *     (`Scaffold smoke (ubuntu-latest)`), so the list has to restate names the
 *     workflow generates, which is the same drift the lane check exists to stop.
 *
 * So one job depends on all of them and reports their verdict, and IT is the
 * required check. Jobs can be added and removed without touching a repository
 * setting, and nothing has to restate a name.
 *
 * Usage (in the workflow):
 *   RESULTS='${{ toJSON(needs) }}' INERT='${{ needs.changes.outputs.inert }}' \
 *   SUPERSEDED='${{ needs.changes.outputs.superseded }}' \
 *     node scripts/ci-gate.mjs
 */

/**
 * Whether a skipped job is acceptable, and the answer is almost never.
 *
 * 🔴 Treating `skipped` as a pass is how a gate stops gating: a job switched
 * off by an `if:` that no longer matches reports nothing, and a check reading
 * that as success is a green light nobody chose to give. It is accepted for
 * exactly TWO reasons, each of which the workflow states rather than this
 * inferring. `changes` decided the commit cannot affect anything it would have
 * verified. Or a newer push to `main` already has a run of this workflow, whose
 * verdict includes this commit; the run skipped itself rather than repeat the
 * work, and nothing was cancelled.
 *
 * Kept as two inputs rather than one folded flag, so the reason a skip passed
 * is the reason reported, and a run that was superseded is never described as
 * touching only inert paths.
 */
export function skipIsAcceptable(inert, superseded = "false") {
  return inert === "true" || superseded === "true";
}

/**
 * The verdict for a set of job results.
 *
 * `results` is GitHub's `needs` context: a name to `{ result }` map, where
 * `result` is `success`, `failure`, `cancelled` or `skipped`.
 *
 * Fails closed twice over. An EMPTY set is refused rather than passed — a gate
 * that depends on nothing agrees with everything, and that is the shape a
 * mistyped `needs:` produces. And a result this does not recognise is refused
 * rather than assumed benign, because the set of outcomes is GitHub's to change.
 */
export function gateVerdict(results, inert, superseded = "false") {
  const entries = Object.entries(results ?? {});
  if (entries.length === 0) {
    return {
      ok: false,
      reasons: [
        "this gate depends on no job, so it has nothing to report. A gate " +
          "that needs nothing agrees with everything.",
      ],
    };
  }

  const reasons = [];
  for (const [name, value] of entries) {
    const result = value?.result;
    if (result === "success") continue;
    if (result === "skipped") {
      if (skipIsAcceptable(inert, superseded)) continue;
      reasons.push(
        `${name} was skipped, and this commit is neither inert nor superseded ` +
          "by a newer push. A job that did not run has verified nothing."
      );
      continue;
    }
    if (result === "failure" || result === "cancelled") {
      reasons.push(`${name} reported ${result}.`);
      continue;
    }
    reasons.push(
      `${name} reported ${JSON.stringify(result)}, which this does not know ` +
        "how to read. Refused rather than assumed to be good news."
    );
  }
  return { ok: reasons.length === 0, reasons };
}

const invokedDirectly =
  process.argv[1] && process.argv[1].endsWith("ci-gate.mjs");

if (invokedDirectly) {
  const raw = process.env.RESULTS;
  if (typeof raw !== "string" || raw.trim() === "") {
    console.error(
      "ci-gate: RESULTS was not set, so no job's outcome could be read. The " +
        "workflow passes `toJSON(needs)`."
    );
    process.exit(2);
  }

  let results;
  try {
    results = JSON.parse(raw);
  } catch (error) {
    console.error(
      `ci-gate: RESULTS was not JSON (${error.message}). It began: ` +
        JSON.stringify(raw.slice(0, 200))
    );
    process.exit(2);
  }

  const inert = process.env.INERT;
  const superseded = process.env.SUPERSEDED ?? "false";
  const { ok, reasons } = gateVerdict(results, inert, superseded);

  // The population before the verdict, on the way past: a reader taking a green
  // gate as proof should be able to see WHAT it stood for.
  const names = Object.keys(results);
  console.log(`ci-gate: ${names.length} job(s) reported — ${names.join(", ")}`);
  if (superseded === "true") {
    console.log(
      "  a newer push to main already has a run; this one skipped its jobs, and that run's verdict includes this commit."
    );
  } else if (inert === "true") {
    console.log("  this commit is inert, so a skipped job is expected.");
  }

  if (!ok) {
    console.error("\nci-gate: FAILED\n");
    for (const reason of reasons) console.error(`  - ${reason}`);
    process.exit(1);
  }
  console.log("ci-gate: ok — every job this depends on passed.");
}
