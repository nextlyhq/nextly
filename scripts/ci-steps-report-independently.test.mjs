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
 * So every verification step carries a condition naming its PREREQUISITES
 * rather than inheriting "everything before me passed":
 *
 *   `!cancelled() && steps.install.outcome == 'success'`
 *   plus `&& steps.build.outcome == 'success'` for the four that read `dist`
 *   without rebuilding it.
 *
 * Both conjuncts are load-bearing and they fail differently. Without
 * `!cancelled()` GitHub applies an implicit `success()` to any `if:` that names
 * no status function, so the step is skipped after ANY earlier failure — the
 * exact behaviour being removed, restored by an expression that still mentions
 * `steps.install`. Without the prerequisite the guard is too weak in the other
 * direction: a step runs on a tree that cannot support it.
 *
 * 🔴 Nothing else in the repository reads these conditions. A step added later
 * without one silently restores the old behaviour for every step behind it,
 * and the only symptom is a rollup that looks exactly like today's.
 *
 * ## What this file learned about testing itself
 *
 * The first version asked four questions that were each satisfied by something
 * other than the property, and all four were found by mutating the real
 * workflow rather than by reading:
 *
 * - it matched `steps.install.outcome == 'success'` alone, so dropping
 *   `!cancelled()` — the half that does the work — left it green;
 * - it decided membership with a substring search over a chunk that runs to the
 *   NEXT step, so a comment introducing step N+1 certified step N. This file's
 *   own comments quote the condition verbatim, so that was live, not theoretical;
 * - it asserted `id: install` over the WHOLE file, and four jobs have a step by
 *   that name, so the ci job could lose its id while `e2e` supplied the match;
 * - it required the guard only of steps spelling `run:`, exempting any gate
 *   added as an action — and this repository already gates through
 *   `fallow-rs/fallow` and `gitleaks` elsewhere.
 *
 * Hence: conditions are read from the step's OWN `if:` key, the population is
 * an allowlist of setup steps rather than a filter on `run:`, and every
 * assertion is scoped to the ci job. The break controls that matter are the
 * subtle ones — weaken a condition, move the id to another job, add an
 * action-shaped gate — not deleting an `if:` outright.
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

const NOT_CANCELLED = "!cancelled()";
const INSTALL_OK = "steps.install.outcome == 'success'";
const BUILD_OK = "steps.build.outcome == 'success'";

/**
 * Steps that prepare the runner rather than verify anything.
 *
 * An ALLOWLIST rather than a filter on `run:`, because the two fail in opposite
 * directions: a name nobody added here is REQUIRED to carry a condition, so a
 * gate arriving in any shape — `run:`, `uses:`, whatever comes next — is caught
 * rather than waved through.
 */
const SETUP_STEPS = new Set([
  "Checkout",
  "Setup pnpm",
  "Setup Node.js",
  "Restore Turbo cache",
  "Save Turbo cache",
  "Install dependencies",
]);

/**
 * The four steps that cannot say anything without `dist`.
 *
 * `Test` is NOT one of them, though it reads built output too: `turbo.jsonc`
 * gives `test` `dependsOn: ["^build"]`, so it rebuilds the dependency subgraph
 * of whatever it is filtered to. Gating it on Build would silence seventeen
 * suites for a failure in a package none of them depends on.
 */
const BUILD_DEPENDENT = new Set([
  "Lint",
  "Typecheck",
  "publint",
  "arethetypeswrong",
]);

/**
 * The steps of the `ci` job as `{ name, ifCondition, id }`.
 *
 * Split on the LIST-ITEM marker (`      - `), never on `- name:`. `name:` is
 * optional in GitHub Actions and this repository already writes bare
 * `- uses:` steps in four other workflows, and keying on the name defeats this
 * file twice over: such a step is not in the population at all, AND its own
 * eight-space `if:` falls inside the PRECEDING chunk, so an unguarded step is
 * scored by its neighbour's condition. Both were break-verified against this
 * job.
 *
 * A step's keys therefore sit either on the dash line itself or at eight
 * spaces beneath it, and both positions are read. Nothing is matched by
 * searching a chunk's free text: a chunk still runs to the next step and so
 * contains the comment block introducing it, and this file's own comments
 * quote the conditions verbatim.
 */
function ciJobSteps(source) {
  const jobStart = source.indexOf("    name: Lint / Typecheck / Test / Build");
  if (jobStart === -1) throw new Error("ci job not found by name");

  const rest = source.slice(jobStart);
  const nextJob = rest.slice(1).search(/\n {2}[a-z][a-z0-9-]*:\n/);
  const jobBody = nextJob === -1 ? rest : rest.slice(0, nextJob + 1);

  return jobBody
    .split(/\n(?= {6}- \S)/)
    .slice(1)
    .map(chunk => ({
      name: stepKey(chunk, "name"),
      ifCondition: stepKey(chunk, "if"),
      id: stepKey(chunk, "id"),
    }));
}

/**
 * One of a step's own keys, from the dash line or the eight-space block.
 *
 * Returns "" when the step does not declare it — which for `name` is a real
 * answer rather than a parse failure, since an unnamed step is still a step
 * and still has to carry a condition.
 */
