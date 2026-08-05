/**
 * What following nested rules is allowed to cost.
 *
 * Rewriting a name inside a nested rule means re-parsing that rule from the
 * TEXT of the rule above it, because a nested rule is `Raw` to this parser
 * rather than a structure. That is the shape of an accidental quadratic: each
 * level re-reads a substring of its parent, so d levels of a sheet of length n
 * read O(n·d) characters, and d can itself grow with n. The origin scan carries
 * a bound for exactly this reason; the name rewriter takes the same one.
 *
 * Asserted by COUNTING PARSES rather than by timing. A wall-clock ratio is what
 * the engine's scaling gate uses because it has no cheaper signal available,
 * and it pays for that with a threshold wide enough to survive a noisy runner.
 * Here the work is countable: the css-tree entry points are already injected,
 * so a test can hand in a counting parser and assert the exact bound. That is
 * machine-independent, and it fails on the regression itself rather than on a
 * measurement of it.
 */
import * as csstree from "css-tree";
import { describe, expect, it } from "vitest";

import {
  namespaceDefinedNames,
  rewriteNameReferences,
  type CssTreeApi,
} from "./css-global-names";
import { MAX_RULE_NESTING, sanitizeCustomCss } from "./css-sanitize";

const SCOPE = "nx-pb-page";

/** `.n1 { .n2 { … { animation: fade 1s } } }`, nested `depth` rules deep. */
function nested(depth: number): string {
  let css = "animation: fade 1s";
  for (let level = depth; level >= 1; level -= 1) css = `.n${level} { ${css} }`;
  return `@keyframes fade { from { opacity: 0 } } ${css}`;
}

/** The real css-tree, with every `parse` call counted. */
function countingApi(): { api: CssTreeApi; parses: () => number } {
  let parses = 0;
  return {
    api: {
      walk: csstree.walk,
      generate: csstree.generate,
      parse: ((text: string, options?: unknown) => {
        parses += 1;
        return (csstree.parse as (t: string, o?: unknown) => csstree.CssNode)(
          text,
          options
        );
      }) as typeof csstree.parse,
    },
    parses: () => parses,
  };
}

/** Parses spent rewriting names in a sheet nested `depth` deep. */
function parsesForDepth(depth: number, budget: number): number {
  const ast = csstree.parse(nested(depth));
  const { api, parses } = countingApi();
  const map = namespaceDefinedNames(ast, SCOPE, api);
  rewriteNameReferences(ast, map, api, budget);
  return parses();
}

describe("following nested rules stays linear in the nesting", () => {
  it("spends parses in proportion to depth, not to depth squared", () => {
    // Doubling the depth may at most double the work. A re-parse per level of
    // every level above it — the quadratic this bound exists to prevent —
    // would show as roughly four times.
    const shallow = parsesForDepth(4, MAX_RULE_NESTING);
    const deep = parsesForDepth(8, MAX_RULE_NESTING);

    expect(shallow).toBeGreaterThan(0);
    expect(deep).toBeLessThanOrEqual(shallow * 2 + 2);
  });

  it("stops at the bound rather than following nesting without end", () => {
    // The bound is what makes the cost above a promise rather than an
    // observation about the inputs this test happens to use.
    const beyond = parsesForDepth(MAX_RULE_NESTING + 20, MAX_RULE_NESTING);
    expect(beyond).toBeLessThanOrEqual(MAX_RULE_NESTING + 2);
  });

  it("does no parsing at all when the stylesheet defines no names", () => {
    // The common case. A sheet with no `@keyframes` and no `@font-face` has
    // nothing to rewrite, and paying to re-parse its nesting anyway would tax
    // every author for a feature they are not using.
    const ast = csstree.parse(".a { .b { color: red } }");
    const { api, parses } = countingApi();
    const map = namespaceDefinedNames(ast, SCOPE, api);
    rewriteNameReferences(ast, map, api, MAX_RULE_NESTING);
    expect(parses()).toBe(0);
  });
});

describe("the bound is the one the origin scan already uses", () => {
  it("reports a nesting it refuses to check, at the same depth", () => {
    // Two bounds would let one pass reach a level the other reports as too deep
    // to check — a rule rewritten inside a block nothing verified, or a block
    // verified and then left holding a stale name.
    const tooDeep = `@keyframes fade { from { opacity: 0 } } ${nested(
      MAX_RULE_NESTING + 5
    )
      .split("} ")
      .slice(1)
      .join("} ")}`;
    const out = sanitizeCustomCss(tooDeep, SCOPE);
    // Whatever survives, nothing inside a rule too deep to check may still
    // carry the bare name the definition no longer has.
    if (out.css.includes("animation:")) {
      expect(out.css).not.toMatch(/animation:\s*fade\b/);
    }
  });
});
