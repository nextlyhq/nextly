/**
 * Breakpoint definitions, and the rules an editor must hold them to.
 *
 * The style compiler reads a site's breakpoints from stored settings and treats
 * them as untrusted: a definition it cannot use is DROPPED rather than raising,
 * because throwing would take down every page over one bad settings record. The
 * consequence for an editor is that almost every way of getting a breakpoint
 * wrong is silent — the definition simply stops existing, and the styles saved
 * against it are reported stale later, far from the screen that caused it.
 *
 * So this is not defensive validation of arbitrary input. Each rule below names
 * a definition the compiler would discard, checked here so the editor can say so
 * while the author is still looking at the field.
 *
 * The types and the cap are IMPORTED from the engine, not restated. This module
 * lived in `@nextlyhq/ui` until 2026-08-12, where it could not import the engine
 * — that package is the block-agnostic layer — so it mirrored the engine's
 * shapes structurally and kept its own copy of the cap. Two implementations of
 * one rule agree the day they are written and drift silently after, which is
 * what `.claude/rules/derived-checks.md` is about, and it is why this belongs
 * here: `packages/builder` already depends on the engine and can ASK.
 *
 * What is still restated, stated plainly rather than left to be discovered: the
 * per-rule DROP decisions below mirror `compile-page.ts` rather than calling it.
 * The compiler makes those decisions inline while emitting, so there is no
 * predicate to call yet. Exporting one from the engine — so the compiler and
 * this editor ask the same function — is the remaining half of this fix, and it
 * is an engine change, not a builder one.
 *
 * @module breakpoints
 */
import {
  BASE_BREAKPOINT,
  BREAKPOINT_AXES,
  MAX_BREAKPOINT_ID_LENGTH,
  MAX_BREAKPOINTS_PER_AXIS,
  type BreakpointAxis,
  type BreakpointDef,
  breakpointContexts,
  type BreakpointId,
  type BreakpointSet,
} from "@nextlyhq/blocks-engine";

/**
 * Re-exported from the engine, not restated.
 *
 * Every one of these is a value the COMPILER decides and this editor only
 * reports on, so a local copy is a second opinion that drifts silently:
 *
 * - `BASE_BREAKPOINT` — the reserved id for the unconditional context. The
 *   compiler claims it before reading settings, so a stored definition reusing
 *   it contributes nothing. A local `"base"` literal would keep rejecting the
 *   old id and start accepting a renamed one, admitting definitions compilation
 *   drops.
 * - `BREAKPOINT_AXES` — not merely a list. The engine reads it as cascade
 *   PRECEDENCE and uses the order to decide which cross-axis duplicate wins, so
 *   a second array that reorders marks the opposite definition as the duplicate.
 * - `MAX_BREAKPOINTS_PER_AXIS` — the cap the compiler enforces while emitting.
 *
 * @experimental
 */
export { BASE_BREAKPOINT, BREAKPOINT_AXES, MAX_BREAKPOINTS_PER_AXIS };
export type { BreakpointAxis, BreakpointDef, BreakpointSet };

/**
 * Why a definition would not survive compilation.
 *
 * @experimental
 */
export type BreakpointIssueCode =
  | "id-too-long"
  | "id-required"
  | "id-reserved"
  | "id-duplicate"
  | "label-required"
  | "width-required"
  | "width-not-positive"
  | "width-duplicate"
  | "second-unbounded-container"
  | "over-axis-limit";

/**
 * One reason one definition is unusable, addressed to the field that caused it.
 *
 * @experimental
 */
export interface BreakpointIssue {
  axis: BreakpointAxis;
  /** Index within its axis, so an editor can mark the row. */
  index: number;
  field: "id" | "label" | "maxWidth";
  code: BreakpointIssueCode;
  message: string;
}

/**
 * How many definitions an axis may hold in STORED settings.
 *
 * The viewport axis is one lower than the declared limit because its
 * unconditional context is inserted by the compiler rather than stored, and it
 * counts against the same cap. The container axis stores its own unbounded
 * definition, so the whole cap is available to it.
 *
 * @experimental
 */
export function storedLimitFor(axis: BreakpointAxis): number {
  return axis === "viewport"
    ? MAX_BREAKPOINTS_PER_AXIS - 1
    : MAX_BREAKPOINTS_PER_AXIS;
}

