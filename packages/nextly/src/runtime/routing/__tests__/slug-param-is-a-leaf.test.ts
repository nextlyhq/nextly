/**
 * `slug-param` is a LEAF, and this is what keeps it one.
 *
 * The module exists so that a consumer importing `slugToStaticParam` — the SEO
 * plugin's sitemap, `blocks-react`'s Next entry, anything deriving a URL for an
 * entry — does not acquire the content route's graph: `requireNextly` and the
 * whole Direct API behind it, the error type, the not-found trigger, the content
 * resolver. None of that is used to turn a string into path segments.
 *
 * 🔴 That property is invisible at the call site and silent when it breaks. The
 * function keeps returning the right answer with any number of imports above it,
 * so nothing fails, no test goes red, and the graph is back to where it started
 * — which is precisely how it got there the first time.
 *
 * Asserted on the TRANSITIVE closure rather than on this file's own import list.
 * A leaf that imports a leaf that imports the Direct API is not a leaf, and a
 * one-level check reports it as one.
 *
 * 🔴 And a leaf MODULE is only half of it. The first version of this guard
 * checked the source graph alone and passed while every published spelling still
 * resolved to the built route bundle, which has already inlined this function
 * beside its eager Direct API imports — measured through package resolution at
 * 3,251 inputs and 21.3 MB, against 4 and 1.4 KB for the leaf entry. The source
 * graph cannot see that, so what a CONSUMER can reach is asserted separately
 * below, from the export map and the build config rather than from `dist`: a
 * stale artifact would agree with itself and fail in the passing direction.
 *
 * @module runtime/routing/__tests__/slug-param-is-a-leaf
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

// `import.meta.dirname` needs Node 20.11 and the package floor is Node >=20.0.
const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTING_DIR = resolve(HERE, "..");
const SRC_DIR = resolve(ROUTING_DIR, "../..");

/** Every module `entry` reaches, directly or through anything it imports. */
function transitiveImports(entry: string): {
  local: Set<string>;
  bare: Set<string>;
} {
  const local = new Set<string>();
  const bare = new Set<string>();
  const queue = [entry];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);

    // `preProcessFile` over the SOURCE, not a compiled bundle: a bundle has
    // already dropped whatever the bundler decided to drop, which is the very
    // thing under test.
    const found = ts.preProcessFile(readFileSync(file, "utf8"), true, true);
    for (const { fileName } of found.importedFiles) {
      if (!fileName.startsWith(".")) {
        bare.add(fileName);
        continue;
      }
      const base = resolve(dirname(file), fileName);
      const target = [".ts", ".tsx", "/index.ts"]
        .map(ext => `${base}${ext}`)
        .find(existsSync);
      // A relative import that resolves to nothing is a failure to RESOLVE, not
      // an absence of one. Recorded as reached so it cannot pass by vanishing.
      if (target === undefined) {
        local.add(`${relative(SRC_DIR, base)} (unresolved)`);
        continue;
      }
      local.add(relative(SRC_DIR, target));
      queue.push(target);
    }
  }
  return { local, bare };
}

describe("slug-param stays a leaf", () => {
  it("reaches exactly one module, and no package at all", () => {
    const { local, bare } = transitiveImports(
      join(ROUTING_DIR, "slug-param.ts")
    );

    // Named exhaustively rather than checked for absences. A denylist only stops
    // what somebody thought to write down, and the import that undoes this will
    // be the one nobody predicted.
    expect([...local].sort()).toEqual(["runtime/routing/reserved-paths.ts"]);
    expect([...bare]).toEqual([]);
  });

  it("is the control: the route it came from does reach the Direct API", () => {
    // Without this the assertion above passes just as well when the probe is
    // pointed at nothing, resolves nothing, or silently reads an empty file —
    // "reaches one module" and "reaches nothing measurable" look identical.
    const { local } = transitiveImports(join(ROUTING_DIR, "content-route.ts"));

    expect([...local]).toContain("direct-api/nextly.ts");
    expect([...local]).toContain("runtime/routing/resolve-content.ts");
    // And it still carries the function's public name, so moving the definition
    // did not move the export a published entry point promises.
    expect([...local]).toContain("runtime/routing/slug-param.ts");
  });
});

describe("the leaf is reachable as one", () => {
  const PKG = JSON.parse(
    readFileSync(resolve(SRC_DIR, "../package.json"), "utf8")
  ) as { exports: Record<string, { types?: string; import?: string }> };

  it("publishes the leaf under its own entry", () => {
    // Without an entry of its own, both documented spellings resolve to the
    // route bundle and the split reaches nobody.
    expect(PKG.exports["./route-path"]?.import).toBe(
      "./dist/runtime/routing/slug-param.mjs"
    );
    expect(PKG.exports["./route-path"]?.types).toBe("./dist/route-path.d.ts");
  });

  it("builds the artifact that entry promises", () => {
    // 🔴 The two halves are written in different files and neither fails
    // without the other: an export map naming an artifact the build does not
    // emit is a published entry point that 404s on install, and it would pass
    // the assertion above on its own.
    const tsup = readFileSync(resolve(SRC_DIR, "../tsup.config.js"), "utf8");
    expect(tsup).toContain('"src/runtime/routing/slug-param.ts"');
  });
});
