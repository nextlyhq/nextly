"use client";

/**
 * The repair surface for a page the canvas cannot show and the author cannot save.
 *
 * Anything stored under a slot name its parent does not declare is invisible in the editor: the
 * canvas builds what a definition declares, so nothing draws it. Saving is refused. Every surface
 * that works by SELECTING a block is therefore useless here, which is why this is a banner over
 * the document rather than an inspector panel or a marker on the canvas.
 *
 * What it offers to remove is not always a block. Validation refuses a slot's NAME rather than its
 * contents, and refuses a slots map on a non-container before it reads a key, so a page can be
 * unsaveable with no block in it to remove. Each of those states gets its own row and its own
 * repair, or the banner would report a problem with no action against it.
 *
 * Nothing is removed without a person choosing it, one row at a time. The alternative, repairing
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

/** What a row calls the thing it offers to remove. */
function labelFor(entry: InvalidSlotEntry): string {
  switch (entry.kind) {
    case "block":
      return entry.node.name?.trim() || entry.type;
    case "empty-slot":
      return `Empty slot "${entry.slotName}"`;
    case "stray-slots":
      return "Leftover slot data";
  }
}

/** Where it sits, for someone who cannot click on it. */
function whereFor(entry: InvalidSlotEntry): string {
  const on = `on ${entry.parentType}${entry.path ? ` (${entry.path})` : ""}`;
  switch (entry.kind) {
    case "block": {
      const held =
        entry.descendantCount > 0
          ? `, holding ${entry.descendantCount} more ${
              entry.descendantCount === 1 ? "block" : "blocks"
            }`
          : "";
      return `in slot "${entry.slotName}" ${on}${held}`;
    }
    case "empty-slot":
      return `${on}, holding nothing`;
    case "stray-slots":
      return `${on}, which holds no slots at all`;
  }
}

/**
 * Identifies the current problem, so dismissing it cannot hide a different one.
 *
 * Dismissal is a judgement about what was listed at that moment. If the set changes the banner has
 * something new to say, and a flag that outlived the thing it referred to would hide a page that
 * still refuses to save.
 */
function signatureOf(entries: InvalidSlotEntry[]): string {
  return entries.map(e => e.key).join(",");
}

/**
 * The action one Remove button dispatches.
 *
 * Separate from the button so the step between "what the finder reported" and "what the reducer is
 * asked to do" can be exercised without a browser. A row that named the right thing while
 * dispatching the wrong repair would look correct in every screenshot.
 *
 * Three kinds, three repairs: removing the block inside is only ever one of the three answers.
 */
export function removalFor(entry: InvalidSlotEntry): EditorAction {
  switch (entry.kind) {
    case "block":
      return {
        type: "REMOVE_FROM_SLOT",
        parentId: entry.parentId,
        slot: entry.slotName,
        id: entry.node.id,
      };
    case "empty-slot":
      return {
        type: "REMOVE_SLOT",
        parentId: entry.parentId,
        slot: entry.slotName,
      };
    case "stray-slots":
      return { type: "DROP_SLOTS", parentId: entry.parentId };
  }
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
  // An empty stale slot and a leftover slots map are faults with no block in them, so the
  // block-counting sentence would be false whenever the list is not all blocks.
  const headline = entries.every(e => e.kind === "block")
    ? `This page has ${count} ${count === 1 ? "block" : "blocks"} in a slot that no longer exists.`
    : `This page has ${count} ${count === 1 ? "leftover" : "leftovers"} from a slot that no longer exists.`;

  return (
    <div className="nx-pb-repair" role="status" aria-live="polite">
      <div className="nx-pb-repair-bar">
        <div className="nx-pb-repair-text">
          <strong>{headline}</strong> None of it is drawn on the canvas, so
          there is nothing to select, and the page will not save until it is
          cleared.
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
            <li key={entry.key} className="nx-pb-repair-item">
              <div className="nx-pb-repair-item-text">
                <span className="nx-pb-repair-item-name">
                  {labelFor(entry)}
                </span>
                <span className="nx-pb-repair-item-where">
                  {whereFor(entry)}
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