/**
 * The set with the built-in base removed from both axes.
 *
 * The base is not a definition an author added: `breakpointContexts` prepends
 * its context whether or not one is stored, and `validateBreakpoints` reports
 * the id as reserved. But a stored set CAN carry a `base` row and the plugin's
 * README documents a host config that does, so every surface that asks "what
 * has this site actually defined" has to strip it — and each one that forgets
 * gets a different wrong answer from the same set.
 *
 * Published rather than repeated, because it has three askers already: the
 * dialog's draft, the trigger's count, and the host deciding whether config
 * defaults exist. The first two disagreeing is what made Save unreachable on
 * the documented configuration; the third disagreeing made a site with only a
 * base row unable to return to it.
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
 * Whether two sets describe the same breakpoints.
 *
 * By CONTENT, never by object identity. The prop contract does not promise a
 * stable reference — a host that rebuilds an equal object on any parent render
 * is within its rights — so identity answers "has the read changed" wrongly in
 * both directions, and a surface that asks it gets a different wrong answer
 * depending on which way the host happens to render.
 *
 * Compares the AUTHORED sets, so a stored base row on one side and none on the
 * other is not a difference: the compiler prepends that context either way, and
 * treating it as a change would report a set that renders identically as new.
 *
 * @experimental
 */
export function sameBreakpoints(
  a: BreakpointSet | undefined,
  b: BreakpointSet | undefined
): boolean {
  const shape = (set: BreakpointSet | undefined) => {
    const authored = authoredBreakpoints(set);
    const axis = (defs: readonly BreakpointDef[]) =>
      defs.map(def => `${def.id}\u0000${def.label}\u0000${def.maxWidth ?? ""}`);
    return [axis(authored.viewport), axis(authored.container)];
  };
  return JSON.stringify(shape(a)) === JSON.stringify(shape(b));
}

/**
 * Whether a bound is one the compiler will keep.
 *
 * @experimental
 */
export function isUsableWidth(width: number | undefined): width is number {
  return typeof width === "number" && Number.isFinite(width) && width > 0;
}

/**
 * Every reason the given set would lose a definition on compilation.
 *
 * Ordered by axis and then by row so an editor can present them beside the
 * fields. Ids are checked across BOTH axes together, because that is the scope
 * the compiler claims them in: an id repeated on the other axis is dropped just
 * as one repeated within an axis is.
 *
 * @experimental
 */
export function validateBreakpoints(set: BreakpointSet): BreakpointIssue[] {
  const issues: BreakpointIssue[] = [];
  // Seeded with the reserved id, which the compiler claims before it reads any
  // stored definition — so a definition naming it is a duplicate of something
  // the author cannot see in the list.
  const claimedIds = new Set<string>([BASE_BREAKPOINT]);

  for (const axis of BREAKPOINT_AXES) {
    const defs = set[axis] ?? [];
    const widthsSeen = new Set<number>();
    let unboundedSeen = false;
    const limit = storedLimitFor(axis);
    // WHICH rows the cap drops, decided the way the compiler decides it: it
    // sorts widest-first and keeps the front of that list, so the casualties
    // are the narrowest definitions, not the last ones stored. Marking by
    // stored position instead would send an author to delete a breakpoint the
    // compiler was going to keep — and would say nothing about the one it drops.
    const overLimit = new Set(
      defs
        .map((def, index) => ({ def, index }))
        .sort(
          (a, b) => (b.def.maxWidth ?? Infinity) - (a.def.maxWidth ?? Infinity)
        )
        .slice(limit)
        .map(entry => entry.index)
    );

    defs.forEach((def, index) => {
      const at = (
        field: BreakpointIssue["field"],
        code: BreakpointIssueCode,
        message: string
      ): void => {
        issues.push({ axis, index, field, code, message });
      };

      // Compared VERBATIM, never normalised. The compiler keys styles by the
      // stored string, so `" tablet "` and `"tablet"` are two different
      // breakpoints to it; trimming here would report one legal set as
      // duplicates and another as using the reserved id, and since a saved id
      // is not editable the author would have no way to answer either.
      const id = def.id;
      if (id.length === 0) {
        at("id", "id-required", "Give this breakpoint an id.");
      } else if (id.length > MAX_BREAKPOINT_ID_LENGTH) {
        /*
         * The COMPILER's limit, not one chosen here. `namedDefinition` drops a
         * definition whose id exceeds it, so an id this screen accepted would
         * save, report success, and then exist nowhere — with every style filed
         * under it silently unapplied. Two gates disagreeing about what is
         * storable is worse than either being strict.
         */
        at(
          "id",
          "id-too-long",
          `An id can be at most ${MAX_BREAKPOINT_ID_LENGTH} characters.`
        );
      } else if (id === BASE_BREAKPOINT) {
        at(
          "id",
          "id-reserved",
          `"${BASE_BREAKPOINT}" is the built-in unconditional breakpoint. Choose another id.`
        );
      } else if (claimedIds.has(id)) {
        at(
          "id",
          "id-duplicate",
          `Another breakpoint already uses the id "${id}". Ids must be unique across both axes.`
        );
      } else {
        claimedIds.add(id);
      }

      if (def.label.trim().length === 0) {
        at("label", "label-required", "Give this breakpoint a label.");
      }

      if (def.maxWidth === undefined) {
        // An unbounded definition means different things per axis, and only the
        // container axis has a use for one.
        if (axis === "viewport") {
          at(
            "maxWidth",
            "width-required",
            "A viewport breakpoint needs a maximum width. Without one it would apply at every width and override the base."
          );
        } else if (unboundedSeen) {
          at(
            "maxWidth",
            "second-unbounded-container",
            "Another container breakpoint is already unbounded. Two cover the same range and one would silently win."
          );
        } else {
          unboundedSeen = true;
        }
      } else if (!isUsableWidth(def.maxWidth)) {
        at(
          "maxWidth",
          "width-not-positive",
          "Maximum width must be a positive number of pixels."
        );
      } else if (widthsSeen.has(def.maxWidth)) {
        at(
          "maxWidth",
          "width-duplicate",
          `Another ${axis} breakpoint already ends at ${def.maxWidth}px. Both would produce the same query and one would silently win.`
        );
      } else {
        widthsSeen.add(def.maxWidth);
      }

      if (overLimit.has(index)) {
        at(
          "id",
          "over-axis-limit",
          `An axis holds at most ${limit} breakpoints, widest kept. This one would be dropped.`
        );
      }
    });
  }

  return issues;
}

