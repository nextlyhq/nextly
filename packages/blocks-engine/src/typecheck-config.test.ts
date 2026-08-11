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
