/**
 * What an archetype body is, as a contract the dispatch table can hold.
 *
 * A body returns an OUTCOME rather than a node, because "this payload is not
 * what I asked for" is a real answer an archetype has to be able to give. A
 * body that could only return a node would have to render its own error box,
 * which is how a dashboard ends up with as many error designs as it has
 * archetypes — and the mismatch has to reach `WidgetCard`, which is the thing
 * that knows to keep the title.
 *
 * @module components/features/widgets/archetypes/types
 */

import type { ReactNode } from "react";

import type {
  DashboardWidget,
  WidgetResult,
} from "@admin/types/dashboard/widgets";

export type ArchetypeOutcome =
  | { ok: true; node: ReactNode }
  | { ok: false; message: string };

export type ArchetypeBody = (
  result: WidgetResult,
  definition: DashboardWidget
) => ArchetypeOutcome;

/**
 * The part of a declaration an archetype can judge BEFORE any query runs.
 *
 * Deliberately narrower than `DashboardWidget`: the two callers that ask this
 * question hold different objects. `resolve-widgets` is still deciding what the
 * widget IS, so it has a declaration rather than a resolved one, and asking for
 * the full shape there would mean building it twice.
 */
export interface DeclaredWidget {
  archetype?: string;
  title?: string;
  query?: { select?: string[]; op?: string };
}

/**
 * What an archetype needs a declaration to carry, judged without data.
 *
 * SEPARATE from the body, because the two answer different questions at
 * different times. "Does this widget declare what I need to draw it?" is
 * knowable from the declaration alone, before a request exists. "Is this
 * payload the op I asked for?" is only knowable once one arrives.
 *
 * Keeping them apart is what lets the grid decline to spend a query on a widget
 * that can never be drawn, and lets a contributed component stay the body for a
 * declaration core would refuse — both of which were wrong when drawability was
 * a property of the ARCHETYPE rather than of the archetype and the declaration
 * together.
 *
 * Returning the REASON rather than a boolean, so the card can say what is
 * missing in the words of the archetype that knows.
 */
export type ArchetypeAccepts = (
  definition: DeclaredWidget
) => string | undefined;

/** An archetype core can draw: its precondition, and its body. */
export interface ArchetypeRenderer {
  /** Absent when the archetype needs nothing beyond its result. */
  accepts?: ArchetypeAccepts;
  body: ArchetypeBody;
}