/**
 * The definitions of one axis in the order the compiler applies them: widest
 * first, an unbounded definition ahead of every bounded one.
 *
 * Presenting them in stored order instead would show an author a list whose
 * cascade runs in a different direction than it reads.
 *
 * @experimental
 */
export function inCascadeOrder(defs: BreakpointDef[]): BreakpointDef[] {
  return [...defs].sort(
    (a, b) => (b.maxWidth ?? Infinity) - (a.maxWidth ?? Infinity)
  );
}

/**
 * Every breakpoint whose rules are live while the editor is showing one.
 *
 * `styleProvenance` needs this and cannot derive it: which declarations are in
 * PLAY is a fact about the width being viewed, while the breakpoint being edited
 * only decides whether the winner among them belongs to this control. An editor
 * simulating a narrow viewport inside a wide window is the ordinary case.
 *
 * ## Read from what is EMITTED, never from the stored set
 *
 * The stored axes and the emitted ones disagree, and this is the one question
 * where that matters. `breakpointContexts` drops a definition whose bound is
 * missing, non-finite or at or below zero; keeps only the FIRST of a duplicated
 * id; allows one unbounded definition on the container axis and none on the
 * viewport; and slices each axis to the per-axis cap. A set read raw therefore
 * names breakpoints no stylesheet ever mentions, and reports a value keyed to a
 * dropped id as live.
 *
 * That failure is SILENT in both directions: a badge naming a real-looking id
 * looks identical whether or not a rule was written under it, and a value whose
 * breakpoint was dropped is a value the author cannot see the source of. Asking
 * the compiler's own normaliser is what keeps the panel and the page saying the
 * same thing.
 *
 * ## Outward, never inward
 *
 * The model is DESKTOP-FIRST — every bounded definition compiles to
 * `@media (max-width: N)` — so a narrow width satisfies its own query and every
 * WIDER one as well. Showing a 768px breakpoint means the 768 rules apply, the
 * 1024 rules apply, and the base rules underneath them all. The set therefore
 * runs outward from the edited definition, never inward.
 *
 * ## An unknown container context is EXCLUDED, not assumed live
 *
 * The viewport's unbounded context matches at every width and is always in play.
 * The container axis is not its counterpart: even at its widest a container
 * context emits `@container (min-width: 0)`, which matches only an element that
 * HAS a query-container ancestor. Whether the selected block has one is a fact
 * about the rendered tree that this arithmetic cannot see, so treating it as
 * universally live lets a container declaration win for a root block the browser
 * is applying nothing to — a false indicator, in the direction that states
 * something wrong rather than saying nothing.
 *
 * So the container axis contributes only when the author is EDITING that axis,
 * which is the one case where they have said which context they mean. Otherwise
 * it is left out entirely.
 *
 * The cost is the reverse — a value genuinely arriving from a container
 * breakpoint is attributed to whatever the viewport axis says while a viewport
 * breakpoint is being edited — and that is the safer of the two, because a
 * control that under-reports its origin is quiet where one that over-reports is
 * wrong.
 *
 * An id belonging to no emitted context yields the viewport's unbounded context
 * alone, which is what an unknown breakpoint actually leaves matching.
 *
 * @experimental
 */
