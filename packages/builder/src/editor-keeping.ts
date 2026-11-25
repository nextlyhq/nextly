"use client";

/**
 * An editor's state kept across a remount of the same document.
 *
 * A host can unmount its editor for a while and mount it again on the same
 * document: the Page Builder draws a read-only page in its place while the
 * document's lock is lost, and the editor again once the lock is back. A new
 * mount starts with an empty history, so the author's undo would be gone. The
 * host instead keeps what the editor hands it as it unmounts, and hands that
 * to the next mount, which carries on with the same undo, redo and selection.
 *
 * Only onto the very document the history was built against. Each entry is
 * an inverse of an edit of that document, so replayed onto any other (someone
 * else's change loaded meanwhile) it would put back content the author is no
 * longer looking at. A mount opened on another document starts fresh.
 *
 * @module editor-keeping
 */
import type { BlockDocument } from "@nextlyhq/blocks-engine";
import { useEffect, useRef, useState, type RefObject } from "react";

import { pruneSelection, type BlockSelection } from "./canvas/selection";
import { seedOf, useHistoryStacks, type KeptHistory } from "./editor-history";

/**
 * What an editor kept as it unmounted: the document it held then, its
 * selection, and its history. Opaque to a host, which only holds it and hands
 * it back.
 * @experimental
 */
export interface KeptEditorState {
  readonly document: BlockDocument;
  readonly selection: BlockSelection;
  readonly history: KeptHistory;
}

/**
 * How a host keeps an editor's state across a remount: what an earlier mount
 * kept, if anything, and where this mount hands its own as it unmounts.
 * @experimental
 */
export interface EditorStateKeeping {
  /** What an earlier mount kept, started from only on the same document. */
  readonly kept?: KeptEditorState | undefined;
  /** Told, as the editor unmounts, what a later mount may start from. */
  readonly keep: (state: KeptEditorState) => void;
}

/**
 * Whether a mount opened on `document` starts from `kept`: only when the two
 * documents are the same value, whatever order their keys arrived in (a form
 * hands back a copy). A host asks this to know whether its own state kept
 * beside the editor's (a save point) still holds.
 * @experimental
 */
export function startsFromKept(
  kept: KeptEditorState | undefined,
  document: BlockDocument
): boolean {
  return kept !== undefined && sameValue(kept.document, document);
}

/**
 * Whether two JSON values are the same: equal primitives, arrays equal item by
 * item, and objects with the same keys holding the same values, in any order.
 * A key holding `undefined` counts as absent, as it does once stored.
 */
function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!isObject(left) || !isObject(right)) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return sameArray(left, right);
  }
  return sameObject(left, right);
}

/** Whether a value is an object or an array (not null). */
function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

/** Two arrays the same item by item; anything else beside an array is not. */
function sameArray(left: object, right: object): boolean {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;
  return left.every((item, at) => sameValue(item, right[at]));
}

/** Two objects with the same keys holding the same values, in any order. */
function sameObject(left: object, right: object): boolean {
  const leftEntries = definedEntries(left);
  const rightValues = new Map(definedEntries(right));
  if (leftEntries.length !== rightValues.size) return false;
  return leftEntries.every(
    ([key, value]) =>
      rightValues.has(key) && sameValue(value, rightValues.get(key))
  );
}

/** An object's entries, leaving out a key that holds `undefined`. */
function definedEntries(value: object): [string, unknown][] {
  return Object.entries(value).filter(([, inner]) => inner !== undefined);
}

/**
 * The history this mount starts with, and what it started from: decided once,
 * as it mounts. The kept state when it was kept on this same document, its
 * selection pruned to the document as every selection is; else an empty
 * history and nothing.
 */
export function useSeededHistory(
  keeping: EditorStateKeeping | undefined,
  initialDocument: BlockDocument
): {
  start: KeptEditorState | undefined;
  history: ReturnType<typeof useHistoryStacks>;
} {
  const [start] = useState(() => {
    const kept = keeping?.kept;
    if (kept === undefined || !startsFromKept(kept, initialDocument)) {
      return undefined;
    }
    return {
      state: {
        ...kept,
        selection: pruneSelection(initialDocument, kept.selection),
      },
      seed: seedOf(kept.history),
    };
  });
  return { start: start?.state, history: useHistoryStacks(start?.seed) };
}

/**
 * Hand the host this editor's state as it unmounts. A passive effect's
 * cleanup, so it runs after the host's own layout cleanups have finished an
 * open passage into the document, and what is kept holds it. Read through
 * refs, which hold the document and selection as they are at that moment.
 */
export function useKeepOnUnmount(
  keeping: EditorStateKeeping | undefined,
  document: RefObject<BlockDocument>,
  selection: RefObject<BlockSelection>,
  history: () => KeptHistory
): void {
  const latest = useRef({ keeping, history });
  latest.current = { keeping, history };
  useEffect(
    () => () => {
      const held = latest.current;
      held.keeping?.keep({
        document: document.current,
        selection: selection.current,
        history: held.history(),
      });
    },
    [document, selection]
  );
}
