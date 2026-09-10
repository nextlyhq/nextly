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

/*
 * There is no allowlist, and that is the point.
 *
 * One existed while `isPartName` was declared shared and not reachable, and it
 * carried a second assertion to stop an entry outliving the state it described.
 * An empty list cannot do that job: the loop over it would run no assertion at
 * all and report a pass, which is the one result this file must never give.
 *
 * So an exception is not a list entry any more, it is a diff. A function added
 * to `document.ts` or `tree.ts` and not re-exported fails the assertion below,
 * and anyone who believes it genuinely should not be published has to say so
 * where a reader will see it rather than by adding a name to a set.
 */

describe("the package entry reaches every primitive that claims to be shared", () => {
  for (const module of ["document", "tree"]) {
    it(`re-exports every function ${module}.ts exports`, () => {
      const declared = exportedFunctions(module);

      // The control: a parse that found nothing would make this pass while
      // testing no symbol at all.
      expect(declared.length).toBeGreaterThan(5);

      const missing = declared.filter(name => !reachable.has(name));
      expect(missing).toEqual([]);
    });
  }
});
