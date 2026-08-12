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
 * The types mirror the block engine's structurally rather than importing it:
 * this package publishes browser components and must not take a dependency on
 * the engine to describe a shape that is three fields wide.
 *
 * @module lib/breakpoints
 */

/**
 * The reserved id for the unconditional context.
 *
 * The compiler inserts this itself and claims the id before reading settings,
 * so a stored definition that reuses it contributes nothing at all.
 *
 * @experimental
 */
export const BASE_BREAKPOINT_ID = "base";

/**
 * Maximum breakpoints per axis, the unconditional base included.
 *
 * @experimental
 */
export const MAX_BREAKPOINTS_PER_AXIS = 7;

/**
 * The two axes a breakpoint may respond to.
 *
 * @experimental
 */
export type BreakpointAxis = "viewport" | "container";

/** @experimental */
export const BREAKPOINT_AXES: readonly BreakpointAxis[] = [
  "viewport",
  "container",
];

/**
 * One breakpoint definition. Desktop-first: a bound is an upper bound.
 *
 * @experimental
 */
export interface BreakpointDef {
  id: string;
  label: string;
  /** Upper bound in CSS pixels. */
  maxWidth?: number;
}

/**
 * The site's breakpoint definitions on both axes.
 *
 * @experimental
 */
export interface BreakpointSet {
  viewport: BreakpointDef[];
  container: BreakpointDef[];
}

/**
 * Why a definition would not survive compilation.
 *
 * @experimental
 */
export type BreakpointIssueCode =
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
  const claimedIds = new Set<string>([BASE_BREAKPOINT_ID]);

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
      } else if (id === BASE_BREAKPOINT_ID) {
        at(
          "id",
          "id-reserved",
          `"${BASE_BREAKPOINT_ID}" is the built-in unconditional breakpoint. Choose another id.`
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
