/**
 * Copy, Cut and Paste for the selected blocks, as verbs every surface shares:
 * the keys, the block toolbar's menu, the canvas's right-click menu and the
 * command palette.
 *
 * The rules are `block-clipboard`'s and the clipboard is
 * `block-clipboard-transport`'s; this joins them to the editor, through the
 * editor's own apply, so a paste is one undo step and is refused by every
 * check any other edit meets.
 *
 * @module block-clipboard-verbs
 */

import type { ComponentLookup, NestingSource } from "@nextlyhq/blocks-engine";
import * as React from "react";

import {
  copyOfSelection,
  NOTHING_TO_PASTE,
  planPaste,
  readCopiedBlocks,
  serializeCopiedBlocks,
} from "./block-clipboard";
import { readClipboard, writeToClipboard } from "./block-clipboard-transport";
import type { EditorState } from "./editor-state";
import { lockSentence, UNDO_KEYS_SPOKEN } from "./keyboard-announcements";
import { registrySlotSource } from "./panels/add/inserter";
import { isRefusal, selectionDeletion, subjectOf } from "./selection-ops";

/** Where copied text goes: the system clipboard, or a clipboard event being handled. */
export type ClipboardWrite = (text: string) => void;

/** The three verbs, plus a paste of text a clipboard event already carries. */
export interface BlockClipboardVerbs {
  /** Copy the selected blocks; answers whether anything was copied. */
  readonly copy: (write?: ClipboardWrite) => boolean;
  /** Copy then remove the selected blocks, lock permitting; answers whether it did. */
  readonly cut: (write?: ClipboardWrite) => boolean;
  /** Paste what the clipboard holds, read from the clipboard. */
  readonly paste: () => void;
  /**
   * Paste text a paste event carries. Answers whether the text was copied
   * blocks, pasted or refused, so other text is left to the page.
   */
  readonly pasteText: (text: string) => boolean;
}

/** What the verbs need from the provider that offers them. */
export interface BlockClipboardOptions {
  /** The newest editor, read when a verb runs. */
  readonly latest: React.RefObject<EditorState>;
  /** Say something in the editor's live region. */
  readonly announce: (message: string) => void;
  /** Show a notice the author reads, for a paste that is refused. */
  readonly notify: (message: string) => void;
  readonly nesting: NestingSource;
  readonly components?: ComponentLookup | undefined;
}

/**
 * The address copied blocks are marked with and checked against: this
 * site's scheme, host and port.
 */
function siteOrigin(): string {
  return globalThis.location?.origin ?? "";
}

/** The editor's own document, where a menu's copy is asked for. */
function shellDocument(): Document | undefined {
  return typeof document === "undefined" ? undefined : document;
}

/** The system clipboard, through the editor's document. */
const systemWrite: ClipboardWrite = text => {
  const doc = shellDocument();
  if (doc !== undefined) writeToClipboard(doc, text);
};

export function useBlockClipboardVerbs({
  latest,
  announce,
  notify,
  nesting,
  components,
}: BlockClipboardOptions): BlockClipboardVerbs {
  const copy = React.useCallback(
    (write: ClipboardWrite = systemWrite): boolean => {
      const editorNow = latest.current;
      const ids = editorNow.selection.ids;
      const copied = copyOfSelection(editorNow.document, ids, siteOrigin());
      if (copied === null) return false;
      write(serializeCopiedBlocks(copied));
      announce(`${subjectOf(editorNow.document, ids)} copied.`);
      return true;
    },
    [latest, announce]
  );

  const cut = React.useCallback(
    (write: ClipboardWrite = systemWrite): boolean => {
      const editorNow = latest.current;
      const ids = editorNow.selection.ids;
      // The removal Delete plans, refused by the same locks in the same
      // words, so Cut never removes what Delete would keep.
      const plan = selectionDeletion(editorNow.document, ids);
      const copied = copyOfSelection(editorNow.document, ids, siteOrigin());
      if (plan === null || copied === null) return false;
      if (isRefusal(plan)) {
        announce(plan.reason);
        return false;
      }
      const locked = lockSentence(editorNow, plan.ops);
      if (locked !== null) {
        announce(locked);
        return false;
      }
      // Removed first and copied only once the editor took the removal, so a
      // refused cut leaves the clipboard as it was. One apply, one undo step.
      if (editorNow.applyAll(plan.ops) === null) return false;
      write(serializeCopiedBlocks(copied));
      editorNow.select(plan.nextSelection);
      announce(`${plan.subject} cut. Undo with ${UNDO_KEYS_SPOKEN}.`);
      return true;
    },
    [latest, announce]
  );

  const pasteText = React.useCallback(
    (text: string): boolean => {
      const read = readCopiedBlocks(text, siteOrigin());
      if (read === null) return false;
      if (read.refusal !== undefined) {
        notify(read.refusal);
        return true;
      }
      const editorNow = latest.current;
      const plan = planPaste(
        editorNow.document,
        editorNow.selectedId,
        read.blocks,
        {
          nesting,
          ...(components === undefined ? {} : { components }),
          slots: registrySlotSource(),
        }
      );
      if (plan.refusal !== undefined) {
        notify(plan.refusal);
        return true;
      }
      const locked = lockSentence(editorNow, plan.ops);
      if (locked !== null) {
        notify(locked);
        return true;
      }
      // The editor's apply judges room, placement and locks once more, and
      // tells the author itself when it refuses.
      const applied = editorNow.applyAll(plan.ops);
      if (applied === null) return true;
      // The copies are selected, as a duplicate's are, through the grammar a
      // click uses, so a second paste lands after them.
      const [first, ...rest] = plan.newIds;
      if (first !== undefined) {
        editorNow.select(first, "replace");
        for (const id of rest) editorNow.select(id, "toggle");
      }
      announce(
        `${subjectOf(applied, plan.newIds)} pasted. Undo with ${UNDO_KEYS_SPOKEN}.`
      );
      return true;
    },
    [latest, notify, announce, nesting, components]
  );

  const paste = React.useCallback(() => {
    const doc = shellDocument();
    if (doc === undefined) return;
    void readClipboard(doc).then(text => {
      if (text === undefined || !pasteText(text)) notify(NOTHING_TO_PASTE);
    });
  }, [pasteText, notify]);

  return React.useMemo(
    () => ({ copy, cut, paste, pasteText }),
    [copy, cut, paste, pasteText]
  );
}
