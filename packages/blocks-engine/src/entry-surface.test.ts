/**
 * Every primitive in the format and tree modules is reachable from the package
 * entry.
 *
 * `export` in a module makes a symbol importable WITHIN the package. A consumer
 * gets only what the entry re-exports, and the two are independent: a symbol can
 * satisfy every internal caller and be unreachable from outside.
 *
 * That difference matters most for the symbols these two modules hold, because
 * each is written as the single answer to a question — what a stored value IS,
 * what a copied id reference means, how a forest is rewritten. A single answer
 * a caller cannot import is one they write again, and the second spelling is
 * the defect: it admits what the first refuses, and no test compares them.
 *
 * Scoped to these two modules rather than to every module, because that is
 * where the claim is made: `document.ts` states what a stored document is, and
 * `tree.ts` holds the traversal and copying rules a caller is not meant to
 * rewrite.
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
 * Names the entry does not re-export.
 *
 * A record of what the entry holds today, not a judgement that it should: the
 * assertion below fails on a name listed here that IS reachable, so the list
 * cannot quietly outlive the state it describes.
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
