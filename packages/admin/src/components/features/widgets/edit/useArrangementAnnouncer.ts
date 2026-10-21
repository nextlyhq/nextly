"use client";

/**
 * How a gesture performed on one card reaches the grid's live region.
 *
 * The grid owns the region and the arrangement owns the subjects, and the
 * wiring between them has to survive a hook cycle. Everything here is about
 * SAYING what happened; nothing here decides what happens.
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
  moved: (title: string, from: number, to: number, count: number) => void;
  width: (title: string, widthName: string) => void;
  removed: (title: string) => void;
  restored: (title: string) => void;
  reset: () => void;
  /** Customise mode opened. */
  entered: () => void;
  /** Cancel threw the draft away. */
  discarded: () => void;
  /** A save landed. */
  saved: () => void;
  /** A save was refused: the dashboard moved elsewhere. */
  refused: () => void;
  /** A save failed; the draft is kept. */
  saveFailed: () => void;
  /** One step of a drag, in the drag's own words. */
  drag: (sentence: string) => void;
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
      moved: (title, from, to, count) =>
        announcer.current?.announceMoved(title, from, to, count),
      width: (title, widthName) =>
        announcer.current?.announceWidth(title, widthName),
      removed: title => announcer.current?.announceRemoved(title),
      restored: title => announcer.current?.announceRestored(title),
      reset: () => announcer.current?.announceReset(),
      entered: () => announcer.current?.announceEntered(),
      discarded: () => announcer.current?.announceDiscarded(),
      saved: () => announcer.current?.announceSaved(),
      refused: () => announcer.current?.announceRefused(),
      saveFailed: () => announcer.current?.announceSaveFailed(),
      drag: sentence => announcer.current?.announceDrag(sentence),
    }),
    []
  );

  const attach = useCallback((next: GridAnnouncer) => {
    announcer.current = next;
  }, []);

  return { announce, attach };
}
