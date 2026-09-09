/**
 * The verbs for the current selection, as every pointer surface asks for them.
 *
 * The bar and the right-click menu draw different things and decide nothing:
 * both take the list from `toolbarActions`, and both have to ask it the same
 * question — the whole selection, judged by the rules the host supplied. Written
 * out at each of them, that question was four lines duplicated, and duplicated
 * lines are how one surface came to ask a narrower question than the other in
 * the first place.
 *
 * A hook rather than a helper, because two thirds of the question are context: a
 * surface cannot ask about the host's rules without reading them, and cannot
 * memoise the answer without a hook to memoise in.
 *
 * @module selection-actions
 */

import * as React from "react";

import type { EditorState } from "./editor-state";
import { useNestingSource } from "./keyboard-actions";
import { toolbarActions, type ToolbarAction } from "./toolbar-actions";

/**
 * What to offer for this editor's selection, recomputed only when it changes.
 *
 * Memoised on the parts rather than on `editor`, which is a fresh object every
 * render: depending on it would rebuild the list on every frame of a drag, and
 * the menu keys its rows on identity.
 */
export function useSelectionActions(editor: EditorState): ToolbarAction[] {
  const { document, selectedId } = editor;
  const selectedIds = editor.selection.ids;
  const nesting = useNestingSource();
  return React.useMemo(
    () => toolbarActions(document, selectedId, selectedIds, nesting),
    [document, selectedId, selectedIds, nesting]
  );
}
