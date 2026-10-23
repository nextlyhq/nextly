/**
 * What `test-changed.mjs` decides for each package a push touches: run every
 * test, or only the files `--changed` selects plus the guards. Each decision is
 * a pure function here, so the cases below hold the reasons the selection is
 * safe: a change no record can see sends the package to its full suite.
 */
import { describe, expect, it } from "vitest";

import {
  declaredReaders,
  emptySelectionReason,
  fullRunReason,
  isUnitTestFile,
  listedFiles,
  readsOutsideTheGraph,
  scriptTestsNeeded,
  selectedFiles,
  testArgs,
  staleRecordsReason,
  workspacesToTest,
} from "./test-changed.mjs";

const nextly = {
  name: "nextly",
  dependencies: { "@nextlyhq/adapter-drizzle": "workspace:*", zod: "^4.0.0" },
  devDependencies: { "@nextlyhq/tsconfig": "workspace:*" },
};

const reasonFor = (changed, changedPackages = ["nextly"]) =>
  fullRunReason({ dir: "packages/nextly", manifest: nextly, changed, changedPackages });

describe("when a package runs every test", () => {
  it("does for a change every test compiles or resolves against", () => {
    for (const path of [
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "tsconfig.json",
      "tsconfig.base.json",
      "packages/tsconfig/base.json",
      ".nvmrc",
      "packages/nextly/tsconfig.json",
      "packages/nextly/tsconfig.tests.json",
    ]) {
      expect(reasonFor([path]), path).not.toBeNull();
    }
  });

  it("does when a workspace package it depends on changed too, since that arrives as built output", () => {
    expect(reasonFor(["packages/nextly/src/a.ts"], ["nextly", "@nextlyhq/adapter-drizzle"])).toMatch(
      /@nextlyhq\/adapter-drizzle changed too/
    );
  });

  it("selects for a change inside its own source only", () => {
    expect(reasonFor(["packages/nextly/src/domains/a.ts", "docs/guide.mdx"])).toBeNull();
  });

  it("selects when the other changed package is not one it depends on", () => {
    expect(reasonFor(["packages/nextly/src/a.ts"], ["nextly", "@nextlyhq/ui"])).toBeNull();
  });

  it("selects for another package's tsconfig, which this one does not compile against", () => {
    expect(reasonFor(["packages/admin/tsconfig.json"])).toBeNull();
  });
});

describe("which tests always run", () => {
  it("are the ones that read files or run processes, which no record names", () => {
    for (const source of [
      'import { readFileSync } from "node:fs";',
      "import fs from 'fs';",
      'import { readFile } from "node:fs/promises";',
      'import fs from "fs-extra";',
      'import { execFileSync } from "node:child_process";',
      'import { execa } from "execa";',
      'const fs = require("node:fs");',
      'const { readFile } = await import("node:fs/promises");',
    ]) {
      expect(readsOutsideTheGraph(source), source).toBe(true);
    }
  });

  it("are not the ones that only import code", () => {
    for (const source of [
      'import { join } from "node:path";',
      'import { describe } from "vitest";',
      'import { fsSafe } from "../fs-safe";',
      "// reads fs in a comment, imports nothing",
    ]) {
      expect(readsOutsideTheGraph(source), source).toBe(false);
    }
  });
});

describe("the files a selected run covers", () => {
  it("are what --changed picked and the guards, once each, in a stable order", () => {
    expect(selectedFiles(["src/b.test.ts", "src/a.test.ts"], ["src/a.test.ts", "src/c.test.ts"])).toEqual([
      "src/a.test.ts",
      "src/b.test.ts",
      "src/c.test.ts",
    ]);
  });

  it("are unit test files, never integration tests the unit config leaves out", () => {
    expect(isUnitTestFile("packages/nextly/src/a.test.ts")).toBe(true);
    expect(isUnitTestFile("packages/admin/src/b.test.tsx")).toBe(true);
    expect(isUnitTestFile("scripts/c.test.mjs")).toBe(true);
    expect(isUnitTestFile("packages/nextly/src/a.integration.test.ts")).toBe(false);
    expect(isUnitTestFile("packages/nextly/src/a.ts")).toBe(false);
  });
});

