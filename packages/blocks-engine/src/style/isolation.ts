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
 * Both checks below return findings rather than throwing, and an empty result
 * means the sheet is clean on that axis — never that it could not be read. CSS
 * parses tolerantly, so "could not be read" is a real outcome and is reported
 * as a finding of its own; see {@link parseStylesheet}.
 *
 * @module style/isolation
 */
import type { Atrule, CssNode, Rule, Selector } from "css-tree";
import parse from "css-tree/parser";
import walk from "css-tree/walker";

import { escapeIdentifier } from "./css-value";

/** One rule whose selector can match outside the page root. */
export interface UnscopedRule {
  /** The offending selector, as it would be written into the stylesheet. */
  selector: string;
  /** Why it escapes, in a sentence a person can act on. */
  reason: string;
}

/**
 * What each at-rule means to the two invariants below.
 *
 * One table rather than two lists, because both questions are asked of the same
 * set of at-rules and an entry present in one list but missing from the other is
 * an at-rule that NEITHER check looks at. That is not hypothetical: a named
 * `@page` was skipped for anchoring, correctly, because it holds no selectors
 * that match elements — and then skipped for naming too, because it was absent
 * from the second list. A rule exempted from one check has to answer the other,
 * and a table makes that a missing field rather than a missing line.
 *
 * `selectorless` marks the at-rules whose contents match no element at all:
 * `@keyframes` holds percentage steps, `@font-face` and `@property` hold
 * descriptors. Asking whether those are anchored is a category error. Their risk
 * is a document-global NAME, which is what `globalNames` reads.
 *
 * The table is TOTAL: an at-rule with no entry here is reported rather than
 * skipped. Enumerating only the dangerous ones means whoever adds an at-rule has
 * to remember a list kept somewhere else, and three separate named at-rules
 * reached this compiler's output that way, each found after the previous one was
 * taken for the last. Reporting the unclassified ones turns that into a question
 * asked at the point of the change.
 */
interface AtRuleFacts {
  /** Its contents match no elements, so anchoring does not apply to them. */
  selectorless: boolean;
  /** The document-global names it defines, if it defines any. */
  globalNames?: (css: string, node: Atrule) => string[];
}

const AT_RULES: Record<string, AtRuleFacts> = {
  // Wrap ordinary rules and name nothing: the rules inside are checked for
  // anchoring like any other, and there is no name to collide.
  media: { selectorless: false },
  supports: { selectorless: false },
  container: { selectorless: false },
  scope: { selectorless: false },
  "starting-style": { selectorless: false },
  // Wraps ordinary rules AND names its layers. A host layer of the same name is
  // the same layer, which merges two orderings that were meant to be separate.
  layer: { selectorless: false, globalNames: commaSeparatedNames },
  // Match no elements; define a name CSS resolves for the whole document.
  keyframes: { selectorless: true, globalNames: preludeNames },
  property: { selectorless: true, globalNames: preludeNames },
  "counter-style": { selectorless: true, globalNames: preludeNames },
  "font-palette-values": { selectorless: true, globalNames: preludeNames },
  "position-try": { selectorless: true, globalNames: preludeNames },
  "color-profile": { selectorless: true, globalNames: preludeNames },
  "font-face": { selectorless: true, globalNames: fontFaceFamilies },
  page: { selectorless: true, globalNames: pageNames },
  "font-feature-values": {
    selectorless: true,
    globalNames: featureValueFamilies,
  },
};

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
  return `${custom ? "--" : ""}${escapeScope(scopeClass)}-${bare}`;
}

/**
 * The scope with its own dashes doubled, so joining it to a name is reversible.
 *
 * `${scope}-${name}` on its own is not injective, and the collision is the exact
 * one this function exists to prevent: scope "a" with name "b-c" and scope "a-b"
 * with name "c" both spell "a-b-c". Two documents differing only that way would
 * define one animation between them, and the later definition would win for
 * both — a namespace that reintroduces the collision it was added to remove.
 *
 * Doubling every dash in the scope leaves the single dash that follows it as the
 * only odd-length run at the boundary, so distinct pairs cannot meet.
 */
function escapeScope(scopeClass: string): string {
  // Escaped as an identifier as well as dash-doubled, because the result is a
  // NAME and CSS is stricter about those than about the class the scope came
  // from. `7f3a` is a legal scope and a legal class, but `7f3a-fade` tokenizes
  // as a dimension rather than an identifier, so an animation by that name is
  // one CSS never resolves. `\37 f3a-fade` is the same name spelled legally.
  return escapeIdentifier(scopeClass.replaceAll("-", "--"));
}

/** Whether a name already carries this document's namespace. */
function isNamespaced(name: string, scopeClass: string): boolean {
  const prefix = `${escapeScope(scopeClass)}-`;
  // Both spellings, rather than stripping a leading `--` as the custom-property
  // marker: a scope may itself begin with a dash, which doubling turns into
  // `--`, so a plain name under scope "-r" also starts that way and stripping
  // would look for the scope in the wrong place.
  return name.startsWith(prefix) || name.startsWith(`--${prefix}`);
}

