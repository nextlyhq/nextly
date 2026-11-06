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

/** The look being edited on its own, and the ways in and out. */
export interface LookEditingState {
  /** The look being edited, or `null` while blocks are edited. */
  readonly id: string | null;
  /** Edit this look on its own, leaving the selected block. */
  readonly edit: (lookId: string) => void;
  /** Back to editing blocks. */
  readonly exit: () => void;
}

export function useLookEditing(
  editor: Pick<EditorState, "selectedId" | "select">
): LookEditingState {
  const [id, setId] = useState<string | null>(null);
  const { select, selectedId } = editor;
  const edit = useCallback(
    (lookId: string) => {
      select(null);
      setId(lookId);
    },
    [select]
  );
  const exit = useCallback(() => setId(null), []);
  // A block selected while a look is edited is what the author edits next.
  useEffect(() => {
    if (selectedId !== null) setId(null);
  }, [selectedId]);
  return { id, edit, exit };
}
