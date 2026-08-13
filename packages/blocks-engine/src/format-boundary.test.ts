import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The `./format` entry point's whole value is what it does NOT reach.
 *
 * It exists so a consumer that needs the document format's vocabulary — a
 * generator, a schema publisher, an agent — does not also load the validator,
 * the migrations and the style compiler's CSS parser. Reading four constants
 * through the package root once took a dependent's bundle from 53,685 to
 * 204,524 bytes, none of it reachable from what it imported.
 *
 * **This is asserted against the BUILT bundles, and the distinction is the
 * test.** `runtime-free.test.ts` reads source and constrains what this package
 * as a whole may depend on; neither it nor any type-level check can say what a
 * particular entry point PULLS IN once the bundler has decided how to split
 * things. A re-export added to `format.ts` from a module that happens to touch
 * the compiler compiles, type-checks, and passes every source-level guard while
 * silently restoring the regression this entry point was added to remove.
 *
 * A comment saying "import nothing heavy here" is the version of this that does
 * not work: the correct path and the easy path differ, so the rule gets broken
 * by someone who knows it.
 */

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist");

/**
 * Every module specifier a source file imports, in any of the forms the bundler
 * emits.
 *
 * Three forms, and each was found only after the version without it had been
 * written and believed:
 *
 * - `import x from "y"` / `export … from "y"` — the `from` clause.
 * - `import "y"` — a SIDE-EFFECT import, which has no `from` and is exactly how
 *   a parser gets pulled in for its registration behaviour. A scanner requiring
 *   `from` reports a file importing `css-tree/parser` as importing nothing.
 * - both quote styles. An earlier version matched only double quotes while the
 *   bundler emits single ones, so it followed nothing and summed one file.
 *
 * All three failures share a shape: the scanner could not match, so it reported
 * absence, and absence is indistinguishable from the clean result this test
 * exists to report. `specifiersIn` is exported to the suite below precisely so
 * that property can be tested on input where the answer is known, rather than
 * inferred from the boundary happening to look healthy.
 */
export function specifiersIn(source: string): string[] {
  const found: string[] = [];
  // `from "x"` covers import and export alike; the second alternative is a bare
  // `import "x"` with no binding, which the first cannot see.
  for (const match of source.matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/g)) {
    found.push(match[1]!);
  }
  return found;
}

const isRelative = (specifier: string) => specifier.startsWith(".");

/** Every emitted file an entry point reaches, following relative specifiers. */
function bundleGraph(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || seen.has(file) || !existsSync(file)) continue;
    seen.add(file);

    for (const specifier of specifiersIn(readFileSync(file, "utf8"))) {
      if (isRelative(specifier)) queue.push(resolve(dirname(file), specifier));
    }
  }

  return [...seen];
}

/** Bare package specifiers an entry point's graph imports at runtime. */
function externalImports(files: string[]): Set<string> {
  const externals = new Set<string>();
  for (const file of files) {
    for (const specifier of specifiersIn(readFileSync(file, "utf8"))) {
      if (!isRelative(specifier)) externals.add(specifier);
    }
  }
  return externals;
}

function bytesOf(files: string[]): number {
  return files.reduce((total, file) => total + statSync(file).size, 0);
}

describe("the format entry point's boundary", () => {
  const formatEntry = join(DIST, "format.mjs");
  const rootEntry = join(DIST, "index.mjs");

  it("has been built", () => {
    // Every assertion below reads these files. Missing ones would make each
    // graph empty, every external set empty, and every expectation trivially
    // satisfied — a suite reporting that nothing heavy is reachable because
    // nothing at all is.
    expect(existsSync(formatEntry), `${formatEntry} is missing`).toBe(true);
    expect(existsSync(rootEntry), `${rootEntry} is missing`).toBe(true);
  });

  it("reaches no runtime dependency", () => {
    const externals = externalImports(bundleGraph(formatEntry));
    expect([...externals].sort()).toEqual([]);
  });

  it("stays a small fraction of the package root", () => {
    const format = bytesOf(bundleGraph(formatEntry));
    const root = bytesOf(bundleGraph(rootEntry));

    // A ratio rather than a byte ceiling: the absolute size moves whenever the
    // engine grows, and a fixed number would either fail on unrelated work or
    // be raised until it meant nothing. What must stay true is that this entry
    // costs a small fraction of the root, which is the property consumers rely
    // on. Measured at roughly 1.5% when written.
    expect(format).toBeGreaterThan(0);
    expect(root).toBeGreaterThan(format * 10);
  });

  it("is measured by a walk that can actually see the difference", () => {
    // The positive control, and the reason the two assertions above mean
    // anything. A traversal that silently followed nothing would report an
    // empty external set and a tiny size for EVERY entry point, including one
    // that demonstrably pulls a parser. Requiring the root to reach a real
    // dependency proves the walk resolves specifiers and reads what it finds.
    const rootFiles = bundleGraph(rootEntry);
    expect(rootFiles.length).toBeGreaterThan(1);
    // Matched by package rather than by exact specifier: the compiler imports
    // `css-tree/parser` and `css-tree/walker` by subpath, so an equality check
    // against the bare name finds nothing and the control passes for the wrong
    // reason — reporting a healthy boundary because it could not see the
    // dependency it was pointed at.
    const rootPackages = [...externalImports(rootFiles)].map(
      specifier => specifier.split("/")[0]
    );
    expect(rootPackages).toContain("css-tree");
  });

  it("sees every import form the bundler emits", () => {
    // The control for the SCANNER rather than for the boundary, on input whose
    // answer is known. The assertions above read real bundles, where a missed
    // form is invisible: the graph comes back smaller, the external set comes
    // back empty, and both are exactly what a healthy boundary looks like.
    //
    // The bare `import "…"` case is here because the scanner did not see it.
    // A side-effect import is how a parser gets pulled in for its registration,
    // so `format.mjs` could have imported css-tree outright and all four checks
    // above would have passed.
    const emitted = [
      `import { a } from './rel.mjs';`,
      `import "css-tree/parser";`,
      `export { b } from "./other.mjs";`,
      `import c from 'some-pkg';`,
    ].join("\n");

    expect(specifiersIn(emitted).sort()).toEqual([
      "./other.mjs",
      "./rel.mjs",
      "css-tree/parser",
      "some-pkg",
    ]);
  });
});
