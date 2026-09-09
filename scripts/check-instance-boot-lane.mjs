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
 * import hides the binding from the import clause, so the property access
 * `<ns>.createTestNextly` counts as well, and for the same reason: it is a fact
 * about the name rather than about where the name came from.
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
export function testFiles(cwd, run = execFileSync) {
  const listed = run("git", ["ls-files", "-z", "--", "packages"], {
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
   * as `testing.createTestNextly()`. Deciding that from the import alone would
   * need a list of the modules the helper can live in, which is the specifier
   * list this deliberately does not keep. The property access is the fact
   * instead, and it is one the compiler reports, so a comment or a string
   * spelling the same thing is still not a boot.
   */
  let reachedThroughNamespace = false;
  const findPropertyAccess = node => {
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === BOOT_BINDING
    ) {
      reachedThroughNamespace = true;
      return;
    }
    ts.forEachChild(node, findPropertyAccess);
  };
  ts.forEachChild(parsed, findPropertyAccess);
  if (reachedThroughNamespace) return true;

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
  const [, name] = path.split("/");
  return name ? `packages/${name}` : undefined;
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
  const covered = [];

  for (const path of files) {
    let source;
    try {
      source = readSource(path);
    } catch {
      continue; // a file git lists and the disk cannot read is the linter's business
    }
    if (!importsBootHelper(source, path)) continue;

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

  return { misrouted, stranded, covered };
}

const invokedDirectly =
  process.argv[1] && process.argv[1].endsWith("check-instance-boot-lane.mjs");

if (invokedDirectly) {
  const files = testFiles(root);

  if (files.length === 0) {
    console.error(
      "check-instance-boot-lane: git listed no test files under packages/, so " +
        "no file could have been judged."
    );
    process.exit(2);
  }

  const readSource = path => readFileSync(join(root, path), "utf8");
  const { misrouted, stranded, covered } = classify(files, readSource);

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

  if (misrouted.length > 0 || stranded.length > 0) {
    console.error("check-instance-boot-lane: FAILED\n");

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
      `instance are named for the integration lane AND run by a package that ` +
      `declares one, out of ${files.length} test file(s) scanned.`
  );
  // Said on the way past, so a reader taking this as proof of routing knows the
  // shape it did not judge.
  console.log(
    `  decides on a parsed import of \`${BOOT_BINDING}\`; a helper that boots ` +
      "under another name is not something this reads."
  );
}
