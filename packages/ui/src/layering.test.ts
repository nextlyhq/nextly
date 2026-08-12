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
 * What this file can enforce is the PLACEMENT, not the duplication. A second
 * implementation of a rule is not detectable by any import scan; it looks like
 * ordinary code. Keeping block-aware modules out of this package is what
 * removes the REASON to write one, so that is the boundary drawn here.
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

/** Every source file in this package, tests excluded. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    if (!/\.tsx?$/.test(entry)) return [];
    if (/\.test\.tsx?$/.test(entry)) return [];
    return [path];
  });
}

describe("the generic UI layer stays block-agnostic", () => {
  it("is exercised — there are source files to scan", () => {
    // Without this the assertions below pass against an empty list, which is
    // the shape of a guard that reports success because it found nothing.
    expect(sourceFiles(SRC).length).toBeGreaterThan(20);
  });

  it("declares no dependency on the block engine", () => {
    const manifest: { dependencies?: Record<string, string> } = JSON.parse(
      readFileSync(join(SRC, "..", "package.json"), "utf8")
    );
    expect(Object.keys(manifest.dependencies ?? {})).not.toContain(
      "@nextlyhq/blocks-engine"
    );
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

  it("imports nothing from the block engine", () => {
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
