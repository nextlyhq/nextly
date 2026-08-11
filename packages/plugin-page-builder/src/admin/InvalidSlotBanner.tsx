"use client";

/**
 * The repair surface for blocks the canvas cannot show and the author cannot save past.
 *
 * A block stored under a slot name its parent does not declare is invisible in the editor: the
 * canvas builds what a definition declares, so nothing draws it. Saving is refused. Every surface
 * that works by SELECTING a block is therefore useless here, which is why this is a banner over
 * the document rather than an inspector panel or a marker on the canvas.
 *
 * Nothing is removed without a person choosing it, one block at a time. The alternative, repairing
 * the document on load, would silently discard content whose only remaining copy is the row in the
 * database.
 */
import { Button } from "@nextlyhq/ui";
import { useState } from "react";

import { findInvalidSlotEntries } from "../core/invalid-slots";
import type { InvalidSlotEntry } from "../core/invalid-slots";
import { defaultBlockRegistry } from "../core/registry";

import { useEditor } from "./store/EditorProvider";
import type { EditorAction } from "./store/editorStore";

/** What the author is offered as the block's name: their own label if they gave it one. */
function labelFor(entry: InvalidSlotEntry): string {
  return entry.node.name?.trim() || entry.type;
}

/**
 * Identifies the current problem, so dismissing it cannot hide a different one.
 *
 * Dismissal is a judgement about the blocks listed at that moment. If the set changes the banner
 * has something new to say, and a flag that outlived the thing it referred to would hide a page
 * that still refuses to save.
 */
function signatureOf(entries: InvalidSlotEntry[]): string {
  return entries.map(e => e.node.id).join(",");
}

/**
 * The action one Remove button dispatches.
 *
 * Separate from the button so the step between "what the finder reported" and "what the reducer
 * is asked to do" can be exercised without a browser. A row that listed the right block and
 * dispatched the wrong slot would look correct in every screenshot.
 */
export function removalFor(entry: InvalidSlotEntry): EditorAction {
  return {
    type: "REMOVE_FROM_SLOT",
    parentId: entry.parentId,
    slot: entry.slotName,
    id: entry.node.id,
  };
}

export function InvalidSlotBanner() {
  const { state, dispatch } = useEditor();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const entries = findInvalidSlotEntries(
    state.document.root,
    defaultBlockRegistry
  );
  const signature = signatureOf(entries);

  if (entries.length === 0 || signature === dismissed) return null;

  const count = entries.length;

  return (
    <div className="nx-pb-repair" role="status" aria-live="polite">
      <div className="nx-pb-repair-bar">
        <div className="nx-pb-repair-text">
          <strong>
            This page has {count} {count === 1 ? "block" : "blocks"} in a slot
            that no longer exists.
          </strong>{" "}
          They are not drawn on the canvas, so you cannot select them, and the
          page will not save while they are there.
        </div>
        <div className="nx-pb-repair-actions">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-expanded={open}
            onClick={() => setOpen(o => !o)}
          >
            {open ? "Hide" : "Review"}
          </Button>
          <button
            type="button"
            className="nx-pb-repair-dismiss"
            aria-label="Dismiss"
            onClick={() => setDismissed(signature)}
          >
            ×
          </button>
        </div>
      </div>

      {open && (
        <ul className="nx-pb-repair-list">
          {entries.map(entry => (
            <li key={entry.node.id} className="nx-pb-repair-item">
              <div className="nx-pb-repair-item-text">
                <span className="nx-pb-repair-item-name">
                  {labelFor(entry)}
                </span>
                <span className="nx-pb-repair-item-where">
                  in slot &ldquo;{entry.slotName}&rdquo; of {entry.parentType}
                  {entry.path ? ` (${entry.path})` : ""}
                  {entry.descendantCount > 0
                    ? `, holding ${entry.descendantCount} more ${
                        entry.descendantCount === 1 ? "block" : "blocks"
                      }`
                    : ""}
                </span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => dispatch(removalFor(entry))}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
