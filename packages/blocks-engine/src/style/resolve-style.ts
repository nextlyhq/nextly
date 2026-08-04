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
   * The breakpoints to fall back through, widest first.
   *
   * The caller passes the chain from the breakpoint asked about up to the base, because which
   * breakpoints exist and how they nest is site configuration, not something this can assume.
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
 * Answered by walking the tiers from lowest to highest and keeping the last one that states
 * anything, which is what "source order decides" means when every rule sits at the same
 * specificity. The breakpoint chain is walked from the asked-for breakpoint outward, so a value
 * is reported at the breakpoint that actually carries it and marked as inherited when that is not
 * the one asked about.
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
  const ordered = tiers(input);
  const chain = [breakpoint, ...(input.breakpointChain ?? [])];

  for (const [depth, bp] of chain.entries()) {
    let found: ResolvedStyle | undefined;
    // Last writer wins WITHIN a breakpoint, before falling outward. A class stating a value at
    // tablet must not lose to the node's own base value: the narrower breakpoint is the more
    // specific answer, whoever wrote it, and the compiler emits it later for that reason.
    for (const tier of ordered) {
      const value = valueAt(tier.styles, state, bp, property);
      if (value !== undefined) found = { value, source: tier.source };
    }
    if (found === undefined) continue;
    if (depth === 0) return found;
    // Named so a control can say which breakpoint the value is coming from, and the inner source
    // is kept so it can also say who wrote it there.
    return {
      value: found.value,
      source: { tier: "inheritedBreakpoint", from: bp, source: found.source },
    };
  }

  return undefined;
}
