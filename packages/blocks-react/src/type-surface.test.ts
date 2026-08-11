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
import { existsSync, readFileSync } from "node:fs";
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
 * What each entry must hand a caller.
 *
 * Listed explicitly rather than derived from what the file mentions. A derived
 * check would pass the moment a type stopped being referenced, which is the
 * opposite of what this guards — and it would also sweep in prose from the
 * doc comments, which is how the first version of this measurement produced a
 * list containing `The`, `Why` and `HTML`.
 */
const REQUIRED: Readonly<
  Record<string, { sentinel: string; types: readonly string[] }>
> = {
  // Types originating in `@nextlyhq/blocks-engine`, which is a DEPENDENCY of
  // this package rather than a peer — so a host has no direct path to it and
  // cannot import these itself.
  index: {
    sentinel: "PageRenderer",
    types: [
      "BlockDocument",
      "BlockNode",
      "BreakpointSet",
      "DocumentLimits",
      "NodeStyles",
      "StyleCompileContext",
      // This package's own render-context surface.
      "BlockRenderArgs",
      "BlocksDataProvider",
      "BlockResolver",
      "PageContext",
      "PageStyles",
      "QueryBudget",
      "ReactBlockDefinition",
      "ResolvedMedia",
    ],
  },
  // The Next-coupled entry re-states what its own options are written in.
  // `nextly`'s route types are deliberately absent: it is a PEER dependency, so
  // a host has installed it directly and names `ContentEntry`, `RenderContext`
  // and the route shapes from `nextly/runtime` where they live. Two import
  // paths for one type costs more than one import a host already has.
  next: {
    sentinel: "createBlocksPage",
    types: ["BlockSeoContribution", "BlockSeoImage", "DerivedPageSeo"],
  },
};

describe("the published type surface", () => {
  for (const [entry, { sentinel, types }] of Object.entries(REQUIRED)) {
    it(`${entry} exports every type its API is written in`, () => {
      const file = join(DIST, `${entry}.d.ts`);
      // A build is the precondition, and saying so beats an empty-set pass:
      // without it every name below is "missing" for a reason that has nothing
      // to do with the surface.
      expect(
        existsSync(file),
        `${file} is missing — run \`pnpm build --filter @nextlyhq/blocks-react\``
      ).toBe(true);

      const exported = exportedNames(readFileSync(file, "utf8"));

      // The positive control, and it is load-bearing rather than setup. A
      // parser that returned NOTHING would report every required name as
      // missing and read as a real regression; one that returned everything
      // would pass while checking nothing. Naming a value this entry certainly
      // exports pins the parser against the real artifact — a size threshold
      // would not, because `next.d.ts` legitimately exports only a handful.
      expect(exported.has(sentinel), `parser found no \`${sentinel}\``).toBe(
        true
      );

      expect([...types].filter(name => !exported.has(name))).toEqual([]);
    });
  }
});
