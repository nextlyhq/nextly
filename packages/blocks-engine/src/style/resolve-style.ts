// Where a style value came from.
//
// Once a value can come from a class, an author looking at a control cannot tell whether what
// they see is theirs, a class's, or the block's — and if they cannot tell, they change the wrong
// thing. Every builder that added classes had to add this answer with them; the ones that did not
// are the ones whose users describe styling as guesswork.
//
// This walks the same order the compiler emits, and that is the load-bearing property. If the two
// could disagree, the indicator would describe a page the browser is not rendering, which is
// worse than no indicator at all: it would be confidently wrong.
//
// So the shape here mirrors the compiler's rather than paraphrasing it. The compiler holds ONE
// ordered list of breakpoint contexts and writes every matching rule in that order; it has no
// notion of a chain. Modelling this side as a single chain from the breakpoint being edited was
// the mistake: a chain has one end, and a page can be responding to a viewport width and a
// container width simultaneously, with both sets of rules live. The two axes are therefore taken
// separately and merged in the compiler's order, which `BREAKPOINT_AXES` states once for both.
//
// Pure by construction: no storage, no registry, no compiler state. The inspector calls it per
// control on every render, tests call it without booting an engine, and an agent can ask it what
// a page means without executing anything.

import type { NodeStyles, StyleValue } from "../document";
import type { TokenLookup } from "../validation";

import { BREAKPOINT_AXES } from "./breakpoint-axes";
import { propertyInheritsToDescendants } from "./catalog";
import type { NamedClass } from "./named-class";
import { isUsableNamedClass } from "./named-class";
import { validateStyleValues } from "./validate-style-value";

/** Which tier a resolved value came from, and which member of that tier. */
export type StyleSource =
  /** The node's own value. What a control edits by default. */
  | { tier: "local" }
  /** A class the node applies. `id` is the class, so the UI can offer to edit it in place. */
  | { tier: "class"; id: string; slug: string }
  /** The block type's default look. */
  | { tier: "blockDefault" }
  /**
   * The page's own styles, reaching this node from the page root.
   *
   * Not a rule on the node at all: it is written once on the root, and shows here only because
   * nothing closer states the property. Reported so a control over a visibly coloured page does
   * not present itself as empty.
   */
  | { tier: "pageSettings" }
  /**
   * A breakpoint other than the one being edited, whose rule is also live.
   *
   * Desktop-first: a node styled at base and viewed at tablet shows the base value unless tablet
   * says otherwise. Naming the breakpoint it came from is what lets a control say "inherited from
   * Desktop" rather than showing an empty field over a page that plainly has the value.
   *
   * It also covers the other axis: while editing a container breakpoint, a live viewport rule can
   * be the winner, and `from` names it.
   */
  | { tier: "inheritedBreakpoint"; from: string; source: StyleSource };

/** A resolved value and where it came from. */
export interface ResolvedStyle {
  value: StyleValue;
  source: StyleSource;
}

/** Everything resolution reads. Supplied by the caller; nothing is fetched. */
export interface StyleResolutionInput {
  /** The node's own styles. */
  node?: NodeStyles;
  /** The classes the node applies, already in library order (see `resolveNodeClasses`). */
  classes?: readonly NamedClass[];
  /** The block type's base styles. */
  blockBase?: NodeStyles;
  /**
   * The page's styles, from `doc.settings.styles`.
   *
   * Consulted only for properties that reach a descendant on their own — text colour and the
   * typography properties, plus the link colours, which the catalog emits on a descendant
   * selector. For anything else a page-root declaration never reaches this node, and offering it
   * as a source would name an origin the browser does not use.
   */
  pageSettings?: NodeStyles;
  /**
   * The viewport breakpoints whose rules are live, widest first, **including the active one**.
   *
   * Every `@media (max-width: …)` at least as wide as the current viewport matches at once, and
   * the compiler writes them widest to narrowest, so this is that list in that order. A site with
   * base/tablet/mobile viewed at mobile passes `["base", "tablet", "mobile"]`.
   *
   * Omitting both chains means the caller is not modelling breakpoints, and the breakpoint asked
   * about is treated as the only live one.
   */
  viewportChain?: readonly string[];
  /**
   * The container breakpoints whose rules are live, widest first, **including the active one**.
   *
   * Read after the viewport chain, because that is the order the stylesheet is written in. See
   * `BREAKPOINT_AXES`.
   */
  containerChain?: readonly string[];
  /**
   * The site's design tokens, if the caller has them.
   *
   * Only used to judge whether the compiler would accept a token reference. Without it a token of
   * the wrong kind for its property cannot be detected, so resolution is fractionally more
   * permissive than the stylesheet — never less.
   */
  tokens?: TokenLookup;
}

/**
 * One tier's styles, in the order they override one another.
 *
 * Lowest first, so a later entry beats an earlier one — the same direction `compile-page` emits
 * in, because at one specificity the cascade is source order and nothing else.
 *
 * Page settings sit below the block default, and for a different reason than the rest: they are
 * not a competing declaration on this element but a value reaching it from an ancestor, and an
 * inherited value loses to any declaration on the element itself whatever the source order.
 */
