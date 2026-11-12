/**
 * What the outline asks of the page, and what a row's menu can do: one set of
 * field actions, which both extend, so the two cannot name the same action
 * differently.
 */
import type { FieldInsertPosition } from "@admin/lib/builder/insert-field";

/** The changes a person can ask for on one field. */
interface OutlineFieldActions {
  move: (id: string, delta: -1 | 1) => void;
  duplicate: (id: string) => void;
  remove: (id: string) => void;
  setHidden: (id: string, hidden: boolean) => void;
  openFieldGroup: (slug: string) => void;
}

/** What the outline asks of the page. */
export interface OutlineCallbacks extends OutlineFieldActions {
  select: (id: string) => void;
  /** Open the picker for a new field at `position`. */
  addAt: (position: FieldInsertPosition) => void;
}

/** What a row's menu can do. One object for every row, so rows stay memoized. */
export interface OutlineActions extends OutlineFieldActions {
  setMenuOpen: (id: string | null) => void;
  /** Put focus back on a row, after its menu closes. */
  focusRow: (id: string) => void;
  select: (id: string) => void;
  addInside: (id: string) => void;
  addAfter: (id: string) => void;
  canMove: (id: string, delta: -1 | 1) => boolean;
}
