/**
 * Which colours the Colours tab's usage filter lists, by what the site's
 * usage count says of each (`variable-usage`) and what the open page uses.
 *
 * @module colour-usage
 */
import type { UsageState } from "./variable-usage";

/** Which colours the Colours tab lists: all, the unused, or this page's. */
export type ColourFilter = "all" | "unused" | "page";

/**
 * Whether a colour is listed under a filter: under Unused only where the
 * site's count has shown it unused, never while it is still counting.
 */
export function keepsColour(
  filter: ColourFilter,
  state: UsageState,
  onPage: boolean
): boolean {
  if (filter === "all") return true;
  return filter === "unused" ? state === "unused" : onPage;
}

/**
 * The colours "Clean up unused…" lists, in the order given: each one the
 * site made (its code and the engine supply none of them) that the site's
 * count has shown unused and the open page does not use, since a colour
 * applied on the canvas is a use before any save says so. A built-in colour
 * is never listed: it is never removed. `counting` says one of the site's
 * own colours is still being counted, so the list may grow.
 */
export function cleanUpCandidates<E extends { readonly identity: string }>(
  colours: readonly E[],
  rule: {
    readonly stateOf: (identity: string) => UsageState;
    readonly builtIn: (identity: string) => boolean;
    readonly onPage: ReadonlySet<string> | undefined;
  }
): { listed: E[]; counting: boolean } {
  const own = colours.filter(entry => !rule.builtIn(entry.identity));
  return {
    listed: own.filter(
      entry =>
        rule.stateOf(entry.identity) === "unused" &&
        rule.onPage?.has(entry.identity) !== true
    ),
    counting: own.some(entry => rule.stateOf(entry.identity) === "counting"),
  };
}

/**
 * The colours a site that hides its unused built-in colours leaves out of
 * the Colours tab and every colour picker: each built-in one (its code or
 * the engine supplies it) that the site's count has shown unused and the
 * open page does not use. None while they are shown. A colour still being
 * counted is kept, as Unused claims nothing for it; one that becomes used
 * is listed again, since this is asked afresh on every read.
 *
 * The one rule for both: the Colours tab and the pickers each ask it.
 */
export function hiddenColours(
  identities: readonly string[],
  rule: {
    /** Whether the site shows its built-in colours (unset reads as shown). */
    readonly shown: boolean;
    readonly stateOf: (identity: string) => UsageState;
    readonly builtIn: (identity: string) => boolean;
    readonly onPage: ReadonlySet<string> | undefined;
  }
): ReadonlySet<string> {
  if (rule.shown) return NONE_HIDDEN;
  return new Set(
    identities.filter(
      identity =>
        rule.builtIn(identity) &&
        rule.stateOf(identity) === "unused" &&
        rule.onPage?.has(identity) !== true
    )
  );
}

/** No colour hidden. */
const NONE_HIDDEN: ReadonlySet<string> = new Set();
