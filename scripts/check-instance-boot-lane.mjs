#!/usr/bin/env node

/**
 * A suite that boots a real Nextly instance runs in the integration lane.
 *
 * The two lanes are told apart by FILENAME and by nothing else. A package's
 * `vitest.config.ts` includes `src/**\/*.{test,spec}.{ts,tsx}` and excludes
 * `src/**\/*.integration.test.ts`; its `vitest.integration.config.ts` includes
 * exactly that suffix, and gives it a 30s budget with `fileParallelism: false`.
 * A boot named for the unit lane therefore runs under a budget sized for jsdom
 * component tests, against every other package turbo is building at the time.
 *
 * That failure is quiet and intermittent, which is why it survives review: the
 * file passes locally in about a second and times out only on a loaded runner.
 * The package configs already record the shape of it, including that raising
 * the unit budget was the previous answer and was exceeded.
 *
 * 🔴 IMPORTS ARE PARSED, NOT MATCHED AS TEXT. Of the files naming
 * `createTestNextly` outside the integration suffix, most name it in prose: a
 * docblock explaining why a spy is used instead, or why a cache is not shared.
 * A containment test over the source would report each of those, and a check
 * that fires on correct files is one that gets silenced. The compiler decides
 * what is an import here, so a comment cannot be one.
 *
 * ⚠️ The BINDING is what identifies a boot, not the module it comes from. The
 * helper is imported under nine different specifiers - `nextly/testing`,
 * `@nextlyhq/plugin-sdk/testing`, and seven relative paths that differ only by
 * depth - so a specifier list would be a list of the ways a directory can be
 * reached, and a file one level deeper would fall out of the scan. A namespace
 * import hides the binding from the import clause, so a property access through
 * an identifier a `NamespaceImport` introduced counts as well. The receiver is
 * checked rather than the property name alone: a suite's own fixture exposing
 * that name boots nothing, and reporting it would be a check firing on a
 * correct file.
 *
 * ⚠️ Being named for the lane is half of being in it. A package that declares
 * no `test:integration` runs nothing matching the suffix, so a correctly named
 * boot there is reported too: that suite is not slow, it is unrun, and green
 * because of it.
 *
 * ⚠️ What this does not judge: a helper that boots an instance behind another
 * name. This names one binding because one binding is what the repository uses;
 * a second wrapper is a reason to add it here deliberately.
 *
 * Usage:
 *   node scripts/check-instance-boot-lane.mjs
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The binding whose presence means a test boots a real instance. */
export const BOOT_BINDING = "createTestNextly";

/** The suffix that routes a file to the integration lane. */
export const INTEGRATION_SUFFIX = ".integration.test.ts";

/*
 * What the unit lane collects, which is the population that can be misrouted.
 *
 * `spec` is here because the unit configs take it - `src/**\/*.{test,spec}.{ts,tsx}`,
 * and `src/**\/*.spec.ts` where the two are written out - while every
 * integration config takes `*.integration.test.ts` and nothing else. A booting
 * suite named `.spec.ts` is therefore not merely misrouted, it is unroutable
 * under its current name, and a scan that skipped the suffix would call the
 * repository clean while one sat in the unit lane.
 */
export const UNIT_LANE_SUFFIXES = [
  ".test.ts",
  ".test.tsx",
  ".spec.ts",
  ".spec.tsx",
];

/**
 * Every tracked test file, from git rather than a directory walk.
 *
 * `git ls-files` answers with what is committed, so a build artifact or an
 * ignored scratch file cannot enter the population and be judged.
 */
