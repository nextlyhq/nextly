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

import { toolbarActions, type ToolbarAction } from "./canvas/toolbar-actions";
import type { EditorState } from "./editor-state";
import {
  useNestingSource,
  useSelectionActionsContext,
} from "./keyboard-actions";
import type { SelectionVerbs } from "./selection-offer";

/**
 * What to offer for this editor's selection, recomputed only when it changes.
 *
 * `locks` says whether to ask the locks too: false for what a surface shows
 * as the selection changes, true for a menu that is opening, whose items an
 * author is about to choose between. Asking them means trying each verb's
 * edit on a copy of the page, so it is asked only where its answer is read.
 *
 * Memoised on the parts rather than on `editor`, which is a fresh object every
 * render: depending on it would rebuild the list on every frame of a drag, and
 * the menu keys its rows on identity.
 */
export function useSelectionActions(
  editor: EditorState,
  locks: boolean = false
): ToolbarAction[] {
  return useSelectionVerbs(editor, locks).actions;
}

/**
 * The verbs and the block menu's depth moves, as {@link useSelectionActions}
 * decides them.
 */
export function useSelectionVerbs(
  editor: EditorState,
  locks: boolean
): SelectionVerbs {
  const { document, selectedId } = editor;
  const selectedIds = editor.selection.ids;
  const nesting = useNestingSource();
  const shared = useSelectionActionsContext();
  const ask = locks ? editor.lockRefusalFor : undefined;

  /*
   * The provider's answer where there is one, and this surface's own where
   * there is not — decided INSIDE the memo, which is what makes it both lazy
   * and correct.
   *
   * Lazy, because with a provider above, `toolbarActions` is never called
   * here at all. That is the point — deciding whether a selection can be
   * SAVED builds the document a save would store, so three surfaces computing
   * it separately made an ordinary edit clone and walk a large selection three
   * times. The provider also keeps its lock answers, so a second menu reads
   * the first one's.
   *
   * Correct, because every input the fallback reads is a dependency. Written as
   * a thunk memoised on the context alone, a surface with no provider kept its
   * first answer for ever, and the suppression that made that compile was
   * hiding it.
   *
   * Outside a provider there is no move verb to judge depth moves with, so
   * none are offered.
   */
  return React.useMemo(() => {
    if (shared !== null) return locks ? shared.withLocks() : shared;
    return {
      actions: toolbarActions(
        document,
        selectedId,
        selectedIds,
        nesting,
        undefined,
        ask,
        undefined,
        false,
        undefined,
        locks
      ),
      depthMoves: [],
    };
  }, [shared, locks, document, selectedId, selectedIds, nesting, ask]);
}
