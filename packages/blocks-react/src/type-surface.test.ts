/**
 * Every type this package's public API is written in terms of must be
 * IMPORTABLE from it, not merely mentioned by it.
 *
 * A package that names a type in a parameter or return position owes that type
 * to its callers. A type mentioned but not exported leaves a host able to SEE
 * the name it is required to pass with no way to write it down: the value must
 * stay unannotated, which keeps the check at the call site and loses the
 * ability to name the value, move it, or type a module boundary around it.
 *
 * `@nextlyhq/blocks-engine` is a DEPENDENCY of this package rather than a peer,
 * so a host has no direct path to it and cannot import those types itself.
 *
 * **Asserted against the BUILT `.d.ts`, not the source, and that distinction is
 * the test.** A `.d.ts` can mention a type in three ways and only one of them
 * is importable: declared and exported, declared and NOT exported (a name a
 * consumer can read and not use), or inlined structurally with no name at all.
 * Reading `src/index.ts` cannot tell them apart — `export *` re-exports without
 * naming, and the bundler rewrites what survives. The artifact a consumer
 * actually resolves is the only place this question has an answer.
 *
 * @module type-surface.test
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { execFileSync } from "node:child_process";

import { beforeAll, describe, expect, it } from "vitest";

const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");

/**
 * The names an entry actually exports.
 *
 * **The alias form is the whole difficulty, and it is why this parser exists
 * rather than a grep.** A bundled declaration re-exports as
 * `export { a as BlockRenderArgs }`, so the exported NAME is on the right of
 * `as` while the local name on the left is a generated letter; reading the
 * left-hand side concludes the type is missing when it is not. `export type
 * { ... }`, inline `{ type X }` and direct `export interface X` all have to be
 * read for the same reason — any form missed reports an absence that is not
 * there.
 */
function exportedNames(declaration: string): Set<string> {
  const names = new Set<string>();

  for (const block of declaration.matchAll(
    /export\s+(?:type\s+)?\{([^}]*)\}/g
  )) {
    for (const clause of block[1].split(",")) {
      const trimmed = clause.trim().replace(/^type\s+/, "");
      if (trimmed === "") continue;
      // `a as BlockRenderArgs` exports the RIGHT-hand name.
      const parts = trimmed.split(/\s+as\s+/);
      const exported = (parts[parts.length - 1] ?? "").trim();
      if (exported !== "") names.add(exported);
    }
  }

  for (const declared of declaration.matchAll(
    /export\s+(?:declare\s+)?(?:type|interface|const|function|class)\s+([A-Za-z0-9_$]+)/g
  )) {
    names.add(declared[1]!);
  }

  return names;
}

/**
 * Every engine type the built declarations IMPORT, derived rather than listed.
 *
 * **A hand-written list has the defect it exists to catch**: it can only hold
 * what someone already knew was missing, so it grows with memory rather than
 * with the API and certifies exactly the state it was written against. Types
 * reached through bundler CHUNK declarations rather than the entry file — the
 * signatures of `createBlockResolver`, `migrationSourceFor`, `toPageStyles` and
 * `fetchPolicyLabel` among them — never appear in such a list at all.
 *
 * The declarations name their own dependency: every chunk carries an
 * `import { ... } from "@nextlyhq/blocks-engine"` listing exactly the engine
 * types that surface is written in. Reading THAT means the requirement grows
 * with the API instead of with someone remembering to extend an array.
 */
function importedEngineTypes(): Set<string> {
  const names = new Set<string>();
  for (const file of readdirSync(DIST).filter(f => f.endsWith(".d.ts"))) {
    const src = readFileSync(join(DIST, file), "utf8");
    for (const line of src.matchAll(
      /import\s*\{([^}]*)\}\s*from\s*['"]@nextlyhq\/blocks-engine['"]/g
    )) {
      for (const clause of line[1].split(",")) {
        // `BlockRenderArgs as BlockRenderArgs$1` imports the LEFT name; the
        // right is the bundler's local alias, which no consumer ever writes.
        const original = clause
          .trim()
          .replace(/^type\s+/, "")
          .split(/\s+as\s+/)[0];
        const trimmed = (original ?? "").trim();
        if (trimmed !== "") names.add(trimmed);
      }
    }
  }
  return names;
}

/** The sentinel each entry is pinned against — see the assertion for why. */
const SENTINELS: Readonly<Record<string, string>> = {
  index: "PageRenderer",
  next: "createBlocksPage",
};

describe("the published type surface", () => {
  // Rebuilt here, not merely checked for, because a `dist` that exists can
  // still predate the source change and would certify a surface nobody has.
  // Turbo orders this package's build before its tests, but the direct runs it
  // never sees — `pnpm --filter @nextlyhq/blocks-react test`, watch, UI — have
  // no such edge. Rebuilding unconditionally costs a second build on a cache
  // miss and removes the question; deciding whether `dist` was current would
  // mean re-implementing turbo's input tracking, and every error in that
  // passes stale declarations.
  beforeAll(() => {
    execFileSync("pnpm", ["run", "build"], {
      cwd: join(DIST, ".."),
      stdio: "ignore",
    });
  }, 180_000);

  it("exports every engine type its declarations import", () => {
    const entries = Object.keys(SENTINELS).map(name =>
      join(DIST, `${name}.d.ts`)
    );
    for (const file of entries) {
      expect(
        existsSync(file),
        `${file} is missing — run \`pnpm build --filter @nextlyhq/blocks-react\``
      ).toBe(true);
    }

    const required = importedEngineTypes();
    // The positive control, and it is load-bearing. A derivation that found
    // NOTHING would assert nothing at all and read as a clean pass.
    expect(required.size).toBeGreaterThan(4);

    // Exported from EITHER entry: a type belonging to the Next-coupled surface
    // has no reason to appear on the root, and requiring both would push names
    // onto an entry that does not use them.
    const exported = new Set<string>();
    for (const file of entries) {
      for (const name of exportedNames(readFileSync(file, "utf8"))) {
        exported.add(name);
      }
    }

    for (const [entry, sentinel] of Object.entries(SENTINELS)) {
      expect(
        exported.has(sentinel),
        `parser found no \`${sentinel}\` in ${entry}.d.ts`
      ).toBe(true);
    }

    expect([...required].filter(name => !exported.has(name)).sort()).toEqual(
      []
    );
  });
});
