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
 * A `turbo test:integration` invocation and the packages it selects.
 *
 * Matched on the command rather than on a step name, because the name is prose
 * somebody can reword while the command is what runs. One invocation per line:
 * the workflow writes each as a single command inside a `run:` block, and a
 * filter split across a continuation would be a different shape than any leg
 * currently uses — so this reports what it can see and the population check
 * below refuses when it sees none.
 */
export function integrationInvocations(workflow) {
  const invocations = [];
  for (const line of workflow.split(/\r?\n/)) {
    if (!/\bturbo\s+test:integration\b/.test(line)) continue;
    const filters = [...line.matchAll(/--filter=(\S+)/g)].map(m => m[1]);
    invocations.push({ line: line.trim(), filters });
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
}
