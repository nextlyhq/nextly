/**
 * "Copy style" and "Paste style" for the selected blocks, as verbs every
 * surface shares: the block toolbar's menu, the canvas's right-click menu and
 * the command palette.
 *
 * The copy is held here, for as long as the editor is open; the paste goes
 * through the editor's own apply as one group, so it is one undo step
 * however many blocks it reaches and is refused by every check any other
 * edit meets. It writes the blocks' own styles and classes only, never a
 * shared style, whatever the Style tab's editing bar targets: a paste that
 * changed a shared style would change every block wearing it, on every page.
 *
 * @module style-clipboard-verbs
 */

import type { AnyBlockDefinition, NamedClass } from "@nextlyhq/blocks-engine";
import { findNode } from "@nextlyhq/blocks-engine";
import * as React from "react";

import { batchStylePasteOps, type StyleSource } from "./batch-style";
import type { EditorState } from "./editor-state";
import { designReadOnlyReason, lockViewOf } from "./inspector";
import { lockSentence, UNDO_KEYS_SPOKEN } from "./keyboard-announcements";
import { subjectOf } from "./selection-ops";
import {
  copiedStyleOf,
  NOTHING_COPIED_YET,
  skippedSettingsWords,
} from "./style-clipboard";

/** The two verbs. */
export interface StyleClipboardVerbs {
  /** Copy the one selected block's style; answers whether it did. */
  readonly copyStyle: () => boolean;
  /** Give every selected block the copied style, as one undo step. */
  readonly pasteStyle: () => void;
}

/** What the verbs need from the provider that offers them. */
export interface StyleClipboardOptions {
  /** The newest editor, read when a verb runs. */
  readonly latest: React.RefObject<EditorState>;
  /** Say something in the editor's live region. */
  readonly announce: (message: string) => void;
  /** Show a notice the author reads. */
  readonly notify: (message: string) => void;
  /** The site's styles, to tell block styles and text styles apart. */
  readonly library?: readonly NamedClass[] | undefined;
  /** Where block definitions are read: the registry, unless told. */
  readonly definitions?: (type: string) => AnyBlockDefinition | undefined;
}

export function useStyleClipboardVerbs({
  latest,
  announce,
  notify,
  library,
  definitions,
}: StyleClipboardOptions): StyleClipboardVerbs {
  // A ref rather than state: nothing is drawn from it, since "Paste style"
  // is always offered and says what to do when nothing was copied.
  const copied = React.useRef<StyleSource | null>(null);

  const copyStyle = React.useCallback((): boolean => {
    const editorNow = latest.current;
    const ids = editorNow.selection.ids;
    const [only] = ids;
    // One block's look: with several selected, there is no one to copy.
    if (ids.length !== 1 || only === undefined) return false;
    const style = copiedStyleOf(editorNow.document, only);
    if (style === null) return false;
    copied.current = style;
    announce(`Style copied from ${subjectOf(editorNow.document, ids)}.`);
    return true;
  }, [latest, announce]);

  const pasteStyle = React.useCallback(() => {
    const source = copied.current;
    if (source === null) {
      notify(NOTHING_COPIED_YET);
      return;
    }
    const editorNow = latest.current;
    const { document } = editorNow;
    const ids = editorNow.selection.ids;
    const view = lockViewOf(editorNow);
    // ONE held block refuses the whole paste, as one lock refuses a delete
    // of several: the group is applied whole or not at all.
    for (const id of ids) {
      const held = designReadOnlyReason(document, id, view);
      if (held !== undefined) {
        notify(held);
        return;
      }
    }
    const nodes = ids.flatMap(id => {
      const node = findNode(document.nodes, id);
      return node === undefined ? [] : [node];
    });
    if (nodes.length === 0) return;
    const plan = batchStylePasteOps(nodes, source, {
      library,
      ...(definitions === undefined ? {} : { definitions }),
    });
    const skipped = skippedSettingsWords(plan.skipped, definitions);
    // Shown as well as said: nothing on the page shows a setting that didn't
    // arrive.
    const sayExplained = (words: string): void => {
      notify(words);
      announce(words);
    };
    if (plan.ops.length === 0) {
      if (skipped !== undefined) sayExplained(skipped);
      else
        announce(
          nodes.length === 1
            ? "This block already has this style."
            : "These blocks already have this style."
        );
      return;
    }
    const locked = lockSentence(editorNow, plan.ops);
    if (locked !== null) {
      notify(locked);
      return;
    }
    // The editor's apply judges the page once more; it says itself why it
    // refuses.
    if (editorNow.applyAll(plan.ops) === null) return;
    if (skipped !== undefined) notify(skipped);
    announce(
      [
        `Style pasted on ${subjectOf(document, ids)}.`,
        ...(skipped === undefined ? [] : [skipped]),
        `Undo with ${UNDO_KEYS_SPOKEN}.`,
      ].join(" ")
    );
  }, [latest, announce, notify, library, definitions]);

  return React.useMemo(
    () => ({ copyStyle, pasteStyle }),
    [copyStyle, pasteStyle]
  );
}
