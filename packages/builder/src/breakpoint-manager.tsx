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
import {
  BASE_BREAKPOINT,
  type BreakpointDef,
  type BreakpointSet,
} from "./breakpoints";

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
 * The set with the built-in base removed from both axes.
 *
 * A stored set CAN carry a `base` row, and the plugin's own README documents a
 * host config that does — while `validateBreakpoints` reports the same id as
 * reserved, because the compiler claims it before reading any stored
 * definition. Passed through, the dialog renders it as an ordinary read-only
 * row and Save is disabled for as long as it is there: an author on the
 * documented configuration cannot save breakpoints at all until they delete a
 * row the interface presents as built in.
 *
 * Dropped here rather than made savable, because the two conventions are not
 * both right. `breakpointContexts` prepends the base context whether or not one
 * is stored, so a stored base row is redundant at best and shadowed at worst,
 * and the dialog is the one surface that must not offer to edit it.
 *
 * Applied to the DRAFT as well as the count. An earlier version excluded the
 * base from the count alone, which fixed the label and left the deadlock — the
 * same fact used in one of the two places that needed it.
 */
function withoutBase(value: BreakpointSet): BreakpointSet {
  const authored = (axis: readonly BreakpointDef[] | undefined) =>
    (axis ?? []).filter(def => def?.id !== BASE_BREAKPOINT);
  return {
    viewport: authored(value.viewport),
    container: authored(value.container),
  };
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
  /*
   * The set this surface last wrote, held until the read catches up.
   *
   * A successful write resolves before the query it invalidates has refetched,
   * and `useSiteStyle` reports `isPending` rather than background fetching — so
   * for a moment after saving, `value` is still the PREVIOUS set while the
   * trigger is ready and the dialog will reopen. An author who saves and
   * immediately reopens would be seeded from the old set, and saving that draft
   * would overwrite the write that had just succeeded.
   *
   * Released by ANY change to `value`, not by `value` matching what was
   * written. Waiting for a match cannot end if the server stored something
   * different from what was sent — the surface would then show the submitted
   * set forever and never the truth. Recording the value that was current at
   * the save and yielding the moment it changes bounds this to exactly the
   * window it exists for.
   */
  const [pendingWrite, setPendingWrite] = React.useState<
    | { readonly wrote: BreakpointSet; readonly sawAtSave: BreakpointSet }
    | undefined
  >(undefined);
  const stillStale =
    pendingWrite !== undefined && pendingWrite.sawAtSave === value;
  const authored = withoutBase(stillStale ? pendingWrite.wrote : value);
  const count = authored.viewport.length + authored.container.length;

  const persist = async (next: BreakpointSet): Promise<string | undefined> => {
    // Narrowed rather than passed through: `onSave` may return nothing at all,
    // and `void` is not `undefined` to the checker even though it is at runtime.
    const answered = await onSave(next);
    const outcome = typeof answered === "string" ? answered : undefined;
    // Held only on success. A refused write changed nothing, so there is no
    // newer set for the read to catch up to.
    if (outcome === undefined) {
      setPendingWrite({ wrote: next, sawAtSave: value });
    }
    return outcome;
  };

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
          value={authored}
          onSave={persist}
        />
      ) : null}
    </>
  );
}