describe("the command one package's tests run with", () => {
  // `pnpm run test -- <args>` hands Vitest a literal `--`, after which it
  // ignores every file and flag it is given: the whole suite runs, with no
  // worker limit. So the files and flags follow the script name directly.
  it("passes the selected files and the worker limit straight to the script", () => {
    const args = testArgs("nextly", ["src/a.test.ts", "src/b.test.ts"], "2");
    expect(args).not.toContain("--");
    expect(args).toEqual([
      "--filter",
      "nextly",
      "run",
      "test",
      "src/a.test.ts",
      "src/b.test.ts",
      "--maxWorkers=2",
    ]);
  });

  it("passes the worker limit to a full run the same way", () => {
    expect(testArgs("nextly", [], "3")).toEqual([
      "--filter",
      "nextly",
      "run",
      "test",
      "--maxWorkers=3",
    ]);
  });

  // A full run that finds no tests is the package script's verdict, and a file
  // list that matches nothing is a selection gone wrong: neither is a pass.
  it("never passes with no tests on the gate's behalf", () => {
    expect(testArgs("nextly", [], "2")).not.toContain("--passWithNoTests");
    expect(testArgs("nextly", ["src/a.test.ts"], "2")).not.toContain("--passWithNoTests");
  });
});

describe("when the root scripts tests run too", () => {
  // `turbo run test` never reaches them, and they are what hold the task graph,
  // the hooks and every Vitest config to what the gates assume.
  // They read the root's files with `fs`, so every root path counts, not a
  // list of the ones they are known to read today.
  const dirs = ["packages/nextly", "packages/ui", "packages/admin-css", "e2e"];

  it("does for any path outside every workspace", () => {
    for (const path of [
      "scripts/gate-scope.mjs",
      "turbo.jsonc",
      "vitest.config.ts",
      ".husky/pre-push",
      ".github/workflows/ci.yml",
      "pnpm-lock.yaml",
      "docs/a.mdx",
      "packages/nextly-extra/a.ts",
    ]) {
      expect(scriptTestsNeeded([path], dirs), path).toBe(true);
    }
  });

  it("does for a Vitest config inside a workspace", () => {
    for (const path of [
      "packages/nextly/vitest.config.ts",
      "packages/admin-css/vitest.config.mjs",
      "packages/nextly/vitest.integration.config.ts",
    ]) {
      expect(scriptTestsNeeded([path], dirs), path).toBe(true);
    }
  });

  it("does not for code inside a workspace", () => {
    expect(
      scriptTestsNeeded(["packages/nextly/src/a.ts", "packages/ui/scripts/build.mjs", "e2e/a.spec.ts"], dirs)
    ).toBe(false);
  });
});

describe("what `vitest list --changed` printed", () => {
  const dir = "/repo/packages/blocks-engine";

  it("is read as files relative to the package", () => {
    const out = JSON.stringify([
      { file: `${dir}/src/component-graph.test.ts`, projectName: "" },
      `${dir}/src/nesting.test.ts`,
    ]);
    expect(listedFiles(out, dir)).toEqual(["src/component-graph.test.ts", "src/nesting.test.ts"]);
  });

  it("is an empty selection when it lists nothing", () => {
    expect(listedFiles("[]", dir)).toEqual([]);
  });

  // Each of these sends the package to its full suite rather than to no tests.
  it("is unreadable, never an empty selection, when it is not that list", () => {
    expect(listedFiles("", dir)).toBeNull();
    expect(listedFiles("Error: no config", dir)).toBeNull();
    expect(listedFiles('{"files":[]}', dir)).toBeNull();
    expect(listedFiles('[{"name":"x"}]', dir)).toBeNull();
  });
});

describe("which workspaces a push tests", () => {
  const workspaces = [
    { name: "nextly", dir: "packages/nextly" },
    { name: "@nextlyhq/ui", dir: "packages/ui" },
    { name: "@nextlyhq/tsconfig", dir: "packages/tsconfig" },
    { name: "@nextlyhq/e2e", dir: "e2e" },
  ];
  const scripts = { nextly: "vitest run", "@nextlyhq/ui": "vitest run" };
  // Turbo declaring no root input for any of them, as for a source change.
  const nothingDeclared = { everyReason: null, packages: new Map() };
  const plan = (paths, filters) =>
    workspacesToTest({ workspaces, filters, paths, testScriptOf: w => scripts[w.name], declared: nothingDeclared });
  const names = list => list.map(w => w.name);

  it("are the ones gate-scope scoped it to", () => {
    expect(names(plan(["packages/ui/src/a.tsx"], ["@nextlyhq/ui"]).testable)).toEqual(["@nextlyhq/ui"]);
  });

  // Gate-scope scopes these to no package, or to the config package alone,
  // which has no tests: without the widening nothing that compiles against
  // them would run.
  it("are every testable workspace when a global input changes", () => {
    for (const [path, filters] of [
      [".nvmrc", []],
      ["tsconfig.base.json", []],
      ["packages/tsconfig/base.json", ["@nextlyhq/tsconfig"]],
    ]) {
      expect(names(plan([path], filters).testable), path).toEqual(["nextly", "@nextlyhq/ui"]);
    }
  });

  it("leave out a workspace with no test script, and say which", () => {
    const { testable, untestable } = plan(["e2e/a.spec.ts", "packages/nextly/src/a.ts"], ["@nextlyhq/e2e", "nextly"]);
    expect(names(testable)).toEqual(["nextly"]);
    expect(names(untestable)).toEqual(["@nextlyhq/e2e"]);
  });
});

