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

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { publishedEntries } from "../../scripts/published-entries.mjs";

const PKG_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);

/**
 * The packages a server-safe entry point is allowed to reach.
 *
 * An ALLOW-list, not a list of client-only packages to refuse. A deny-list has to name every way
 * of pulling in a client runtime, and it cannot name the ones that do not exist yet: a workspace
 * package added later, or a sibling that itself imports React, is not "react" by name and would
 * pass. Listing what is permitted fails closed instead, and makes each addition a decision someone
 * takes deliberately.
 *
 * Both entries here are pure functions over strings, with no React and no DOM.
 */
const ALLOWED_PACKAGES = new Set(["clsx", "tailwind-merge"]);

/**
 * Every module specifier a source names, read from the PARSED syntax tree.
 *
 * Parsed rather than matched, because the regex version had to strip comments first and that
 * stripping fails OPEN: an unclosed comment marker inside a template literal swallows everything
 * up to the next terminator, removing real imports rather than adding noise. It also reported a
 * usage example inside a doc comment as a genuine reach. The tree carries no comments to confuse,
 * and covers every form without one pattern per syntax — static, type-only, re-export, side-effect,
 * dynamic import, require, and import-equals.
 */
function specifiers(source: string, fileName: string): string[] {
  const tree = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true
  );
  const found: string[] = [];

  const record = (node: ts.Node | undefined): void => {
    if (node && ts.isStringLiteral(node)) found.push(node.text);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      record(node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      record(node.moduleReference.expression);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(callee) && callee.text === "require";
      if (isDynamicImport || isRequire) record(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };

  visit(tree);
  return found;
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
    for (const specifier of specifiers(source, file)) {
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

describe("reading the specifiers a module names", () => {
  const read = (source: string): string[] => specifiers(source, "probe.ts");

  it("covers every import form, including the ones no single pattern catches", () => {
    expect(
      read(`
        import a from "static";
        import type { B } from "type-only";
        import "side-effect";
        export { c } from "re-export";
        export * from "star";
        const d = await import("dynamic");
        const e = require("required");
        import f = require("equals");
      `).sort()
    ).toEqual([
      "dynamic",
      "equals",
      "re-export",
      "required",
      "side-effect",
      "star",
      "static",
      "type-only",
    ]);
  });

  it("does not report an example inside a doc comment", () => {
    // The first version of this check did, because it matched raw text: the usage example in
    // `tailwind-preset.ts` was reported as a package that entry reaches.
    expect(
      read(`
        /**
         * @example
         * import uiPreset from "@nextlyhq/ui/tailwind-preset";
         */
        import { real } from "actually-imported";
      `)
    ).toEqual(["actually-imported"]);
  });

  it("still sees an import after a template holding an unclosed comment marker", () => {
    // The reason this is parsed rather than matched, and the shape that matters. A non-greedy
    // comment regex handles a CLOSED marker pair inside a template correctly, so that case proves
    // nothing. An UNCLOSED one runs on to the next terminator anywhere in the file — the doc
    // comment below — and deletes the import between them. That failure REMOVES evidence rather
    // than adding noise, so the guard would pass while blind to everything the module imports.
    expect(
      read(
        [
          "const css = `a { /* width: 0 }`;",
          'import { real } from "after-template";',
          "/** A doc comment, whose terminator a regex would pair with the template's. */",
        ].join("\n")
      )
    ).toEqual(["after-template"]);
  });

  it("is not confused by comment markers inside a string", () => {
    expect(
      read(
        [
          'const url = "//cdn.example.com/x";',
          'import { real } from "after-string";',
        ].join("\n")
      )
    ).toEqual(["after-string"]);
  });
});

describe("what a server-safe entry point reaches", () => {
  it("has server-safe entries to check", () => {
    // Fail closed: were the classification to stop reporting any, every case below would pass by
    // iterating an empty list.
    expect(SERVER_SAFE.length).toBeGreaterThan(0);
  });

  it.each(SERVER_SAFE)(
    "%s reaches only packages that are allowed",
    (_subpath, entry) => {
      const { packages } = reach(entry);
      const unlisted = [...packages.entries()]
        .filter(([specifier]) => !ALLOWED_PACKAGES.has(specifier))
        .map(([specifier, importer]) => `${specifier} (from ${importer})`);

      expect(
        unlisted,
        "a server-safe entry point reached a package that is not on the allow-list. If it is genuinely " +
          "free of React and the DOM — including everything IT reaches — add it to ALLOWED_PACKAGES; " +
          "otherwise a server component importing this subpath will fail at runtime while the build " +
          "and the client-directive guard both pass"
      ).toEqual([]);
    }
  );

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
