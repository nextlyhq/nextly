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
 * The steps that cannot say anything without `dist`.
 *
 * `Test` is NOT one of them, though it reads built output too: `turbo.jsonc`
 * gives `test` `dependsOn: ["^build"]`, so it rebuilds the dependency subgraph
 * of whatever it is filtered to. Gating it on Build would silence every
 * suites for a failure in a package none of them depends on.
 *
 * `Playground tests` IS one, and the contrast with `Test` is the reason: it runs
 * `vitest` directly rather than through turbo, so nothing rebuilds for it. The
 * playground declares no tsconfig path mapping for the block packages, so
 * `@nextlyhq/blocks-react/blocks` resolves to
 * `packages/blocks-react/dist/blocks/index.mjs` — measured with `require.resolve`
 * rather than assumed — and without a build the suite cannot import what it
 * exists to check.
 */
const BUILD_DEPENDENT = new Set([
  "Lint",
  "Typecheck",
  "publint",
  "arethetypeswrong",
  "Playground tests",
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

/** Whether a step declared at `declared` has already run by index `index`. */
function resolvesBefore(declared, index) {
  return declared !== undefined && declared < index;
}

/** A step's position, for a message that has to name one that has no name. */
function label(step, index) {
  return `${step.name || "(unnamed step)"} (#${index + 1})`;
}

/** Where an id was declared, or that it was not. */
function where(declared) {
  return declared === undefined ? "nowhere" : `#${declared + 1}`;
}

/**
 * Every step this condition names, sorted and de-duplicated.
 *
 * Matches the reference rather than one SPELLING of it. `steps.<id>.outcome`
 * is the form written here, but `steps.<id>.conclusion` chains a step just as
 * effectively, and `steps['<id>']` is the same expression in bracket syntax —
 * so reading only the first would let the identical silencing through under a
 * different name.
 *
 * Sorted so the comparison is over a SET rather than over the order somebody
 * happened to write the conjuncts in.
 */
function referencedStepIds(condition) {
  const dotted = [...condition.matchAll(/steps\.([A-Za-z0-9_-]+)\b/g)];
  const bracketed = [...condition.matchAll(/steps\[\s*['"]([^'"]+)['"]\s*\]/g)];
  const ids = [...dotted, ...bracketed].map(m => m[1]);
  return [...new Set(ids)].sort();
}

/**
 * Every status function this condition calls, sorted and de-duplicated.
 *
 * `!cancelled()` is the only one a verification step may name. An EXPLICIT
 * `success()` is the trap: it reproduces the implicit one GitHub applies when
 * no status function is present, so a condition carrying both `!cancelled()`
 * and `success()` keeps every required conjunct and is still skipped by any
 * earlier failure — the behaviour this whole job was changed to stop, restored
 * by an addition rather than a removal.
 */
function calledStatusFunctions(condition) {
  const calls = [
    ...condition.matchAll(/\b(success|always|cancelled|failure)\s*\(\s*\)/g),
  ].map(m => m[1]);
  return [...new Set(calls)].sort();
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

    // An exact set, not a presence check. Missing `!cancelled()` restores the
    // skipping by omission; ADDING `success()` beside it restores the same
    // skipping while every required conjunct is still there, which no
    // presence check can see and no reader spots by eye.
    const wrong = verificationSteps(steps)
      .filter(
        s =>
          !s.ifCondition.includes(NOT_CANCELLED) ||
          calledStatusFunctions(s.ifCondition).join() !== "cancelled"
      )
      .map(s => `${s.name || "(unnamed step)"}: ${s.ifCondition || "(no if:)"}`);

    expect(
      wrong,
      "a verification step may call !cancelled() and no other status function: GitHub applies an implicit success() when none is named, and an explicit one reproduces it, so either way the step is skipped after ANY earlier failure"
    ).toEqual([]);
  });

  it("references EXACTLY the prerequisites each step is allowed", async () => {
    const steps = ciJobSteps(await readFile(CI_WORKFLOW, "utf-8"));

    // An exact set rather than a presence check, because the two failures are
    // opposite and both matter. A MISSING prerequisite lets a step run on a
    // tree that cannot support it. An EXTRA one — a conjunct naming some other
    // verification step — restores precisely the silencing this job was changed
    // to stop: that peer failing skips this step, and the rollup goes back to
    // one red with invisible skips beside it. The workflow itself establishes
    // the idiom (four steps legitimately name `build`), so a chained condition
    // is indistinguishable by eye from a blessed one.
    const wrong = verificationSteps(steps)
      .map(s => ({
        step: s,
        actual: referencedStepIds(s.ifCondition),
        expected: BUILD_DEPENDENT.has(s.name)
          ? ["build", "install"]
          : ["install"],
      }))
      .filter(r => r.actual.join() !== r.expected.join())
      .map(
        r =>
          `${r.step.name || "(unnamed step)"}: references [${r.actual}], allowed [${r.expected}]`
      );

    expect(
      wrong,
      "a verification step may name install (and build, if it reads dist without rebuilding it) and nothing else — any other outcome reference makes one gate's failure hide another's verdict"
    ).toEqual([]);

    // The population itself, so a rename cannot empty the check silently.
    const present = steps.map(s => s.name).filter(n => BUILD_DEPENDENT.has(n));
    expect(present.sort()).toEqual([...BUILD_DEPENDENT].sort());
  });

  it("declares install and build BEFORE the steps that reference them", async () => {
    const steps = ciJobSteps(await readFile(CI_WORKFLOW, "utf-8"));

    // The other half of "the reference must resolve". A missing id is one way
    // `steps.<id>.outcome` evaluates to empty; referencing a step that has not
    // RUN YET is the other, because the steps context only carries steps
    // already executed. Both skip the step silently, and a skipped step does
    // not fail the job — so the workflow would be GREEN with the gate never
    // having run, which is the failure this file exists to prevent.
    const declaredAt = new Map(
      steps.map((s, index) => [s.id, index]).filter(([id]) => id !== "")
    );

    const tooEarly = steps.flatMap((s, index) =>
      referencedStepIds(s.ifCondition)
        .filter(id => !resolvesBefore(declaredAt.get(id), index))
        .map(id => `${label(s, index)} references ${id}, declared at ${where(declaredAt.get(id))}`)
    );

    expect(
      tooEarly,
      "a step referencing an id declared later reads empty and is skipped, and a skipped step does not fail the job"
    ).toEqual([]);
  });

  it("does NOT gate Test on Build, which would silence every filtered suite", async () => {
    const steps = ciJobSteps(await readFile(CI_WORKFLOW, "utf-8"));
    const test = steps.find(s => s.name === "Test");

    // Asserted as a negative because the mistake is an attractive one: the four
    // steps around it carry the build conjunct, so adding it here reads as
    // tidying up an inconsistency. It is not one — `turbo.jsonc` gives `test`
    // `dependsOn: ["^build"]`, so it rebuilds what it needs, and gating it
    // means a Build failure in a package none of the filters depends on
    // contributes nothing instead of every filtered suite's worth of verdict.
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
