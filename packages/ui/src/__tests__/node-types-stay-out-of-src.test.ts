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
});
