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
 * 1. **The builder never imports `@nextlyhq/admin` directly.** Plugins and
 *    libraries reach admin only through `@nextlyhq/plugin-sdk/admin` — a curated
 *    facade where every export is named individually and carries a stability
 *    tag. A direct import bypasses the facade and takes a dependency on
 *    internals nobody promised to keep.
 *
 *    The pull toward it is real rather than hypothetical: the editor wants
 *    admin's Lexical node set for inline rich text, and reaching for it directly
 *    is the shape that looks harmless at the call site.
 *
 * 2. **The builder does not re-implement rendering.** It renders documents with
 *    `@nextlyhq/blocks-react` — the same renderer that serves published pages.
 *    `plugin-page-builder` carries a renderer of its own, and the two disagree
 *    about condition gating in opposite directions.
 *
 * The guard is an ALLOWLIST. A blocklist only stops what someone thought to
 * name, and the next dependency added without thought is the one that breaks the
 * promise. Adding an entry below is a deliberate act with a reason recorded
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

/**
 * Stands in for `import(expr)` where `expr` is not a literal.
 *
 * Such a target cannot be resolved by reading the file, so the honest report is
 * "unknown", and unknown has to be a violation: the alternative is a guard that
 * approves whatever it could not read. It is deliberately not a legal package
 * specifier, so it can never be satisfied by an allowlist entry.
 */
const UNRESOLVED_DYNAMIC_IMPORT = "import(<non-literal>)";

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Every module specifier a source text imports, read from the AST rather than by
 * regex.
 *
 * Three shapes reach a module, not one. `import ... from` and `export ... from`
 * are declarations carrying a module specifier; `import("pkg")` is a call
 * expression, and a visitor that reads only declarations walks straight past it
 * — approving a file that pulls the forbidden package in at runtime. Template
 * literals with no substitutions are as statically known as quoted strings, so
 * they count as literals here.
 *
 * Separated from the file reading so the shapes above can be asserted against
 * source text directly: the contract tests below scan real files, and a file
 * that happens to contain none of a shape cannot demonstrate the shape is seen.
 */
function importsOfSource(text: string, fileName = "module.ts"): string[] {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.ESNext,
    true
  );
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      found.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const target = node.arguments[0];
      found.push(
        target && ts.isStringLiteralLike(target)
          ? target.text
          : UNRESOLVED_DYNAMIC_IMPORT
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** Every module specifier a file imports. */
function importsOf(file: string): string[] {
  return importsOfSource(readFileSync(file, "utf8"), file);
}

/** Bare package specifiers only — relative paths are this package's own code. */
function isBare(specifier: string): boolean {
  return !specifier.startsWith(".") && !specifier.startsWith("/");
}

describe("reading a module's imports", () => {
  it("sees static imports and re-exports", () => {
    expect(importsOfSource(`import { a } from "react";`)).toEqual(["react"]);
    expect(importsOfSource(`export { b } from "@nextlyhq/ui";`)).toEqual([
      "@nextlyhq/ui",
    ]);
    expect(importsOfSource(`export * from "@nextlyhq/blocks-react";`)).toEqual([
      "@nextlyhq/blocks-react",
    ]);
  });

  it("sees type-only imports, which a rename could turn into a value import", () => {
    expect(
      importsOfSource(`import type { P } from "@nextlyhq/admin";`)
    ).toEqual(["@nextlyhq/admin"]);
  });

  it("sees dynamic imports, which carry a dependency no declaration records", () => {
    expect(
      importsOfSource(`const m = await import("@nextlyhq/admin/lexical");`)
    ).toEqual(["@nextlyhq/admin/lexical"]);
    expect(
      importsOfSource("const m = await import(`@nextlyhq/admin`);")
    ).toEqual(["@nextlyhq/admin"]);
  });

  it("reports a dynamic import it cannot resolve rather than dropping it", () => {
    // The failure this replaces is silent: an unreadable target that produced no
    // entry left the allowlist with nothing to reject.
    expect(importsOfSource(`const m = await import(name);`)).toEqual([
      UNRESOLVED_DYNAMIC_IMPORT,
    ]);
    expect(
      importsOfSource("const m = await import(`@nextlyhq/${pkg}`);")
    ).toEqual([UNRESOLVED_DYNAMIC_IMPORT]);
  });

  it("rejects an unresolved dynamic import through the same allowlist as a named one", () => {
    // The sentinel is only useful if it survives the two filters between the
    // reader and the verdict: it must look bare, and must match no entry.
    expect(isBare(UNRESOLVED_DYNAMIC_IMPORT)).toBe(true);
    expect(ALLOWED_RUNTIME_IMPORTS).not.toContain(UNRESOLVED_DYNAMIC_IMPORT);
    expect(ALLOWED_IN_TESTS).not.toContain(UNRESOLVED_DYNAMIC_IMPORT);
  });

  it("ignores relative imports of the package's own code", () => {
    expect(
      importsOfSource(`import { x } from "./canvas";`).filter(isBare)
    ).toEqual([]);
  });
});

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