function stepKey(chunk, key) {
  const onDashLine = firstMatch(chunk, new RegExp(`^ {6}- ${key}: (.+)$`, "m"));
  if (onDashLine !== "") return onDashLine;
  return firstMatch(chunk, new RegExp(`^ {8}${key}: (.+)$`, "m"));
}

/** The first capture group, trimmed, or "" when the pattern does not match. */
function firstMatch(text, pattern) {
  const match = pattern.exec(text);
  return match === null ? "" : match[1].trim();
}

/**
 * The steps that must carry a condition: everything that is not setup.
 *
 * An unnamed step stays IN, deliberately. It cannot appear in a name-keyed
 * allowlist, so dropping it would exempt exactly the shape that is hardest to
 * notice; keeping it means the population fails closed and such a step is
 * reported by position.
 */
const verificationSteps = steps => steps.filter(s => !SETUP_STEPS.has(s.name));

describe("the ci job reports every gate, not only the first to fail", () => {
  /**
   * A floor before the verdict.
   *
   * Every assertion below is satisfied by an empty step list, so a parser that
   * stopped matching would certify the workflow while reading nothing.
   */
  it("finds the job's steps at all", async () => {
    const steps = ciJobSteps(await readFile(CI_WORKFLOW, "utf-8"));
    const names = steps.map(s => s.name);

    expect(steps.length).toBeGreaterThan(10);
    expect(names).toContain("Typecheck");
    expect(names).toContain("Build");
    // The allowlist is only meaningful if it actually matches something here.
    expect(names).toContain("Install dependencies");
  });

  it("requires !cancelled() on every verification step", async () => {
    const steps = ciJobSteps(await readFile(CI_WORKFLOW, "utf-8"));

    const missing = verificationSteps(steps)
      .filter(s => !s.ifCondition.includes(NOT_CANCELLED))
      .map(s => `${s.name || "(unnamed step)"}: ${s.ifCondition || "(no if:)"}`);

    expect(
      missing,
      "GitHub applies an implicit success() to an if: naming no status function, so a condition without !cancelled() is skipped after ANY earlier failure — the behaviour this job was changed to stop"
    ).toEqual([]);
  });

  it("requires the install prerequisite on every verification step", async () => {
    const steps = ciJobSteps(await readFile(CI_WORKFLOW, "utf-8"));

    const missing = verificationSteps(steps)
      .filter(s => !s.ifCondition.includes(INSTALL_OK))
      .map(s => `${s.name || "(unnamed step)"}: ${s.ifCondition || "(no if:)"}`);

    expect(
      missing,
      "a verification step without the install prerequisite either stops every step behind it or runs without node_modules"
    ).toEqual([]);
  });

  it("requires the build prerequisite on the steps that read dist", async () => {
    const steps = ciJobSteps(await readFile(CI_WORKFLOW, "utf-8"));

    const missing = verificationSteps(steps)
      .filter(s => BUILD_DEPENDENT.has(s.name))
      .filter(s => !s.ifCondition.includes(BUILD_OK))
      .map(s => `${s.name || "(unnamed step)"}: ${s.ifCondition || "(no if:)"}`);

    expect(
      missing,
      "turbo gives lint no dependency and check-types only ^check-types, so on a failed Build these read a stale dist — and a type-aware lint rule then names YOUR expression rather than the missing build"
    ).toEqual([]);

    // The population itself, so a rename cannot empty the check silently.
    const present = steps.map(s => s.name).filter(n => BUILD_DEPENDENT.has(n));
    expect(present.sort()).toEqual([...BUILD_DEPENDENT].sort());
  });

  it("does NOT gate Test on Build, which would silence seventeen suites", async () => {
    const steps = ciJobSteps(await readFile(CI_WORKFLOW, "utf-8"));
    const test = steps.find(s => s.name === "Test");

    // Asserted as a negative because the mistake is an attractive one: the four
    // steps around it carry the build conjunct, so adding it here reads as
    // tidying up an inconsistency. It is not one — `turbo.jsonc` gives `test`
    // `dependsOn: ["^build"]`, so it rebuilds what it needs, and gating it
    // means a Build failure in a package none of the seventeen filters depends
    // on contributes nothing instead of seventeen suites' worth of verdict.
    expect(test).toBeDefined();
    expect(test.ifCondition).toContain(NOT_CANCELLED);
    expect(test.ifCondition).toContain(INSTALL_OK);
    expect(
      test.ifCondition,
      "turbo rebuilds test's dependency subgraph, so gating it on Build only costs coverage"
    ).not.toContain(BUILD_OK);
  });

  it("keeps install and build identified INSIDE this job", async () => {
    const steps = ciJobSteps(await readFile(CI_WORKFLOW, "utf-8"));

    // Scoped to the ci job, because four jobs in this file have a step named
    // "Install dependencies" — a whole-file search is discharged by any one of
    // them. An unidentified step publishes no outcome, GitHub evaluates the
    // reference to empty, and every guarded step silently stops running.
    const ids = Object.fromEntries(steps.map(s => [s.name, s.id]));

    expect(ids["Install dependencies"]).toBe("install");
    expect(ids.Build).toBe("build");
  });
});
