// What a stored breakpoint set MEANS, as opposed to what it literally contains.
//
// Two questions that every surface reading a site's breakpoints has to answer the same way, and
// that neither the type nor the stored record answers on its own: which definitions did an author
// actually add, and in what order does the cascade apply them. A surface that gets either wrong
// does not fail — it shows a plausible list that disagrees with the one next to it.
//
// Here rather than in the editor because the editor is no longer the only asker. A preview surface
// outside the builder derives device presets from the same set, and the two must not answer
// differently; the alternative is each package reimplementing a base-row strip and a sort, which is
// the drift this repository has a rule about.
//
// Beside `breakpoint-axes.ts` for the same reason that file exists: these are facts about the
// document model, readable without reading the emitter that consumes them.

import type { BreakpointDef, BreakpointSet } from "../document";

import { BASE_BREAKPOINT } from "./compile-page";

/**
 * The set with the built-in base removed from both axes.
 *
 * The base is not a definition an author added: `breakpointContexts` prepends
 * its context whether or not one is stored, and `validateBreakpoints` reports
 * the id as reserved. But a stored set CAN carry a `base` row — the page-builder
 * plugin's README documents a host config that does — so every surface asking
 * "what has this site actually defined" has to strip it, and each one that
 * forgets gets a different wrong answer from the same set.
 *
 * The failures are not hypothetical. A dialog and a trigger disagreeing about
 * this made Save unreachable on the documented configuration; a host that did
 * not strip it could not return a site to its config defaults.
 *
 * @experimental
 */
export function authoredBreakpoints(
  set: BreakpointSet | undefined
): BreakpointSet {
  const authored = (axis: readonly BreakpointDef[] | undefined) =>
    (axis ?? []).filter(def => def?.id !== BASE_BREAKPOINT);
  return {
    viewport: authored(set?.viewport),
    container: authored(set?.container),
  };
}

/**
 * The definitions of one axis in the order the compiler applies them: widest
 * first, an unbounded definition ahead of every bounded one.
 *
 * Presenting them in stored order instead would show an author a list whose
 * cascade runs in a different direction than it reads.
 *
 * Copied before sorting, because `Array.prototype.sort` mutates: sorting the
 * caller's array in place reorders a stored record that other readers still
 * hold, and the reorder is invisible until one of them reports a different
 * winner.
 *
 * @experimental
 */
export function inCascadeOrder(
  defs: readonly BreakpointDef[]
): BreakpointDef[] {
  return [...defs].sort(
    (a, b) => (b.maxWidth ?? Infinity) - (a.maxWidth ?? Infinity)
  );
}
