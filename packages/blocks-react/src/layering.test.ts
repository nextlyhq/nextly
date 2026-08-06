import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { Dirent } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * The package's layering contract, enforced rather than documented.
 *
 * Three promises, each broken by an import that is individually reasonable and
 * collectively fatal:
 *
 * 1. **The root entry never touches Next.** A consumer importing the renderer
 *    must not acquire `next/*` in their graph, and the renderer must stay
 *    usable outside a Next app. `next.ts` is the one exception, by design.
 * 2. **Nothing imports the admin or the CMS runtime.** The renderer runs in the
 *    user's application, where neither exists.
 * 3. **Nothing imports the editor.** The rendering path and the editing path
 *    share a document format, not a module graph.
 *
 * The guard is an ALLOWLIST. A blocklist only stops what someone thought to
 * name, and the next dependency added without thought is exactly the one that
 * breaks the promise. Adding an entry below is a deliberate act with a reason
 * recorded beside it.
 */

// `import.meta.dirname` only exists from Node 20.11 and the package floor is
// Node >=20.0, so derive the directory from the module URL instead.
const SRC_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * What the package may import at runtime, and why.
 *
 * - `react` / `react/jsx-runtime`: this is a React renderer. Declared as a peer
 *   dependency so the consumer's copy is the only one in the tree.
 * - `@nextlyhq/blocks-engine`: the document model, validation and style
 *   compiler. Runtime-free itself, so depending on it costs the consumer
 *   nothing beyond the engine's own bounded allowlist.
 */
const ALLOWED_RUNTIME_IMPORTS = [
  "react",
  "react/jsx-runtime",
  "@nextlyhq/blocks-engine",
];

/**
 * Modules only `src/next.ts` and its own imports may use.
 *
 * Kept separate from the allowlist above so that a `next/*` import appearing in
 * any other file is a failure, not a pass — the whole point of the subpath
 * split is that the boundary is checkable.
 */
const NEXT_ONLY_IMPORTS = [
  "next",
  "next/cache",
  "next/headers",
  "next/navigation",
  // The CMS, for `createBlocksPage`. Promise 2 above says the renderer must not
  // import the CMS runtime, and this does not weaken it: that promise is about
  // the RENDERER, which runs in the user's application where no CMS exists, and
  // the root entry still may not reach either module.
  //
  // A route is a different thing from a renderer. Turning documents into pages
  // means resolving a path to an entry, and resolving media and links means
  // reading records; all three are the CMS's work, and a helper that did them
  // without it would be reimplementing the CMS beside the CMS. Declared as an
  // OPTIONAL peer dependency, so a consumer using only the root entry installs
  // nothing extra and gets no unmet-peer warning.
  "nextly",
  "nextly/runtime",
];

/** Files that are test harness rather than shipped code. */
const TEST_FILE = /\.test\.tsx?$/;

/**
 * Stand-in for a dynamic import whose target cannot be read from the source.
 *
 * It is deliberately not a real specifier, so it matches no allowlist entry and
 * therefore fails: an unreadable route into the module graph is treated as a
 * violation rather than waved through.
 */
const UNRESOLVABLE_SPECIFIER = "<computed-dynamic-import>";

/** Every source file, with its path relative to `src`. */
function sourceFiles(dir: string = SRC_DIR): string[] {
  const entries: Dirent[] = readdirSync(dir, { withFileTypes: true });
  return entries.flatMap(entry => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (!/\.tsx?$/.test(entry.name)) return [];
    if (TEST_FILE.test(entry.name)) return [];
    return [full];
  });
}

/**
 * Module specifiers a source text imports at RUNTIME.
 *
 * Read from TypeScript's own parse of the file rather than by pattern. What
 * counts as an import is a question about syntax, and syntax has exactly one
 * authority; a text scan has to re-derive comments, string boundaries and
 * statement positions, and each of those is a way for a real import to go
 * unseen. Every form below is one the parser answers directly:
 *
 * - `import "x"` anywhere a statement may appear, including after another
 *   statement on the same line.
 * - `import type` / `export type`, which erase at build and so do not count.
 *   Inline `import { type X }` still counts: the statement itself is a runtime
 *   import even when one binding is a type.
 * - `import("x")` and `require("x")`. A dynamic import puts a module in the
 *   graph exactly as a static one does, and `import x = require("y")` is the
 *   documented CommonJS-interop spelling.
 * - `import("x").Foo` in type position, which is a type query and erases, so
 *   it is correctly absent — it parses as a type node, not a call.
 *
 * A dynamic call whose argument is not a single string literal is reported as
 * {@link UNRESOLVABLE_SPECIFIER}: `import(base + name)` cannot be checked here,
 * and the guard exists so that no route into the graph opens without a
 * deliberate act.
 */
