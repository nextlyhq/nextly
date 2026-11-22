/**
 * A block's custom CSS scoped to that block.
 *
 * The author writes `selector` where the block goes (`selector { … }`,
 * `selector:hover { … }`, `selector h2 { … }`, and the same inside `@media`),
 * and the compile puts the block's own selector there. The STORED CSS keeps
 * `selector`, so a block copied, moved, saved as a section or exported carries
 * CSS that still scopes to wherever it lands: the rewrite happens here, at
 * compile time, against the node the CSS is on now.
 *
 * Only the `selector` tokens are replaced; every other character is kept as
 * the author wrote it, by splicing the source at the positions the parser
 * reports rather than regenerating it. A regenerated sheet would reformat the
 * author's CSS, and a line number a refusal names would no longer match it.
 *
 * Whether the CSS is SAFE to put on a page is not asked here. That is the host's
 * checker, which the compile asks before it calls this; this module only
 * decides whether every rule can be scoped to the block.
 *
 * @module style/custom-css-scope
 */
import type { CssNode, List, Rule, Selector } from "css-tree";
import parse from "css-tree/parser";

/** The placeholder an author writes where the block goes. */
const SELECTOR_PLACEHOLDER = "selector";

/**
 * The at-rules a block's CSS may wrap its rules in: each only conditions the
 * rules inside it, so scoping those rules scopes the whole at-rule. Anything
 * else (`@font-face`, `@keyframes`, `@page`) declares something for the whole
 * page, which no selector can confine to one block.
 */
const SCOPING_AT_RULES = new Set(["media", "supports", "container"]);

/** One line of a block's CSS that cannot be scoped to the block, and why. */
export interface CustomCssRefusal {
  /** The line it is on, from 1, as the author's editor numbers it. */
  readonly line: number;
  /** Why, in a sentence the author can act on. */
  readonly reason: string;
}

/** A block's CSS scoped to the block, or the lines that could not be. */
export type ScopedBlockCss =
  | { readonly ok: true; readonly css: string }
  | { readonly ok: false; readonly refusals: readonly CustomCssRefusal[] };

const RULE_REFUSAL = "A rule in a block's CSS starts with selector.";
const SIBLING_REFUSAL =
  "A rule in a block's CSS can't reach the blocks beside it (+ or ~).";

/**
 * Combinators that step from an element to the ones beside it rather than
 * into it. Taken from the block's own element they reach its neighbours.
 */
const SIBLING_COMBINATORS = new Set(["+", "~", "||"]);
const UNREADABLE_REFUSAL = "This CSS can't be read.";

/**
 * Scope a block's CSS to the block.
 *
 * @param css - the CSS as the author wrote it, with `selector` for the block
 * @param blockSelector - the selector the compile styles the block by
 * @returns the CSS with each `selector` replaced, or every line that cannot be
 *   scoped, in source order
 */
export function scopeBlockCss(
  css: string,
  blockSelector: string
): ScopedBlockCss {
  const refusals: CustomCssRefusal[] = [];
  const refuse = (line: number, reason: string) => {
    if (!refusals.some(r => r.line === line && r.reason === reason)) {
      refusals.push({ line, reason });
    }
  };
  const ast = parse(css, {
    positions: true,
    // An at-rule's prelude is never rewritten, and css-tree does not know every
    // condition a browser does (`@container` among them), so it is kept as text.
    parseAtrulePrelude: false,
    onParseError: error => refuse(lineOf(error), UNREADABLE_REFUSAL),
  });
  const placeholders: { start: number; end: number }[] = [];
  if (ast.type === "StyleSheet") {
    scopeList(ast.children, placeholders, refuse);
  }
  if (refusals.length > 0) {
    return {
      ok: false,
      refusals: [...refusals].sort((a, b) => a.line - b.line),
    };
  }
  return { ok: true, css: spliced(css, placeholders, blockSelector) };
}

/** The line a parse error is on; css-tree reports it, its types do not. */
function lineOf(error: unknown): number {
  const line = (error as { line?: unknown }).line;
  return typeof line === "number" && line > 0 ? line : 1;
}

/** Each rule in a list scoped, each at-rule entered or refused. */
function scopeList(
  children: List<CssNode>,
  placeholders: { start: number; end: number }[],
  refuse: (line: number, reason: string) => void
): void {
  children.forEach(node => {
    const line = node.loc?.start.line ?? 1;
    if (node.type === "Rule") {
      const refusal = scopeRule(node, placeholders);
      if (refusal !== undefined) refuse(line, refusal);
      return;
    }
    if (node.type === "Atrule") {
      const name = node.name.toLowerCase();
      if (SCOPING_AT_RULES.has(name) && node.block !== null) {
        scopeList(node.block.children, placeholders, refuse);
        return;
      }
      refuse(line, `@${node.name} isn't allowed in a block's CSS.`);
      return;
    }
    // A comment, or whitespace css-tree keeps, holds no rule to scope.
    if (node.type === "Comment" || node.type === "WhiteSpace") return;
    refuse(line, UNREADABLE_REFUSAL);
  });
}

/**
 * Record where each selector of a rule names the block, or return why one
 * cannot be scoped (`undefined` when all can): it does not START from it, or steps from it to its neighbours.
 * Every selector of a list must scope: one that does not is a rule reaching
 * past the block.
 */
function scopeRule(
  rule: Rule,
  placeholders: { start: number; end: number }[]
): string | undefined {
  if (rule.prelude.type !== "SelectorList") return RULE_REFUSAL;
  const found: { start: number; end: number }[] = [];
  let verdict: string | undefined;
  rule.prelude.children.forEach(selector => {
    if (verdict !== undefined) return;
    if (selector.type !== "Selector") {
      verdict = RULE_REFUSAL;
      return;
    }
    const first = selector.children.first;
    if (
      first?.type !== "TypeSelector" ||
      first.name.toLowerCase() !== SELECTOR_PLACEHOLDER ||
      first.loc === undefined
    ) {
      verdict = RULE_REFUSAL;
      return;
    }
    if (leavesTheBlock(selector)) {
      verdict = SIBLING_REFUSAL;
      return;
    }
    found.push({ start: first.loc.start.offset, end: first.loc.end.offset });
  });
  if (verdict === undefined) placeholders.push(...found);
  return verdict;
}

/**
 * Whether a selector's first step out of the block's own element goes to the
 * elements beside it. Once a descendant or child step has gone inside, a
 * sibling step after it stays inside too.
 */
function leavesTheBlock(selector: Selector): boolean {
  let leaves = false;
  let decided = false;
  selector.children.forEach(part => {
    if (decided || part.type !== "Combinator") return;
    decided = true;
    leaves = SIBLING_COMBINATORS.has(part.name);
  });
  return leaves;
}

/** The source with each placeholder replaced by the block's selector. */
function spliced(
  css: string,
  placeholders: readonly { start: number; end: number }[],
  blockSelector: string
): string {
  const ordered = [...placeholders].sort((a, b) => a.start - b.start);
  let out = "";
  let at = 0;
  for (const { start, end } of ordered) {
    out += css.slice(at, start) + blockSelector;
    at = end;
  }
  return out + css.slice(at);
}
