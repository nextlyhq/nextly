#!/usr/bin/env node

/**
 * Every package with a test task must be run by a workflow, and every filter a
 * workflow names must belong to a package that has one.
 *
 * Both lanes select what to run with a hand-written `--filter` list, repeated
 * per step. Nothing connects those lists to the packages that declare the
 * tasks, so the two drift in both directions and each drift is silent:
 *
 *   - a package declares the task and no command names it. Its suites run
 *     NOWHERE, and every job stays green — the shape a check cannot notice,
 *     because what it would have reported is simply absent. Measured on
 *     `e6797c5d1`: `nextly` (907 files, 11562 tests) and `@nextlyhq/admin`
 *     (407, 4061) had passed for weeks while neither gated a merge.
 *   - a filter keeps naming a package that no longer has the task. Turbo
 *     matches nothing and moves on, so the step reports success while the entry
 *     stands as a record of coverage nobody is getting.
 *
 * Both sides are DERIVED rather than restated. The packages come from reading
 * the manifests git tracks, and the lanes come from parsing the commands the
 * workflows actually run, so neither is a list kept in step by hand.
 *
 * 🔴 Running SOME of a package's files is not running its task. Two steps in
 * `ci.yml` invoke `vitest run` against named `nextly` files, ahead of the build,
 * so a schema-pipeline break surfaces early. Twelve files out of 907 is 1.3% of
 * that suite, and counting it as coverage is how the gap above survived: the
 * package looks present in the workflow. A command carrying file arguments
 * therefore covers nothing here.
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
 * The task each workflow is responsible for running.
 *
 * One entry per lane rather than one check per lane: the question is the same
 * both times, and asking it twice in two files is how the second copy drifts.
 */
const LANES = [
  { task: "test", workflow: ".github/workflows/ci.yml" },
  { task: "test:integration", workflow: ".github/workflows/integration.yml" },
];

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

/** Shell lines ending in a backslash are one command, so join them. */
export function joinContinuations(lines) {
  const commands = [];
  let pending = "";
  for (const line of lines) {
    if (line.endsWith("\\")) {
      pending += line.slice(0, -1).trimEnd() + " ";
      continue;
    }
    commands.push((pending + line).trim());
    pending = "";
  }
  if (pending.trim() !== "") commands.push(pending.trim());
  return commands;
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
    const scalar = /^[ \t]*([|>])[-+]?[ \t]*$/.exec(rest);
    if (scalar !== null) {
      const body = [];
      for (let line = index + 1; line < lines.length; line++) {
        const text = lines[line];
        if (text.trim() === "") continue;
        if (text.length - text.trimStart().length <= keyIndent) break;
        body.push(text.trim());
      }
      // 🔴 The two scalars mean different things and the difference decides
      // what a command IS. A literal block (`|`) keeps its newlines, so each
      // line is its own command. A FOLDED block (`>`) joins them with spaces
      // into one — which is how the unit step spells a `turbo test` and its
      // twenty filters, and reading those lines separately leaves a `turbo
      // test` selecting nobody and twenty flags running nothing.
      if (scalar[1] === ">") {
        if (body.length > 0) step.commands.push(body.join(" "));
      } else {
        // 🔴 A trailing backslash continues the command onto the next line, so
        // the lines are one command to the shell and must be one here. Reading
        // them apart is what made `vitest run \\` look like a whole-suite run:
        // its file arguments were on the lines that followed, and a run of
        // twelve named files then counted as covering all 907.
        step.commands.push(...joinContinuations(body));
      }
      continue;
    }
    if (rest.trim() !== "") step.commands.push(rest.trim());
  }
  return steps;
}

/**
 * The packages a single command runs the given task for.
 *
 * `null` when the command does not run that task at all, which is different
 * from running it for nobody.
 *
 * Two shapes count, and one deliberately does not:
 *   - `turbo test` / `turbo test:integration` runs the package's TASK;
 *     `test` is matched so it cannot also swallow `test:integration`.
 *   - a bare `vitest run` runs the whole suite of whatever it is filtered to,
 *     which is how the playground's tests are run.
 *   - 🔴 `vitest run <files>` does NOT. It runs part of a suite, and counting
 *     it as the task is what let `nextly` look covered by twelve of its 907
 *     files.
 */
