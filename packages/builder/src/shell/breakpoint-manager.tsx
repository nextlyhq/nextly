"use client";

/**
 * The site's breakpoints, as Settings' Site tab shows and edits them.
 *
 * A list in the device buttons' own words, and an "Edit breakpoints" control
 * that turns the section into the editor in place. The editor is the whole of
 * editing: its rows, its validation, its cascade preview, its Save and Cancel
 * and the reason a save was refused. A breakpoint set validates as a whole, so
 * it is saved as a whole, never a row at a time.
 *
 * **In Settings rather than in the top bar.** Breakpoints are site-wide and set
 * rarely; the top bar keeps the devices that choose between them.
 *
 * @module breakpoint-manager
 */

import { Button } from "@nextlyhq/ui";
import { Check } from "lucide-react";
import * as React from "react";

import { BreakpointEditor } from "./breakpoint-editor";
import { deviceOptions, tierIcon } from "./breakpoint-switcher";
import {
  authoredBreakpoints,
  BASE_BREAKPOINT,
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
   * Persist the edited set. See {@link BreakpointEditorProps.onSave} — a promise
   * is awaited and a resolved string is shown as a refusal.
   */
  onSave: (next: BreakpointSet) => void | Promise<string | null | undefined>;
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
  /**
   * Told when editing starts and ends, so a host can ask before it is left:
   * a draft open in the editor is work not saved yet.
   */
  onEditingChange?: (editing: boolean) => void;
  /** Told when a save of the set starts and settles; see the editor's. */
  onSavingChange?: (saving: boolean) => void;
  /**
   * Why the breakpoints cannot be edited right now, when the host knows one
   * the saved set's read cannot (a removal still being carried out, say):
   * Edit breakpoints is disabled, saying why. Absent, `status` decides.
   */
  blocked?: string;
  /**
   * A short word shown beside a breakpoint, by its id: what the host has just
   * done to it ("put back"), said for as long as the host passes it.
   */
  tags?: ReadonlyMap<string, string>;
  /**
   * Counted up by the host to open the editor, as Edit breakpoints does: a
   * step that ends with editing as the way on opens it in one click.
   */
  editRequest?: number;
}

/**
 * Why Edit breakpoints is disabled, or `undefined` while it may be used: the
 * host's own reason first, then what the saved set's read has done.
 */
function editUnavailable(
  status: BreakpointManagerProps["status"],
  blocked: string | undefined
): string | undefined {
  if (blocked !== undefined) return blocked;
  if (status === "ready") return undefined;
  return status === "loading"
    ? "Available once the site's saved styles have loaded."
    : "Your site's saved styles could not be read, so editing them here could overwrite them.";
}

/** One breakpoint in the list: its device glyph, name and range, and a tag. */
function DeviceRow({
  device,
  tag,
}: {
  device: ReturnType<typeof deviceOptions>[number];
  /** What the host says of it just now ("put back"), when anything. */
  tag: string | undefined;
}): React.JSX.Element {
  const Glyph = tierIcon(
    device.id === BASE_BREAKPOINT ? undefined : device.preview
  );
  return (
    <li className="flex items-center gap-2 px-3 py-2 text-sm">
      <Glyph
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <span className="font-medium">{device.label}</span>
      <span className="text-muted-foreground">{device.range}</span>
      {tag === undefined ? null : (
        <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
          {tag}
        </span>
      )}
    </li>
  );
}

/**
 * Open the editor when the host asks (`editRequest` counted up), once per
 * request, and only when it may be opened. A request made while the set is
 * still loading (a read refetching) waits for it, so the one click is never
 * lost; one made while editing is held, or the set can't be read, is
 * answered by the disabled button's reason and not kept for later.
 */
function useEditRequest(
  editRequest: number | undefined,
  status: BreakpointManagerProps["status"],
  ready: boolean,
  open: () => void
): void {
  const asked = React.useRef(editRequest ?? 0);
  React.useEffect(() => {
    if (editRequest === undefined || editRequest === asked.current) return;
    if (status === "loading") return;
    asked.current = editRequest;
    if (ready) open();
  });
}

/**
 * The set to show and edit: `value`, or the set this surface last wrote until
 * the read catches up (see the comment inside), with `hold` to record a write.
 */
function useHeldWrite(value: BreakpointSet): {
  readonly shown: BreakpointSet;
  readonly hold: (wrote: BreakpointSet) => void;
} {
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
  return {
    shown: stillStale ? pendingWrite.wrote : value,
    hold: wrote => setPendingWrite({ wrote, sawAtSave: value }),
  };
}

/**
 * The button that opens the breakpoint dialog, and the dialog.
 * @experimental
 */
export function BreakpointManager({
  value,
  onSave,
  status,
  onEditingChange,
  onSavingChange,
  blocked,
  tags,
  editRequest,
}: BreakpointManagerProps): React.JSX.Element {
  const ready = status === "ready" && blocked === undefined;
  const [editing, setEditingState] = React.useState(false);
  const setEditing = (next: boolean): void => {
    setEditingState(next);
    onEditingChange?.(next);
  };
  useEditRequest(editRequest, status, ready, () => setEditing(true));
  // Whether this section's last save succeeded, to say so beside it.
  const [saved, setSaved] = React.useState(false);
  const held = useHeldWrite(value);
  const authored = authoredBreakpoints(held.shown);

  const persist = async (
    next: BreakpointSet
  ): Promise<string | null | undefined> => {
    // Narrowed rather than passed through: `onSave` may return nothing at all,
    // and `void` is not `undefined` to the checker even though it is at runtime.
    const answered = await onSave(next);
    const outcome =
      typeof answered === "string" || answered === null ? answered : undefined;
    // Held only on success. A refused write changed nothing, so there is no
    // newer set for the read to catch up to.
    if (outcome === undefined) {
      held.hold(next);
      setSaved(true);
    }
    return outcome;
  };

  const shown = held.shown;

  if (editing) {
    // Mounted only while editing, so the draft is seeded from the set at the
    // moment the author starts, never from one that changed behind it.
    return (
      <BreakpointEditor
        value={authored}
        onSave={persist}
        onClose={() => setEditing(false)}
        {...(onSavingChange === undefined ? {} : { onSavingChange })}
        // A reason that arrives while editing holds the open editor too.
        {...(blocked === undefined ? {} : { blocked })}
      />
    );
  }

  return (
    <div className="space-y-3" data-breakpoint-manager="">
      <ul className="divide-y divide-border rounded-md border border-border">
        {deviceOptions(shown).map(device => (
          <DeviceRow
            key={device.id}
            device={device}
            tag={tags?.get(device.id)}
          />
        ))}
      </ul>
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!ready}
          onClick={() => {
            setSaved(false);
            setEditing(true);
          }}
          // Disabled rather than hidden until the saved set is read: opened
          // on the host's defaults, a save would overwrite the site's real
          // breakpoints with a set it never chose.
          title={editUnavailable(status, blocked)}
        >
          Edit breakpoints
        </Button>
        {/* After a save, in the save chip's word, beside what made it; a
            refused save stays in the editor with its reason. */}
        <span
          role="status"
          className="flex items-center gap-1.5 text-sm text-muted-foreground"
        >
          {saved ? (
            <>
              <Check className="size-4 text-success" aria-hidden="true" />
              Saved
            </>
          ) : null}
        </span>
      </div>
    </div>
  );
}