export function testFiles(cwd, run = execFileSync, root) {
  const listed = run("git", ["ls-files", "-z", "--", root], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return listed
    .split("\0")
    .filter(Boolean)
    .filter(path => UNIT_LANE_SUFFIXES.some(suffix => path.endsWith(suffix)));
}

/**
 * The roots this scans, listed SEPARATELY so each carries its own control.
 *
 * 🔴 One combined listing cannot report a root that went missing. With both
 * roots in one pathspec, misspelling `templates` still returned two thousand
 * package files, so `covered` stayed large, the run reported success, and the
 * only trace was a count nobody compares between runs: 225 of 2073 rather than
 * 226 of 2074. The shipped template would have stopped being scanned while the
 * output went on claiming every booting suite was checked.
 *
 * Asking per root makes each one's emptiness its own answer.
 */
export const SCAN_ROOTS = ["packages", "templates"];

/**
 * Whether a source file IMPORTS the boot helper.
 *
 * Walks the statement list rather than the whole tree: an import declaration is
 * only legal at the top level, so anything deeper that looks like one is not
 * one. `import type { createTestNextly }` is not a boot either, and the
 * compiler marks that on both the clause and the individual specifier.
 */
export function importsBootHelper(source, fileName = "test.ts") {
  const parsed = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );

  /*
   * A namespace import hides the binding from the import clause: `import * as
   * testing from "..."` names only `testing`, and the helper is reached later
   * as `testing.createTestNextly()`.
   *
   * 🔴 The RECEIVER is checked, not just the property name. Accepting any
   * `<anything>.createTestNextly` would report a suite whose own fixture or mock
   * happens to expose that name - `fixture.createTestNextly()` boots nothing -
   * and a check that demands an integration rename for a correct file is one
   * that gets turned off. Only identifiers a `NamespaceImport` actually
   * introduced count, so the receiver has to be a module this file imported.
   */
  const namespaces = new Set();
  for (const statement of parsed.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
    }
  }

  if (namespaces.size > 0) {
    let reachedThroughNamespace = false;
    const findPropertyAccess = node => {
      if (reachedThroughNamespace) return;
      if (
        ts.isPropertyAccessExpression(node) &&
        node.name.text === BOOT_BINDING &&
        ts.isIdentifier(node.expression) &&
        namespaces.has(node.expression.text)
      ) {
        reachedThroughNamespace = true;
        return;
      }
      ts.forEachChild(node, findPropertyAccess);
    };
    ts.forEachChild(parsed, findPropertyAccess);
    if (reachedThroughNamespace) return true;
  }

  for (const statement of parsed.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    const bindings = clause.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;

    for (const element of bindings.elements) {
      if (element.isTypeOnly) continue;
      // `import { createTestNextly as boot }` still boots an instance, so the
      // name that matters is the one on the module's side of the rename.
      const imported = element.propertyName ?? element.name;
      if (imported.text === BOOT_BINDING) return true;
    }
  }

  return false;
}

/**
 * Whether a path is a scaffolded project rather than one of this repo's packages.
 *
 * The two are judged by different rules because they are different shapes. A
 * package here sits in a monorepo with two lanes and a build running beside it,
 * so a boot is routed to the lane sized for one. A template is a single-package
 * project a user receives with one vitest config, one test script and nothing
 * to contend with, so there is no second lane to route to and inventing one
 * would put monorepo machinery in someone's new plugin. What it can do is state
 * a budget, which is the thing the routing was buying.
 */
export function isTemplate(path) {
  return path.startsWith("templates/");
}

/** The vitest budget a boot needs, whichever mechanism supplies it. */
export const BOOT_BUDGET_MS = 30_000;

/**
 * Whether a config states timeouts a boot can finish inside.
 *
 * Read off the parsed config rather than matched in the text, for the same
 * reason the imports are: a number in a comment explaining the defaults is not
 * a number vitest will use. Both budgets are required because a boot in
 * `beforeEach` is governed by `hookTimeout` and the case body by `testTimeout`,
 * and vitest's defaults for the two differ.
 */