function tiers(
  input: StyleResolutionInput,
  property: string
): { styles: NodeStyles; source: StyleSource }[] {
  const ordered: { styles: NodeStyles; source: StyleSource }[] = [];
  if (input.pageSettings && propertyInheritsToDescendants(property)) {
    ordered.push({
      styles: input.pageSettings,
      source: { tier: "pageSettings" },
    });
  }
  if (input.blockBase) {
    ordered.push({ styles: input.blockBase, source: { tier: "blockDefault" } });
  }
  for (const cls of input.classes ?? []) {
    // The compiler writes nothing for a class it cannot name, so applying one here would report
    // a value and a source the browser never receives.
    if (!isUsableNamedClass(cls)) continue;
    ordered.push({
      styles: cls.styles,
      source: { tier: "class", id: cls.id, slug: cls.slug },
    });
  }
  if (input.node)
    ordered.push({ styles: input.node, source: { tier: "local" } });
  return ordered;
}

/**
 * Every breakpoint whose rules are live, in the order the stylesheet writes them.
 *
 * Both axes, concatenated in `BREAKPOINT_AXES` order, which is what makes a container rule beat a
 * viewport one. An id appearing on both axes is kept at its first position, matching the compiler,
 * which claims ids across the two axes and drops the later definition.
 */
function liveBreakpoints(
  breakpoint: string,
  input: StyleResolutionInput
): string[] {
  const byAxis = {
    viewport: input.viewportChain,
    container: input.containerChain,
  };
  // Neither chain supplied is the non-responsive case, not an empty page: a caller asking about
  // one breakpoint without describing the others gets exactly that breakpoint, which is what
  // every call looked like before there was a second axis to describe.
  if (byAxis.viewport === undefined && byAxis.container === undefined) {
    return [breakpoint];
  }
  const live: string[] = [];
  const claimed = new Set<string>();
  for (const axis of BREAKPOINT_AXES) {
    for (const id of byAxis[axis] ?? []) {
      if (claimed.has(id)) continue;
      claimed.add(id);
      live.push(id);
    }
  }
  return live;
}

/** The value one tier states for a property at exactly this state and breakpoint, if any. */
function valueAt(
  styles: NodeStyles,
  state: string,
  breakpoint: string,
  property: string
): StyleValue | undefined {
  if (styles === null || typeof styles !== "object") return undefined;
  const byBreakpoint = (styles as Record<string, unknown>)[state];
  if (byBreakpoint === null || typeof byBreakpoint !== "object")
    return undefined;
  const values = (byBreakpoint as Record<string, unknown>)[breakpoint];
  if (values === null || typeof values !== "object") return undefined;
  const value = (values as Record<string, unknown>)[property];
  return value === undefined ? undefined : (value as StyleValue);
}

/**
 * Whether the compiler would write this value, rather than merely whether it is present.
 *
 * `compileStyleValues` drops a declaration validation rejects, so the browser goes on showing the
 * tier below. Treating every defined value as a winner would report the rejected one — a control
 * showing a colour that is not on the page, over a page whose real colour came from somewhere the
 * control does not name.
 *
 * Asked per stated value, so the cost is one check per tier that mentions the property, not one
 * per property in the document.
 */
function compilerWritesValue(
  property: string,
  value: StyleValue,
  tokens: TokenLookup | undefined
): boolean {
  return !validateStyleValues(
    { [property]: value },
    "",
    "strict",
    undefined,
    false,
    tokens
  ).some(issue => issue.severity === "error");
}

/**
 * What a property resolves to, and where it came from.
 *
 * Walked tier-outermost, breakpoint-innermost, because that is the order the stylesheet is
 * written in and at one specificity the order IS the cascade. A whole tier precedes the whole of
 * the next, so a value from a higher tier beats one from a lower tier at ANY width: a node's own
 * desktop value beats a class's tablet value, even while viewing at tablet, because the node's
 * rule is emitted after the class's and both match.
 *
 * Reading it the other way round — narrowest breakpoint first, whoever wrote it — is the
 * intuitive answer and the wrong one. It would report a class value the browser never shows.
 *
 * Within one tier the live breakpoints are walked in written order and the last match kept, which
 * gives the desktop-first model on the viewport axis and lets a container rule beat a viewport one.
 *
 * `breakpoint` is the one the control is EDITING, and is used only to decide whether the winning
 * value is the author's own or has come from elsewhere. Which breakpoints are live is
 * `viewportChain` and `containerChain`; this argument does not imply them.
 *
 * `undefined` means nothing states this property anywhere. A control showing a placeholder is
 * telling the truth in that case; showing an empty box for a value that exists is not.
 */
export function resolveStyle(
  property: string,
  state: string,
  breakpoint: string,
  input: StyleResolutionInput
): ResolvedStyle | undefined {
  const live = liveBreakpoints(breakpoint, input);
  // An interactive state does not replace the unconditional rules — it joins them. `:hover` is
  // emitted as `:where(:hover)`, which carries no specificity, so a `base` declaration written
  // LATER still wins over a `hover` one written earlier. A hovered element therefore matches
  // both, and asking only about `hover` reports a value the browser overrides.
  //
  // Within one tier the compiler writes base first and the state after, so the state wins there;
  // across tiers the later tier wins whichever state it used.
  const states = state === "base" ? ["base"] : ["base", state];
  let resolved: ResolvedStyle | undefined;

  for (const tier of tiers(input, property)) {
    for (const candidateState of states) {
      for (const id of live) {
        const value = valueAt(tier.styles, candidateState, id, property);
        if (value === undefined) continue;
        if (!compilerWritesValue(property, value, input.tokens)) continue;
        resolved =
          id === breakpoint
            ? { value, source: tier.source }
            : {
                value,
                // Named so a control can say which breakpoint the value comes from, with the
                // writer kept inside so it can also say who set it there.
                source: {
                  tier: "inheritedBreakpoint",
                  from: id,
                  source: tier.source,
                },
              };
      }
    }
  }

  return resolved;
}