/** A family name without its quotes; the name is the same either way. */
function unquote(name: string): string {
  return name.replace(/^["']|["']$/g, "");
}

/** The whole prelude, for the at-rules whose prelude IS the name they define. */
function preludeNames(css: string, node: Atrule): string[] {
  const prelude = node.prelude;
  if (prelude === null) return [];
  const name =
    prelude.type === "Raw" ? prelude.value.trim() : sourceTextOf(css, prelude);
  return name === "" ? [] : [name];
}

/**
 * The page name a `@page` rule defines, which is optional.
 *
 * `@page :first` names nothing: it selects the first page of a flow that
 * already exists. `@page cover` defines "cover", and `@page cover:first`
 * defines it too while selecting one of its pages. Only a leading identifier is
 * a name, so the pseudo-class comes off before the comparison.
 */
function pageNames(css: string, node: Atrule): string[] {
  const text = preludeNames(css, node)[0];
  if (text === undefined) return [];
  // Everything up to the first unescaped colon, rather than a pattern spelling
  // out which characters an identifier may hold. A CSS identifier can be
  // non-ASCII or carry escapes — `@page 封面` and `@page \63 over` both name a
  // page — and a pattern narrower than the grammar finds no name where one
  // exists, which reads as "nothing to collide" rather than "could not tell".
  let end = text.length;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\") {
      i++;
      continue;
    }
    if (text[i] === ":") {
      end = i;
      break;
    }
  }
  const name = text.slice(0, end).trim();
  return name === "" ? [] : [name];
}

/**
 * The font families an `@font-feature-values` rule attaches values to.
 *
 * Its prelude is a family list rather than a name it invents, but the collision
 * is the same one: the feature values inside attach to those families for the
 * whole document, so ours and a host's for one family are a single set and the
 * later definition wins for both.
 */
function featureValueFamilies(css: string, node: Atrule): string[] {
  return commaSeparatedNames(css, node);
}

/**
 * Every name in a comma-separated prelude.
 *
 * Split on commas rather than read token by token, so an unquoted multi-word
 * font family stays one name instead of being reported a word at a time.
 */
function commaSeparatedNames(css: string, node: Atrule): string[] {
  const text = preludeNames(css, node)[0];
  if (text === undefined) return [];
  const names: string[] = [];
  let start = 0;
  let quote: string | undefined;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "\\") {
      i++;
      continue;
    }
    if (quote !== undefined) {
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    // Only a comma OUTSIDE a string separates two families. A family may be
    // written as a string and a string may contain a comma, so splitting the
    // text would cut `"Fade, Two"` in half and report the tail as a name of its
    // own — a finding against a stylesheet that was correct.
    if (char === ",") {
      names.push(text.slice(start, i));
      start = i + 1;
    }
  }
  names.push(text.slice(start));
  return names.map(part => unquote(part.trim())).filter(part => part !== "");
}

/**
 * The family name an `@font-face` declares, unquoted.
 *
 * `@font-face` is the one at-rule that names itself in a DESCRIPTOR rather than
 * a prelude, and the name is every bit as global: `font-family: Fade` inside it
 * defines "Fade" for the whole document, so a host font and ours by the same
 * name are one font, and which one it is depends on load order.
 */
function fontFaceFamilies(css: string, node: Atrule): string[] {
  const block = node.block;
  if (block === null) return [];
  let family: string | undefined;
  for (const child of block.children) {
    if (child.type !== "Declaration") continue;
    if (child.property.toLowerCase() !== "font-family") continue;
    // Kept rather than returned: a later descriptor wins inside a block the way
    // a later declaration does anywhere else, so the family this rule defines is
    // the LAST one. Stopping at the first would let
    // `font-family: safe; font-family: Host` pass the namespace check while
    // defining "Host".
    family = unquote(sourceTextOf(css, child.value).trim());
  }
  return family === undefined || family === "" ? [] : [family];
}

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
  const parsed = parseStylesheet(css);
  const found: GlobalName[] = [];
  if (parsed.reason !== "") {
    found.push({ atRule: "", name: "", reason: parsed.reason });
  }
  if (parsed.ast === undefined) return found;
  walk(parsed.ast, {
    visit: "Atrule",
    enter(node: Atrule) {
      const atRule = node.name.toLowerCase();
      const facts = AT_RULES[atRule];
      if (facts === undefined) {
        // An at-rule inside a selectorless one is a descriptor of it — the
        // `@styleset` blocks within `@font-feature-values`, say — and is
        // covered by the name check on its parent.
        const parent = this.atrule;
        if (
          parent !== null &&
          parent !== node &&
          AT_RULES[parent.name.toLowerCase()]?.selectorless === true
        ) {
          return;
        }
        // Default deny. Three named at-rules reached this compiler's output
        // before anyone classified them, each found separately and each after
        // the last was called the last. Enumerating the dangerous ones asks
        // whoever adds an at-rule to remember a list in another file; reporting
        // the unclassified ones asks them to answer a question. A finding here
        // means "decide what this rule does", not "this rule is wrong".
        found.push({
          atRule,
          name: "",
          reason: `"@${atRule}" is not classified, so whether it defines a document-global name is unknown. Add it to the at-rule table.`,
        });
        return;
      }
      // A layer inside a layer is named by the pair: `@layer a { @layer b { … } }`
      // defines `a.b`, so an inner name that carries no namespace of its own is
      // still namespaced by the one it sits in. Judging it alone would call a
      // correctly namespaced hierarchy a collision. The outermost layer is the
      // one that has to carry the namespace, and it is checked on its own.
      if (
        atRule === "layer" &&
        this.atrule !== null &&
        this.atrule !== node &&
        this.atrule.name.toLowerCase() === "layer"
      ) {
        return;
      }
      const readNames = facts.globalNames;
      if (readNames === undefined) return;
      for (const name of readNames(css, node)) {
        if (isNamespaced(name, scopeClass)) continue;
        found.push({
          atRule,
          name,
          reason: `"@${atRule}" defines the name "${name}", which CSS resolves for the whole document, so it collides with any other definition of that name on the page.`,
        });
      }
    },
  });
  return found;
}

