"use client";

/**
 * What the grid says out loud, and the one region it says it through.
 *
 * Its own hook because announcing is a subject rather than a step: it decides
 * when silence is right, it dedupes a repeated sentence, and it is shared by
 * two very different events — a batch settling, and a reader moving a card.
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
      // The zero-width space alternates the string, because a live region does
      // not re-announce text that did not change -- and moving a card up twice
      // produces the same sentence both times. Same device as the builder's
      // `keyboard-actions`, which is where this grid's convention comes from.
      setAnnouncement(
        current =>
          `${title} moved to position ${position} of ${count}.${
            current.endsWith("​") ? "" : "​"
          }`
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
      setAnnouncement(
        current =>
          `${title} moved to column ${column} of ${columnCount}, position ${position} of ${count}.${
            current.endsWith("\u200b") ? "" : "\u200b"
          }`
      );
    },
    []
  );

  return { announcement, announceMove, announceColumn };
}
