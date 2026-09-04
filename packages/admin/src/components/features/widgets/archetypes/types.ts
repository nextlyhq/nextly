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
  WidgetSlot,
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
  /** What a `stats` card draws. Judged before any request, like `query`. */
  cells?: ReadonlyArray<{ key: string; label: string }>;
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

/**
 * An archetype drawn from the DECLARATION alone, with no data behind it.
 *
 * `text` and `actions` are queryless by core's own contract -- the registry
 * validator refuses a query on them -- so they never enter the batch and no
 * slot ever arrives for them. Reading that absence as "in flight" or as "drawn
 * from a query and declaring none" is right for every data archetype and wrong
 * for these two, which is why they get their own kind of body rather than a
 * `WidgetResult` they would have to ignore.
 */
export type DeclaredBody = (definition: DashboardWidget) => ArchetypeOutcome;

/**
 * How a `cells` archetype reaches one cell's answer.
 *
 * A LOOKUP rather than the raw slot record, so the composite key format lives
 * in exactly one place. An archetype handed the record would have to spell
 * `${id}#${key}` itself, which is a second implementation of a question the
 * batch already answers -- and one that fails by drawing a permanent loading
 * state rather than by throwing.
 */
export type CellSlotLookup = (cellKey: string) => WidgetSlot | undefined;

/**
 * An archetype drawn from MANY query results, one per declared cell.
 *
 * Its own kind rather than a `body` that receives an array, because the two
 * differ in what ABSENCE means. A data body is handed one result and is only
 * called once it exists; a cells body has to render while some of its numbers
 * are still in flight and others have failed, which is a card-level decision it
 * is the only thing positioned to make.
 */
export type CellsBody = (
  definition: DashboardWidget,
  slotFor: CellSlotLookup
) => ArchetypeOutcome;

/**
 * An archetype core can draw: its precondition, and its body.
 *
 * The body is one of two kinds and the dispatch branches on which. A DATA
 * archetype is drawn from a result and waits for one; a DECLARED archetype is
 * drawn from the declaration and must never wait, because nothing is coming.
 */
export interface ArchetypeRenderer {
  /** Absent when the archetype needs nothing beyond its result. */
  accepts?: ArchetypeAccepts;
  /** Drawn from a query result. Mutually exclusive with `declared`. */
  body?: ArchetypeBody;
  /** Drawn from the declaration alone, with no query behind it. */
  declared?: DeclaredBody;
  /** Drawn from one result per declared cell. Mutually exclusive with both. */
  cells?: CellsBody;
}
