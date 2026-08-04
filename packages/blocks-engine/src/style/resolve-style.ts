// Where a style value came from.
//
// Once a value can come from a class, an author looking at a control cannot tell whether what
// they see is theirs, a class's, or the block's — and if they cannot tell, they change the wrong
// thing. Every builder that added classes had to add this answer with them; the ones that did not
// are the ones whose users describe styling as guesswork.
//
// This walks the same order the compiler emits, and that is the load-bearing property. If the two
// could disagree, the indicator would describe a page the browser is not rendering, which is
// worse than no indicator at all: it would be confidently wrong. The order lives in ONE place —
// the tier list below — and `compile-page` emits from the same list.
//
// Pure by construction: no storage, no registry, no compiler state. The inspector calls it per
// control on every render, tests call it without booting an engine, and an agent can ask it what
// a page means without executing anything.

import type { NodeStyles, StyleValue } from "../document";

import type { NamedClass } from "./named-class";
import { isUsableNamedClass } from "./named-class";

/** Which tier a resolved value came from, and which member of that tier. */
export type StyleSource =
  /** The node's own value. What a control edits by default. */
  | { tier: "local" }
  /** A class the node applies. `id` is the class, so the UI can offer to edit it in place. */
  | { tier: "class"; id: string; slug: string }
  /**
   * A wider breakpoint the value cascades down from.
   *
   * Desktop-first: a node styled at base and viewed at tablet shows the base value unless tablet
   * says otherwise. Naming the breakpoint it came from is what lets a control say "inherited from
   * Desktop" rather than showing an empty field over a page that plainly has the value.
   */
  | { tier: "inheritedBreakpoint"; from: string; source: StyleSource }
  /** The block type's default look. */
  | { tier: "blockDefault" };

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
   * The breakpoints to fall back through, ordered OUTWARD from the one asked about: each entry
   * wider than the one before it, ending at the base.
   *
   * Resolving `mobile` in a base/tablet/mobile site passes `["tablet", "base"]`. The caller
   * supplies it because which breakpoints exist and how they nest is site configuration, and
   * the direction is fixed here because getting it backwards silently returns a wider value
   * over a closer one — the browser would show the closer one.
   */
  breakpointChain?: readonly string[];
}

/**
 * One tier's styles, in the order they override one another.
 *
 * Lowest first, so a later entry beats an earlier one — the same direction `compile-page` emits
 * in, because at one specificity the cascade is source order and nothing else.
 */
function tiers(
  input: StyleResolutionInput
): { styles: NodeStyles; source: StyleSource }[] {
  const ordered: { styles: NodeStyles; source: StyleSource }[] = [];
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
 * Within one tier the narrower breakpoint wins, which is the desktop-first model: the chain is
 * walked from its widest end so the closest match is the last kept.
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
  const chain = [breakpoint, ...(input.breakpointChain ?? [])];
  // An interactive state does not replace the unconditional rules — it joins them. `:hover` is
  // emitted as `:where(:hover)`, which carries no specificity, so a `base` declaration written
  // LATER still wins over a `hover` one written earlier. A hovered element therefore matches
  // both, and asking only about `hover` reports a value the browser overrides.
  //
  // Within one tier the compiler writes base first and the state after, so the state wins there;
  // across tiers the later tier wins whichever state it used.
  const states = state === "base" ? ["base"] : ["base", state];
  let resolved: ResolvedStyle | undefined;

  for (const tier of tiers(input)) {
    for (const candidateState of states) {
      // Widest to narrowest, so the last value kept is the closest match this tier states.
      for (let i = chain.length - 1; i >= 0; i--) {
        const value = valueAt(tier.styles, candidateState, chain[i], property);
        if (value === undefined) continue;
        resolved =
          i === 0
            ? { value, source: tier.source }
            : {
                value,
                // Named so a control can say which breakpoint the value comes from, with the
                // writer kept inside so it can also say who set it there.
                source: {
                  tier: "inheritedBreakpoint",
                  from: chain[i],
                  source: tier.source,
                },
              };
      }
    }
  }

  return resolved;
}
