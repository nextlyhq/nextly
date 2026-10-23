/**
 * What `test-changed.mjs` decides for each package a push touches: run every
 * test, or only the files `--changed` selects plus the guards. Each decision is
 * a pure function here, so the cases below hold the reasons the selection is
 * safe: a change no record can see sends the package to its full suite.
 */
import { describe, expect, it } from "vitest";

import {
  fullRunReason,
  isUnitTestFile,
  listedFiles,
  readsOutsideTheGraph,
  scriptTestsNeeded,
  selectedFiles,
  testArgs,
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
      "--passWithNoTests",
    ]);
  });

  it("passes the worker limit to a full run the same way", () => {
    expect(testArgs("nextly", [], "3")).toEqual([
      "--filter",
      "nextly",
      "run",
      "test",
      "--maxWorkers=3",
      "--passWithNoTests",
    ]);
  });
});

describe("when the root scripts tests run too", () => {
  // `turbo run test` never reaches them, and they are what hold the task graph,
  // the hooks and every Vitest config to what the gates assume.
  it("does for a change to a script, the turbo config or any Vitest config", () => {
    for (const path of [
      "scripts/gate-scope.mjs",
      "turbo.jsonc",
      "turbo.json",
      "vitest.config.ts",
      "packages/nextly/vitest.config.ts",
      "packages/admin-css/vitest.config.mjs",
      "packages/nextly/vitest.integration.config.ts",
    ]) {
      expect(scriptTestsNeeded([path]), path).toBe(true);
    }
  });

  it("does not for product code or docs", () => {
    expect(scriptTestsNeeded(["packages/nextly/src/a.ts", "docs/a.mdx", "packages/ui/scripts/build.mjs"])).toBe(false);
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