describe("a selection that came back empty", () => {
  it("stands while the package still has tests to discover", () => {
    expect(emptySelectionReason(["src/a.test.ts"])).toBeNull();
  });

  // A config that now excludes everything, or a deleted test directory, also
  // selects nothing: the package's own script decides whether that passes.
  it("runs the package in full when Vitest discovers no test file at all", () => {
    expect(emptySelectionReason([])).toMatch(/discovers no test file/);
  });

  it("runs the package in full when Vitest could not say", () => {
    expect(emptySelectionReason(null)).toMatch(/could not say/);
  });
});

describe("what turbo declares the test tasks read outside their packages", () => {
  // The shape `turbo run test --dry=json` prints, cut down to what is read.
  const dry = {
    globalCacheInputs: { files: { "scripts/vitest-dom-setup.ts": "h", "packages/tsconfig/base.json": "h" } },
    tasks: [
      {
        task: "test",
        package: "create-nextly-app",
        directory: "packages/create-nextly-app",
        inputs: { "src/a.ts": "h", "../../templates/plugin/README.md": "h", "../../skills/a/SKILL.md": "h" },
      },
      { task: "test", package: "nextly", directory: "packages/nextly", inputs: { "src/a.ts": "h" } },
      { task: "build", package: "nextly", directory: "packages/nextly", inputs: { "../../docs/a.mdx": "h" } },
    ],
  };

  it("runs a package whose test task declares a changed root file", () => {
    const declared = declaredReaders(dry, ["templates/plugin/README.md"]);
    expect(declared.everyReason).toBeNull();
    expect([...declared.packages.keys()]).toEqual(["create-nextly-app"]);
    expect(declared.packages.get("create-nextly-app")).toMatch(/templates\/plugin\/README\.md changed/);
  });

  it("runs every package for a file turbo hashes into every task", () => {
    expect(declaredReaders(dry, ["scripts/vitest-dom-setup.ts"]).everyReason).toMatch(/vitest-dom-setup/);
  });

  it("reads only test tasks, and only files outside the package", () => {
    const declared = declaredReaders(dry, ["docs/a.mdx", "packages/nextly/src/a.ts"]);
    expect(declared.everyReason).toBeNull();
    expect(declared.packages.size).toBe(0);
  });

  // An unreadable dry run must not read as "nothing declared".
  it("is unreadable, never empty, when it is not a dry run", () => {
    expect(declaredReaders(undefined, ["templates/a"])).toBeNull();
    expect(declaredReaders({ tasks: "x" }, ["templates/a"])).toBeNull();
  });

  it("widens the workspaces a push tests", () => {
    const workspaces = [
      { name: "nextly", dir: "packages/nextly" },
      { name: "create-nextly-app", dir: "packages/create-nextly-app" },
    ];
    const testScriptOf = () => "vitest run";
    const names = declared =>
      workspacesToTest({ workspaces, filters: [], paths: ["templates/plugin/README.md"], testScriptOf, declared }).testable.map(w => w.name);
    expect(names(declaredReaders(dry, ["templates/plugin/README.md"]))).toEqual(["create-nextly-app"]);
    expect(names(declaredReaders(dry, ["scripts/vitest-dom-setup.ts"]))).toEqual(["nextly", "create-nextly-app"]);
    // No declaration at all is treated as everything.
    expect(names(undefined)).toEqual(["nextly", "create-nextly-app"]);
  });
});

describe("whether a package's dependency records describe the tree", () => {
  const pushed = new Set(["packages/nextly/src/a.ts"]);

  it("do when everything changed since the last full run is in this push", () => {
    expect(staleRecordsReason(["packages/nextly/src/a.ts"], pushed)).toBeNull();
    expect(staleRecordsReason([], pushed)).toBeNull();
  });

  // A pull, a rebase or a branch switch changes files the push does not: a
  // test reaching a changed file through an import gained there is missed.
  it("do not when a file changed some other way", () => {
    expect(staleRecordsReason(["packages/nextly/src/a.ts", "packages/nextly/src/b.ts"], pushed)).toMatch(
      /src\/b\.ts changed since the last full run/
    );
  });

  it("do not when no full run here recorded the commit they describe", () => {
    expect(staleRecordsReason(null, pushed)).toMatch(/no full run here/);
  });
});
