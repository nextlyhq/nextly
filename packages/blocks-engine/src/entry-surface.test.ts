/**
 * Every primitive in the format and tree modules is reachable from the package
 * entry.
 *
 * This exists because the same gap has now been found three times by a reader
 * rather than a test, and each time the symbol's own docblock had already
 * claimed the thing that was not true: `idReferenceTokens` said it was
 * published so a second copier would not re-split an IDREFS value;
 * `isBlockOrigin` was moved beside its type so both roads into storage could
 * ask one question; `isPartName` says it is "the ONE answer" for the same
 * reason its exported sibling `isBlockType` is.
 *
 * A rule nobody can import is a rule the next surface writes again, and the
 * second spelling is the defect — so "is it exported from the module" and "can
 * a consumer reach it" are two different claims, and only the second one
 * matters to the argument these docblocks make.
 *
 * Scoped to the two modules that publish primitives OTHER code is meant to
 * reuse rather than to every module, because that is the claim being checked:
 * `document.ts` states what a stored document IS, and `tree.ts` holds the
 * traversal and copying rules a caller is not supposed to rewrite.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import * as entry from "./index";

/** Every `export function` name a module declares. */
function exportedFunctions(module: string): string[] {
  const source = readFileSync(
    new URL(`./${module}.ts`, import.meta.url),
    "utf8"
  );
  return [...source.matchAll(/^export function (\w+)/gm)].map(
    match => match[1]!
  );
}

/**
 * Reachable from the entry, asked of the MODULE OBJECT rather than of the
 * index source.
 *
 * Reading `index.ts` for names would pass on a re-export that does not resolve,
 * and would need a parser for every export form the file uses. What a consumer
 * gets is the module object, so that is what is asked.
 */
const reachable = new Set(Object.keys(entry));

/**
 * Known unreachable, with the reason.
 *
 * `isPartName` predates this guard and its own docblock argues it should be
 * published — it is left alone here rather than exported as a side effect of an
 * unrelated change, and filed instead.
 */
const KNOWN_UNPUBLISHED = new Set(["isPartName"]);

describe("the package entry reaches every primitive that claims to be shared", () => {
  for (const module of ["document", "tree"]) {
    it(`re-exports every function ${module}.ts exports`, () => {
      const declared = exportedFunctions(module);

      // The control: a parse that found nothing would make this pass while
      // testing no symbol at all.
      expect(declared.length).toBeGreaterThan(5);

      const missing = declared.filter(
        name => !reachable.has(name) && !KNOWN_UNPUBLISHED.has(name)
      );
      expect(missing).toEqual([]);
    });
  }

  it("still names something the entry genuinely does not export", () => {
    // The allowlist has to describe reality, or it is a place defects hide.
    for (const name of KNOWN_UNPUBLISHED) {
      expect(reachable.has(name)).toBe(false);
    }
  });
});
