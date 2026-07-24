import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Dirent } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The engine's core contract: no React and no Nextly at runtime, ever.
 * Documents must be usable from Node scripts, edge runtimes, browsers, and
 * external agents without a framework install. Type-only imports are fine
 * (they erase at build); runtime imports are a contract violation this test
 * turns into a hard failure.
 */

// `import.meta.dirname` only exists from Node 20.11; the package floor is
// Node >=20.0, so derive the directory from the module URL to stay runnable
// across the whole supported range.
const SRC_DIR = dirname(fileURLToPath(import.meta.url));

/** Import specifiers the engine must never depend on at runtime. */
const FORBIDDEN_RUNTIME_IMPORTS = [
  "react",
  "react-dom",
  "nextly",
  "next",
  "@nextlyhq/admin",
  "@nextlyhq/ui",
];

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
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      files.push(full);
    }
  }
  return files;
}

describe("the engine is runtime-free", () => {
  it("has no runtime imports of React, Next.js, or Nextly packages", () => {
    for (const file of sourceFiles()) {
      const source = readFileSync(file, "utf8");
      // Matches `import ... from "x"` and `export ... from "x"` but not
      // `import type ...` — type-only imports erase at build and are allowed.
      // Also matches bare side-effect imports (`import "x";`) and dynamic
      // imports, so every runtime import FORM the engine forbids is caught.
      const runtimeImports = [
        ...source.matchAll(
          /^\s*(?:import|export)\s+(?!type\s)[^;]*?\sfrom\s+["']([^"']+)["']/gm
        ),
        ...source.matchAll(/^\s*import\s+["']([^"']+)["']/gm),
        ...source.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g),
      ].map(match => match[1]);

      for (const specifier of runtimeImports) {
        if (specifier === undefined) continue;
        const forbidden = FORBIDDEN_RUNTIME_IMPORTS.some(
          pkg => specifier === pkg || specifier.startsWith(`${pkg}/`)
        );
        expect(
          forbidden,
          `${file} imports "${specifier}" at runtime — the engine must stay runtime-free (use "import type" if only types are needed)`
        ).toBe(false);
      }
    }
  });

  it("declares zero runtime dependencies in package.json", () => {
    const pkg = JSON.parse(
      readFileSync(join(SRC_DIR, "..", "package.json"), "utf8")
    ) as {
      dependencies?: object;
      peerDependencies?: object;
      optionalDependencies?: object;
    };
    expect(pkg.dependencies ?? {}).toEqual({});
    expect(pkg.peerDependencies ?? {}).toEqual({});
    expect(pkg.optionalDependencies ?? {}).toEqual({});
  });
});
