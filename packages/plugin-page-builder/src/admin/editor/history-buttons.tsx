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
 * @module admin/editor/history-buttons
 */
import type { InlineEditOutcome } from "@nextlyhq/builder/shell";
import { detectApplePlatform } from "@nextlyhq/ui";
import { Redo2, Undo2 } from "lucide-react";
import type * as React from "react";

const BUTTON_CLASS =
  "focus-visible:ring-ring rounded-md p-1.5 focus-visible:ring-2 focus-visible:outline-none disabled:opacity-40";

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
  inline: { commit: () => InlineEditOutcome };
}): React.JSX.Element {
  // Read at render, in the browser: the buttons are drawn only inside the
  // editor, which mounts on the client.
  const apple = detectApplePlatform();
  const step = (take: () => void) => () => {
    inline.commit();
    take();
  };
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <button
        type="button"
        aria-label="Undo"
        title={`Undo (${apple ? "⌘Z" : "Ctrl+Z"})`}
        disabled={!editor.canUndo}
        onClick={step(editor.undo)}
        className={BUTTON_CLASS}
      >
        <Undo2 className="size-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label="Redo"
        title={`Redo (${apple ? "⇧⌘Z" : "Ctrl+Y"})`}
        disabled={!editor.canRedo}
        onClick={step(editor.redo)}
        className={BUTTON_CLASS}
      >
        <Redo2 className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
