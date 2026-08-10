import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Dirent } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The engine's core contract: no framework at runtime, ever. Documents must be
 * usable from Node scripts, edge runtimes, browsers, and external agents
 * without a framework install. Type-only imports are fine (they erase at
 * build); runtime imports are a contract violation this test turns into a hard
 * failure.
 *
 * The guard is an ALLOWLIST rather than a list of banned packages: a blocklist
 * only stops what someone thought to name, and the next dependency added
 * without thought is exactly the one that breaks the promise. Adding an entry
 * below is a deliberate act with a reason recorded beside it.
 */

// `import.meta.dirname` only exists from Node 20.11; the package floor is
// Node >=20.0, so derive the directory from the module URL to stay runnable
// across the whole supported range.
const SRC_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Packages the engine may import at runtime, and why.
 *
 * - `css-tree`: the style compiler's parser. Style values and custom CSS have
 *   to be parsed to be made safe, and no seam moves that requirement
 *   elsewhere. Pure JavaScript, ships a browser build, and pulls in only
 *   `mdn-data` and `source-map-js`, so the "runs anywhere" promise holds.
 * - `picomatch`: the glob grammar `next/image`'s `remotePatterns` is written
 *   in. The remote-host policy has to read the same patterns a Nextly app
 *   already declares for `next/image`, and re-implementing that grammar in a
 *   SECURITY control to avoid a dependency would trade a known matcher for an
 *   unknown one. Zero dependencies of its own, no Node builtins, and already
 *   run in a browser by the page builder's canvas, so the promise holds.
 */
const ALLOWED_RUNTIME_DEPENDENCIES = ["css-tree", "picomatch"];

/**
 * Files that are part of the test harness rather than the shipped engine.
 *
 * They may import the test runner, because nothing outside a test run ever
 * loads them: they are excluded from the published build. What ships is what
 * this guard governs, and drawing the line by suffix means a new harness file
 * has to name itself as one.
 */
const HARNESS_SUFFIXES = [".test.ts", ".bench.ts", ".test-d.ts"];

// Walk the whole src tree, not just its top level: a forbidden import in a
// future subdirectory must fail this guard too, not slip past because the scan
// only looked at immediate children.
function sourceFiles(dir: string = SRC_DIR): string[] {
  const entries: Dirent[] = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(full));
    } else if (
      entry.name.endsWith(".ts") &&
      !HARNESS_SUFFIXES.some(suffix => entry.name.endsWith(suffix))
    ) {
      files.push(full);
    }
  }
  return files;
}

/**
 * The package a bare import specifier names: `css-tree/lexer` is `css-tree`,
 * `@scope/pkg/sub` is `@scope/pkg`. Relative and `node:` specifiers are not
 * packages and are reported as-is so the caller can rule on them.
 */
function packageOf(specifier: string): string {
  if (specifier.startsWith(".") || specifier.startsWith("node:")) {
    return specifier;
  }
  const parts = specifier.split("/");
  return specifier.startsWith("@")
    ? parts.slice(0, 2).join("/")
    : (parts[0] ?? specifier);
}

/**
 * Every specifier a file imports at RUNTIME.
 *
 * Three forms, because a guard that knows only one of them is a guard the next
 * import form walks straight past: `import … from "x"` and its re-export
 * cousin, the bare side-effect `import "x"`, and a dynamic `import("x")`.
 * `import type` is absent on purpose — it erases at build.
 *
 * Shared by both checks below so neither can fall behind the other on which
 * forms count as reaching a package.
 */
function runtimeSpecifiers(source: string): string[] {
  return [
    ...source.matchAll(
      /^\s*(?:import|export)\s+(?!type\s)[^;]*?\sfrom\s+["']([^"']+)["']/gm
    ),
    ...source.matchAll(/^\s*import\s+["']([^"']+)["']/gm),
    ...source.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g),
  ].flatMap(match => (match[1] === undefined ? [] : [match[1]]));
}

describe("the engine is runtime-free", () => {
  it("imports no package at runtime beyond the allowlist", () => {
    for (const file of sourceFiles()) {
      const source = readFileSync(file, "utf8");
      for (const specifier of runtimeSpecifiers(source)) {
        const pkg = packageOf(specifier);
        // Relative imports stay inside the package. Node builtins are refused
        // along with everything else: the engine promises to run in browsers
        // and edge runtimes, where they do not exist.
        if (pkg.startsWith(".")) continue;
        expect(
          ALLOWED_RUNTIME_DEPENDENCIES,
          `${file} imports "${specifier}" at runtime, which is not on the engine's allowlist — use "import type" if only types are needed, or add the package to ALLOWED_RUNTIME_DEPENDENCIES with a reason`
        ).toContain(pkg);
      }
    }
  });

  it("reaches css-tree only through its parser and walker entries", () => {
    // css-tree's root entry loads its MDN reference data, which calls
    // `createRequire` from `node:module`. The published build keeps
    // dependencies external, so that import would survive into a browser or
    // edge bundle and break the promise above. The parser and walker entries
    // carry none of it. Type-only imports of the root are fine: they erase.
    const allowed = new Set(["css-tree/parser", "css-tree/walker"]);
    for (const file of sourceFiles()) {
      const source = readFileSync(file, "utf8");
      for (const specifier of runtimeSpecifiers(source)) {
        if (packageOf(specifier) !== "css-tree") continue;
        expect(
          allowed,
          `${file} imports "${specifier}" at runtime — use css-tree/parser or css-tree/walker, whose module graphs do not reach node:module`
        ).toContain(specifier);
      }
    }
  });

  it("declares only allowlisted runtime dependencies in package.json", () => {
    const pkg = JSON.parse(
      readFileSync(join(SRC_DIR, "..", "package.json"), "utf8")
    ) as {
      dependencies?: Record<string, string>;
      peerDependencies?: object;
      optionalDependencies?: object;
    };
    expect(Object.keys(pkg.dependencies ?? {}).sort()).toEqual(
      [...ALLOWED_RUNTIME_DEPENDENCIES].sort()
    );
    // Peer and optional dependencies push an install decision onto consumers,
    // which is the opposite of the "install it and it works anywhere" promise.
    expect(pkg.peerDependencies ?? {}).toEqual({});
    expect(pkg.optionalDependencies ?? {}).toEqual({});
  });
});
