import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Dirent } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The block library stands on its own.
 *
 * `src/core`, `src/render` and `src/admin` are the package's earlier
 * implementation. They still render every page, so they are not going anywhere
 * today, and that is exactly why this guard exists: a single import from the new
 * library into one of them is invisible until the day that module is removed,
 * and then it is a rewrite rather than a deletion.
 *
 * The check is an ALLOWLIST — a relative import may resolve inside this
 * directory, or to one of the paths named below with a reason — rather than a
 * list of banned directories. A blocklist only stops what someone thought to
 * name; a new directory added later would walk straight past it.
 *
 * Type-only imports count. They erase from the bundle, but a type import is
 * still a file that has to exist, so it blocks a deletion just as firmly as a
 * value import does.
 *
 * What this cannot see is coupling reached THROUGH an allowed path: an
 * integration test that boots the plugin loads whatever the plugin loads. The
 * guard is about what the library itself is written against, which is what
 * decides whether it can outlive the code beside it.
 */

const BLOCKS_DIR = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = resolve(BLOCKS_DIR, "..");

/**
 * Paths outside this directory that a file here may import, and why.
 *
 * - `plugin`: the package's plugin entry. An integration test boots the real
 *   plugin to prove registration happens on a live registry, which cannot be
 *   done from a stub without proving something else instead.
 */
const ALLOWED_OUTSIDE_PATHS = ["plugin"];

function sourceFiles(dir: string = BLOCKS_DIR): string[] {
  const entries: Dirent[] = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(full));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Every specifier a file imports, type-only ones included.
 *
 * Four forms, because a guard that knows only some of them is one the next
 * import form walks past: `import … from`, its re-export cousin, the bare
 * side-effect import, and a dynamic `import()`.
 */
function allSpecifiers(source: string): string[] {
  return [
    ...source.matchAll(
      /^\s*(?:import|export)\s[^;]*?\sfrom\s+["']([^"']+)["']/gm
    ),
    ...source.matchAll(/^\s*import\s+["']([^"']+)["']/gm),
    ...source.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g),
  ].flatMap(match => (match[1] === undefined ? [] : [match[1]]));
}

describe("the block library does not depend on the code it replaces", () => {
  it("resolves every relative import inside its own directory", () => {
    for (const file of sourceFiles()) {
      const source = readFileSync(file, "utf8");
      for (const specifier of allSpecifiers(source)) {
        if (!specifier.startsWith(".")) continue;
        const target = resolve(dirname(file), specifier);
        if (!relative(BLOCKS_DIR, target).startsWith("..")) continue;
        const outside = relative(SRC_DIR, target);
        expect(
          ALLOWED_OUTSIDE_PATHS,
          `${relative(SRC_DIR, file)} imports "${specifier}", which resolves to "${outside}" outside the block library — write it against the engine API, or add the path to ALLOWED_OUTSIDE_PATHS with a reason`
        ).toContain(outside);
      }
    }
  });

  it("scans the files it claims to", () => {
    // A walk that silently found nothing would pass the check above forever.
    const scanned = sourceFiles().map(file => relative(BLOCKS_DIR, file));
    expect(scanned).toContain("library/collection-loop.tsx");
    expect(scanned).toContain("context.ts");
    expect(scanned.length).toBeGreaterThan(5);
  });
});
