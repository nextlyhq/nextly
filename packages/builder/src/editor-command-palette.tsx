"use client";

/**
 * The editor's command palette, assembled and mounted.
 *
 * `CommandPalette` is the surface and `builderCommands` is the list; this is
 * the one piece that knows both, and it exists so a host does not have to.
 * Mounting the palette otherwise means reaching into the verbs context,
 * rebuilding the command array on the right renders, and knowing that the
 * palette must sit inside `BlockKeyboardActions` — three things every host
 * would have to get right, and would get right differently.
 *
 * **It was the missing piece.** `CommandPalette` shipped and was tested and was
 * exported, and no host ever mounted it — so the editor advertised a command
 * palette that no author could open. Pressing `mod+k` in the admin opens
 * `@nextlyhq/admin`'s palette instead, which is the reason the gap survived a
 * browser check: something opens, so the feature looks present.
 *
 * @module editor-command-palette
 */

import * as React from "react";

import { builderCommands } from "./builder-commands";
import { CommandPalette } from "./command-palette";
import type { EditorState } from "./editor-state";
import { useBlockActionsContext } from "./keyboard-actions";

export interface EditorCommandPaletteProps {
  /** The editor whose state the commands read and change. */
  editor: EditorState;
  /**
   * Leaving the editor, when the host has somewhere to go.
   *
   * Omitted where there is nowhere — the editor embedded in a form that is
   * already on screen — and the palette then offers no way out rather than a
   * command that does nothing. Passed to `builderCommands`, which makes the
   * same distinction the shell's exit affordance does.
   */
  onExit?: () => void;
}

export function EditorCommandPalette({
  editor,
  onExit,
}: EditorCommandPaletteProps): React.JSX.Element {
  const verbs = useBlockActionsContext();

  /*
   * Rebuilt when what it OFFERS could have changed, which is the document, the
   * selection and the history's two flags.
   *
   * `editor` as a whole would be the obvious dependency and is the wrong one:
   * the store hands back a fresh object on every render, so the list would be
   * rebuilt on every frame of a panel drag — and `CommandPalette` keys its rows
   * on identity, so a list rebuilt mid-search is a list that loses the row the
   * author had highlighted.
   */
  const commands = React.useMemo(
    () =>
      builderCommands({
        document: editor.document,
        selectedId: editor.selectedId,
        verbs,
        undo: editor.undo,
        redo: editor.redo,
        canUndo: editor.canUndo,
        canRedo: editor.canRedo,
        onExit,
      }),
    [
      editor.document,
      editor.selectedId,
      editor.undo,
      editor.redo,
      editor.canUndo,
      editor.canRedo,
      verbs,
      onExit,
    ]
  );

  return <CommandPalette commands={commands} />;
}
