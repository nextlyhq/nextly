"use client";

/**
 * The repair surface for a page the canvas cannot show and the author cannot save.
 *
 * Anything stored under a slot name its parent does not declare is invisible in the editor: the
 * canvas builds what a definition declares, so nothing draws it. Saving is refused. Every surface
 * that works by SELECTING a block is therefore useless here, which is why this is a banner over
 * the document rather than an inspector panel or a marker on the canvas.
 *
 * What it offers to act on is not always a block. Validation refuses a slot's NAME rather than its
 * contents, and refuses a slots map on a non-container before it reads a key, so a page can be
 * unsaveable with no block in it to remove. Each of those states gets its own row and its own
 * repair, or the banner would report a problem with no action against it.
 *
 * One kind of row IS on the canvas: a block whose slot refuses its type. It appears here anyway
 * because seeing the block tells the author nothing about why the page will not save, and because
 * its repair is the one that keeps the block — a slot admitting a single container type says
 * exactly what to put around it.
 *
 * Nothing is changed without a person choosing it, one row at a time. The alternative, repairing
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

/**
 * What the row's button will do, since not every repair discards the block.
 *
 * Exported because the rows only exist once the banner is expanded, so nothing about the collapsed
 * surface can show that a wrap is offered where a wrap is right.
 */
export function actionLabelFor(entry: InvalidSlotEntry): string {
  if (entry.kind !== "not-allowed" || !entry.wrapWith) return "Remove";
  const label = defaultBlockRegistry.get(entry.wrapWith)?.label;
  return label ? `Wrap in ${label}` : "Wrap";
}

/** What a row calls the thing it acts on. */
function labelFor(entry: InvalidSlotEntry): string {
  switch (entry.kind) {
    case "block":
    case "not-allowed":
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
    case "not-allowed":
      return `in slot "${entry.slotName}" ${on}, which does not accept ${entry.type}`;
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
 * The action one row's button dispatches.
 *
 * A carrier rather than a decision: the entry goes to the reducer, which asks `repairInvalidSlot`
 * what to do with it. Deciding here as well would be a second switch on the same union, and a row
 * that named the right block while prescribing the wrong operation looks correct in every
 * screenshot.
 */
export function repairFor(entry: InvalidSlotEntry): EditorAction {
  return { type: "REPAIR_INVALID_SLOT", entry };
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
  const misplaced = entries.filter(e => e.kind === "not-allowed").length;
  const hidden = count - misplaced;

  // Three sentences rather than one with a clause, because the two families of fault differ in
  // the fact that matters most to the reader: whether the thing is on the canvas at all.
  const headline =
    misplaced === count
      ? `This page has ${count} ${count === 1 ? "block" : "blocks"} somewhere ${count === 1 ? "it is" : "they are"} no longer allowed.`
      : hidden === count && entries.every(e => e.kind === "block")
        ? `This page has ${count} ${count === 1 ? "block" : "blocks"} in a slot that no longer exists.`
        : hidden === count
          ? `This page has ${count} ${count === 1 ? "leftover" : "leftovers"} from a slot that no longer exists.`
          : `This page has ${count} things that stop it saving.`;

  const detail =
    misplaced === count
      ? "Each one is drawn on the canvas, so nothing looks wrong, but the page will not save while it sits where it does."
      : misplaced === 0
        ? "None of it is drawn on the canvas, so there is nothing to select, and the page will not save until it is cleared."
        : "Some of it is not drawn on the canvas at all, so there is nothing to select. The page will not save until each one is dealt with.";

  return (
    <div className="nx-pb-repair" role="status" aria-live="polite">
      <div className="nx-pb-repair-bar">
        <div className="nx-pb-repair-text">
          <strong>{headline}</strong> {detail}
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
                onClick={() => dispatch(repairFor(entry))}
              >
                {actionLabelFor(entry)}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
