/**
 * Which look the inspector edits on its own, chosen from the Design panel's
 * Block looks group, held once for the two surfaces that read it: the Design
 * panel marks the chosen row, and the inspector edits the look.
 *
 * Choosing a look leaves the selected block, so the inspector has no block to
 * edit and edits the look instead. Selecting a block again leaves the look, so
 * an author is never editing a look while a block shows as selected.
 *
 * @module look-editing
 */

import type { EditorState } from "@nextlyhq/builder/shell";
import { useCallback, useEffect, useState } from "react";

/**
 * A look, by its id and its block type: two block types' own looks may share
 * an id, so the type is what tells them apart.
 */
export interface EditedLook {
  readonly id: string;
  readonly blockType: string;
}

/** The look being edited on its own, and the ways in and out. */
export interface LookEditingState {
  /** The look being edited, or `null` while blocks are edited. */
  readonly look: EditedLook | null;
  /** Edit this look on its own, leaving the selected block. */
  readonly edit: (look: EditedLook) => void;
  /** Back to editing blocks. */
  readonly exit: () => void;
}

export function useLookEditing(
  editor: Pick<EditorState, "selectedId" | "select">
): LookEditingState {
  const [look, setLook] = useState<EditedLook | null>(null);
  const { select, selectedId } = editor;
  const edit = useCallback(
    (next: EditedLook) => {
      select(null);
      setLook(next);
    },
    [select]
  );
  const exit = useCallback(() => setLook(null), []);
  // A block selected while a look is edited is what the author edits next.
  useEffect(() => {
    if (selectedId !== null) setLook(null);
  }, [selectedId]);
  return { look, edit, exit };
}
