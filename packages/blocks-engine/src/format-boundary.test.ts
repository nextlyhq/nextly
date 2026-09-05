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
 * Four forms, all of which a bundle can contain:
 *
 * - `import x from "y"` and `export … from "y"` — the `from` clause.
 * - `import "y"` — a side-effect import, which has no `from` clause and is how
 *   a parser is pulled in for its registration behaviour alone.
 * - `import("y")` — a dynamic import, which defers loading without avoiding it.
 * - both quote styles, since the bundler emits single quotes.
 *
 * A form this misses is not reported as a gap. The graph simply comes back
 * smaller and the external set emptier, which is what a healthy boundary looks
 * like, so every assertion below passes over a dependency it never saw.
 * `specifiersIn` is therefore exported and asserted directly on input whose
 * answer is known, rather than trusted because the boundary looks intact.
 */
export function specifiersIn(source: string): string[] {
  const found: string[] = [];
  // `from "x"` covers import and export alike; the second alternative is a bare
  // `import "x"` with no binding, which the first cannot see.
  // `import(` is matched with its parenthesis so a dynamic import is seen; the
  // bare `import "x"` alternative would not reach it, because the quote does
  // not follow the keyword directly.
  //
  // The capture excludes a NEWLINE because a module specifier cannot contain
  // one, and without that this reads a false import out of ordinary code: the
  // literal `"from"` ends with a quote, so the keyword pattern matches the word
  // inside the string and captures everything up to the next quote — which for
  // `ownEntry(value, "from")` followed by a comparison is a fragment of the
  // next two lines. Excluding the newline cannot hide a real specifier and does
  // refuse that.
  for (const match of source.matchAll(
    /(?:from|import)\s*\(?\s*['"]([^'"\n]+)['"]/g
  )) {
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

describe("the import scanner", () => {
  it("does not read an import out of a string literal named like the keyword", () => {
    // `"from"` ends in a quote, so a keyword match that allowed a newline in
    // the specifier captured the next two lines of ordinary code and reported
    // it as an external dependency. A module specifier has no newline in it.
    const source = [
      'const from = ownEntry(value, "from");',
      'if (from === "component") return true;',
    ].join("\n");

    expect(specifiersIn(source)).toEqual([]);
  });

  it("still sees every real specifier shape", () => {
    // The control: the narrowing must not cost a form the walk depends on.
    const source = [
      'import { a } from "./a";',
      'export { b } from "./b";',
      'import "./side-effect";',
      'const c = await import("./c");',
    ].join("\n");

    expect(specifiersIn(source)).toEqual([
      "./a",
      "./b",
      "./side-effect",
      "./c",
    ]);
  });
});

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
    // answer is known. It is the only assertion in this file that can fail when
    // the scanner narrows: the four above read real bundles, where a form that
    // goes unmatched produces a smaller graph and an emptier external set —
    // indistinguishable from the boundary being intact.
    const emitted = [
      `import { a } from './rel.mjs';`,
      `import "css-tree/parser";`,
      `export { b } from "./other.mjs";`,
      `import c from 'some-pkg';`,
      `const lazy = () => import("lazy-pkg/sub");`,
      `await import('./deferred.mjs');`,
    ].join("\n");

    expect(specifiersIn(emitted).sort()).toEqual([
      "./deferred.mjs",
      "./other.mjs",
      "./rel.mjs",
      "css-tree/parser",
      "lazy-pkg/sub",
      "some-pkg",
    ]);
  });
});
