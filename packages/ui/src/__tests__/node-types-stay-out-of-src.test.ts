/**
 * Node types are available to the tests and to nothing else.
 *
 * This package publishes browser components. Its tests need `@types/node` to
 * read fixtures off disk, and TypeScript pulls in every package under
 * `node_modules/@types` automatically — so the moment that dependency exists,
 * `process`, `Buffer` and the `node:*` modules are in scope for `src/**` too
 * unless something says otherwise. A component reaching `process.env` would
 * then type-check cleanly and break in a browser.
 *
 * `types: []` in the shipping config is what says otherwise, and it is one line
 * that looks like tidiness. Deleting it fails nothing, changes no behaviour
 * anyone would notice, and silently reopens the hole. Hence a test: the guard
 * has to be visible as a guard.
 *
 * Verified by probe rather than argued: a `src/` module reading `process.env`
 * compiles with the dependency present and no `types` field, and stops
 * compiling once the field is restored.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "../..");

/** Comments are legal in these files, so they are parsed rather than required. */
function readJsonc(path: string): Record<string, unknown> {
  const text = readFileSync(path, "utf8").replace(/^\s*\/\/.*$/gm, "");
  return JSON.parse(text) as Record<string, unknown>;
}

const shipped = readJsonc(resolve(pkgRoot, "tsconfig.json"));
const tests = readJsonc(resolve(pkgRoot, "tsconfig.tests.json"));
const pkg = readJsonc(resolve(pkgRoot, "package.json"));

const compilerOptions = (config: Record<string, unknown>) =>
  (config.compilerOptions ?? {}) as Record<string, unknown>;

/**
 * The node type files a config's program actually loads.
 *
 * Built through the compiler rather than by spawning `tsc --listFiles`, which answers the same
 * question a second or two slower and would put a subprocess in a unit suite.
 *
 * The directory separator in the pattern is load-bearing. pnpm encodes peer dependencies into its
 * directory names, so a path like `vitest@4.1.10_@types+node@20.19.17_...` is a perfectly ordinary
 * package folder that has nothing to do with node types — matching `@types` and `node` loosely
 * counts those and reports a leak that is not there.
 */
/**
 * How long one program construction gets.
 *
 * Building a TypeScript program reads and parses every file it reaches, which takes under a second
 * on an idle machine and several times that on a CI runner sharing a host with other matrices.
 * Vitest's default is 5s, and these two cases crossed it there while passing locally -- reddening
 * unrelated lanes' pull requests, which is the expensive direction for a check to fail in.
 *
 * Raised rather than the work reduced, because what makes the second case slow is the thing it
 * exists to prove: that the reader FINDS node types when they are present. A cheaper control would
 * be a control of something else.
 */
const PROGRAM_TIMEOUT_MS = 60_000;

function nodeTypeFilesIn(configName: string): string[] {
  const configPath = resolve(pkgRoot, configName);
  const { config, error } = ts.readConfigFile(configPath, ts.sys.readFile);
  // A config that could not be read would otherwise resolve to an empty program, and an empty
  // program loads no node types — the guard would pass by failing to ask the question.
  expect(error, `${configName} could not be read`).toBeUndefined();
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, pkgRoot);
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

describe("node types stay out of the shipped surface", () => {
  it("depends on @types/node, so the guard is load-bearing", () => {
    // Without this the rule below would pass vacuously: with no @types/node
    // there is nothing to leak, and the test would keep passing after someone
    // removed the guard AND the dependency together.
    const dev = (pkg.devDependencies ?? {}) as Record<string, string>;
    expect(dev["@types/node"]).toBeDefined();
  });

  it("keeps ambient types out of the shipping config", () => {
    expect(compilerOptions(shipped).types).toEqual([]);
  });

  it("scopes node types to the test config", () => {
    expect(compilerOptions(tests).types).toEqual(["node"]);
  });

  it("runs both configs, so neither is checked in name only", () => {
    // A test config nothing executes is a file, not a check.
    const scripts = (pkg.scripts ?? {}) as Record<string, string>;
    expect(scripts["check-types"]).toContain("tsconfig.tests.json");
  });

  it(
    "loads no node type file into the shipping program",
    { timeout: PROGRAM_TIMEOUT_MS },
    () => {
      // The PROPERTY, not the line. Every assertion above reads configuration, and `types` governs
      // only the AUTOMATIC inclusion of `node_modules/@types/*` — it does nothing about a
      // `/// <reference types="node" />` inside a `.d.ts` the program already includes. So a
      // dependency whose types reference node reopens this hole with `types: []` still written down
      // and all four assertions above still green.
      //
      // Not hypothetical: applied to `blocks-react`, whose `/next` subpath imports Next, that same
      // line is inert — 63 node type files load anyway, because `next/dist/types.d.ts` references
      // them. The line works here and not there, so what is asserted has to be the outcome.
      expect(nodeTypeFilesIn("tsconfig.json")).toEqual([]);
    }
  );

  it(
    "loads them into the test program, so the check can tell the two apart",
    { timeout: PROGRAM_TIMEOUT_MS },
    () => {
      // The positive control. Without it an empty result above cannot be distinguished from a reader
      // that finds nothing under any circumstances — a bad path, a config that resolved no files, a
      // filter that matches nothing.
      expect(nodeTypeFilesIn("tsconfig.tests.json").length).toBeGreaterThan(0);
    }
  );
});
