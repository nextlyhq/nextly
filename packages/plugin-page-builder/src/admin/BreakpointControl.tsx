"use client";

/**
 * Which viewport width the canvas is drawn at.
 *
 * Its own component because it is the one piece of the editor's old toolbar that
 * carries a capability rather than chrome. The toolbar around it is replaced by
 * the builder shell, which supplies a top bar and takes its contents as a slot —
 * so the control moves into that slot instead of being deleted with the bar it
 * used to sit in.
 *
 * The shell has no breakpoint UI of its own to adopt. `@nextlyhq/builder` ships
 * a breakpoint DIALOG, but that edits which breakpoints exist; it is not a
 * device switcher, and it is exported from no entry point.
 *
 * @module admin/BreakpointControl
 */

import { type LucideIcon } from "lucide-react";

import { Monitor, Smartphone, Tablet } from "./icons";
import { useEditor } from "./store/EditorProvider";

const BREAKPOINTS: { id: string; label: string; Icon: LucideIcon }[] = [
  { id: "base", label: "Desktop", Icon: Monitor },
  { id: "tablet", label: "Tablet", Icon: Tablet },
  { id: "mobile", label: "Mobile", Icon: Smartphone },
];

/**
 * The device-preview switcher.
 *
 * A radio group in behaviour rather than a set of toggles: exactly one width is
 * active, so `aria-pressed` on each button describes the state a screen reader
 * needs without inventing a second selection model.
 */
export function BreakpointControl() {
  const { state, dispatch } = useEditor();

  return (
    <div className="nx-pb-seg" role="group" aria-label="Preview device">
      {BREAKPOINTS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          className="nx-pb-seg-btn"
          aria-pressed={state.activeBreakpoint === id}
          aria-label={label}
          onClick={() => dispatch({ type: "SET_BREAKPOINT", breakpoint: id })}
        >
          <Icon size={15} aria-hidden />
          {label}
        </button>
      ))}
    </div>
  );
}
