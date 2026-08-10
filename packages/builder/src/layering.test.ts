import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * The package's layering contract, enforced rather than documented.
 *
 * Two promises, each broken by an import that is individually reasonable:
 *
 * 1. **The builder never imports `@nextlyhq/admin` directly.** The layering
 *    invariant (AGENTS.md, master plan §4.11) is that plugins and libraries
 *    reach admin only through `@nextlyhq/plugin-sdk/admin` — a curated facade
 *    where every export is named individually and carries a stability tag. A
 *    direct import bypasses the facade and takes a dependency on internals
 *    nobody promised to keep.
 *
 *    This matters more here than elsewhere, because Phase 3 has a sanctioned
 *    reason to want admin code: the Lexical node set for inline rich text
 *    (Plan 04 P-2, founder-decided 2026-08-11). The decision routes it through
 *    `plugin-sdk/admin`, and this test is what keeps the shortcut closed while
 *    that work is in flight.
 *
 * 2. **The builder does not re-implement rendering.** It renders documents with
 *    `@nextlyhq/blocks-react` — the same renderer that serves published pages
 *    (Plan 04 D-04.7). The previous generation carried its own renderer and the
 *    two disagreed about condition gating in opposite directions for as long as
 *    both existed.
 *
 * The guard is an ALLOWLIST. A blocklist only stops what someone thought to
 * name, and the next dependency added without thought is the one that breaks
 * the promise. Adding an entry below is a deliberate act with a reason recorded
 * beside it.
 */

// `import.meta.dirname` only exists from Node 20.11 and the package floor is
// Node >=20.0, so derive the directory from the module URL instead.
const SRC_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * What the package may import at runtime, and why.
 *
 * - `react`, `react-dom`, `react/jsx-runtime`: the editor is a React app. Peer
 *   dependencies, so the host's copy is the only one in the tree.
 * - `@nextlyhq/blocks-engine`: the document model, validation and style
 *   compiler. Runtime-free.
 * - `@nextlyhq/blocks-react`: the renderer the canvas draws with — the same one
 *   that serves published pages.
 * - `@nextlyhq/ui`: the design system, and the only source of admin-theme
 *   tokens. Peer, for the same one-copy reason as React.
 * - `@nextlyhq/plugin-sdk`: the stable import surface, including the `/admin`
 *   subpath that is the ONLY sanctioned route to admin components.
 */
const ALLOWED_RUNTIME_IMPORTS = [
  "react",
  "react-dom",
  "react/jsx-runtime",
  "@nextlyhq/blocks-engine",
  "@nextlyhq/blocks-react",
  "@nextlyhq/ui",
  "@nextlyhq/plugin-sdk",
];

/** Node built-ins and test-only tooling, which never reach a consumer's bundle. */
const ALLOWED_IN_TESTS = [
  "node:fs",
  "node:path",
  "node:url",
  "typescript",
  "vitest",
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Every module specifier a file imports, read from the AST rather than by regex. */
function importsOf(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.ESNext,
    true
  );
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      found.push(node.moduleSpecifier.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** Bare package specifiers only — relative paths are this package's own code. */
function isBare(specifier: string): boolean {
  return !specifier.startsWith(".") && !specifier.startsWith("/");
}

describe("the builder's layering contract", () => {
  const files = sourceFiles(SRC_DIR);

  it("reads its own source, so the assertions below are not vacuous", () => {
    // Positive control. An empty file list would satisfy every `every()` below,
    // and a guard that passes because it found nothing is the failure mode this
    // program has paid for repeatedly.
    expect(files.length).toBeGreaterThan(0);
    expect(files.some(f => f.endsWith("index.ts"))).toBe(true);
  });

  it("never imports @nextlyhq/admin directly", () => {
    // The one route to admin is `@nextlyhq/plugin-sdk/admin`. Asserted as a
    // prefix so `@nextlyhq/admin/anything` is caught too — a subpath import is
    // the shape this would most plausibly take.
    const offenders = files.filter(file =>
      importsOf(file).some(
        specifier =>
          specifier === "@nextlyhq/admin" ||
          specifier.startsWith("@nextlyhq/admin/")
      )
    );

    expect(offenders).toEqual([]);
  });

  it("imports only what the contract allows", () => {
    const violations: string[] = [];
    for (const file of files) {
      const isTest = /\.test\.tsx?$/.test(file);
      for (const specifier of importsOf(file).filter(isBare)) {
        // Subpath imports are judged by their package, so `plugin-sdk/admin`
        // is permitted by the `plugin-sdk` entry above.
        const pkg = specifier.startsWith("@")
          ? specifier.split("/").slice(0, 2).join("/")
          : (specifier.split("/")[0] ?? specifier);
        const allowed = isTest
          ? [...ALLOWED_RUNTIME_IMPORTS, ...ALLOWED_IN_TESTS]
          : ALLOWED_RUNTIME_IMPORTS;
        if (!allowed.includes(pkg) && !allowed.includes(specifier)) {
          violations.push(`${file}: ${specifier}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
