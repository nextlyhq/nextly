/**
 * The package's entries, held apart: Next.js is an optional peer dependency,
 * so the root and `testing` entries must reach no `next` module by any chain
 * of imports, and only the `next` entry's own graph may name one.
 *
 * Checked over each entry's module graph rather than file by file, because
 * a root that re-exported one helper of `./next` would pass every per-file
 * check while loading Next.js for every site.
 *
 * @module layering.test
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { importedSpecifiers } from "@nextlyhq/module-specifiers";
import { describe, expect, it } from "vitest";

const SRC = dirname(fileURLToPath(import.meta.url));
const ROOT_ENTRIES = ["index.ts", join("testing", "index.ts")];
const NEXT_ENTRY = join(SRC, "next", "index.ts");

/**
 * Every module a source names, as the repository's one reader of imports reads
 * it: static imports and re-exports, `import()` and `require()`, a target it
 * cannot read as a marker that matches nothing. Type-only imports count too: a
 * root whose declarations name `next` breaks a site's type-check without
 * Next.js as surely as one that loads it.
 */
function importsIn(source: string, fileName: string): string[] {
  return importedSpecifiers(source, fileName);
}

/** A relative import's file, or null for a package or a JSON file, which imports nothing. */
function resolve(from: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  if (specifier.endsWith(".json") && existsSync(join(dirname(from), specifier)))
    return null;
  const base = join(dirname(from), specifier.replace(/\.js$/, ""));
  const found = [`${base}.ts`, join(base, "index.ts")].find(candidate =>
    existsSync(candidate)
  );
  if (found === undefined)
    throw new Error(`${relative(SRC, from)}: cannot resolve ${specifier}`);

  return found;
}

/** Every file an entry reaches by relative imports, the entry included. */
function graphOf(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of importsIn(readFileSync(file, "utf8"), file)) {
      const next = resolve(file, specifier);
      if (next !== null) queue.push(next);
    }
  }

  return seen;
}

/** Shipped source files: every `.ts` under `src` but tests. */
function sourceFiles(dir = SRC): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.ts$/.test(entry.name) && !/\.test(-d)?\.ts$/.test(entry.name)
      ? [full]
      : [];
  });
}

function isNext(specifier: string): boolean {
  return specifier === "next" || specifier.startsWith("next/");
}

/** The files of a graph that name a `next` module, with what they name. */
function nextImportsIn(files: Iterable<string>): string[] {
  return [...files].flatMap(file =>
    importsIn(readFileSync(file, "utf8"), file)
      .filter(isNext)
      .map(specifier => `${relative(SRC, file)}: ${specifier}`)
  );
}

describe("the import reader", () => {
  it("sees every form an import of Next.js can take", () => {
    expect(
      importsIn(
        [
          'export const a = 1; import { headers } from "next/headers";',
          'export { redirect } from "next/navigation";',
          'import type { Metadata } from "next";',
          'const later = await import("next/cache");',
          'const old = require("next/server");',
          "const text = \"import { x } from 'next/form'\";",
          '// import "next/script";',
        ].join("\n"),
        "probe.ts"
      )
    ).toEqual([
      "next/headers",
      "next/navigation",
      "next",
      "next/cache",
      "next/server",
    ]);
  });
});

describe("the package's entries", () => {
  it("keep Next.js out of the root's and the testing entry's module graphs", () => {
    for (const entry of ROOT_ENTRIES) {
      const graph = graphOf(join(SRC, entry));
      // A traversal that found nothing would pass vacuously.
      expect(graph.size).toBeGreaterThan(10);
      expect(graph.has(NEXT_ENTRY), `${entry} reaches next/index.ts`).toBe(
        false
      );
      expect(nextImportsIn(graph)).toEqual([]);
    }
  });

  it("name Next.js only inside the next entry's own graph", () => {
    const nextGraph = graphOf(NEXT_ENTRY);
    const outside = sourceFiles().filter(file => !nextGraph.has(file));

    expect(nextImportsIn(nextGraph)).not.toEqual([]);
    expect(nextImportsIn(outside)).toEqual([]);
  });
});
