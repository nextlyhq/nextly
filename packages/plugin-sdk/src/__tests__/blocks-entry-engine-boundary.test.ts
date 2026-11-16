/**
 * The SDK's blocks entry reaches the block engine through its narrow entries
 * only, never its root.
 *
 * A plugin that contributes blocks imports `@nextlyhq/plugin-sdk/blocks`, and
 * the admin loads that plugin's module on every screen. The engine's root
 * re-exports the whole engine, its style compiler and the CSS parser among it,
 * so one import of it from this entry put all of that on the sign-in page.
 * Held against the built entry and every chunk it imports, since that is what
 * an application's bundler reads.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), "../../dist");
const ENGINE_ROOT = "@nextlyhq/blocks-engine";

/**
 * The specifiers a built module imports or re-exports from: `from "…"`, a
 * side-effect `import "…"`, and a dynamic `import("…")`, each of which brings
 * the module it names.
 */
function specifiersOf(code: string): string[] {
  return [...code.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)"([^"]+)"/g)].map(
    match => match[1]
  );
}

/** Every package specifier the built `entry` reaches, through its own chunks. */
function packagesReached(entry: string): string[] {
  const seen = new Set<string>();
  const packages = new Set<string>();
  const queue = [join(DIST, entry)];
  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    for (const specifier of specifiersOf(readFileSync(file, "utf8"))) {
      if (specifier.startsWith(".")) {
        queue.push(resolve(dirname(file), specifier));
      } else {
        packages.add(specifier);
      }
    }
  }
  return [...packages].sort();
}

describe("the blocks entry and the block engine", () => {
  it("has been built", () => {
    expect(existsSync(join(DIST, "blocks.mjs"))).toBe(true);
  });

  it("never imports the engine's root", () => {
    expect(packagesReached("blocks.mjs")).not.toContain(ENGINE_ROOT);
  });

  it("CONTROL: reaches the engine, through its named-query entry", () => {
    // A walk that read no import would pass the check above for any build.
    expect(packagesReached("blocks.mjs")).toContain(
      `${ENGINE_ROOT}/named-query`
    );
  });
});
