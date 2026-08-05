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
import { namespacedGlobalName } from "@nextlyhq/blocks-engine";
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

/** What one run handed to the parser: how often, and how much. */
interface ParseCost {
  calls: number;
  bytes: number;
}

/** The real css-tree, with every `parse` call and its input measured. */
function countingApi(): { api: CssTreeApi; cost: () => ParseCost } {
  const cost: ParseCost = { calls: 0, bytes: 0 };
  return {
    api: {
      walk: csstree.walk,
      generate: csstree.generate,
      parse: ((text: string, options?: unknown) => {
        cost.calls += 1;
        // Bytes, not only calls. A regression that re-reads the whole subtree
        // at each level still makes about one call per level, so a call count
        // alone cannot see it — the text handed over is where the quadratic
        // shows.
        cost.bytes += text.length;
        return (csstree.parse as (t: string, o?: unknown) => csstree.CssNode)(
          text,
          options
        );
      }) as typeof csstree.parse,
    },
    cost: () => cost,
  };
}

/** Parser work spent rewriting names in a sheet nested `depth` deep. */
function costForDepth(depth: number, budget: number): ParseCost {
  const ast = csstree.parse(nested(depth));
  const { api, cost } = countingApi();
  const map = namespaceDefinedNames(ast, SCOPE, api);
  rewriteNameReferences(ast, map, api, budget);
  return cost();
}

describe("what following nested rules is allowed to cost", () => {
  it("makes a number of parse calls linear in the depth", () => {
    // Doubling the depth roughly doubles the CALLS. A pass that re-read every
    // level above each level — the quadratic this bound exists to prevent —
    // would show near four times. Measured: 5 calls at depth 4, 13 at depth 8.
    const shallow = costForDepth(4, MAX_RULE_NESTING);
    const deep = costForDepth(8, MAX_RULE_NESTING);

    expect(shallow.calls).toBeGreaterThan(0);
    expect(deep.calls / shallow.calls).toBeLessThan(3);
  });

  it("hands the parser no more text than the bound allows", () => {
    // The BYTES are superlinear in the depth, and that is by design rather than
    // a defect: each level is re-parsed from the text of the level above, so d
    // levels of a sheet of length n read O(n·d) characters. Measured, they grow
    // about 3.6x per doubling of depth.
    //
    // The promise is therefore not linearity, it is the CEILING — which is what
    // the nesting bound buys. Each level is read at most twice, once as a rule
    // and once as the declarations beside one, so the whole pass may never hand
    // the parser more than the sheet itself times twice the bound. That is the
    // assertion an unbounded regression fails, however deep the input goes.
    const deep = costForDepth(MAX_RULE_NESTING + 20, MAX_RULE_NESTING);
    const ceiling = nested(MAX_RULE_NESTING + 20).length * MAX_RULE_NESTING * 2;

    expect(deep.bytes).toBeGreaterThan(0);
    expect(deep.bytes).toBeLessThanOrEqual(ceiling);
  });

  it("stops at the bound rather than following nesting without end", () => {
    // Two readings per level, so the call count settles at twice the bound
    // however much deeper the input goes.
    const beyond = costForDepth(MAX_RULE_NESTING + 20, MAX_RULE_NESTING);
    expect(beyond.calls).toBeLessThanOrEqual(MAX_RULE_NESTING * 2 + 2);
  });

  it("does no parsing at all when the stylesheet defines no names", () => {
    // The common case. A sheet with no `@keyframes` and no `@font-face` has
    // nothing to rewrite, and paying to re-parse its nesting anyway would tax
    // every author for a feature they are not using.
    const ast = csstree.parse(".a { .b { color: red } }");
    const { api, cost } = countingApi();
    const map = namespaceDefinedNames(ast, SCOPE, api);
    rewriteNameReferences(ast, map, api, MAX_RULE_NESTING);
    expect(cost().calls).toBe(0);
    expect(cost().bytes).toBe(0);
  });
});

describe("the bound is the one the origin scan already uses", () => {
  it("rewrites a name nested exactly at the bound", () => {
    // The edge itself, not one inside it: an off-by-one that refused
    // `MAX_RULE_NESTING` would pass a test written at `MAX_RULE_NESTING - 1`.
    const out = sanitizeCustomCss(nested(MAX_RULE_NESTING), SCOPE);
    // The DECLARATION, not the name. `@keyframes <namespaced fade>` is in the
    // output either way, so asserting the name alone passes when the rule
    // holding the reference was removed — which is exactly what a bound shifted
    // one level shallower does.
    expect(out.css).toContain(
      `animation:${namespacedGlobalName("fade", SCOPE)} 1s`
    );
    expect(out.warnings.map(warning => warning.code)).not.toContain(
      "unchecked"
    );
  });

  it("removes the first nesting past the bound, name and all", () => {
    // One deeper, so the two cases meet at the boundary and an off-by-one in
    // either direction fails one of them.
    //
    // The rule GOES, rather than being rewritten unverified: the origin scan
    // cannot check that deep either, and a block nobody checked must not reach
    // the page whatever its names look like. Asserting only that the bare name
    // is gone would pass on a namespaced one left inside an unchecked rule,
    // which is the outcome this is here to rule out.
    const out = sanitizeCustomCss(nested(MAX_RULE_NESTING + 1), SCOPE);

    // The fixture parsed — an earlier version of this test built one that did
    // not, and every assertion below it then passed on an empty sheet.
    expect(out.css).toContain("@keyframes");

    expect(out.warnings.map(warning => warning.code)).toContain("unchecked");
    expect(out.css).not.toContain("animation");
    expect(out.css).not.toContain(".n" + MAX_RULE_NESTING);
  });
});
