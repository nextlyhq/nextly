/**
 * A server-safe entry point must stay reachable from a server component.
 *
 * `published-entries.mjs` declares which subpaths are server-safe, the build routes those through a
 * config that adds no `"use client"` banner, and a guard asserts the built artifact carries none.
 * None of that looks at what the source IMPORTS — so adding `useState` to `lib/utils.ts` would
 * build cleanly, ship without a banner, and break the first server component to import
 * `@nextlyhq/ui/utils`, with every existing check green.
 *
 * The dependency graph cannot answer this the way it can for a package that is simply not a
 * dependency: `react` is a declared peer dependency of this package and resolves fine. What makes
 * an entry server-safe is that nothing it REACHES pulls in a client runtime, which is a property of
 * the import graph and has to be walked.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { publishedEntries } from "../../scripts/published-entries.mjs";

const PKG_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);

/**
 * Packages that make a module client-only.
 *
 * React itself is the substantive one; the rest are component libraries whose modules call hooks,
 * so importing any of them drags the same runtime in behind a different name.
 */
const CLIENT_ONLY = [
  "react",
  "react-dom",
  "lucide-react",
  "cmdk",
  "sonner",
  "@radix-ui/",
  "@tanstack/react-virtual",
  "react-resizable-panels",
  "class-variance-authority",
];

/** Every specifier a module imports or re-exports, including type-only positions. */
function specifiers(source: string): string[] {
  return [
    ...source.matchAll(
      /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*["']([^"']+)["']/g
    ),
    ...source.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g),
    ...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g),
    ...source.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g),
  ].map(match => match[1]!);
}

/** Resolve a relative specifier the way the bundler does, or `null` if it names a package. */
function resolveLocal(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ]) {
    if (existsSync(candidate) && !candidate.endsWith(path.sep)) {
      try {
        if (readFileSync(candidate, "utf8")) return candidate;
      } catch {
        // A directory matched the bare path; keep trying the suffixed candidates.
      }
    }
  }
  return null;
}

/** Every local module reachable from an entry, and every package specifier they name. */
function reach(entry: string): {
  files: string[];
  packages: Map<string, string>;
} {
  const files: string[] = [];
  const packages = new Map<string, string>();
  const queue = [entry];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    files.push(file);

    const source = readFileSync(file, "utf8");
    for (const specifier of specifiers(source)) {
      const local = resolveLocal(file, specifier);
      if (local) {
        queue.push(local);
      } else if (!packages.has(specifier)) {
        packages.set(specifier, path.relative(PKG_ROOT, file));
      }
    }
  }
  return { files, packages };
}

const SERVER_SAFE = publishedEntries()
  .filter(entry => entry.serverSafe)
  .map(entry => [entry.subpath, path.join(PKG_ROOT, entry.source)] as const);

describe("what a server-safe entry point reaches", () => {
  it("has server-safe entries to check", () => {
    // Fail closed: were the classification to stop reporting any, every case below would pass by
    // iterating an empty list.
    expect(SERVER_SAFE.length).toBeGreaterThan(0);
  });

  it.each(SERVER_SAFE)("%s pulls in no client runtime", (_subpath, entry) => {
    const { packages } = reach(entry);
    const offenders = [...packages.entries()]
      .filter(([specifier]) =>
        CLIENT_ONLY.some(
          banned =>
            specifier === banned ||
            specifier.startsWith(banned.endsWith("/") ? banned : `${banned}/`)
        )
      )
      .map(([specifier, importer]) => `${specifier} (from ${importer})`);

    expect(
      offenders,
      "a server-safe entry point reached a client-only package, so a server component importing " +
        "it would fail at runtime while the build and the client-directive guard both passed"
    ).toEqual([]);
  });

  it.each(SERVER_SAFE)(
    "%s reaches no module marked client",
    (_subpath, entry) => {
      const marked = reach(entry)
        .files.filter(file =>
          /^\s*["']use client["']/.test(readFileSync(file, "utf8"))
        )
        .map(file => path.relative(PKG_ROOT, file));

      expect(marked).toEqual([]);
    }
  );
});