export function fileArguments(rest) {
  return rest
    .split(/\s+/)
    .filter(token => token !== "")
    // `--name=value` carries its own value, so the whole token goes. A BARE
    // `--name` takes the flag only: whether the token after it is that flag's
    // value or a file is not something arity-free reading can know, and
    // consuming it is what let `vitest run --passWithNoTests src/a.test.ts`
    // read as a whole-suite run - a partial run counting as a package's task,
    // which is the one mistake this whole check exists to prevent.
    .filter(token => !token.startsWith("-"))
    // What remains is a flag's value or a file, and the two are told apart by
    // shape rather than by a table of vitest's options that would drift from
    // vitest. A path has a separator; a test file names itself even without
    // one. So `--config vitest.config.ts` leaves a value, and
    // `--passWithNoTests src/a.test.ts` leaves a file.
    .filter(token => token.includes("/") || /\.(test|spec)\.[cm]?[jt]sx?$/.test(token));
}

export function commandCoverage(command, task) {
  const runsTask =
    task === "test"
      ? /\bturbo\s+test(?![:\w])/.test(command)
      : new RegExp(`\\bturbo\\s+${task.replace(":", ":")}\\b`).test(command);
  const vitest = /\bvitest\s+run\b(.*)$/.exec(command);
  const wholeSuite =
    task === "test" && vitest !== null && fileArguments(vitest[1]).length === 0;
  if (!runsTask && !wholeSuite) return null;
  if (/--dir\b/.test(command)) return null;
  return filtersIn(command);
}

/**
 * What a command's `--filter` flags select, in the two forms turbo accepts.
 *
 * Every spelling the workflows use: `--filter=x`, `--filter x`, and either
 * quoted.
 *
 * turbo selects by NAME or by LOCATION, and the difference matters here. A
 * name is the package itself. A location like `./packages/*` is a directory
 * pattern, and which packages it selects is a fact about the tree rather than
 * about the command — so it is carried out whole and resolved against the
 * workspace by `selectedPackages`, where the manifests are known.
 *
 * A NAME wildcard such as `@nextlyhq/*` is dropped. It selects a set this
 * cannot enumerate without knowing which names exist, and crediting coverage
 * on a guess is the failure this check exists to prevent. Dropping it errs the
 * loud way: the packages go unclaimed and the lane reports them.
 */
