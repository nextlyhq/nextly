"use client";

/**
 * What the grid says out loud, and the one region it says it through.
 *
 * Its own hook because announcing is a subject rather than a step: it decides
 * when silence is right, it dedupes a repeated sentence, and it is shared by
 * very different events — a batch settling, a reader moving a card, and
 * customise mode opening, closing or saving.
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
  /**
   * Say where a card moved, counted among the cards the reader can see.
   *
   * Both ends of the move, because a reader who moved a card from its menu
   * cannot see where it went: "moved from 2 to 5 of 9" says the start, the
   * landing and how far the list runs, in the order the grid is read.
   */
  announceMoved: (
    title: string,
    from: number,
    to: number,
    count: number
  ) => void;
  /** Say the width a card was just set to, by its name ("Half width"). */
  announceWidth: (title: string, widthName: string) => void;
  /**
   * Say that a card was taken off the dashboard.
   *
   * Removing changes nothing a screen reader can otherwise perceive: the card
   * simply stops being rendered. Without this the only feedback is its silent
   * disappearance, which is indistinguishable from the page having failed.
   */
  announceRemoved: (title: string) => void;
  /** Say that a removed card was put back where it was. */
  announceRestored: (title: string) => void;
  /**
   * Say that the default dashboard is staged in place of the reader's own.
   *
   * Nothing is written until they save, and the sentence says so: a reset that
   * sounded final would have a reader leave without saving it.
   */
  announceReset: () => void;
  /**
   * Say that customise mode opened, and that nothing in it is stored yet.
   *
   * Entering moves focus to the bar, which a screen reader announces by its
   * name; what the name cannot say is that every change waits for Save.
   */
  announceEntered: () => void;
  /** Say that Cancel threw the draft away. */
  announceDiscarded: () => void;
  /** Say that a save landed. */
  announceSaved: () => void;
  /** Say that a save was refused because the dashboard moved elsewhere. */
  announceRefused: () => void;
  /** Say that a save failed, and that the draft is still on screen. */
  announceSaveFailed: () => void;
  /**
   * Say that one of a card's settings changed outside customise mode, once the card shows it:
   * "Activity: Date range set to Last 7 days." The card redraws in place, so without this a
   * screen reader hears nothing of a change that has already been saved.
   */
  announceSettingChanged: (
    title: string,
    setting: string,
    value: string
  ) => void;
  /**
   * Say one step of a drag: a card picked up, the place it would land, a cancel. The sentence
   * is the drag's own (`edit/drag/drag-messages`); the landing itself is `announceMoved`.
   */
  announceDrag: (sentence: string) => void;
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
 * The zero-width space, because a live region does not re-announce text that
 * did not change. Two placements of one widget carry the same title, so
 * removing both produces the same sentence twice and the second would be
 * silent.
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

  /*
   * Every sentence goes through one setter, so the dedupe rule below is
   * applied to all of them rather than restated per sentence.
   */
  const say = useCallback(
    (sentence: string) =>
      setAnnouncement(current => alternate(current, sentence)),
    []
  );

  const announceMoved = useCallback(
    (title: string, from: number, to: number, count: number) =>
      say(`${title} moved from ${from} to ${to} of ${count}.`),
    [say]
  );

  const announceWidth = useCallback(
    (title: string, widthName: string) => say(`${title} set to ${widthName}.`),
    [say]
  );

  const announceRemoved = useCallback(
    (title: string) => say(`${title} removed.`),
    [say]
  );

  const announceRestored = useCallback(
    (title: string) => say(`${title} restored.`),
    [say]
  );

  const announceReset = useCallback(
    () => say("Dashboard reset to the default. Save to keep it."),
    [say]
  );

  const announceEntered = useCallback(
    () =>
      say("Customizing your dashboard. Nothing is saved until you press Save."),
    [say]
  );

  const announceDiscarded = useCallback(() => say("Changes discarded."), [say]);

  const announceSaved = useCallback(() => say("Dashboard saved."), [say]);

  const announceRefused = useCallback(
    () => say("Your dashboard changed elsewhere, so nothing was saved."),
    [say]
  );

  const announceSaveFailed = useCallback(
    () =>
      say("Your dashboard could not be saved. Your changes are still here."),
    [say]
  );

  const announceSettingChanged = useCallback(
    (title: string, setting: string, value: string) =>
      say(`${title}: ${setting} set to ${value}.`),
    [say]
  );

  return {
    announcement,
    announceSettingChanged,
    announceMoved,
    announceWidth,
    announceRemoved,
    announceRestored,
    announceReset,
    announceEntered,
    announceDiscarded,
    announceSaved,
    announceRefused,
    announceSaveFailed,
    // A drag's sentence is already its own, so it is said as it comes.
    announceDrag: say,
  };
}