/** One node's own text, exactly as the stylesheet spells it. */
function sourceText(css: string, node: Selector): string {
  return sourceTextOf(css, node);
}

/**
 * The stylesheet's AST, or the reason it cannot be checked.
 *
 * css-tree parses in tolerant mode: a malformed stylesheet does not throw, it
 * RECOVERS, keeping what it could read and turning what it could not into `Raw`
 * nodes. A `try`/`catch` therefore catches almost nothing, and the recovered
 * tree is missing exactly the parts most worth checking.
 *
 * That matters because browsers recover too, and differently. Given
 * `.nx-pb-page .a{} } body { color:red }` css-tree reports "Selector is
 * expected" and hands back a rule with a `Raw` prelude, while a browser drops
 * the stray brace and applies `body { color: red }` to the host page. Checking
 * the recovered tree would find nothing and report the sheet clean.
 *
 * So recovery is treated as a failure of the check rather than a success. This
 * compiler generates its own CSS, so a parse error here is a defect in this
 * package, not in anyone's content — and an invariant that cannot read its
 * input has to say so rather than return "nothing found".
 *
 * At-rule preludes are deliberately left unparsed. Their internal grammar is
 * not what this module reads — selectors are — and css-tree validates each one
 * against a grammar it ships, which lags CSS itself: it rejects every
 * `@container` query as malformed, a feature this compiler emits routinely, and
 * would reject each new at-rule until css-tree caught up. Skipping that
 * grammar keeps the errors that remain meaningful, leaves the preludes readable
 * as text for the names below, and still parses the rules INSIDE those at-rules
 * so anchoring is checked there too.
 */
function parseStylesheet(css: string): { ast?: CssNode; reason: string } {
  const errors: string[] = [];
  let ast: CssNode;
  try {
    ast = parse(css, {
      positions: true,
      parseAtrulePrelude: false,
      onParseError: (error: Error) => errors.push(error.message),
    });
  } catch {
    return {
      reason: "The stylesheet could not be parsed, so it was not checked.",
    };
  }
  // The recovered tree comes back even when it recovered, so a caller can
  // report what the parser DID manage to read alongside the fact that it had to
  // guess. Stopping at the first problem would hide the rest of them.
  return {
    ast,
    reason:
      errors.length > 0
        ? `The stylesheet did not parse cleanly (${errors[0]}), so what a browser would make of it cannot be checked.`
        : "",
  };
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
  const parsed = parseStylesheet(css);
  const offenders: UnscopedRule[] = [];
  if (parsed.reason !== "") {
    // Unparsable output is a failure of this compiler, not of the document, and
    // it is not something a caller can be told to fix in their content. Report
    // it as a finding rather than pretending the sheet was checked.
    offenders.push({ selector: "", reason: parsed.reason });
  }
  if (parsed.ast === undefined) return offenders;

  walk(parsed.ast, {
    visit: "Rule",
    enter(node: Rule) {
      // A rule inside `@keyframes` has percentage "selectors" that match no
      // element; anchoring does not apply to it.
      const inNonSelectorAtRule = this.atrule
        ? AT_RULES[this.atrule.name.toLowerCase()]?.selectorless === true
        : false;
      if (inNonSelectorAtRule) return;
      if (node.prelude.type !== "SelectorList") {
        // A prelude css-tree could not read is a prelude this check cannot
        // vouch for, and a browser may well match elements with it.
        offenders.push({
          selector: sourceTextOf(css, node.prelude),
          reason: `This selector could not be parsed, so whether it stays inside ".${scopeClass}" is unknown.`,
        });
        return;
      }
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
