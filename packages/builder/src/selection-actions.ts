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
import {
  useNestingSource,
  useSelectionActionsContext,
} from "./keyboard-actions";
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
  const shared = useSelectionActionsContext();

  /*
   * The provider's answer where there is one, and this surface's own where
   * there is not — decided INSIDE the memo, which is what makes it both lazy
   * and correct.
   *
   * Lazy, because `??` short-circuits: with a provider above, `toolbarActions`
   * is never called here at all. That is the point — deciding whether a
   * selection can be SAVED builds the document a save would store, so three
   * surfaces computing it separately made an ordinary edit clone and walk a
   * large selection three times.
   *
   * Correct, because every input the fallback reads is a dependency. Written as
   * a thunk memoised on the context alone, a surface with no provider kept its
   * first answer for ever, and the suppression that made that compile was
   * hiding it.
   */
  return React.useMemo(
    () => shared ?? toolbarActions(document, selectedId, selectedIds, nesting),
    [shared, document, selectedId, selectedIds, nesting]
  );
}
