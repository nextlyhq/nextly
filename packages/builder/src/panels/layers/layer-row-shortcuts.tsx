/**
 * The Layers rows' own keystrokes (rename, hide or show, lock or unlock), as
 * the editor's shortcut manager runs them and Help lists them, and how an
 * event finds the row it happened in.
 *
 * Its own module so the Layers panel stays the entry that draws the tree.
 *
 * @module panels/layers/layer-row-shortcuts
 */
import { useShortcuts } from "@nextlyhq/ui";
import type * as React from "react";

import { isElement } from "../../dom-kind";

import { ROW_KEYS, type RowKeyAction } from "./layer-row-actions";

/** The block of the row an event happened in, or `null` off the rows. */
export function rowIdOf(target: EventTarget | null): string | null {
  // Asked by node kind, so a row in another document still answers.
  if (!isElement(target)) return null;
  const row = target.closest('[role="treeitem"]');
  return (
    row?.querySelector("[data-nx-layer]")?.getAttribute("data-nx-layer") ?? null
  );
}

/** What each row keystroke does, as Help lists it. */
const ROW_KEY_DESCRIPTIONS: Readonly<Record<RowKeyAction, string>> = {
  rename: "Rename the block of the focused Layers row",
  "toggle-hidden":
    "Hide or show the block of the focused Layers row on the device being edited",
  "toggle-lock": "Lock or unlock the block of the focused Layers row",
};

const ROW_KEY_ACTIONS: readonly RowKeyAction[] = [
  "rename",
  "toggle-hidden",
  "toggle-lock",
];

/**
 * The row keystrokes, registered with the editor's shortcut manager so Help
 * lists them with every other binding. Each acts on the row that has focus,
 * and only while one of this panel's rows has it: the same keys elsewhere,
 * or in a rename's field, are left alone.
 */
export function RowShortcuts({
  scope,
  act,
}: {
  scope: React.RefObject<HTMLElement | null>;
  act: (id: string, action: RowKeyAction) => void;
}): null {
  const focusedRow = (): string | null => {
    const root = scope.current;
    const active = root?.ownerDocument.activeElement;
    if (
      root === null ||
      root === undefined ||
      active === null ||
      active === undefined ||
      !root.contains(active) ||
      active.getAttribute("role") !== "treeitem"
    ) {
      return null;
    }
    return rowIdOf(active);
  };
  useShortcuts(
    ROW_KEY_ACTIONS.map(action => ({
      keys: ROW_KEYS[action],
      description: ROW_KEY_DESCRIPTIONS[action],
      when: () => focusedRow() !== null,
      run: () => {
        const id = focusedRow();
        if (id !== null) act(id, action);
      },
    })),
    { name: "builder-layers-rows" }
  );
  return null;
}
