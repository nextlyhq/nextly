"use client";

/**
 * The editor's way in to the site's breakpoints.
 *
 * A TRIGGER plus the dialog, rather than the dialog alone, because open state
 * is the only thing a host would have to invent to use it and every host would
 * invent it the same way. What a host does have to supply is the pair this
 * cannot know: the site's saved set, and how to write one.
 *
 * **In the top bar rather than in a left panel.** Breakpoints are site-wide and
 * set rarely — an author defines them once and then works within them for
 * months — so they do not earn a permanent region beside Insert and Layers,
 * which are used on every edit. Every builder researched puts breakpoint
 * management in the viewport chrome rather than in a content panel, and putting
 * it there also means the manager sits where a breakpoint SWITCHER will go, so
 * the two read as one control instead of two unrelated ones.
 *
 * @module breakpoint-manager
 */

import { Button } from "@nextlyhq/ui";
import { MonitorSmartphone } from "lucide-react";
import * as React from "react";

import { BreakpointDialog } from "./breakpoint-dialog";
import { BASE_BREAKPOINT, type BreakpointSet } from "./breakpoints";

/**
 * Props for BreakpointManager.
 * @experimental
 */
export interface BreakpointManagerProps {
  /** The site's saved breakpoints, as the canvas is compiled against them. */
  value: BreakpointSet;
  /**
   * Persist the edited set. See {@link BreakpointDialogProps.onSave} — a promise
   * is awaited and a resolved string is shown as a refusal.
   */
  onSave: (next: BreakpointSet) => void | Promise<string | undefined>;
  /**
   * Whether the SAVED set has actually been read yet.
   *
   * False while the stored site style is loading or could not be read, and the
   * consequence is why this is a required input rather than an optional nicety.
   * Until the read answers, `value` is the host's CONFIG DEFAULTS — so a dialog
   * opened on it would show a set the site never chose, and saving from that
   * draft would overwrite the site's real breakpoints with defaults the author
   * never saw. The same gate the canvas and the provenance trace already apply,
   * one surface over.
   *
   * Disabled rather than hidden: a control that vanishes while a request is in
   * flight moves the buttons beside it under the pointer, and an author who
   * knows the manager exists is left wondering whether the feature was removed.
   */
  ready: boolean;
}

/**
 * How many breakpoints the site defines, for the trigger's own label.
 *
 * The base is not counted. It is not a definition an author added and cannot be
 * removed, so including it would report "1 breakpoint" for a site that has
 * defined none — the exact state the label exists to distinguish.
 */
function definedCount(value: BreakpointSet): number {
  const axes = [value.viewport, value.container];
  let count = 0;
  for (const axis of axes) {
    for (const def of axis ?? []) {
      if (def?.id !== BASE_BREAKPOINT) count += 1;
    }
  }
  return count;
}

/**
 * The button that opens the breakpoint dialog, and the dialog.
 * @experimental
 */
export function BreakpointManager({
  value,
  onSave,
  ready,
}: BreakpointManagerProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const count = definedCount(value);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={!ready}
        onClick={() => setOpen(true)}
        /*
         * The count is in the ACCESSIBLE name, not only in the glyph beside it.
         * A screen-reader user otherwise reaches a button called "Breakpoints"
         * that gives no hint whether the site has any — which is the single
         * thing this label is worth showing.
         */
        aria-label={
          ready ? `Breakpoints: ${count} defined` : "Breakpoints: still loading"
        }
        title={
          ready
            ? undefined
            : "Available once the site's saved styles have loaded."
        }
      >
        <MonitorSmartphone className="size-4" />
        <span>Breakpoints</span>
        {ready && count > 0 ? (
          <span
            className="text-muted-foreground tabular-nums"
            // Already in the button's accessible name above, so announcing it
            // again would read the number twice.
            aria-hidden="true"
          >
            {count}
          </span>
        ) : null}
      </Button>
      {/*
       * Mounted only while open, so the draft is seeded from `value` at the
       * moment the author opens it. Kept mounted, a set that arrived or changed
       * in the background would sit behind a closed dialog and the author would
       * open it onto whatever was current when the editor booted.
       */}
      {open ? (
        <BreakpointDialog
          open
          onOpenChange={setOpen}
          value={value}
          onSave={onSave}
        />
      ) : null}
    </>
  );
}
