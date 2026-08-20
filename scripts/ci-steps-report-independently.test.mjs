/**
 * One failing gate in `Lint / Typecheck / Test / Build` must not silence the
 * rest of the job.
 *
 * The job runs twenty-odd verification steps in one sequence: cheap grep gates
 * first, then Script tests, Build, Lint, Typecheck, Test, publint,
 * arethetypeswrong. GitHub's default is to stop at the first failing step, so
 * for as long as an early gate is red, every step behind it reports `skipped`
 * and the rollup shows exactly one red job — indistinguishable from a job with
 * one thing wrong.
 *
 * That is not hypothetical. A grep gate went red at step two; the fifteen steps
 * behind it never ran; seven pull requests merged over the single red; and two
 * of them carried defects the skipped steps existed to catch — a changeset
 * whose frontmatter never closed (Script tests) and three type errors in a new
 * test file (Typecheck). Neither surfaced until the grep gate was repaired,
 * days of merges later.
 *
 * So every verification step carries
 * `if: !cancelled() && steps.install.outcome == 'success'`. The job still
 * fails; what changes is that it reports everything wrong rather than the
 * first thing wrong.
 *
 * 🔴 The guard is what makes this true, and nothing else in the repository
 * reads it. A step added later without the condition silently restores the old
 * behaviour for every step behind it, and the only symptom is a rollup that
 * looks the same as it does today. Hence a test rather than a comment.
 *
 * Parsed as TEXT rather than through a YAML library on purpose: `yaml` appears
 * in this repository only as a pnpm override, so it is reachable here by
 * hoisting rather than by declaration, and a resolution that depends on
 * hoisting is not one to build a gate on.
 *
 * @module ci-steps-report-independently.test
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CI_WORKFLOW = path.join(HERE, "..", ".github", "workflows", "ci.yml");

const GUARD = "steps.install.outcome == 'success'";

/**
 * The steps of the `ci` job, as `{ name, body }`.
 *
 * The job is found by its `name:` line and read to the next job at the same
 * indentation, so a step belonging to `e2e` or `scaffold-smoke` cannot be
 * mistaken for one of these.
 */
function ciJobSteps(source) {
  const jobStart = source.indexOf("    name: Lint / Typecheck / Test / Build");
  if (jobStart === -1) throw new Error("ci job not found by name");

  // The next line at four-space indentation that starts a new job key.
  const rest = source.slice(jobStart);
  const nextJob = rest.slice(1).search(/\n {2}[a-z][a-z0-9-]*:\n/);
  const jobBody = nextJob === -1 ? rest : rest.slice(0, nextJob + 1);

  const chunks = jobBody.split(/\n(?=      - name: )/).slice(1);
  return chunks.map(chunk => {
    const name = /^ {6}- name: (.+)$/m.exec(chunk)?.[1] ?? "";
    return { name: name.trim(), body: chunk };
  });
}

describe("the ci job reports every gate, not only the first to fail", () => {
  /**
   * A floor before the verdict.
   *
   * Every assertion below is satisfied by an empty step list, so a parser that
   * stopped matching would certify the workflow while reading nothing.
   */
  it("finds the job's steps at all", async () => {
    const steps = ciJobSteps(await readFile(CI_WORKFLOW, "utf-8"));

    expect(steps.length).toBeGreaterThan(10);
    expect(steps.map(s => s.name)).toContain("Typecheck");
  });

  it("guards every step that runs a command", async () => {
    const steps = ciJobSteps(await readFile(CI_WORKFLOW, "utf-8"));

    // `install` is the deliberate exception: without node_modules no step
    // below can say anything, so its failure legitimately skips them all.
    // Steps that only set up the runner (checkout, node, cache) are not
    // verification and are not required to carry the guard.
    const unguarded = steps
      .filter(s => /^\s+run:/m.test(s.body))
      .filter(s => s.name !== "Install dependencies")
      .filter(s => !s.body.includes(GUARD))
      .map(s => s.name);

    expect(
      unguarded,
      "a verification step without the install guard stops every step behind it, which is how a red job comes to mean 'one problem' when it means 'nothing after this ran'"
    ).toEqual([]);
  });

  it("keeps install identified, because the guard names it", async () => {
    const source = await readFile(CI_WORKFLOW, "utf-8");

    // The guard reads `steps.install.outcome`; an unidentified step publishes
    // no outcome, and GitHub evaluates the reference to empty rather than
    // failing — so every guarded step would silently stop running.
    expect(source).toMatch(/- name: Install dependencies\n\s+id: install\n/);
  });
});
