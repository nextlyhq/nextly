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

/** The package this layer may not reach. */
const FORBIDDEN = "@nextlyhq/blocks-engine";

/**
 * Every module extension the bundler follows.
 *
 * Pinned as a literal, and wider than the `.ts`/`.tsx` a source tree usually
 * holds: tsup follows a local `.mts` or `.cts` bridge as readily as a `.ts`
 * one, so a scan that reads only the common two leaves a route into the bundle
 * unwatched. The `.js` family is here for the same reason — nothing stops a
 * shipped entry importing one.
 */
const MODULE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
] as const;

/**
 * Whether a filename is a shipped module this scan must read.
 *
 * Separated from the directory walk so each extension can be exercised
 * directly. Driving it through the filesystem instead means a route is only
 * covered if a file with that extension happens to exist today.
 */
function isShippedModule(entry: string): boolean {
  if (/\.(test|fixture)\./.test(entry)) return false;
  return MODULE_EXTENSIONS.some(extension => entry.endsWith(extension));
}

/**
 * The one matcher. Its positive control below reads THIS value rather than a
 * copy: a control with its own regex proves the copy works, and stays green
 * while the matcher it stands for drifts.
 *
 * WHAT A PASS DOES NOT MEAN. This matches the `from` spelling only. A bare
 * side-effect `import "@nextlyhq/blocks-engine"`, a dynamic `import(...)`, a
 * `require(...)`, an `import x = require(...)` and a `typeof import(...)` in
 * type position all reach the package and all pass this check. Reading
 * specifiers from the TypeScript AST is what covers them, and
 * `packages/builder/src/layering.test.ts` already does exactly that, with each
 * form and its reason written out.
 *
 * A second AST walker is not the answer here — that is the duplication this
 * file exists to argue against. The answer is one shared reader all three
 * layering tests call, which is a decision about where test infrastructure
 * crossing three packages lives. Until then this catches the common spelling
 * and every manifest declaration, and the limit is written down rather than
 * left to be inferred from a green run.
 */
const IMPORTS_FORBIDDEN = new RegExp(
  `from\\s+["']${FORBIDDEN.replace("/", "\\/")}`
);

/**
 * Every `field.package` a manifest declares that RESOLVES to the forbidden
 * package — by name, or through an npm alias.
 *
 * Keys alone are not the boundary. `"engine": "npm:@nextlyhq/blocks-engine@1"`
 * declares the engine under a name of the author's choosing, so the key says
 * `engine` and the source says `import ... from "engine"`: the manifest check
 * and the import check both see a package they have never heard of, and both
 * pass. The VALUE is where the real specifier lives.
 */
function forbiddenDeclarationsIn(manifest: Record<string, unknown>): string[] {
  return DEPENDENCY_FIELDS.flatMap(field =>
    Object.entries((manifest[field] as Record<string, string>) ?? {})
      .filter(
        ([name, range]) =>
          name === FORBIDDEN || range.startsWith(`npm:${FORBIDDEN}`)
      )
      .map(([name]) => `${field}.${name}`)
  );
}

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
    return isShippedModule(entry) ? [path] : [];
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

    expect(
      forbiddenDeclarationsIn(manifest),
      "packages/ui is the block-agnostic layer. A component needing the block " +
        "model belongs in packages/builder, which already depends on the engine."
    ).toEqual([]);
  });

  it("names every npm dependency field, so no route can go missing", () => {
    // Pinned as a literal set, because the per-field control below cannot
    // guard the list it iterates: removing a field deletes that field's own
    // case, the suite shrinks by one and every remaining case passes. A
    // vanishing test reads exactly like a passing one.
    expect([...DEPENDENCY_FIELDS].sort()).toEqual([
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "peerDependencies",
    ]);
  });

  it.each(DEPENDENCY_FIELDS)(
    "is exercised — the collector reads the %s field",
    field => {
      // Per field, not in aggregate. A count-based control is satisfied by the
      // fields that happen to be populated, so dropping `dependencies` from the
      // list would leave it green while the real assertion stopped inspecting
      // runtime dependencies entirely. A sentinel in ONE field at a time is the
      // only shape that fails when that field's route is missing.
      expect(
        forbiddenDeclarationsIn({ [field]: { [FORBIDDEN]: "workspace:*" } })
      ).toEqual([`${field}.${FORBIDDEN}`]);
      // The ALIAS route through the same field. `"engine": "npm:<pkg>@1"`
      // declares the engine under a name of the author's choosing, so a check
      // reading keys alone never sees the package it forbids.
      expect(
        forbiddenDeclarationsIn({
          [field]: { engine: `npm:${FORBIDDEN}@1.0.0` },
        })
      ).toEqual([`${field}.engine`]);
    }
  );

  it("names every module extension the bundler follows", () => {
    // Pinned literally, for the reason the field list is: removing an
    // extension deletes that extension's own case below, the suite shrinks by
    // one, and every remaining case passes. A vanishing test reads exactly
    // like a passing one.
    expect([...MODULE_EXTENSIONS].sort()).toEqual([
      ".cjs",
      ".cts",
      ".js",
      ".jsx",
      ".mjs",
      ".mts",
      ".ts",
      ".tsx",
    ]);
  });

  it.each(MODULE_EXTENSIONS)("scans a %s module", extension => {
    // Per extension, asserted on the decision rather than through the
    // filesystem: driving this off real files covers only the extensions that
    // happen to exist today, and a `.mts` bridge importing the engine is
    // exactly the file nobody has written yet.
    expect(isShippedModule(`bridge${extension}`)).toBe(true);
    expect(isShippedModule(`bridge.test${extension}`)).toBe(false);
  });

  it("skips a file the bundler does not follow", () => {
    // The positive control for the two above: an `isShippedModule` returning
    // true for everything satisfies every extension case.
    expect(isShippedModule("theme.css")).toBe(false);
    expect(isShippedModule("README.md")).toBe(false);
  });

  it("is exercised — the import scan can find the specifier it hunts", () => {
    // An empty offender list is only evidence once the search is shown to
    // work. A renamed package or a typo in the pattern returns exactly the
    // same clean result as compliance does.
    expect(
      IMPORTS_FORBIDDEN.test('import { x } from "@nextlyhq/blocks-engine";')
    ).toBe(true);
    expect(IMPORTS_FORBIDDEN.test('import { x } from "@nextlyhq/ui";')).toBe(
      false
    );
  });

  it("imports it in no shipped source file", () => {
    // The manifest alone is not a boundary: under pnpm a package hoisted for
    // another workspace member stays importable from one whose own manifest
    // never declares it. The import is the thing that would actually resolve,
    // so the import is what is checked.
    const offenders = sourceFiles(SRC).filter(file =>
      IMPORTS_FORBIDDEN.test(readFileSync(file, "utf8"))
    );

    expect(
      offenders,
      "A component that needs the block model belongs in packages/builder, " +
        "which already depends on the engine. Importing it here makes this " +
        "package block-aware; restating its rules here makes them drift."
    ).toEqual([]);
  });
});
