import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The engine's core contract: no React and no Nextly at runtime, ever.
 * Documents must be usable from Node scripts, edge runtimes, browsers, and
 * external agents without a framework install. Type-only imports are fine
 * (they erase at build); runtime imports are a contract violation this test
 * turns into a hard failure.
 */

const SRC_DIR = join(import.meta.dirname, ".");

/** Import specifiers the engine must never depend on at runtime. */
const FORBIDDEN_RUNTIME_IMPORTS = [
  "react",
  "react-dom",
  "nextly",
  "next",
  "@nextlyhq/admin",
  "@nextlyhq/ui",
];

function sourceFiles(): string[] {
  return readdirSync(SRC_DIR)
    .filter(name => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map(name => join(SRC_DIR, name));
}

describe("the engine is runtime-free", () => {
  it("has no runtime imports of React, Next.js, or Nextly packages", () => {
    for (const file of sourceFiles()) {
      const source = readFileSync(file, "utf8");
      // Matches `import ... from "x"` and `export ... from "x"` but not
      // `import type ...` — type-only imports erase at build and are allowed.
      const runtimeImports = [
        ...source.matchAll(
          /^\s*(?:import|export)\s+(?!type\s)[^;]*?\sfrom\s+["']([^"']+)["']/gm
        ),
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
    ) as { dependencies?: object; peerDependencies?: object };
    expect(pkg.dependencies ?? {}).toEqual({});
    expect(pkg.peerDependencies ?? {}).toEqual({});
  });
});
