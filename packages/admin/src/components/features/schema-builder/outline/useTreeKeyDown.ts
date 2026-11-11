"use client";

/**
 * The tree's key handler: finds the row a key was pressed on, asks
 * `tree-keys` what the key means there, and carries the command out.
 */
import type { KeyboardEvent } from "react";
import { useRef } from "react";

import type { VisibleRow } from "@admin/lib/builder/outline/outline-model";

import type { OutlineActions } from "./outline-types";
import { treeCommand, typeAheadTarget, type TreeCommand } from "./tree-keys";

/** How long type-ahead keeps adding to what was typed, in milliseconds. */
const TYPE_AHEAD_MS = 600;

/** What a row's element id starts with; the rest is the field's id. */
export const ROW_ID_PREFIX = "outline-row-";

/** The id of the row an event happened on, if it happened on a row itself. */
export function rowIdOf(target: EventTarget): string | null {
  if (!(target instanceof HTMLElement)) return null;
  if (target.getAttribute("role") !== "treeitem") return null;
  return target.id.startsWith(ROW_ID_PREFIX)
    ? target.id.slice(ROW_ID_PREFIX.length)
    : null;
}

/** What carrying a command out needs. */
interface TreeKeyContext {
  rows: readonly VisibleRow[];
  actions: OutlineActions;
  focusRow: (id: string, scroll?: boolean) => void;
  toggle: (path: string) => void;
}

type Runner<K extends TreeCommand["kind"]> = (
  command: Extract<TreeCommand, { kind: K }>,
  row: VisibleRow,
  index: number
) => void;

export function useTreeKeyDown(
  context: TreeKeyContext
): (event: KeyboardEvent<HTMLDivElement>) => void {
  const typed = useRef({ text: "", at: 0 });
  const { rows, actions, focusRow, toggle } = context;

  const runners: { [K in TreeCommand["kind"]]: Runner<K> } = {
    focus: command => {
      const last = rows.length - 1;
      const target = rows[Math.max(0, Math.min(last, command.index))];
      if (target) focusRow(target.node.id, true);
    },
    toggle: (_, row) => toggle(row.node.path),
    "focus-parent": (_, row) => {
      if (row.node.parentId) focusRow(row.node.parentId, true);
    },
    select: (_, row) => actions.select(row.node.id),
    menu: (_, row) => actions.setMenuOpen(row.node.id),
    move: (command, row) => actions.move(row.node.id, command.delta),
    "add-after": (_, row) => actions.addAfter(row.node.id),
    "type-ahead": (command, _, index) => {
      const now = Date.now();
      const recent = now - typed.current.at < TYPE_AHEAD_MS;
      const text = recent ? typed.current.text + command.key : command.key;
      typed.current = { text, at: now };
      const found = typeAheadTarget(rows, index, text);
      if (found) focusRow(found.node.id, true);
    },
  };

  return event => {
    // The row the key was pressed on: the focused tree item, wherever focus
    // came from (a click, a key, or a script).
    const id = rowIdOf(event.target);
    const index = rows.findIndex(row => row.node.id === id);
    const row = rows[index];
    if (!row) return;
    const command = treeCommand(event, row, index, rows.length);
    if (!command) return;
    if (command.kind !== "type-ahead") event.preventDefault();
    (runners[command.kind] as Runner<typeof command.kind>)(command, row, index);
  };
}
