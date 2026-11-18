/**
 * Which entry of each list the author last clicked on the canvas, for the
 * block that click selected: the binding picker shows that entry's values
 * beside a list item's fields, else the first entry's.
 *
 * Read from the element pressed, as the canvas draws it: a list draws each
 * entry as a box of its own, without a node id, straight inside the list's
 * element. Kept only while the block the click selected stays selected, so
 * a block selected another way (from Layers, by key) samples the first
 * entry, as before.
 * Editor state only, never stored.
 *
 * @module clicked-entry
 */
import {
  blockTypeClassName,
  COLLECTION_LIST_TYPE,
} from "@nextlyhq/blocks-engine";
import { NODE_ID_ATTRIBUTE } from "@nextlyhq/blocks-react";
import * as React from "react";

import { isElement } from "./dom-kind";
import { CANVAS_ROOT_CLASS } from "./shell-state";

/** The class a list's element and each of its entries carry. */
const LIST_CLASS = blockTypeClassName(COLLECTION_LIST_TYPE);

/** The entries clicked, by list id, for the block the click selected. */
interface Clicked {
  readonly nodeId: string;
  readonly entries: ReadonlyMap<string, number>;
}

let clicked: Clicked | undefined;
const listeners = new Set<() => void>();

/** Whether `element` is one entry a list drew: no node of its own, in a list. */
function isListEntry(element: Element): boolean {
  const list = element.parentElement;
  return (
    list !== null &&
    !element.hasAttribute(NODE_ID_ATTRIBUTE) &&
    element.classList.contains(LIST_CLASS) &&
    list.hasAttribute(NODE_ID_ATTRIBUTE) &&
    list.classList.contains(LIST_CLASS)
  );
}

/** The entry's place among its list's entries, from 0. */
function placeOf(entry: Element): number {
  let place = 0;
  for (
    let before = entry.previousElementSibling;
    before !== null;
    before = before.previousElementSibling
  ) {
    if (isListEntry(before)) place += 1;
  }
  return place;
}

/**
 * The entry of each list around `target`, by the list's id, innermost
 * first; none for an element outside the canvas.
 */
function entriesAround(target: unknown): ReadonlyMap<string, number> {
  const entries = new Map<string, number>();
  if (!isElement(target)) return entries;
  const canvas = target.closest(`.${CANVAS_ROOT_CLASS}`);
  if (canvas === null) return entries;
  // Bounded by the canvas: each step moves one element out.
  for (
    let at: Element | null = target;
    at !== null && at !== canvas;
    at = at.parentElement
  ) {
    if (!isListEntry(at)) continue;
    const listId = at.parentElement?.getAttribute(NODE_ID_ATTRIBUTE);
    if (listId != null && !entries.has(listId)) {
      entries.set(listId, placeOf(at));
    }
  }
  return entries;
}

/**
 * Keep the entries `target` sits in for `nodeId`, the block a click on it
 * selected; a click that selected nothing, or nothing in a list, forgets them.
 */
export function rememberClickedEntries(
  nodeId: string | null,
  target: unknown
): void {
  const entries = entriesAround(target);
  const next =
    nodeId === null || entries.size === 0 ? undefined : { nodeId, entries };
  if (next === undefined && clicked === undefined) return;
  clicked = next;
  for (const listener of listeners) listener();
}

/**
 * Keep the clicked entries only while the block they were kept for is
 * selected: a selection made another way (Layers, the keyboard) to any
 * other block forgets them, so coming back to the block from there samples
 * the first entry.
 */
export function keepClickedEntriesFor(selected: readonly string[]): void {
  if (clicked === undefined || selected.includes(clicked.nodeId)) return;
  forgetClickedEntries();
}

/** Forget every clicked entry. */
export function forgetClickedEntries(): void {
  rememberClickedEntries(null, null);
}

/**
 * The entry of list `listId` the author clicked to select `nodeId`, or
 * `undefined` where the block was selected another way.
 */
export function clickedEntryOf(
  nodeId: string,
  listId: string
): number | undefined {
  return clicked?.nodeId === nodeId ? clicked.entries.get(listId) : undefined;
}

/** {@link clickedEntryOf}, drawn again when the author clicks elsewhere. */
export function useClickedEntry(
  nodeId: string,
  listId: string | undefined
): number | undefined {
  const subscribe = React.useCallback((listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return React.useSyncExternalStore(subscribe, () =>
    listId === undefined ? undefined : clickedEntryOf(nodeId, listId)
  );
}
