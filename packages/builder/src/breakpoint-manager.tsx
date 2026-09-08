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
  authoredBreakpoints,
  sameBreakpoints,
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
   * What the SAVED set's read has actually done — not merely whether it is done.
   *
   * Three states, because the two that are not `ready` need different words and
   * a boolean cannot carry them. Until the read answers, `value` is the host's
   * CONFIG DEFAULTS, so a dialog opened on it would show a set the site never
   * chose and saving that draft would overwrite the site's real breakpoints with
   * defaults the author never saw. That is true of a FAILED read as much as a
   * pending one — which is why a `pending`-only gate is wrong — but the two are
   * not the same thing to say. Told "still loading" after a permission denial,
   * an author waits for a request that already finished.
   *
   * Disabled rather than hidden in both cases: a control that vanishes while a
   * request is in flight moves the buttons beside it under the pointer, and an
   * author who knows the manager exists is left wondering whether the feature
   * was removed.
   */
  status: "loading" | "unavailable" | "ready";
}

/**
 * The button that opens the breakpoint dialog, and the dialog.
 * @experimental
 */
export function BreakpointManager({
  value,
  onSave,
  status,
}: BreakpointManagerProps): React.JSX.Element {
  const ready = status === "ready";
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
  /*
   * The hold survives exactly while the read has demonstrably not moved.
   *
   * Two earlier versions each failed in one direction, which is the tell that a
   * third heuristic is the wrong answer. Waiting for the incoming set to MATCH
   * what was written never ends if the server stored something else. Comparing
   * object IDENTITY releases on any parent render that rebuilds an equal
   * object, because the prop contract does not promise a stable reference.
   *
   * Both are answered by asking about CONTENT and accepting either outcome as
   * an arrival: the read has caught up when it now equals what was written, and
   * it has also caught up when it differs from what was there at the save. What
   * is left — equal to the pre-save set and not to the written one — is the only
   * state in which nothing has come back yet, so the hold cannot stick and
   * cannot lift early.
   */
  const readArrived =
    pendingWrite !== undefined &&
    (sameBreakpoints(value, pendingWrite.wrote) ||
      !sameBreakpoints(value, pendingWrite.sawAtSave));
  const stillStale = pendingWrite !== undefined && !readArrived;
  /*
   * CLEARED once the read moves, not merely stopped being consulted.
   *
   * Leaving it in state makes the release temporary rather than permanent:
   * `resolveSiteStyle` hands back the host's config OBJECT when nothing is
   * stored, and that reference is memoised — so a site that saves a set and
   * later has the stored section cleared through the API or an import sees
   * `value` return to the very object it was at the save, `sawAtSave === value`
   * become true a second time, and an optimistic write resurrect over the truth
   * the server and canvas have both moved back to.
   */
  React.useEffect(() => {
    if (readArrived) setPendingWrite(undefined);
  }, [readArrived]);
  const authored = authoredBreakpoints(stillStale ? pendingWrite.wrote : value);
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
          ready
            ? `Breakpoints: ${count} defined`
            : status === "loading"
              ? "Breakpoints: still loading"
              : "Breakpoints: unavailable"
        }
        title={
          ready
            ? `Breakpoints: ${count} defined`
            : status === "loading"
              ? "Available once the site's saved styles have loaded."
              : "Your site's saved styles could not be read, so editing them here could overwrite them."
        }
      >
        {/*
          The glyph carries the control and the word is dropped: the trigger
          opens a dialog that names itself, and "Breakpoints" beside a count
          spent more of the bar than the two facts an author reads from here —
          that this is where tiers are managed, and how many exist.

          The accessible name below is unchanged and still says both, so
          nothing is lost to a reader who cannot see the glyph; the title makes
          the same sentence reachable by pointer.
        */}
        <MonitorSmartphone className="size-4" />
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