export function filtersIn(command) {
  const names = [];
  const locations = [];
  for (const [, raw] of command.matchAll(/--filter[= ]\s*('[^']*'|"[^"]*"|\S+)/g)) {
    const filter = raw.replace(/^['"]|['"]$/g, "");
    if (filter.startsWith("./") || filter.startsWith("../")) {
      locations.push(filter);
      continue;
    }
    if (filter.includes("*")) continue;
    names.push(filter.replace(/[\^.]+\.\.\.$|\.\.\.$/, ""));
  }
  return { names, locations };
}

/**
 * Whether a location pattern selects a package sitting at `directory`.
 *
 * Only the two shapes turbo is given here: a literal directory, and a single
 * `*` standing for one path segment. `**` and the rest of glob are not
 * answered — an unrecognised pattern matches nothing, so a package it would
 * have covered is reported as unrun rather than quietly credited.
 */
export function locationMatches(pattern, directory) {
  const bare = pattern.replace(/^\.\//, "").replace(/\/$/, "");
  if (bare.includes("**") || bare.includes("?") || bare.includes("[")) {
    return false;
  }
  const expression = bare
    .split("/")
    .map(segment =>
      segment === "*"
        ? "[^/]+"
        : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    )
    .join("/");
  return new RegExp(`^${expression}$`).test(directory);
}

/**
 * Every package a lane's invocations select, names and locations together.
 *
 * `packages` is the workspace as `{ name, directory }`, so a location pattern
 * is resolved against the tree that will actually run rather than against a
 * second list of what is expected to be there.
 */
export function selectedPackages(invocations, packages) {
  const covered = new Set();
  const named = new Set();
  for (const invocation of invocations) {
    for (const name of invocation.filters.names) {
      covered.add(name);
      named.add(name);
    }
    for (const pattern of invocation.filters.locations) {
      for (const { name, directory } of packages) {
        if (locationMatches(pattern, directory)) covered.add(name);
      }
    }
  }
  return { covered: [...covered].sort(), named: [...named].sort() };
}

/**
 * Every command in the workflow that runs the task, with what it selects.
 *
 * Matched on the command rather than on a step name, because the name is prose
 * somebody can reword while the command is what runs.
 */
export function shellStatements(command) {
  const statements = [];
  let current = "";
  let quote = null;
  for (let index = 0; index < command.length; index++) {
    const character = command[index];
    if (quote !== null) {
      current += character;
      if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      current += character;
      continue;
    }
    const pair = command.slice(index, index + 2);
    if (pair === "&&" || pair === "||") {
      statements.push(current);
      current = "";
      index++;
      continue;
    }
    if (character === ";" || character === "|" || character === "&") {
      statements.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  statements.push(current);
  return statements.map(statement => statement.trim()).filter(Boolean);
}

export function taskInvocations(workflow, task) {
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
      // without a space after it: `cmd #--filter=x` runs `cmd`.
      const executable = command.split(/\s+#/)[0];
      // 🔴 A `--filter` belongs to the command it was written on, and a shell
      // line can hold several. Reading the line whole credits `turbo test`
      // with the packages a `turbo build` beside it selects, and those suites
      // then run nowhere while the lane reports them covered — the same silent
      // shape this check exists to catch, produced by the check itself.
      for (const statement of shellStatements(executable)) {
        const filters = commandCoverage(statement, task);
        if (filters === null) continue;
        invocations.push({ line: statement, filters });
      }
    }
  }
  return invocations;
}

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
    packages.push({
      name: manifest.name,
      // What a `--filter=./packages/*` is matched against. The manifest's
      // own location, so nothing has to agree with it separately.
      directory: path.replace(/(^|\/)package\.json$/, "") || ".",
      scripts: manifest.scripts ?? {},
    });
  }
  return packages;
}

/**
 * Every manifest that declares the task, by package name.
 *
 * Derived from `readWorkspace` rather than reading the manifests a second
 * time: the two answers are about the same packages, and a second reader is
 * one edit away from disagreeing with the first about which files count.
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
 * check scanning those two directories would judge a workspace smaller than
 * the one that runs — and a package outside its scan is precisely the silent
 * gap this exists to report. pnpm resolves its own membership, so there is no
 * second list of what the workspace contains and nothing to keep in step.
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
    // declares no suites of its own and no filter selects it.
    .filter(directory => directory !== "" && directory !== ".")
    .map(directory => `${directory}/package.json`)
    .sort();
}

/**
 * What the two sides disagree about, in both directions.
 *
 * The two directions do not ask about the same set, which is why `selection`
 * carries both. `covered` answers whether a package's suites run at all, and a
 * location pattern counts there. `named` answers whether a written-out filter
 * still refers to a package that has the task — a question only a NAME can
 * fail, because naming a package is a claim about that package. A location
 * selects a PLACE, and turbo skipping something there that declares no such
 * script is the pattern working, not a stale entry.
 */
export function laneDrift(declared, selection) {
  const coveredSet = new Set(selection.covered);
  const declaredSet = new Set(declared);
  return {
    unrun: declared.filter(name => !coveredSet.has(name)),
    stale: selection.named.filter(name => !declaredSet.has(name)),
  };
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
  const packages = readWorkspace(readManifest, manifestPaths);

  const failures = [];
  const summary = [];

  for (const { task, workflow } of LANES) {
    let source;
    try {
      source = readFileSync(join(root, workflow), "utf8");
    } catch {
      console.error(
        `check-test-lanes: ${workflow} could not be read, so the \`${task}\` lane ` +
          "has nothing to be compared against."
      );
      process.exit(2);
    }

    const invocations = taskInvocations(source, task);
    const declared = packagesWithTask(readManifest, manifestPaths, task);
    const selection = selectedPackages(invocations, packages);

    // The population, before the verdict. An empty side is satisfied by every
    // comparison below, so each would report a clean lane having examined
    // nothing.
    if (invocations.length === 0) {
      console.error(
        `check-test-lanes: ${workflow} runs no \`${task}\`. Either the steps were ` +
          "rewritten and this check needs teaching, or the lane has stopped " +
          "running and every package would read as covered."
      );
      process.exit(2);
    }
    if (declared.length === 0) {
      console.error(
        `check-test-lanes: no package declares a \`${task}\` script, which would ` +
          "make every filter in that lane stale rather than the lane clean."
      );
      process.exit(2);
    }

    const { unrun, stale } = laneDrift(declared, selection);
    for (const name of unrun) {
      failures.push(
        `${name} declares \`${task}\` and nothing ${workflow} runs selects it, ` +
          "so its suites run nowhere. Either it sits outside the locations the " +
          "lane already selects, or it needs naming in the step that runs " +
          `\`${task}\`.`
      );
    }
    for (const name of stale) {
      failures.push(
        `${workflow} filters for ${name} in the \`${task}\` lane, and it declares ` +
          "no such script. Turbo matches no task and the step passes without " +
          "running it; drop the filter or add the script."
      );
    }
    summary.push(
      `  ${task}: ${declared.length} package(s), ${invocations.length} invocation(s) in ${workflow}`
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
  // this as proof of coverage knows which shapes it did not judge.
  console.log(
    "  reads step `run:` by indentation, not YAML: a job-level condition, a " +
      "step disabled by an expression, or a `#` inside quotes are not seen."
  );
}