export function collectRuntimeImports(source: string, fileName: string) {
  const parsed = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.ESNext,
    // Parent pointers are unused, but omitting them costs nothing to set and
    // makes any later node-relative query work rather than crash.
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );

  const specifiers: string[] = [];
  const push = (node: ts.Expression): void => {
    specifiers.push(
      ts.isStringLiteralLike(node) ? node.text : UNRESOLVABLE_SPECIFIER
    );
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      // No import clause is a bare side-effect import, which is a runtime
      // import by definition and the form most likely to be overlooked.
      if (!node.importClause?.isTypeOnly) push(node.moduleSpecifier);
    } else if (ts.isExportDeclaration(node)) {
      // A re-export without a specifier (`export { x }`) reaches no module.
      if (node.moduleSpecifier && !node.isTypeOnly) push(node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      if (!node.isTypeOnly) push(node.moduleReference.expression);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      // A bare `require` identifier only. `foo.require("x")` is a method on
      // some object, not a module resolve.
      const isModuleCall =
        callee.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(callee) && callee.text === "require");
      if (isModuleCall) {
        const argument = node.arguments[0];
        if (argument) push(argument);
        else specifiers.push(UNRESOLVABLE_SPECIFIER);
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(parsed);
  return specifiers;
}

/** {@link collectRuntimeImports} for a file on disk. */
function runtimeImports(file: string): string[] {
  return collectRuntimeImports(readFileSync(file, "utf8"), file);
}

/** Relative specifiers are internal: not gated, but they ARE followed (below). */
function isInternal(specifier: string): boolean {
  return specifier.startsWith(".") || specifier.startsWith("#");
}

/** Resolve a relative specifier to a file on disk, or null if it is not one. */
function resolveRelative(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;

  // `./next.js` is the standard ESM-TypeScript spelling and resolves to
  // `next.ts` under both TypeScript's bundler resolution and esbuild. Probing
  // only `next.js.ts` would treat that edge as unresolvable, and an
  // unresolvable edge is silently dropped from the graph — which is exactly
  // the re-export this walk exists to catch.
  const withoutJsSuffix = specifier.replace(/\.(js|jsx|mjs|cjs)$/, "");
  const bases = [
    join(dirname(fromFile), specifier),
    join(dirname(fromFile), withoutJsSuffix),
  ];

  for (const base of bases) {
    for (const candidate of [
      `${base}.ts`,
      `${base}.tsx`,
      join(base, "index.ts"),
      join(base, "index.tsx"),
    ]) {
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Every file reachable from an entry by following relative imports.
 *
 * The root's promise is about its MODULE GRAPH, not about one file: if
 * `index.ts` re-exports `./next`, importing the package root loads the
 * Next-coupled entry transitively and the promise is broken even though no
 * file names `next/*` directly. Checking files in isolation cannot see that.
 */
function reachableFrom(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    for (const specifier of runtimeImports(file)) {
      const resolved = resolveRelative(file, specifier);
      if (resolved && !seen.has(resolved)) queue.push(resolved);
    }
  }
  return seen;
}

/** `node:fs` and friends: allowed nowhere in shipped code. */
function isNodeBuiltin(specifier: string): boolean {
  return specifier.startsWith("node:");
}

/**
 * The scanner's own coverage.
 *
 * Every case here is a way a real import can reach the module graph while
 * looking like something else in the file's text. They are asserted against
 * source strings rather than files on disk so that adding one costs nothing
 * and leaves no fixture behind.
 */
describe("the runtime-import scanner", () => {
  const scan = (source: string) => collectRuntimeImports(source, "sample.ts");

  it("sees a static import that follows another statement on the same line", () => {
    // An import declaration is legal wherever a statement is, so a scan that
    // expects one at the start of a line misses this while the module still
    // enters the graph.
    expect(scan('export const marker = true; import "next/headers";')).toEqual([
      "next/headers",
    ]);
  });

  it("sees imports regardless of surrounding comments", () => {
    expect(
      scan(
        [
          "/* import 'not-real' */",
          "// import 'also-not-real'",
          'import "next/cache";',
          'import /* between */ "next/headers";',
        ].join("\n")
      )
    ).toEqual(["next/cache", "next/headers"]);
  });

  it("ignores imports and requires that appear inside string literals", () => {
    expect(
      scan('const sample = `import "next/headers"; require("next")`;')
    ).toEqual([]);
  });

  it("counts every dynamic form that reaches a module", () => {
    expect(
      scan(
        [
          'await import("next/headers");',
          'const cache = require("next/cache");',
          'import navigation = require("next/navigation");',
        ].join("\n")
      )
    ).toEqual(["next/headers", "next/cache", "next/navigation"]);
  });

  it("refuses a dynamic import whose target it cannot read", () => {
    expect(scan('await import("next/" + "headers");')).toEqual([
      UNRESOLVABLE_SPECIFIER,
    ]);
    expect(scan("await import(chosen);")).toEqual([UNRESOLVABLE_SPECIFIER]);
  });

  it("does not count a method that happens to be named require", () => {
    expect(scan('loader.require("next/headers");')).toEqual([]);
  });

  it("excludes type-only imports and exports, which erase at build", () => {
    expect(
      scan(
        [
          'import type { A } from "next/headers";',
          'export type { B } from "next/cache";',
          'type Later = import("next/navigation").Thing;',
        ].join("\n")
      )
    ).toEqual([]);
  });

  it("counts a statement carrying an inline type binding", () => {
    // `import { type A, b }` still emits an import at runtime for `b`.
    expect(scan('import { type A, b } from "next/headers";')).toEqual([
      "next/headers",
    ]);
  });

  it("counts a bare side-effect import", () => {
    expect(scan('import "next/headers";')).toEqual(["next/headers"]);
  });
});

describe("the package's layering contract", () => {
  const files = sourceFiles();
  // Everything the `/next` entry can reach. Membership, not filename, decides
  // whether a module is allowed to import Next.
  const nextGraph = reachableFrom(join(SRC_DIR, "next.ts"));

  it("has source files to check", () => {
    // A traversal bug that returned nothing would make every assertion below
    // vacuously true, which is the failure mode these tests exist to prevent.
    expect(files.length).toBeGreaterThan(0);
  });

  it("imports nothing outside the allowlist", () => {
    const violations: string[] = [];

    for (const file of files) {
      const isNextSide = nextGraph.has(file);
      for (const specifier of runtimeImports(file)) {
        if (isInternal(specifier)) continue;

        if (isNodeBuiltin(specifier)) {
          violations.push(`${relative(SRC_DIR, file)}: ${specifier}`);
          continue;
        }
        if (ALLOWED_RUNTIME_IMPORTS.includes(specifier)) continue;
        // Any module reachable only from the `/next` entry may use Next, not
        // just the entry file itself: splitting that entry into helpers must
        // not require every helper to re-export through one file.
        if (isNextSide && NEXT_ONLY_IMPORTS.includes(specifier)) continue;

        violations.push(`${relative(SRC_DIR, file)}: ${specifier}`);
      }
    }

    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("keeps the next entry out of the root's module graph", () => {
    // The guarantee is about what importing the package ROOT pulls in, so it
    // is checked over the graph reachable from `index.ts` rather than file by
    // file. A re-export of `./next` from the root would satisfy every
    // per-file check while breaking the promise outright.
    const rootGraph = reachableFrom(join(SRC_DIR, "index.ts"));
    const nextEntry = join(SRC_DIR, "next.ts");

    expect(
      rootGraph.has(nextEntry),
      "index.ts must not reach next.ts through any chain of relative imports"
    ).toBe(false);

    const leaks: string[] = [];
    for (const file of rootGraph) {
      for (const specifier of runtimeImports(file)) {
        if (specifier === "next" || specifier.startsWith("next/")) {
          leaks.push(`${relative(SRC_DIR, file)}: ${specifier}`);
        }
      }
    }
    expect(leaks, leaks.join("\n")).toEqual([]);
  });

  it("keeps next/* out of every file outside the next graph", () => {
    const leaks: string[] = [];

    for (const file of files) {
      if (nextGraph.has(file)) continue;
      for (const specifier of runtimeImports(file)) {
        if (specifier === "next" || specifier.startsWith("next/")) {
          leaks.push(`${relative(SRC_DIR, file)}: ${specifier}`);
        }
      }
    }

    expect(leaks, leaks.join("\n")).toEqual([]);
  });

  it("imports neither the admin, the CMS runtime, nor the editor", () => {
    // Named explicitly ON TOP of the allowlist. The allowlist already refuses
    // these, but naming them makes the failure message say what rule was
    // broken instead of only that something unlisted appeared.
    const forbidden = [
      "@nextlyhq/admin",
      "@nextlyhq/plugin-sdk",
      "@nextlyhq/plugin-page-builder",
      "@nextlyhq/ui",
    ];
    // Permitted inside the `/next` graph and refused everywhere else, on the
    // same footing as `next/*`. A route helper has to read content, and the
    // subpath is the boundary that keeps that away from the renderer; the
    // per-file check below is what makes "away" mean something.
    const nextSideOnly = ["nextly"];
    const violations: string[] = [];

    for (const file of files) {
      const isNextSide = nextGraph.has(file);
      for (const specifier of runtimeImports(file)) {
        const root = specifier.startsWith("@")
          ? specifier.split("/").slice(0, 2).join("/")
          : specifier.split("/")[0];
        if (!root) continue;
        if (forbidden.includes(root)) {
          violations.push(`${relative(SRC_DIR, file)}: ${specifier}`);
          continue;
        }
        if (nextSideOnly.includes(root) && !isNextSide) {
          violations.push(`${relative(SRC_DIR, file)}: ${specifier}`);
        }
      }
    }

    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("keeps the CMS out of the root's module graph", () => {
    // The promise the optional peer dependency rests on. `nextly` is declared
    // optional so that a consumer rendering documents standalone installs
    // nothing extra — which is only true while no chain from `index.ts` reaches
    // it. A per-file check cannot see that: every individual file could be
    // clean while the root re-exported the one that is not.
    const rootGraph = reachableFrom(join(SRC_DIR, "index.ts"));
    const leaks: string[] = [];

    for (const file of rootGraph) {
      for (const specifier of runtimeImports(file)) {
        const root = specifier.split("/")[0];
        if (root === "nextly") {
          leaks.push(`${relative(SRC_DIR, file)}: ${specifier}`);
        }
      }
    }

    expect(leaks, leaks.join("\n")).toEqual([]);
  });
});
