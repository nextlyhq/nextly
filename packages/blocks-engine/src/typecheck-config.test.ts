import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * The two halves of type-checking this package, held where deleting one is
 * visible.
 *
 * Type-checking the tests and keeping Node globals out of `src` are one change,
 * not two, and the second half is the one that rots. Test files legitimately
 * reach `node:fs` and `process`, so `@types/node` has to resolve for them; with
 * no `types` list it resolves for `src` as well, and a published browser module
 * can read `process.env` and type-check clean. Measured rather than reasoned:
 * `export const leak = process.env.SECRET` in `src` compiles with no `types`
 * field and fails with `TS2591` once the list is empty.
 *
 * Nothing else would notice its removal. Deleting `types: []` breaks no build,
 * fails no test and widens what compiles, so every gate reports green — and it
 * lives in the SHIPPING config, which nobody reviewing a test change opens.
 *
 * The assertions are on config text because that is where the property lives.
 * A runtime test cannot evaluate "what can `src` see", so the honest thing is
 * to check the setting that decides it and say plainly that is what this does.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = join(HERE, "..");

/** Parse a tsconfig, which is JSONC — comments and all. */
function readConfig(name: string): Record<string, unknown> {
  const path = join(PACKAGE_DIR, name);
  const parsed = ts.parseConfigFileTextToJson(path, readFileSync(path, "utf8"));
  expect(parsed.error, `${name} must be parseable`).toBeUndefined();
  return parsed.config as Record<string, unknown>;
}

function compilerOptions(name: string): Record<string, unknown> {
  const options = readConfig(name).compilerOptions;
  expect(options, `${name} must set compilerOptions`).toBeDefined();
  return options as Record<string, unknown>;
}

function packageJson(): {
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
} {
  return JSON.parse(
    readFileSync(join(PACKAGE_DIR, "package.json"), "utf8")
  ) as ReturnType<typeof packageJson>;
}

describe("what the shipping config lets src see", () => {
  it("admits no ambient type packages", () => {
    // The line whose deletion is silent. An empty list is not the same as an
    // absent one: absent means "every @types package installed anywhere in the
    // tree", which here includes Node.
    expect(compilerOptions("tsconfig.json").types).toEqual([]);
  });

  it("still depends on the types the empty list is holding back", () => {
    // The anti-vacuity control, and it is the assertion that makes the one
    // above mean something. Remove `@types/node` and `types: []` together and
    // the first test still passes while the hole it guards no longer exists —
    // so a later reader would read a guard that had quietly become decoration,
    // and restoring the dependency would reopen the hole under a green test.
    expect(packageJson().devDependencies["@types/node"]).toBeDefined();
  });

  it("keeps test files out of what it builds", () => {
    const exclude = readConfig("tsconfig.json").exclude;
    expect(exclude).toContain("**/*.test.ts");
    // `.tsx` too, though this package has none today. The engine is
    // runtime-free, so a `.tsx` here would be a mistake — but excluding it from
    // the SHIPPING config is what makes it a mistake caught at review rather
    // than a test file compiled into `dist`.
    expect(exclude).toContain("**/*.test.tsx");
  });
});

describe("what the tests config adds back", () => {
  it("re-widens types for the test files that need Node", () => {
    // Extending the shipping config inherits `types: []`, which would break
    // every test importing `node:fs`. The widening has to be deliberate and
    // confined to this config.
    expect(compilerOptions("tsconfig.tests.json").types).toContain("node");
  });

  it("carries no opt-out list", () => {
    // Every test file in this package compiles. An empty list is a stronger
    // statement than a short one: the first entry added is a visible
    // regression rather than one more line in a column that already has many.
    expect(readConfig("tsconfig.tests.json").exclude).toEqual([
      "dist",
      "node_modules",
    ]);
  });
});

describe("both configs actually run", () => {
  it("checks the tests config as well as the shipping one", () => {
    // A hand-rolled `tsc -p tsconfig.json` runs only the first and reports a
    // green that covers no test file at all. That exact false pass has already
    // cost this repo a defect, which is why the script is asserted rather than
    // assumed.
    const script = packageJson().scripts["check-types"];
    expect(script).toContain("tsc --noEmit");
    expect(script).toContain("-p tsconfig.tests.json");
  });
});

/**
 * How long one program construction gets.
 *
 * Building a TypeScript program reads and parses every file it reaches: under a
 * second on an idle machine, several times that on a CI runner sharing a host
 * with other matrices. Vitest's default is 5s, and the equivalent pair in
 * `packages/ui` crossed it there while passing locally — reddening `main` and
 * three unrelated lanes' pull requests, which is the expensive direction for a
 * check to fail in.
 *
 * Raised rather than the work reduced, because what makes the control slow is
 * the thing it exists to prove: that the reader FINDS node types when they are
 * present. A cheaper control would be a control of something else.
 */
const PROGRAM_TIMEOUT_MS = 60_000;

/**
 * The node type files a config's program actually loads.
 *
 * Built through the compiler rather than by spawning `tsc --listFiles`, which
 * answers the same question a second or two slower and puts a subprocess in a
 * unit suite. The two were checked against each other and agree.
 *
 * The directory separators in the pattern are load-bearing. pnpm encodes peer
 * dependencies into its directory names, so `vitest@4.1.10_@types+node@20.19.17`
 * is an ordinary package folder with nothing to do with node types — matching
 * `@types` and `node` loosely counts those and reports a leak that is not there.
 */
function nodeTypeFilesIn(configName: string): string[] {
  const configPath = join(PACKAGE_DIR, configName);
  const { config, error } = ts.readConfigFile(configPath, ts.sys.readFile);
  // An unreadable config resolves to an empty program, and an empty program
  // loads no node types — so without this the guard passes by failing to ask.
  expect(error, `${configName} could not be read`).toBeUndefined();
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, PACKAGE_DIR);
  expect(
    parsed.fileNames.length,
    `${configName} matched no files`
  ).toBeGreaterThan(0);
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  return program
    .getSourceFiles()
    .map(file => file.fileName)
    .filter(name => name.includes("/@types/node/"));
}

describe("what the shipping program actually loads", () => {
  it(
    "loads no node type file into the shipping program",
    { timeout: PROGRAM_TIMEOUT_MS },
    () => {
      // The PROPERTY, where every assertion above reads a SETTING. `types`
      // governs only the automatic inclusion of `node_modules/@types/*`; it does
      // nothing about a `/// <reference types="node" />` inside a `.d.ts` the
      // program already includes. A dependency whose types carry one reopens
      // this hole with `types: []` still written down and every config
      // assertion above still green.
      //
      // Not hypothetical. In `blocks-react` that same line is inert: Next's
      // `dist/types.d.ts` references node and 63 type files load anyway. The
      // line works here and not there, so whether it works is a property of the
      // dependency graph rather than of the line, and only the outcome can be
      // asserted.
      expect(nodeTypeFilesIn("tsconfig.json")).toEqual([]);
    }
  );

  it(
    "loads them into the test program, so the reader can tell the two apart",
    { timeout: PROGRAM_TIMEOUT_MS },
    () => {
      // The positive control. Without it an empty result above cannot be told
      // from a reader that finds nothing under any circumstances — a wrong
      // path, a config that resolved no files, a filter matching nothing.
      expect(nodeTypeFilesIn("tsconfig.tests.json").length).toBeGreaterThan(0);
    }
  );
});
