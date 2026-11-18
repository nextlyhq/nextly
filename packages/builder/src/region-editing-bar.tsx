"use client";

/**
 * The bar above the canvas while a region of the page's layout is edited in
 * place, for the shell's `canvasStrip` slot: the host's words for what is
 * edited and how far a change reaches ("Editing the site header · changes
 * show on 11 pages"), and Done, the one way back to the page.
 *
 * A press on the dimmed page changes nothing there, and briefly highlights
 * Done instead (`pulse`), so an author who clicked the page sees how to get
 * back to it.
 *
 * It holds the live region that announces entering and leaving, drawn
 * whether or not a region is edited: a live region that appears with its
 * first words is often not read at all. So the host draws this part always,
 * and it draws no bar while the page is edited.
 *
 * @module region-editing-bar
 * @experimental Settles with editing a header or footer in place.
 */

import { useEffect, useId, useState, type JSX } from "react";

import type { EditingTargetState } from "./editing-target";

/** How long Done stays highlighted after a press on the dimmed page. */
const PULSE_MS = 900;

export interface RegionEditingBarProps {
  /** The editing target, from `useEditingTarget`. */
  editing: Pick<
    EditingTargetState,
    "target" | "leave" | "pulse" | "announcement"
  >;
  /**
   * What Done runs: the host's, where it asks first about unsaved changes.
   * Absent, Done leaves at once.
   */
  onDone?: () => void;
}

export function RegionEditingBar({
  editing,
  onDone,
}: RegionEditingBarProps): JSX.Element {
  const { target } = editing;
  const wordsId = useId();
  const pulsing = usePulsing(editing.pulse);
  return (
    <>
      <div
        role="status"
        aria-live="polite"
        className="nx-sr-only"
        data-nx-region-announcer=""
      >
        {editing.announcement}
      </div>
      {target.kind !== "region" ? null : (
        <div className="nx-region-bar" data-nx-region-bar={target.area}>
          <p className="nx-region-bar__words" id={wordsId}>
            {target.words.bar}
          </p>
          <button
            type="button"
            className="nx-region-bar__done"
            // So a screen reader on Done hears what it ends.
            aria-describedby={wordsId}
            data-pulsing={pulsing ? "" : undefined}
            onClick={onDone ?? editing.leave}
          >
            {target.words.done}
          </button>
        </div>
      )}
    </>
  );
}

/**
 * Whether Done is highlighted now: for a moment after each new press counted
 * in `pulse`, and not before the first.
 */
function usePulsing(pulse: number): boolean {
  const [shown, setShown] = useState(0);
  // Highlighted in the render that sees a new press, rather than an effect
  // later, so the highlight never lags the press by a frame.
  const [seen, setSeen] = useState(pulse);
  if (seen !== pulse) {
    setSeen(pulse);
    setShown(pulse);
  }
  useEffect(() => {
    if (shown === 0) return;
    const timer = setTimeout(() => setShown(0), PULSE_MS);
    return () => clearTimeout(timer);
  }, [shown]);
  return shown !== 0;
}