export function statesBootBudget(source) {
  const parsed = ts.createSourceFile(
    "vitest.config.ts",
    source,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS
  );

  /*
   * 🔴 Only the object vitest is actually handed counts. A walk over the whole
   * file records a `testTimeout` wherever it appears, including in a constant
   * nobody passes anywhere, so a config could name the budgets in a decoy and
   * export one that omits them: the check goes green and the suite runs on the
   * defaults. What is traced instead is the default export, through
   * `defineConfig(...)` if it is wrapped, down to its `test` property.
   */
  const exported = parsed.statements.find(ts.isExportAssignment);
  if (!exported) return false;

  let config = exported.expression;
  // `defineConfig({...})` is a passthrough; an object literal may be exported
  // directly, and vitest accepts both.
  if (ts.isCallExpression(config)) {
    if (config.arguments.length === 0) return false;
    config = config.arguments[0];
  }
  if (!ts.isObjectLiteralExpression(config)) return false;

  const test = config.properties.find(
    property =>
      ts.isPropertyAssignment(property) &&
      ts.isIdentifier(property.name) &&
      property.name.text === "test" &&
      ts.isObjectLiteralExpression(property.initializer)
  );
  if (!test) return false;

  const budgets = new Map();
  for (const property of test.initializer.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      ts.isIdentifier(property.name) &&
      ts.isNumericLiteral(property.initializer)
    ) {
      budgets.set(property.name.text, Number(property.initializer.text));
    }
  }

  return (
    (budgets.get("testTimeout") ?? 0) >= BOOT_BUDGET_MS &&
    (budgets.get("hookTimeout") ?? 0) >= BOOT_BUDGET_MS
  );
}

/** The package directory a file belongs to, as `packages/<name>`. */
/**
 * The name this file needs in order to be collected by the integration lane.
 *
 * Every unit-lane suffix maps to the one suffix an integration config takes, so
 * a `.spec.ts` is renamed as far as `.integration.test.ts` rather than to a
 * `.spec` form no config would collect.
 */
export function integrationName(path) {
  return path.replace(/\.(test|spec)\.tsx?$/, INTEGRATION_SUFFIX);
}

export function packageOf(path) {
  const [root, name] = path.split("/");
  return name ? `${root}/${name}` : undefined;
}

/**
 * Whether a package can actually run an integration suite.
 *
 * Renaming a file into a lane its package does not have would move it out of
 * the unit run and into nothing, which is a worse outcome than the timeout: the
 * suite stops reporting and every job stays green. So the instruction this
 * check gives depends on the answer.
 */
export function hasIntegrationLane(packageDir, readManifest) {
  try {
    const pkg = JSON.parse(readManifest(join(packageDir, "package.json")));
    return typeof pkg?.scripts?.["test:integration"] === "string";
  } catch {
    return false;
  }
}

/**
 * The verdict for one population of files.
 *
 * `covered` is the positive control and is returned rather than logged, because
 * a scan that finds no boots at all has not proved every boot is in the right
 * lane; it has proved the parser stopped recognising them.
 */
export function classify(files, readSource) {
  const misrouted = [];
  const stranded = [];
  const underBudget = [];
  const covered = [];

  for (const path of files) {
    let source;
    try {
      source = readSource(path);
    } catch {
      continue; // a file git lists and the disk cannot read is the linter's business
    }
    if (!importsBootHelper(source, path)) continue;

    /*
     * A template boots in the one lane it has, so the question is whether that
     * lane states a budget a boot can finish inside. Demanding the integration
     * suffix here would demand a second config and a second script in a project
     * that ships with one test.
     */
    if (isTemplate(path)) {
      const configPath = `${packageOf(path)}/vitest.config.ts`;
      let config;
      try {
        config = readSource(configPath);
      } catch {
        underBudget.push({ path, configPath, reason: "has no vitest config" });
        continue;
      }
      if (!statesBootBudget(config)) {
        underBudget.push({
          path,
          configPath,
          reason: `does not set testTimeout and hookTimeout to at least ${BOOT_BUDGET_MS}ms`,
        });
        continue;
      }
      covered.push(path);
      continue;
    }

    if (!path.endsWith(INTEGRATION_SUFFIX)) {
      misrouted.push(path);
      continue;
    }

    /*
     * The name is only half of being routed. A package that declares no
     * `test:integration` runs nothing matching the suffix, so a correctly named
     * boot there is not in a slower lane, it is in no lane: it stops reporting
     * and every job stays green. That is the worse of the two failures, and
     * judging the name alone would have called it the clean case.
     */
    const packageDir = packageOf(path);
    if (packageDir && !hasIntegrationLane(packageDir, readSource)) {
      stranded.push(path);
      continue;
    }

    covered.push(path);
  }

  return { misrouted, stranded, underBudget, covered };
}

