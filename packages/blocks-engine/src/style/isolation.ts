/**
 * The isolation invariant: nothing this compiler emits may match outside the
 * page root.
 *
 * The compiler builds every selector from the page root outwards, so it cannot
 * emit an unanchored rule by construction — and that was true on the day a
 * stored block type reached a selector unescaped and emitted
 * `.nx-pb-page .nx-bt-evil--x, body { … }`. "By construction" is a property of
 * the code as written, and the code is rewritten every week. This checks the
 * OUTPUT, which is the only thing a page actually loads.
 *
 * Isolation here is anchoring, not encapsulation, and that is a decision rather
 * than a limitation. `@layer` cannot be the mechanism: unlayered styles beat
 * every layer regardless of order, so any host using a CSS-in-JS library would
 * automatically outrank everything we emit. `@scope` does not stop inheritance —
 * `color`, `font-size` and `font-weight` cross a scope boundary freely — so it
 * solves the half that anchoring already solves and not the half that needs
 * help. Shadow DOM is the only complete isolation and is the wrong goal: this
 * page belongs to the user, and the contract is "predictable and overridable",
 * not "sealed".
 *
 * The parser and walker are imported by subpath rather than from css-tree's
 * root, the way the value checks already do it: the root entry loads MDN
 * reference data that reaches for `node:module`, and this package promises to
 * run in browsers and edge runtimes. A test enforces it.
 *
 * The offending selector is read back out of the source by position rather than
 * regenerated from the AST. It costs nothing, keeps the generator off the
 * import graph, and reports what the stylesheet actually SAYS — which is what
 * someone reading the finding needs to go and look at.
 *
 * @module style/isolation
 */
import type { Atrule, CssNode, Rule, Selector } from "css-tree";
import parse from "css-tree/parser";
import walk from "css-tree/walker";

/** One rule whose selector can match outside the page root. */
export interface UnscopedRule {
  /** The offending selector, as it would be written into the stylesheet. */
  selector: string;
  /** Why it escapes, in a sentence a person can act on. */
  reason: string;
}

/**
 * At-rules whose prelude is not a selector list and whose contents are not
 * page-scoped by nesting.
 *
 * `@keyframes` holds percentage selectors, `@font-face` and `@property` hold
 * descriptors, and none of them match elements at all — so asking whether their
 * contents are anchored is a category error. They carry a different risk, which
 * namespacing answers rather than anchoring: their names are document-global.
 */
const NON_SELECTOR_AT_RULES = new Set([
  "keyframes",
  "font-face",
  "property",
  "counter-style",
  "page",
  "font-feature-values",
  "font-palette-values",
]);

/**
 * Whether one selector is anchored inside the scope class.
 *
 * Two subtleties, both of which a substring test gets wrong and both of which
 * cost a leak to learn:
 *
 * The scope has to appear as its own class, not as a prefix of another. Matching
 * text would accept `.nx-pb-page-header`, a different class that merely starts
 * the same way.
 *
 * Only the combinator taken DIRECTLY from the scope decides. `.scope + .x` is a
 * sibling of the page root and therefore outside it, while `.scope .a + .b` is
 * not: `.b` shares a parent with `.a`, which is already inside, so every later
 * combinator stays within the subtree.
 *
 * A scope inside `:not()` is the opposite of being scoped by it. Walking the
 * AST's top level rather than the selector text handles that for free, because
 * a pseudo-class keeps its arguments in its own children.
 */
function selectorIsAnchored(selector: Selector, scopeClass: string): boolean {
  const parts = selector.children.toArray();
  const index = parts.findIndex(
    part => part.type === "ClassSelector" && part.name === scopeClass
  );
  if (index === -1) return false;
  // Everything after the scope's own compound belongs to the subtree only if
  // the step leaving it is a descendant or child step.
  const next = parts.slice(index + 1).find(part => part.type === "Combinator");
  if (next === undefined) return true;
  return next.name === " " || next.name === ">";
}

/**
 * A name that CSS resolves globally, wearing the document's namespace.
 *
 * `@keyframes`, `@property`, `@counter-style` and `@font-palette-values` all
 * define names in one flat per-document space, no matter where the rule sits or
 * how tightly its selectors are scoped. Two documents on one page — or a
 * document and its host — that both define `fade` do not get one each: the
 * later definition wins for BOTH, silently, and which one is later depends on
 * the order stylesheets happened to load.
 *
 * Anchoring cannot help, because these names are not selectors. Namespacing is
 * the whole mechanism, which is why the invariant below exists before anything
 * emits one: the moment tokens or animations start defining names, an
 * un-namespaced one has to be a test failure rather than a rendering mystery
 * somebody debugs six months later.
 */
