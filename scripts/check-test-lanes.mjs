#!/usr/bin/env node

/**
 * Every package that declares a test task is run by a lane.
 *
 * The lane is ASKED rather than read. Each lane is a script in the root
 * manifest, and running it with `--dry=json` makes turbo report the plan it
 * would execute — so the question "which packages' suites does CI run?" is
 * answered by the tool that will run them, against the command that will run.
 *
 * 🔴 The previous answer parsed the workflows: it read `run:` blocks out of the
 * YAML, split the shell, and worked out which packages each `--filter` selected.
 * That is an unbounded problem and it behaved like one. Twelve separate ways to
 * fool it were found, each a shape the parser did not model — a folded block
 * scalar, a line continuation, a comment, a `&&` chain, a boolean option eating
 * a path, a `^...` selector that excludes the package it names, turbo's `--`
 * pass-through, `echo` in front of the command, `continue-on-error`, a `!`
 * exclusion, `|| true`, and a `--dry-run`. Every fix was correct and the next
 * shape arrived anyway, because the space of ways to write a command has no
 * edge. Nothing here parses a command now, so none of those shapes has anything
 * to fool.
 *
 * What this leaves is the drift it was built for. Measured on `e6797c5d1`:
 * `nextly` (907 files, 11562 tests) and `@nextlyhq/admin` (407, 4061) declared
 * `test`, passed for weeks, and gated nothing, because the hand-written filter
 * list in the workflow had never been told about them.
 *
 * ⚠️ The boundary, stated rather than covered badly. This proves what a lane
 * SCRIPT runs; it takes on trust that the workflow still calls that script, and
 * checks only that the file names it. A workflow that renames its step, guards
 * it with an expression, or lets it fail with `continue-on-error` is not
 * something this reads — which is the deliberate trade, because reading that
 * well is the problem this stopped trying to solve.
 *
 * Usage:
 *   node scripts/check-test-lanes.mjs
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Each lane: the task it runs, the scripts that run it, and where it is called.
 *
 * One entry per task rather than one check per task: the question is the same
 * both times, and asking it twice in two files is how the second copy drifts.
 */
export const LANES = [
  {
    task: "test",
    workflow: ".github/workflows/ci.yml",
    scripts: ["lane:test"],
    /*
     * The playground is an APP, and `test` dependsOn `^build`, so filtering
     * turbo to a leaf that depends on nearly every package would pull the whole
     * graph into a step that needs only what Build already produced. It runs
     * vitest directly instead, which turbo has no plan for — so its coverage is
     * declared here, next to the script that provides it, rather than inferred.
     */
    direct: [{ script: "lane:test:playground", package: "playground" }],
  },
  {
    task: "test:integration",
    workflow: ".github/workflows/integration.yml",
    /*
     * Three legs, and the split is a property rather than a preference: an
     * adapter's integration suites need their own dialect's database, so a leg
     * runs the adapter it has a server for. The packages that name no dialect
     * boot in-memory SQLite and sit on that leg.
     */
    scripts: [
      "lane:test:integration:postgres",
      "lane:test:integration:mysql",
      "lane:test:integration:sqlite",
    ],
    direct: [],
  },
];

/** Every readable manifest as the two facts this check asks of a package. */
export function readWorkspace(readManifest, manifestPaths) {
  const packages = [];
  for (const path of manifestPaths) {
    let manifest;
    try {
      manifest = JSON.parse(readManifest(path));
    } catch {
      continue; // an unreadable manifest is reported by the workspace linter
    }
    if (typeof manifest?.name !== "string") continue;
    packages.push({ name: manifest.name, scripts: manifest.scripts ?? {} });
  }
  return packages;
}

/**
 * Every manifest that declares the task, by package name.
 *
 * Derived from `readWorkspace` rather than reading the manifests a second time:
 * the two answers are about the same packages, and a second reader is one edit
 * away from disagreeing with the first about which files count.
 */
export function packagesWithTask(readManifest, manifestPaths, task) {
  return readWorkspace(readManifest, manifestPaths)
    .filter(({ scripts }) => typeof scripts?.[task] === "string")
    .map(({ name }) => name)
    .sort();
}

/**
 * Every manifest in the workspace, asked of pnpm rather than assumed.
 *
 * 🔴 The globs are NOT written out here. `pnpm-workspace.yaml` also registers
 * the root-level `e2e`, which sits under neither `packages/` nor `apps/`, so a
 * check scanning those two directories would judge a workspace smaller than the
 * one that runs — and a package outside its scan is precisely the silent gap
 * this exists to report.
 */
export function workspaceManifests(cwd, run = execFileSync) {
  const projects = JSON.parse(
    run("pnpm", ["ls", "-r", "--depth", "-1", "--json"], {
      cwd,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    })
  );
  return projects
    .map(project => relative(cwd, project.path ?? ""))
    // The workspace root is a project to pnpm and not a package to this: it
    // declares no suites of its own and no lane selects it.
    .filter(directory => directory !== "" && directory !== ".")
    .map(directory => `${directory}/package.json`)
    .sort();
}

