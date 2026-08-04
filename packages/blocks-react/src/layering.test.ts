import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { Dirent } from "node:fs";

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
 *    share a document format, not a module graph — the separation Plasmic
 *    maintains and the one the proof-of-concept already enforces for itself.
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
];

/** Files that are test harness rather than shipped code. */
const TEST_FILE = /\.test\.tsx?$/;

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
 * Module specifiers a file imports at RUNTIME.
 *
 * `import type` and `export type` are excluded because they erase at build and
 * cost a consumer nothing. Inline `import { type X }` still counts: the
 * statement itself is a runtime import even when one binding is a type.
 *
 * DYNAMIC imports count too. `await import("next/headers")` puts Next in the
 * module graph exactly as a static import does, and a guard that reads only
 * static syntax is bypassed by the one line most likely to be written when
 * someone wants to "just reach for it here" — which is precisely the moment
 * the boundary needs enforcing. `require()` is scanned for the same reason,
 * even though this package is ESM-only, because a lazy CommonJS resolve is the
 * documented workaround used elsewhere in this repo.
 */
function runtimeImports(file: string): string[] {
  const raw = readFileSync(file, "utf8");
  // Comments become a single space so one sitting between tokens cannot hide a
  // call from the matchers below, while the token boundaries the patterns rely
  // on are preserved. Both forms are legal between `import` and its
  // parenthesis, so both must go:
  //
  //   import /* annotation */ ("next/headers")
  //   import // annotation
  //   ("next/headers")
  //
  // String literals are left intact deliberately. A `//` inside a specifier is
  // part of a URL, not a comment, and stripping it would corrupt the very
  // value being checked; the cost is that a `//` inside a string could mask a
  // later call on the same line, which no import statement produces.
  const source = raw
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1 ");
  const specifiers: string[] = [];

  // `from "..."` in an import/export statement, and bare `import "..."`.
  const staticPattern =
    /(?:^|\n)\s*(?:import|export)\s+(type\s+)?([^;'"]*?)\s*from\s*["']([^"']+)["']|(?:^|\n)\s*import\s+["']([^"']+)["']/g;

  let match: RegExpExecArray | null;
  while ((match = staticPattern.exec(source)) !== null) {
    const isTypeOnly = Boolean(match[1]);
    const specifier = match[3] ?? match[4];
    if (!specifier || isTypeOnly) continue;
    specifiers.push(specifier);
  }

  // `import("...")` and `require("...")`, with any whitespace. A preceding
  // `.` is excluded so a method named `import` on some object is not counted.
  const dynamicPattern =
    /(?<![.\w])(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g;
  while ((match = dynamicPattern.exec(source)) !== null) {
    const specifier = match[1];
    if (specifier) specifiers.push(specifier);
  }

  // A dynamic import whose specifier is not a single literal cannot be checked
  // here. Fail loudly rather than pass silently: the point of this guard is
  // that a route into the module graph cannot be opened without a deliberate
  // act.
  //
  // The test is "the argument is not EXACTLY one string literal", not "the
  // argument does not start with a quote". `import("next/" + "headers")` starts
  // with a quote, so a first-character test waves it through while the literal
  // matcher above also skips it for the concatenation.
  // `\s*` alone is not enough between the keyword and the parenthesis:
  // `import /* webpackChunkName: "x" */ ("next/headers")` is valid and would
  // be seen by neither matcher. Comments are stripped before matching so both
  // forms are recognised.
  const anyDynamic = /(?<![.\w])(?:import|require)\s*\(([^)]*)\)/g;
  const singleLiteral = /^\s*["'][^"']*["']\s*$/;
  let dynamicMatch: RegExpExecArray | null;
  while ((dynamicMatch = anyDynamic.exec(source)) !== null) {
    const argument = dynamicMatch[1] ?? "";
    if (!singleLiteral.test(argument)) {
      specifiers.push("<computed-dynamic-import>");
    }
  }

  return specifiers;
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
 * file named `next/*` directly. Checking files in isolation cannot see that.
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
      "nextly",
      "@nextlyhq/admin",
      "@nextlyhq/plugin-sdk",
      "@nextlyhq/plugin-page-builder",
      "@nextlyhq/ui",
    ];
    const violations: string[] = [];

    for (const file of files) {
      for (const specifier of runtimeImports(file)) {
        const root = specifier.startsWith("@")
          ? specifier.split("/").slice(0, 2).join("/")
          : specifier.split("/")[0];
        if (root && forbidden.includes(root)) {
          violations.push(`${relative(SRC_DIR, file)}: ${specifier}`);
        }
      }
    }

    expect(violations, violations.join("\n")).toEqual([]);
  });
});
