#!/usr/bin/env node

/**
 * Every package with a `test:integration` task must be named by a workflow leg
 * that runs one, and every leg's filters must name a package that has one.
 *
 * The integration jobs select what to run with a hand-written `--filter` list,
 * repeated once per dialect leg. Nothing connects that list to the packages
 * that actually declare the task, so the two drift in both directions and each
 * drift is silent:
 *
 *   - a package gains `test:integration` and nobody edits the workflow. Its
 *     suites run NOWHERE. The unit job no longer includes them and no
 *     integration leg selects them, so the coverage leaves and every job stays
 *     green — the shape a check cannot notice, because what it would have
 *     reported is simply absent.
 *   - a filter keeps naming a package that no longer has the task. Turbo
 *     matches no task and moves on, so the leg reports success while the entry
 *     stands as a record of coverage nobody is getting.
 *
 * Both sides are DERIVED rather than restated. The packages come from reading
 * the manifests git tracks, and the legs come from parsing the commands the
 * workflow actually runs, so neither is a list kept in step by hand.
 *
 * Usage:
 *   node scripts/check-integration-lane.mjs
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const WORKFLOW = ".github/workflows/integration.yml";

/**
 * Whether a step's `if:` disables it no matter what the run decides.
 *
 * Only a LITERAL false, because that is the whole set this can answer. A matrix
 * condition is the workflow selecting a leg rather than disabling one, and
 * whether it holds depends on a run that has not happened - so treating an
 * expression as disabled would report a lane uncovered while it runs perfectly,
 * which for this check is the more expensive direction.
 */
export function staticallyDisabled(condition) {
  if (typeof condition !== "string") return false;
  const bare = condition.trim().replace(/^\$\{\{(.*)\}\}$/s, "$1").trim();
  return bare === "false";
}

/**
 * Each step in the workflow, with the condition on it and the commands it runs.
 *
 * 🔴 Reading `run:` rather than scanning every line is the load-bearing part.
 * The workflow's prose explains what each leg does, so a paragraph naming a
 * command reads identically to the command - and a line scan counts an
 * invocation that was commented out, or one belonging to a step that is turned
 * off, while the lane it described has stopped running. That is this check
 * reporting a covered lane it never had.
 *
 * Steps are block-sequence items (`- name:` / `- uses:` / `- run:`), and their
 * keys sit one level in. Both `run:` forms the file uses are read: a block
 * scalar, whose body is every following line indented past the key, and the
 * one-line form. A block's body is a shell script, so a line opening with `#`
 * there is a comment for the same reason a YAML one is, and neither executes.
 *
 * ⚠️ The boundary, stated rather than covered badly. This reads indentation,
 * not YAML, so what it CANNOT see is: a condition on the JOB rather than the
 * step, a step disabled by an expression only the run can evaluate, a `#`
 * inside quotes, and a command assembled across lines. Each would need a
 * parser, and none is a form this workflow uses. The check names that limit in
 * its own output rather than leaving it implicit, which is the call
 * `check-comment-convention.mjs` already made for its own YAML reader.
 */
export function workflowSteps(workflow) {
  const lines = workflow.split(/\r?\n/);
  const steps = [];
  let step;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const item = /^(\s*)-\s+\S/.exec(line);
    if (item) {
      step = { indent: item[1].length, condition: undefined, commands: [] };
      steps.push(step);
    }
    if (step === undefined) continue;
    // A key of THIS step sits one level in from its dash. Deeper belongs to
    // another mapping, and shallower has ended the step.
    const keyIndent = step.indent + 2;
    // Either spelling of the same position: the first key sits ON the dash
    // line (`- run: ...`), and the rest are indented to where that key began.
    const own = new RegExp(
      `^(?:\\s{${step.indent}}-\\s+|\\s{${keyIndent}})(\\w[\\w-]*):(.*)$`
    ).exec(line);
    if (own === null) continue;
    const [, key, rest] = own;
    if (key === "if") {
      step.condition = rest.trim();
      continue;
    }
    if (key !== "run") continue;
    if (/^[ \t]*[|>][-+]?[ \t]*$/.test(rest)) {
      for (let body = index + 1; body < lines.length; body++) {
        const bodyLine = lines[body];
        if (bodyLine.trim() === "") continue;
        if (bodyLine.length - bodyLine.trimStart().length <= keyIndent) break;
        step.commands.push(bodyLine.trim());
      }
      continue;
    }
    if (rest.trim() !== "") step.commands.push(rest.trim());
  }
  return steps;
}

/**
 * A `turbo test:integration` invocation and the packages it selects.
 *
 * Matched on the command rather than on a step name, because the name is prose
 * somebody can reword while the command is what runs.
 */