/**
 * The packages a plan actually runs the task for.
 *
 * turbo lists a task for every package a filter SELECTED, including those with
 * no such script, and marks the latter `<NONEXISTENT>`. Selecting a package is
 * not running it, and the difference is the whole point here: a location filter
 * reaches config packages that have no suites, and counting those would be this
 * check inventing coverage.
 */
export function packagesInPlan(plan, task) {
  return (plan.tasks ?? [])
    .filter(
      entry =>
        entry.task === task &&
        typeof entry.command === "string" &&
        entry.command !== "" &&
        entry.command !== "<NONEXISTENT>"
    )
    .map(entry => entry.package);
}

/**
 * turbo's plan for one lane script, taken from the script itself.
 *
 * `--dry=json` is appended to the real command rather than reconstructed, so
 * what is measured is what CI runs.
 *
 * 🔴 `--silent` is load-bearing. Without it pnpm echoes the package name and
 * the command before handing over, and finding the plan meant scanning for the
 * first `{` — which took a brace out of that preamble on a runner whose npm
 * warnings differ from a laptop's, and the whole check failed on a
 * `SyntaxError` at position 1. Silencing pnpm removes the preamble instead of
 * teaching a scanner to skip it, and the JSON then starts at the first byte.
 */
export function planForScript(script, cwd, run = execFileSync) {
  const output = run("pnpm", ["--silent", "run", script, "--dry=json"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  try {
    return JSON.parse(output.trim());
  } catch (error) {
    // Never a bare parse error: what this was reading is the only thing that
    // explains it, and a `SyntaxError` alone costs a CI round trip to diagnose.
    throw new Error(
      `\`pnpm ${script} --dry=json\` did not produce a turbo plan. ` +
        `${error.message}. It began: ${JSON.stringify(output.slice(0, 200))}`
    );
  }
}

/**
 * Whether a lane script is a single command whose failure reaches the job.
 *
 * 🔴 A shell operator can swallow a failure — `turbo run test ... || true`
 * plans exactly the same work and reports success however the suites end, so
 * the plan this check reads would be right while the gate was gone. Refusing
 * the operators is a containment test on one JSON string, not a reading of a
 * shell, which is the whole difference from the parser this replaced.
 */
export function directLaneCommand(packageName, taskCommand) {
  return `pnpm --filter ${packageName} exec ${taskCommand.trim()}`;
}

/**
 * Whether a direct lane script is exactly the package running its own task.
 *
 * RECONSTRUCTED and compared, rather than inspected. Asking whether the script
 * ends with the package's task command answered half the question: a script
 * reading `pnpm --filter @nextlyhq/admin exec vitest run` ends the same way, so
 * the lane could have reported the playground covered while running a different
 * package entirely. Building the command the entry implies and comparing it
 * settles the runner, the selector and the task in one comparison, with nothing
 * parsed.
 *
 * Deliberately rigid. There is one direct lane, and it exists because an app is
 * a leaf whose `test` dependsOn `^build` would pull the whole graph. A second
 * one needing a different shape is a reason to loosen this on purpose, not a
 * gap to leave open now.
 */
export function isDirectLaneFor(laneScript, packageName, taskCommand) {
  return laneScript.trim() === directLaneCommand(packageName, taskCommand);
}

export function namesScript(source, script) {
  // 🔴 Anchored at the END of the name, because these names nest:
  // `lane:test:playground` CONTAINS `lane:test`, so a plain containment test
  // let the playground step vouch for a Test step that had been replaced. The
  // mutation that found it passed a check reporting every package covered.
  // 🔴 And anchored at the END of the COMMAND, not just the name. `pnpm
  // lane:test --dry=json` would otherwise satisfy this while the step only
  // printed a plan — the check would measure the manifest's script and the job
  // would run something else. Nothing may follow the name but whitespace.
  const escaped = script.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`pnpm ${escaped}[ \\t]*(?=\\r?\\n|$)`).test(source);
}

export function isSingleCommand(script) {
  // A NEWLINE separates commands as surely as `;` does, and a lane reading
  // `turbo run test --dry=json\ntrue` plans the work, runs none of it, and
  // ends successfully — which is the whole bypass this predicate exists to
  // refuse. Substitution is refused with them: it can introduce a command the
  // text does not show.
  return !/[;&|\n\r`]/.test(script) && !script.includes("$(");
}

/** Packages that declare the task and no lane runs. */
export function unrunPackages(declared, covered) {
  const reached = new Set(covered);
  return declared.filter(name => !reached.has(name));
}

const invokedDirectly =
  process.argv[1] && process.argv[1].endsWith("check-test-lanes.mjs");

if (invokedDirectly) {
  let manifestPaths;
  try {
    manifestPaths = workspaceManifests(root);
  } catch {
    console.error(
      "check-test-lanes: pnpm could not list the workspace, so the set of " +
        "packages to judge is unknown rather than empty."
    );
    process.exit(2);
  }

  if (manifestPaths.length === 0) {
    console.error(
      "check-test-lanes: pnpm reported no workspace packages, so no package " +
        "could have been judged."
    );
    process.exit(2);
  }

  const readManifest = path => readFileSync(join(root, path), "utf8");
  const rootScripts = JSON.parse(readManifest("package.json")).scripts ?? {};
  const workspace = readWorkspace(readManifest, manifestPaths);

  const failures = [];
  const summary = [];

  for (const { task, workflow, scripts, direct } of LANES) {
    const declared = packagesWithTask(readManifest, manifestPaths, task);

    // The population, before the verdict. An empty side is satisfied by every
    // comparison below, so each would report a clean lane having examined
    // nothing.
    if (declared.length === 0) {
      console.error(
        `check-test-lanes: no package declares a \`${task}\` script, which ` +
          "would make every lane vacuously complete rather than correct."
      );
      process.exit(2);
    }

    const covered = new Set();
    for (const script of [...scripts, ...direct.map(entry => entry.script)]) {
      if (typeof rootScripts[script] !== "string") {
        console.error(
          `check-test-lanes: the root manifest declares no \`${script}\`, so ` +
            `the \`${task}\` lane cannot be asked what it runs.`
        );
        process.exit(2);
      }
      if (!isSingleCommand(rootScripts[script])) {
        failures.push(
          `\`${script}\` chains commands, so a shell operator could report ` +
            "success however the suites end. A lane script has to be one " +
            "command whose failure reaches the job."
        );
      }
      // The one thing still taken from the workflow, and it is a containment
      // test rather than a reading of the command. Named in the output below so
      // nobody takes this check for more than it proves.
      let source;
      try {
        source = readFileSync(join(root, workflow), "utf8");
      } catch {
        console.error(
          `check-test-lanes: ${workflow} could not be read, so nothing shows ` +
            `the \`${task}\` lane is still called.`
        );
        process.exit(2);
      }
      if (!namesScript(source, script)) {
        failures.push(
          `${workflow} does not run \`pnpm ${script}\`, so whatever that ` +
            "script selects reaches no job. Call it, or drop it from LANES."
        );
      }
    }

    for (const script of scripts) {
      let plan;
      try {
        plan = planForScript(script, root);
      } catch {
        // turbo refuses a filter that matches no package, which is how a lane
        // naming a package that has been renamed or removed surfaces. Reported
        // rather than swallowed: a lane whose plan cannot be produced is a lane
        // whose CI step fails too.
        console.error(
          `check-test-lanes: \`pnpm ${script}\` produced no plan. turbo refuses ` +
            "a filter that matches no package, so a lane naming one that is " +
            "gone fails here and in CI alike."
        );
        process.exit(2);
      }
      for (const name of packagesInPlan(plan, task)) covered.add(name);
    }
    /*
     * A `direct` entry is a claim that a script runs the package's WHOLE task,
     * and the claim is checked against the package rather than trusted.
     *
     * 🔴 Derived from the package's own task command, not from a list of the
     * vitest flags that narrow a run. Such a list would be a second, ageing
     * copy of vitest's options — `--changed`, `--shard`, `--project`,
     * `--testNamePattern` today, and whatever is added next. Requiring the lane
     * script to END with the command the package declares needs no such list:
     * anything appended stops matching, and a package that changes how it runs
     * its suites drags the lane with it.
     */
    for (const entry of direct) {
      const declaredBy = workspace.find(pkg => pkg.name === entry.package);
      const command = declaredBy?.scripts?.[task];
      if (typeof command !== "string") {
        failures.push(
          `${entry.package} is listed as run directly by \`${entry.script}\`, ` +
            `and it declares no \`${task}\` script for that to be running.`
        );
        continue;
      }
      if (!isDirectLaneFor(rootScripts[entry.script], entry.package, command)) {
        failures.push(
          `\`${entry.script}\` is not ${entry.package} running its own ` +
            `\`${task}\`. It has to read exactly ` +
            `\`${directLaneCommand(entry.package, command)}\`, so that the ` +
            "package it selects and the suites it runs are both the ones this " +
            "lane claims."
        );
        continue;
      }
      covered.add(entry.package);
    }

    if (covered.size === 0) {
      console.error(
        `check-test-lanes: the \`${task}\` lane runs nothing, so every package ` +
          "would read as uncovered rather than the lane as broken."
      );
      process.exit(2);
    }

    for (const name of unrunPackages(declared, [...covered])) {
      failures.push(
        `${name} declares \`${task}\` and no lane runs it, so its suites run ` +
          `nowhere. Add it to a \`lane:${task}\` script, or to that lane's ` +
          "`direct` list if a turbo selector cannot describe it."
      );
    }

    summary.push(
      `  ${task}: ${declared.length} package(s) declare it, ${covered.size} run by ` +
        `${scripts.length + direct.length} lane script(s)`
    );
  }

  if (failures.length > 0) {
    console.error("check-test-lanes: FAILED\n");
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }

  console.log("check-test-lanes: ok — every package's test task is run by a lane.");
  for (const line of summary) console.log(line);
  // Said on the way past rather than only in the source, so a reader taking
  // this as proof of coverage knows which shape it did not judge.
  console.log(
    "  asks turbo what each lane script runs; of the workflow it checks only " +
      "that the script is named, not how the step is guarded."
  );
}
