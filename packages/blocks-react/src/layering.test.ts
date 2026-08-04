import { readFileSync, readdirSync } from "node:fs";
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
 */
function runtimeImports(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const specifiers: string[] = [];

  // `from "..."` in an import/export statement, and bare `import "..."`.
  const pattern =
    /(?:^|\n)\s*(?:import|export)\s+(type\s+)?([^;'"]*?)\s*from\s*["']([^"']+)["']|(?:^|\n)\s*import\s+["']([^"']+)["']/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const isTypeOnly = Boolean(match[1]);
    const specifier = match[3] ?? match[4];
    if (!specifier || isTypeOnly) continue;
    specifiers.push(specifier);
  }
  return specifiers;
}

/** Relative specifiers are internal and never gated. */
function isInternal(specifier: string): boolean {
  return specifier.startsWith(".") || specifier.startsWith("#");
}

/** `node:fs` and friends: allowed nowhere in shipped code. */
function isNodeBuiltin(specifier: string): boolean {
  return specifier.startsWith("node:");
}

describe("the package's layering contract", () => {
  const files = sourceFiles();

  it("has source files to check", () => {
    // A traversal bug that returned nothing would make every assertion below
    // vacuously true, which is the failure mode these tests exist to prevent.
    expect(files.length).toBeGreaterThan(0);
  });

  it("imports nothing outside the allowlist", () => {
    const violations: string[] = [];

    for (const file of files) {
      const isNextEntry = relative(SRC_DIR, file) === "next.ts";
      for (const specifier of runtimeImports(file)) {
        if (isInternal(specifier)) continue;

        if (isNodeBuiltin(specifier)) {
          violations.push(`${relative(SRC_DIR, file)}: ${specifier}`);
          continue;
        }
        if (ALLOWED_RUNTIME_IMPORTS.includes(specifier)) continue;
        if (isNextEntry && NEXT_ONLY_IMPORTS.includes(specifier)) continue;

        violations.push(`${relative(SRC_DIR, file)}: ${specifier}`);
      }
    }

    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("keeps next/* out of every file except the next entry", () => {
    const leaks: string[] = [];

    for (const file of files) {
      if (relative(SRC_DIR, file) === "next.ts") continue;
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
