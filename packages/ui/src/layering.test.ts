/**
 * `@nextlyhq/ui` is the block-agnostic layer.
 *
 * The page builder splits three ways, and the split is what keeps one rule in
 * one place:
 *
 * - `blocks-engine` owns the block model, its validation and its style
 *   compiler. No UI.
 * - `packages/builder` is UI that UNDERSTANDS blocks. It depends on the engine
 *   and reads rules from it directly.
 * - this package is generic primitives — button, dialog, input, colour
 *   arithmetic — and knows nothing about blocks.
 *
 * The third clause is the load-bearing one. A block-aware component placed HERE
 * cannot reach the engine cheaply, so it restates the engine's rules instead,
 * and the copy drifts silently: the editor accepts a definition compilation
 * discards, or refuses one it would have kept. That has already happened three
 * times, in the breakpoint rules, a token predicate and an access context.
 *
 * This is not a new rule. `.claude/rules/derived-checks.md` already states it —
 * a narrower view must be DERIVED from the richer one, because two
 * implementations agree the day they are written and drift silently after —
 * and records defects from five unrelated packages behind it.
 *
 * WHAT THIS FILE DOES NOT ESTABLISH, stated first because a green suite here
 * would otherwise read as the whole claim: this package is NOT block-agnostic
 * today. `lib/breakpoints.ts` reimplements the compiler's breakpoint drop
 * rules and `breakpoint-dialog.tsx` consumes them. Both are green under every
 * assertion below, because a second implementation of a rule is not an import
 * — it is ordinary code, and no import scan can see it.
 *
 * So the invariant asserted is the narrow one the checks actually decide: this
 * package takes no DIRECT dependency on the engine, by manifest or by import.
 * That is worth holding on its own — it is what keeps a block-aware component
 * from being casually added here — but it is a precondition for the layer being
 * block-agnostic, not evidence that it is.
 *
 * The remaining half is a MOVE: `lib/breakpoints.ts` and `breakpoint-dialog.tsx`
 * belong in `packages/builder`, which already depends on the engine and can
 * derive those rules instead of restating them.
 *
 * Placement is worth enforcing precisely because availability is not enough.
 * `baseStyles` on the block definition is the supported way to declare a
 * block's visual defaults, is derived by the renderer, and is used by no block
 * in this repository — while blocks restate the same defaults inline. A
 * supported export that is merely available loses to the easy path, so the
 * boundary has to be one something FAILS at.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SRC = join(__dirname);

/** Every manifest field that can make a package resolvable from here. */
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

/**
 * Every SHIPPED source file in this package.
 *
 * Test material is excluded by three separate spellings, because it uses all
 * three: a `.test.ts` filename, a `__tests__` directory holding helpers that
 * carry no test suffix, and a `.fixture.ts` file. Excluding only the filename
 * suffix reports a helper importing the engine FOR a test as a production
 * layering violation, which is a false alarm about code that never ships.
 */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      return entry === "__tests__" ? [] : sourceFiles(path);
    }
    if (!/\.tsx?$/.test(entry)) return [];
    if (/\.(test|fixture)\.tsx?$/.test(entry)) return [];
    return [path];
  });
}

describe("this package takes no direct dependency on the block engine", () => {
  it("is exercised — there are source files to scan", () => {
    // Without this the assertions below pass against an empty list, which is
    // the shape of a guard that reports success because it found nothing.
    expect(sourceFiles(SRC).length).toBeGreaterThan(20);
  });

  it("declares it in no manifest field", () => {
    // All four fields, because each makes the engine reachable in its own way:
    // `peerDependencies` and `optionalDependencies` push it onto consumers,
    // and `devDependencies` makes it resolvable while the package is being
    // written, which is exactly when a component would reach for it.
    const manifest: Record<string, unknown> = JSON.parse(
      readFileSync(join(SRC, "..", "package.json"), "utf8")
    ) as Record<string, unknown>;

    const declared = DEPENDENCY_FIELDS.flatMap(field =>
      Object.keys((manifest[field] as Record<string, string>) ?? {}).map(
        name => `${field}.${name}`
      )
    );

    expect(
      declared.filter(entry => entry.endsWith(".@nextlyhq/blocks-engine")),
      "packages/ui is the block-agnostic layer. A component needing the block " +
        "model belongs in packages/builder, which already depends on the engine."
    ).toEqual([]);
  });

  it("is exercised — the manifest scan reads fields that exist", () => {
    // An empty result is only evidence once the fields being read are shown to
    // hold something. A renamed field returns the same clean answer as
    // compliance does.
    const manifest: Record<string, unknown> = JSON.parse(
      readFileSync(join(SRC, "..", "package.json"), "utf8")
    ) as Record<string, unknown>;

    const populated = DEPENDENCY_FIELDS.filter(
      field => Object.keys((manifest[field] as object) ?? {}).length > 0
    );
    expect(populated.length).toBeGreaterThanOrEqual(2);
  });

  it("is exercised — the import scan can find the specifier it hunts", () => {
    // An empty offender list is only evidence once the search is shown to
    // work. A renamed package or a typo in the pattern returns exactly the
    // same clean result as compliance does.
    const pattern = /from\s+["']@nextlyhq\/blocks-engine/;
    expect(pattern.test('import { x } from "@nextlyhq/blocks-engine";')).toBe(
      true
    );
    expect(pattern.test('import { x } from "@nextlyhq/ui";')).toBe(false);
  });

  it("imports it in no shipped source file", () => {
    // The manifest alone is not a boundary: under pnpm a package hoisted for
    // another workspace member stays importable from one whose own manifest
    // never declares it. The import is the thing that would actually resolve,
    // so the import is what is checked.
    const offenders = sourceFiles(SRC).filter(file =>
      /from\s+["']@nextlyhq\/blocks-engine/.test(readFileSync(file, "utf8"))
    );

    expect(
      offenders,
      "A component that needs the block model belongs in packages/builder, " +
        "which already depends on the engine. Importing it here makes this " +
        "package block-aware; restating its rules here makes them drift."
    ).toEqual([]);
  });
});
