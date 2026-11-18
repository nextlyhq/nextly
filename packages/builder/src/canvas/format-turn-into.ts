/**
 * The format bar's "Turn into", for the block whose words are being edited.
 *
 * The choices are the block menu's own (`turnIntoOffers`), asked of the page
 * as it would stand with the words typed so far, so what a choice says it
 * removes is about those words. Choosing one finishes the edit first, then
 * turns the block in the page the edit wrote: the words typed are what is
 * turned, and the turn is its own undo step after the edit's.
 *
 * Not offered for a component's exposed words, which are a placement's value
 * rather than a block of their own, nor for a block that turns into nothing.
 *
 * @module format-turn-into
 */

import { applyOp, type BlockDocument } from "@nextlyhq/blocks-engine";

import type { EditorState } from "../editor-state";
import { runTurnInto, turnIntoOffers } from "../turn-into-verb";

import type { FormatTurnInto } from "./format-bar-state";
import type { InlineEditOutcome } from "./inline-edit-outcome";
import { passageOp, type RichPassageAddress } from "./rich-passage";

/** The passage being edited, as the turn reads it. */
export interface TypedPassage {
  readonly editing: RichPassageAddress;
  /** The words as typed so far. */
  readonly words: unknown;
  readonly baseline: unknown;
  readonly opened: unknown;
}

/** What the format bar's "Turn into" is built from. */
export interface FormatTurnIntoSource {
  readonly editing: RichPassageAddress;
  /** The editor as it stands now. */
  readonly editor: () => EditorState;
  /** The passage as typed so far, or `null` once it is no longer open. */
  readonly typed: () => TypedPassage | null;
  /** Finish the edit, writing the words, as leaving the passage does. */
  readonly commit: () => InlineEditOutcome;
}

/** The page as it would stand with the words typed so far written. */
function pageAsTyped(editor: EditorState, typed: TypedPassage | null) {
  if (typed === null) return editor.document;
  const op = passageOp(
    editor,
    typed.editing,
    typed.words,
    typed.baseline,
    typed.opened
  );
  if (op === null) return editor.document;
  try {
    return applyOp(editor.document, op).document;
  } catch {
    return editor.document;
  }
}

/** The page a finished edit left, or `null` when it was not finished. */
function pageAfter(
  outcome: InlineEditOutcome,
  editor: EditorState
): BlockDocument | null {
  if (outcome.status === "written") return outcome.document;
  if (outcome.status === "unchanged") return editor.document;
  return null;
}

/** The format bar's "Turn into" for a passage, or nothing where none. */
export function formatTurnInto(
  source: FormatTurnIntoSource
): FormatTurnInto | undefined {
  const { editing } = source;
  if (editing.exposure !== undefined) return undefined;
  const offered = turnIntoOffers(source.editor().document, editing.nodeId);
  if (offered.length === 0) return undefined;
  return {
    choices: () => {
      const editor = source.editor();
      return turnIntoOffers(pageAsTyped(editor, source.typed()), editing.nodeId, {
        ask: editor.lockRefusalFor,
        planned: true,
      });
    },
    run: to => {
      const editor = source.editor();
      const page = pageAfter(source.commit(), editor);
      if (page === null) return;
      runTurnInto(
        {
          document: page,
          apply: editor.apply,
          lockRefusalFor: editor.lockRefusalFor,
        },
        editing.nodeId,
        to,
        // What the turn removes was said beside the choice, and a refusal
        // the page gives is said by the editor's own notices.
        () => undefined
      );
    },
  };
}
