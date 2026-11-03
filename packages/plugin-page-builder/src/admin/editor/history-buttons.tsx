"use client";

/**
 * Undo and redo in the editor's top bar.
 *
 * Each press takes one step of the document's history, the same history
 * mod+z and mod+shift+z walk. An inline text edit still open on the canvas is
 * committed first: its words are not a step in the history until they are, so
 * undoing without the commit would rewind the change before them and leave the
 * words in place.
 *
 * What the commit came to decides the rest:
 * - **Refused or unavailable**: the passage stays open because its words exist
 *   nowhere else, so nothing is taken from the history underneath it.
 * - **Written**: the words are now the newest step. Undo takes them back. Redo
 *   has nothing left to repeat, because a new step ends the branch it would
 *   have replayed, as in every editor once the author types.
 *
 * @module admin/editor/history-buttons
 */
import type { InlineEditOutcome } from "@nextlyhq/builder/shell";
import { detectApplePlatform } from "@nextlyhq/ui";
import { Redo2, Undo2 } from "lucide-react";
import * as React from "react";

const BUTTON_CLASS =
  "focus-visible:ring-ring rounded-md p-1.5 focus-visible:ring-2 focus-visible:outline-none disabled:opacity-40";

/** Whether the commit left the passage open, so the history must not move. */
function heldOpen(outcome: InlineEditOutcome): boolean {
  return outcome.status === "refused" || outcome.status === "unavailable";
}

/**
 * The shortcut each tooltip names, once the platform is known.
 *
 * Resolved after mounting: `detectApplePlatform` reads `navigator`, which a
 * server render does not have, so naming the keys during render would emit
 * Ctrl on the server and ⌘ in a Mac's first render, and React would find a
 * tooltip it did not produce. Until then the tooltip names the action alone.
 */
function useShortcutLabels(): { undo: string; redo: string } | null {
  const [apple, setApple] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    setApple(detectApplePlatform());
  }, []);
  if (apple === null) return null;
  return apple
    ? { undo: "⌘Z", redo: "⇧⌘Z" }
    : { undo: "Ctrl+Z", redo: "Ctrl+Y" };
}

export function HistoryButtons({
  editor,
  inline,
}: {
  editor: {
    canUndo: boolean;
    canRedo: boolean;
    undo: () => void;
    redo: () => void;
  };
  inline: {
    commit: () => InlineEditOutcome;
    editing: unknown;
    editingRich: unknown;
    inspecting?: boolean;
  };
}): React.JSX.Element {
  const keys = useShortcutLabels();
  // An open inline edit is a step the history does not hold yet: Undo takes
  // it back once committed, so it is offered even on a fresh document.
  // An inspector field's open passage too: Undo commits it and takes it back.
  const editingInline =
    inline.editing !== null ||
    inline.editingRich !== null ||
    inline.inspecting === true;
  const undo = () => {
    if (heldOpen(inline.commit())) return;
    editor.undo();
  };
  const redo = () => {
    const outcome = inline.commit();
    if (heldOpen(outcome) || outcome.status === "written") return;
    editor.redo();
  };
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <button
        type="button"
        aria-label="Undo"
        title={keys === null ? "Undo" : `Undo (${keys.undo})`}
        disabled={!editor.canUndo && !editingInline}
        onClick={undo}
        className={BUTTON_CLASS}
      >
        <Undo2 className="size-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label="Redo"
        title={keys === null ? "Redo" : `Redo (${keys.redo})`}
        disabled={!editor.canRedo}
        onClick={redo}
        className={BUTTON_CLASS}
      >
        <Redo2 className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