export function liveBreakpointsFor(
  set: BreakpointSet | undefined,
  edited: BreakpointId
): BreakpointId[] {
  const contexts = breakpointContexts(set);
  const chosen = contexts.find(context => context.id === edited);
  /*
   * The viewport's unbounded context alone. A container one is only included
   * when the author is editing the container axis — see the note above: at its
   * widest it still emits a query that matches only an element inside a query
   * container, which this cannot know.
   */
  const unbounded = contexts
    .filter(
      context =>
        !isUsableWidth(context.maxWidth) &&
        (context.axis !== "container" || chosen?.axis === "container")
    )
    .map(context => context.id);
  // An unknown id, or an unbounded context itself: neither adds anything to the
  // contexts already matching.
  if (chosen === undefined || !isUsableWidth(chosen.maxWidth)) return unbounded;
  const width = chosen.maxWidth;
  const wider = contexts
    .filter(
      context =>
        context.axis === chosen.axis &&
        isUsableWidth(context.maxWidth) &&
        context.maxWidth >= width
    )
    .map(context => context.id);
  return [...unbounded, ...wider];
}

/**
 * The breakpoints whose rules the BROWSER is currently applying.
 *
 * Asked of the browser rather than derived from the breakpoint being edited,
 * because those are different facts and only one of them decides what is on
 * screen. The edited breakpoint says where a write LANDS; which declarations are
 * in play is a property of the width the page is being viewed at, and the editor
 * renders its canvas inline rather than in a frame — so an ordinary window
 * narrow enough to satisfy `@media (max-width: 1024px)` has those rules active
 * while the panel is still editing the base breakpoint.
 *
 * Evaluated by `matchMedia` against each emitted context's OWN at-rule text, so
 * there is no second reading of what a breakpoint means: the compiler wrote the
 * query, and the browser answers it. Width arithmetic here would be a second
 * implementation of the same condition and would drift the moment the emitted
 * form changed.
 *
 * **Container contexts are excluded and cannot be answered this way.** A
 * `@container` query resolves against an element's query container, not the
 * viewport, so `matchMedia` has nothing to say about it — see
 * {@link liveBreakpointsFor}, which excludes them for the same reason.
 *
 * A runtime without `matchMedia` gets the unconditional contexts alone, which is
 * what is certainly live anywhere.
 *
 * @experimental
 */
export function matchedBreakpoints(
  set: BreakpointSet | undefined,
  matches: (query: string) => boolean
): BreakpointId[] {
  const live: BreakpointId[] = [];
  for (const context of breakpointContexts(set)) {
    if (context.atRule === undefined) {
      // The unconditional VIEWPORT context: no query to ask, and always
      // applying. A container's widest context is not this case — it still
      // carries `@container (min-width: 0)` and is filtered below.
      live.push(context.id);
      continue;
    }
    /*
     * Only a MEDIA query is answerable here, and the at-rule's own prefix is
     * what decides. An explicit axis check beside this would be a second
     * decision about one question: a container context's at-rule is
     * `@container (...)`, so it fails this test already, and the two could only
     * ever disagree by drifting apart.
     */
    const condition = context.atRule.replace(/^@media\s*/, "");
    if (condition === context.atRule) continue;
    if (matches(condition)) live.push(context.id);
  }
  return live;
}

/**
 * Every media condition the site's viewport breakpoints emit, for subscribing to.
 *
 * Beside {@link matchedBreakpoints} because they must agree on which contexts
 * carry a query and how its text is reduced to a condition — a subscriber
 * listening to a different set than the reader evaluates is a panel that stops
 * updating at exactly the widths it was added for.
 *
 * @experimental
 */
export function breakpointQueries(set: BreakpointSet | undefined): string[] {
  const queries: string[] = [];
  for (const context of breakpointContexts(set)) {
    if (context.atRule === undefined) continue;
    const condition = context.atRule.replace(/^@media\s*/, "");
    // The same single test {@link matchedBreakpoints} applies, deliberately.
    if (condition !== context.atRule) queries.push(condition);
  }
  return queries;
}
