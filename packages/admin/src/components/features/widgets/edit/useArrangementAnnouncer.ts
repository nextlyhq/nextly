"use client";

/**
 * How a gesture performed on one card reaches the grid's live region.
 *
 * Two halves of one contract, together because neither is comprehensible
 * alone: the grid owns the region and the arrangement owns the subjects, and
 * the wiring between them has to survive a hook cycle.
 *
 * Extracted from the grid and the arrangement hook because both had grown past
 * what the complexity gate allows, and this is the concern they had each
 * acquired a piece of. It is also the natural seam: everything here is about
 * SAYING what happened, and nothing here decides what happens.
 *
 * @module components/features/widgets/edit/useArrangementAnnouncer
 */

import { useCallback, useMemo, useRef } from "react";

import type { GridAnnouncer } from "../useGridAnnouncer";

/**
 * What the grid says on the arrangement's behalf.
 *
 * One object rather than a parameter per sentence, because they are one
 * collaborator: a signature listing them separately grew by one every time a
 * gesture learned to speak.
 */
export interface ArrangementAnnouncer {
  column: (
    title: string,
    column: number,
    columnCount: number,
    position: number,
    count: number
  ) => void;
  hidden: (title: string, hidden: boolean) => void;
  removed: (title: string) => void;
}

export interface AnnouncerRelay {
  /** Handed to the arrangement, before the announcer behind it exists. */
  announce: ArrangementAnnouncer;
  /** Points the relay at the real announcer, once the grid has one. */
  attach: (announcer: GridAnnouncer) => void;
}

/**
 * A stable announcer that can be pointed at the real one afterwards.
 *
 * 🔴 The indirection is load-bearing, because the grid's hooks form a cycle:
 * the announcer needs the batch's outcome, the batch needs the widgets the
 * arrangement resolved, and the arrangement needs somewhere to announce a
 * gesture. A ref is the one link that can be filled in after the fact — this
 * object's identity never changes, so nothing downstream re-renders on it, and
 * by the time a reader can act on a card the announcer is long since attached.
 *
 * Every call is optional-chained rather than defaulted to a no-op function,
 * so an unattached relay is silent rather than pretending to have spoken.
 */
export function useAnnouncerRelay(): AnnouncerRelay {
  const announcer = useRef<GridAnnouncer | null>(null);

  const announce = useMemo<ArrangementAnnouncer>(
    () => ({
      column: (title, column, columnCount, position, count) =>
        announcer.current?.announceColumn(
          title,
          column,
          columnCount,
          position,
          count
        ),
      hidden: (title, hidden) =>
        announcer.current?.announceHidden(title, hidden),
      removed: title => announcer.current?.announceRemoved(title),
    }),
    []
  );

  const attach = useCallback((next: GridAnnouncer) => {
    announcer.current = next;
  }, []);

  return { announce, attach };
}

/**
 * The one card fact these two gestures need, named structurally.
 *
 * Not `ArrangedWidget`, which lives in the hook that calls this one: importing
 * it back would make the two modules circular for a shape whose whole content
 * is a title and a flag.
 */
export interface PresenceRow {
  placementId: string;
  hidden: boolean;
  widget: { title: string };
}

export interface PlacementPresence {
  toggleHidden: (placementId: string) => void;
  remove: (placementId: string) => void;
}

/**
 * Putting a card away and taking one off, each saying what it did.
 *
 * Both wrap the editor's own mutation rather than replacing it, and both read
 * the row BEFORE acting: a removed placement has no row to look up afterwards,
 * and a hidden one leaves the render the moment the draft updates.
 *
 * Both read from the DRAWN rows rather than from the stored placements, so the
 * sentence names what the reader is looking at. A placement whose declaration
 * this admin cannot resolve is skipped from the render, and announcing one by
 * id would name a card nobody can see.
 */
export function useAnnouncedPresence(
  rows: readonly PresenceRow[],
  editor: PlacementPresence,
  announce: ArrangementAnnouncer
): PlacementPresence {
  const toggleHidden = useCallback(
    (placementId: string) => {
      const row = rows.find(item => item.placementId === placementId);
      editor.toggleHidden(placementId);
      // The state it BECOMES. `row.hidden` is what the reader is looking at,
      // so its negation is what the toggle just produced -- asking the editor
      // again here would read the value that is about to be replaced.
      if (row) announce.hidden(row.widget.title, !row.hidden);
    },
    [rows, editor, announce]
  );

  const remove = useCallback(
    (placementId: string) => {
      const row = rows.find(item => item.placementId === placementId);
      editor.remove(placementId);
      if (row) announce.removed(row.widget.title);
    },
    [rows, editor, announce]
  );

  return { toggleHidden, remove };
}
