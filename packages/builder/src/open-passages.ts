/**
 * The passages an inspector field holds open in the shared rich-text editor.
 *
 * While a passage is open its words exist only in that editor, and they reach
 * the document when the field is left. A Save or an exit that came first would
 * store the document without them. So a field holding a passage says so here,
 * and whoever finishes the canvas's open edit before storing the document
 * (`useInlineEditing`'s `commit`) finishes these too, through the field's own
 * commit, and is handed the document that commit wrote.
 *
 * One registry per editor, made by the host and lent both to the inspector and
 * to the inline editing it finishes: the two never import each other.
 *
 * @module open-passages
 */

import type { BlockDocument } from "@nextlyhq/blocks-engine";

/** How a field finishes its passage: the document its write produced, if any. */
export type FinishPassage = () => BlockDocument | null | void;

export interface OpenPassages {
  /** Hold a passage open; the answer releases it. */
  hold(finish: FinishPassage): () => void;
  /**
   * Finish every passage held, in the order they opened, and answer the
   * document the last write produced, or `null` when none wrote.
   */
  finishAll(): BlockDocument | null;
  /** Whether any passage is open, which is unsaved work. */
  isOpen(): boolean;
  /** Told whenever a passage opens or closes. */
  subscribe(listener: () => void): () => void;
}

/** A fresh registry, for one editor. */
export function createOpenPassages(): OpenPassages {
  const held = new Set<{ finish: FinishPassage }>();
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of [...listeners]) listener();
  };
  return {
    hold(finish) {
      const entry = { finish };
      held.add(entry);
      changed();
      return () => {
        if (held.delete(entry)) changed();
      };
    },
    finishAll() {
      let written: BlockDocument | null = null;
      // Copied first: a field releases its hold as it finishes.
      for (const entry of [...held]) {
        const document = entry.finish();
        if (document !== null && document !== undefined) written = document;
      }
      return written;
    },
    isOpen: () => held.size > 0,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