const invokedDirectly =
  process.argv[1] && process.argv[1].endsWith("check-instance-boot-lane.mjs");

if (invokedDirectly) {
  const files = [];
  for (const scanRoot of SCAN_ROOTS) {
    const found = testFiles(root, execFileSync, scanRoot);
    if (found.length === 0) {
      console.error(
        `check-instance-boot-lane: git listed no test files under ${scanRoot}/, ` +
          "so nothing there could have been judged and a clean run would be " +
          "reporting on a root it never read."
      );
      process.exit(2);
    }
    files.push(...found);
  }

  const readSource = path => readFileSync(join(root, path), "utf8");
  const { misrouted, stranded, underBudget, covered } = classify(files, readSource);

  // The control, before the verdict. Every file failing to parse, or the
  // binding being renamed upstream, produces an empty `misrouted` that reads
  // exactly like a clean repository.
  if (covered.length === 0) {
    console.error(
      `check-instance-boot-lane: no file imports \`${BOOT_BINDING}\` at all, ` +
        "which would make every suite vacuously well-routed rather than " +
        "correctly routed. The binding has been renamed, or the parse is failing."
    );
    process.exit(2);
  }

  if (misrouted.length > 0 || stranded.length > 0 || underBudget.length > 0) {
    console.error("check-instance-boot-lane: FAILED\n");

    for (const { path, configPath, reason } of underBudget) {
      console.error(
        `  ${path}\n` +
          `    boots an instance, and ${configPath} ${reason}.\n` +
          `    A scaffolded project has one lane and nothing to contend with, so\n` +
          `    it states the budget rather than routing around it: set\n` +
          `    testTimeout and hookTimeout to ${BOOT_BUDGET_MS}. A boot in\n` +
          "    `beforeEach` is governed by hookTimeout, the case body by\n" +
          "    testTimeout, and vitest's defaults for the two differ.\n"
      );
    }

    for (const path of stranded) {
      console.error(
        `  ${path}\n` +
          `    is named for the integration lane, and ${packageOf(path)} declares ` +
          "no `test:integration` script, so nothing runs it at all.\n" +
          "    Give the package an integration config and script, or the suite is " +
          "green because it never ran.\n"
      );
    }

    for (const path of misrouted) {
      const packageDir = packageOf(path);
      const renamed = integrationName(path);
      console.error(
        `  ${path}\n` +
          `    imports \`${BOOT_BINDING}\`, so it boots a real instance and needs ` +
          `the integration lane's budget.\n` +
          `    Rename it to ${renamed}.`
      );
      // `readSource` already resolves against the repository root, so the
      // package directory is passed as it was derived: repository-relative.
      if (packageDir && !hasIntegrationLane(packageDir, readSource)) {
        console.error(
          `    ⚠️  ${packageDir} declares no \`test:integration\` script, so the ` +
            "rename alone would move this suite out of the unit lane and into " +
            "no lane at all. Give the package an integration config and script " +
            "first."
        );
      }
      console.error("");
    }
    process.exit(1);
  }

  console.log(
    `check-instance-boot-lane: ok - ${covered.length} suite(s) that boot an ` +
      `instance have a budget sized for one, out of ${files.length} test ` +
      "file(s) scanned."
  );
  console.log(
    "  a package suite earns it by running in the integration lane; a " +
      "scaffolded template by stating the timeouts, having only one lane."
  );
  // Said on the way past, so a reader taking this as proof of routing knows the
  // shape it did not judge.
  console.log(
    `  decides on a parsed import of \`${BOOT_BINDING}\`; a helper that boots ` +
      "under another name is not something this reads."
  );
}