export function integrationInvocations(workflow) {
  const invocations = [];
  for (const step of workflowSteps(workflow)) {
    // A step that cannot run covers nothing, however completely its command
    // describes the lane.
    if (staticallyDisabled(step.condition)) continue;
    for (const command of step.commands) {
      // A disabled command is not an invocation either. Anchored at the start,
      // so a `#` cannot precede what it disables.
      if (command.startsWith("#")) continue;
      // Everything from an unquoted `#` is a comment to the shell, with or
      // without a space after it: `cmd #--filter=x` runs `cmd`. Splitting on
      // `#` alone is what keeps a commented flag from reading as coverage.
      const executable = command.split(/\s+#/)[0];
      if (!/\bturbo\s+test:integration\b/.test(executable)) continue;
      const filters = [...executable.matchAll(/--filter=(\S+)/g)].map(m => m[1]);
      invocations.push({ line: executable.trim(), filters });
    }
  }
  return invocations;
}

/** Every tracked manifest that declares the task, by package name. */
export function packagesWithIntegrationTask(readManifest, manifestPaths) {
  const named = [];
  for (const path of manifestPaths) {
    let manifest;
    try {
      manifest = JSON.parse(readManifest(path));
    } catch {
      continue; // an unreadable manifest is reported by the workspace linter
    }
    if (typeof manifest?.name !== "string") continue;
    if (typeof manifest?.scripts?.["test:integration"] === "string") {
      named.push(manifest.name);
    }
  }
  return named.sort();
}

/** What the two sides disagree about, in both directions. */
export function laneDrift(declared, selected) {
  const selectedSet = new Set(selected);
  const declaredSet = new Set(declared);
  return {
    unrun: declared.filter(name => !selectedSet.has(name)),
    stale: selected.filter(name => !declaredSet.has(name)),
  };
}

const invokedDirectly =
  process.argv[1] && process.argv[1].endsWith("check-integration-lane.mjs");

if (invokedDirectly) {
  let manifestPaths;
  try {
    manifestPaths = execFileSync(
      "git",
      ["ls-files", "packages/*/package.json", "apps/*/package.json"],
      { cwd: root, encoding: "utf8" }
    )
      .split("\n")
      .filter(Boolean);
  } catch {
    console.error(
      "check-integration-lane: cannot list tracked manifests; this reads git's " +
        "index rather than the filesystem, so it has nothing to judge."
    );
    process.exit(2);
  }

  let workflow;
  try {
    workflow = readFileSync(join(root, WORKFLOW), "utf8");
  } catch {
    console.error(
      `check-integration-lane: ${WORKFLOW} could not be read, so the legs have ` +
        "nothing to be compared against."
    );
    process.exit(2);
  }

  const invocations = integrationInvocations(workflow);
  const declared = packagesWithIntegrationTask(
    path => readFileSync(join(root, path), "utf8"),
    manifestPaths
  );
  const selected = [
    ...new Set(invocations.flatMap(invocation => invocation.filters)),
  ].sort();

  // The population, before the verdict. An empty side is satisfied by every
  // comparison below, so each of these would report a clean lane having
  // examined nothing.
  if (manifestPaths.length === 0) {
    console.error(
      "check-integration-lane: no tracked package manifests were found, so no " +
        "package could have been judged."
    );
    process.exit(2);
  }
  if (invocations.length === 0) {
    console.error(
      `check-integration-lane: ${WORKFLOW} runs no \`turbo test:integration\`. ` +
        "Either the legs were rewritten and this check needs teaching, or the " +
        "integration lane has stopped running and every package would read as " +
        "covered."
    );
    process.exit(2);
  }
  if (declared.length === 0) {
    console.error(
      "check-integration-lane: no package declares a `test:integration` script, " +
        "which would make every filter below stale rather than the lane clean."
    );
    process.exit(2);
  }

  const { unrun, stale } = laneDrift(declared, selected);

  if (unrun.length > 0 || stale.length > 0) {
    console.error("check-integration-lane: FAILED\n");
    for (const name of unrun) {
      console.error(
        `  - ${name} declares \`test:integration\` and no leg selects it, so its ` +
          "suites run nowhere. Add `--filter=" +
          name +
          `\` to a leg in ${WORKFLOW}.`
      );
    }
    for (const name of stale) {
      console.error(
        `  - ${WORKFLOW} filters for ${name}, which declares no ` +
          "`test:integration`. Turbo matches no task and the leg passes without " +
          "running it; drop the filter or add the script."
      );
    }
    console.error(`\ndeclared (${declared.length}): ${declared.join(", ")}`);
    console.error(`selected (${selected.length}): ${selected.join(", ")}`);
    process.exit(1);
  }

  console.log(
    `check-integration-lane: ok — ${declared.length} package(s) declare ` +
      `\`test:integration\` and every one is selected by a leg, across ` +
      `${invocations.length} invocation(s).`
  );
  // Said on the way past rather than only in the source, so a reader taking
  // this as proof of coverage knows which shapes it did not judge.
  console.log(
    "  reads step `run:` by indentation, not YAML: a job-level condition, a " +
      "step disabled by an expression, or a `#` inside quotes are not seen."
  );
}
