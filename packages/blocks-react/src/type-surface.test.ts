/**
 * Every type this package's public API is written in terms of must be
 * IMPORTABLE from it, not merely mentioned by it.
 *
 * A package that names a type in a parameter or return position owes that type
 * to its callers. `blocks-react` did not: `StyleCompileContext`, `BlockDocument`
 * and `DocumentLimits` appeared in the built declarations in parameter
 * positions while being named in no export statement, and `BreakpointSet` — the
 * one field `StyleCompileContext` requires — was absent from the surface
 * entirely. A host could SEE the name it was required to pass and had no way to
 * write it down. The workaround was to leave the value unannotated, which keeps
 * the check at the call site and loses the ability to name the value, move it,
 * or type a module boundary around it.
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

import { describe, expect, it } from "vitest";

const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");

/**
 * The names an entry actually exports.
 *
 * **The alias form is the whole difficulty, and it is why this parser exists
 * rather than a grep.** A bundled declaration re-exports as
 * `export { a as BlockRenderArgs }`, so the exported NAME is on the right of
 * `as` while the local name on the left is a generated letter. A check reading
 * the left-hand side concludes the type is missing and is wrong — measured,
 * twice, while writing this file. `export type { ... }`, inline
 * `{ type X }` and direct `export interface X` all have to be read too, for the
 * same reason: any one of them missed reports an absence that is not there.
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
 * **A hand-written list has the defect it exists to catch.** The first version
 * of this test enumerated the types a reported gap had named, and passed while
 * `AnyBlockDefinition`, `MigrationSource`, `CompiledPageCss` and
 * `RemotePatternInput` were still unreachable — they sit in the signatures of
 * `createBlockResolver`, `migrationSourceFor`, `toPageStyles` and
 * `fetchPolicyLabel`, in bundler CHUNK declarations rather than in the entry
 * file, so neither the measurement nor the list saw them.
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
    // NOTHING would assert nothing at all and read as a clean pass — which is
    // precisely how the previous version of this test passed over four
    // unreachable types.
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
