"use client";

/**
 * What the grid says out loud, and the one region it says it through.
 *
 * Its own hook because announcing is a subject rather than a step: it decides
 * when silence is right, it dedupes a repeated sentence, and it is shared by
 * very different events — a batch settling, a reader moving a card, and the
 * empty dashboard's demo content loading.
 * Left inline it was four more pieces of state and branching in a component the
 * complexity gate was already objecting to.
 *
 * ONE region, and one announcer feeding it. Several announcers on one surface
 * interrupt each other and a reader cannot tell which announcement belonged to
 * what they just did — the reason the grid has a single live region at all, and
 * an argument that does not weaken because the second announcer would be the
 * grid itself rather than a card.
 *
 * @module components/features/widgets/useGridAnnouncer
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface GridAnnouncer {
  /** The live region's current text. */
  announcement: string;
  /** Say where a card landed. */
  announceMove: (title: string, position: number, count: number) => void;
  /**
   * Say that a card changed COLUMN.
   *
   * 🔴 Its own sentence rather than the position formatter. A column and a
   * position within one are different facts, so passing a column through
   * `announceMove` says "moved to position 3 of 3" about a card that is the
   * only one in column 3 — a position it does not hold, in a list whose length
   * is not its column's. Two facts, two wordings.
   */
  announceColumn: (
    title: string,
    column: number,
    columnCount: number,
    position: number,
    count: number
  ) => void;
  /**
   * Say that a card was put away, or brought back.
   *
   * Hiding changes nothing a screen reader can otherwise perceive: the card
   * simply stops being rendered, and the control that did it keeps its own
   * label. Without this the only feedback is the card's silent disappearance,
   * which is indistinguishable from the page having failed.
   */
  announceHidden: (title: string, hidden: boolean) => void;
  /**
   * Say that a card was taken off the dashboard.
   *
   * Its own sentence rather than the hiding one, because the two differ in
   * what they cost: hiding keeps the placement and removing drops it, and a
   * reader deciding whether to undo needs to hear which one happened.
   */
  announceRemoved: (title: string) => void;
  /**
   * Say a sentence about the dashboard as a whole.
   *
   * For a change that belongs to no card and moves no focus -- the empty
   * dashboard's demo content loading, landing or failing. Through this region
   * rather than one of its own, so it cannot talk over what the grid says
   * about a card.
   */
  announceStatus: (text: string) => void;
}

/**
 * What the grid says once a batch settles, or `null` for a state not worth
 * interrupting a reader for.
 *
 * Mid-flight says nothing, for the same reason `DocumentStatusLive` stays quiet
 * during a save: this grid refetches on every window focus, and announcing the
 * start of each refresh would speak over the reader every time they came back
 * to the tab. What matters is where it came to rest.
 */
function settledAnnouncement(
  isLoading: boolean,
  total: number,
  failed: number
): string | null {
  if (total === 0) return null;
  if (isLoading) return null;
  const loaded = total - failed;
  const noun = total === 1 ? "widget" : "widgets";
  return failed > 0
    ? `${loaded} of ${total} ${noun} updated, ${failed} failed.`
    : `${loaded} of ${total} ${noun} updated.`;
}

/**
 * The next announcement, alternated so an identical sentence is spoken again.
 *
 * The zero-width space, for the reason `announceMove` carries one: a live
 * region does not re-announce text that did not change. Two placements of one
 * widget carry the same title, so putting both away produces the same sentence
 * twice and the second would be silent.
 *
 * At module scope because it is pure: inside the hook it would be a dependency
 * of every callback below, and a new identity each render.
 */
function alternate(current: string, next: string): string {
  return `${next}${current.endsWith("\u200b") ? "" : "\u200b"}`;
}

export function useGridAnnouncer(
  settling: boolean,
  counted: number,
  failed: number
): GridAnnouncer {
  const [announcement, setAnnouncement] = useState("");
  // What was last spoken, so an unchanged outcome does not re-fire. A ref
  // rather than state because it must not itself cause a render.
  const spoken = useRef("");
  const next = settledAnnouncement(settling, counted, failed);

  useEffect(() => {
    if (!next || next === spoken.current) return;
    spoken.current = next;
    setAnnouncement(next);
  }, [next]);

  const announceMove = useCallback(
    (title: string, position: number, count: number) => {
      setAnnouncement(current =>
        alternate(
          current,
          `${title} moved to position ${position} of ${count}.`
        )
      );
    },
    []
  );

  const announceColumn = useCallback(
    (
      title: string,
      column: number,
      columnCount: number,
      position: number,
      count: number
    ) => {
      setAnnouncement(current =>
        alternate(
          current,
          `${title} moved to column ${column} of ${columnCount}, position ${position} of ${count}.`
        )
      );
    },
    []
  );

  const announceHidden = useCallback(
    (title: string, hidden: boolean) =>
      setAnnouncement(current =>
        alternate(
          current,
          hidden
            ? // Names where it went rather than only that it went. A hidden
              // card is still in the arrangement, and a reader who cannot see
              // the dimmed cell has no other way to learn it is recoverable.
              `${title} hidden. Edit the dashboard to bring it back.`
            : `${title} shown again.`
        )
      ),
    []
  );

  const announceRemoved = useCallback(
    (title: string) =>
      setAnnouncement(current =>
        alternate(current, `${title} removed from the dashboard.`)
      ),
    []
  );

  const announceStatus = useCallback(
    (text: string) => setAnnouncement(current => alternate(current, text)),
    []
  );

  return {
    announcement,
    announceMove,
    announceColumn,
    announceHidden,
    announceRemoved,
    announceStatus,
  };
}