export function namespacedGlobalName(name: string, scopeClass: string): string {
  // A custom-property name keeps its leading dashes, since `@property` only
  // accepts a dashed ident and moving them would produce a name CSS refuses.
  const custom = name.startsWith("--");
  const bare = custom ? name.slice(2) : name;
  return `${custom ? "--" : ""}${scopeClass}-${bare}`;
}

/** At-rules that define a globally-resolved name in their prelude. */
const GLOBAL_NAME_AT_RULES = new Set([
  "keyframes",
  "property",
  "counter-style",
  "font-palette-values",
]);

/** One at-rule defining a name that is not namespaced to this document. */
export interface GlobalName {
  /** The at-rule, e.g. "keyframes". */
  atRule: string;
  /** The name it defines. */
  name: string;
  /** Why it is a problem, in a sentence a person can act on. */
  reason: string;
}

/**
 * Every globally-resolved name a stylesheet defines without the namespace.
 *
 * Separate from {@link findUnscopedRules} because it is a different failure:
 * that one is a rule matching elements it does not own, this one is a NAME
 * colliding with someone else's. A sheet can be perfectly anchored and still
 * rename the host's animation.
 */
export function findUnnamespacedGlobals(
  css: string,
  scopeClass: string
): GlobalName[] {
  const found: GlobalName[] = [];
  let ast: CssNode;
  try {
    ast = parse(css, { positions: true });
  } catch {
    return [];
  }
  walk(ast, {
    visit: "Atrule",
    enter(node: Atrule) {
      const atRule = node.name.toLowerCase();
      if (!GLOBAL_NAME_AT_RULES.has(atRule)) return;
      const prelude = node.prelude;
      if (prelude === null) return;
      const name =
        prelude.type === "Raw"
          ? prelude.value.trim()
          : sourceTextOf(css, prelude);
      if (name === "") return;
      if (namespacedGlobalName(name, scopeClass) === name) return;
      const bare = name.startsWith("--") ? name.slice(2) : name;
      if (bare.startsWith(`${scopeClass}-`)) return;
      found.push({
        atRule,
        name,
        reason: `"@${atRule} ${name}" defines a name CSS resolves for the whole document, so it collides with any other definition of that name on the page.`,
      });
    },
  });
  return found;
}

/** One node's own text, exactly as the stylesheet spells it. */
function sourceText(css: string, node: Selector): string {
  return sourceTextOf(css, node);
}

/** The same, for any node that carries a position. */
function sourceTextOf(css: string, node: CssNode): string {
  const loc = node.loc;
  if (loc === undefined) return "";
  return css.slice(loc.start.offset, loc.end.offset).trim();
}

/**
 * Every rule in a stylesheet whose selector can match outside `scopeClass`.
 *
 * Parsed rather than pattern-matched. A stylesheet is a grammar, and the
 * interesting cases — a selector list where only the first part is anchored, an
 * escaped class containing what looks like a combinator, a scope buried inside
 * `:not()` — are exactly the ones text handling gets wrong.
 *
 * Returns findings rather than throwing, so a caller can report all of them at
 * once. Empty means the sheet is anchored.
 */
export function findUnscopedRules(
  css: string,
  scopeClass: string
): UnscopedRule[] {
  const offenders: UnscopedRule[] = [];
  let ast: CssNode;
  try {
    ast = parse(css, { positions: true });
  } catch {
    // Unparsable output is a failure of this compiler, not of the document, and
    // it is not something a caller can be told to fix in their content. Report
    // it as one finding rather than pretending the sheet was checked.
    return [
      {
        selector: "",
        reason: "The stylesheet could not be parsed, so it was not checked.",
      },
    ];
  }

  walk(ast, {
    visit: "Rule",
    enter(node: Rule) {
      // A rule inside `@keyframes` has percentage "selectors" that match no
      // element; anchoring does not apply to it.
      const inNonSelectorAtRule = this.atrule
        ? NON_SELECTOR_AT_RULES.has(this.atrule.name.toLowerCase())
        : false;
      if (inNonSelectorAtRule) return;
      if (node.prelude.type !== "SelectorList") return;
      for (const selector of node.prelude.children) {
        if (selector.type !== "Selector") continue;
        if (selectorIsAnchored(selector, scopeClass)) continue;
        offenders.push({
          selector: sourceText(css, selector),
          reason: `This selector is not anchored inside ".${scopeClass}", so it can match elements the document does not own.`,
        });
      }
    },
  });
  return offenders;
}
