"use client";

/**
 * The editor's document state: what is being edited, what is selected, and how
 * to take an edit back.
 *
 * The op layer already answers "what does this edit do to the document" and
 * hands back an inverse with every application. What was missing is the thing
 * that HOLDS the answer — so every consumer that wanted to edit had to keep its
 * own copy of the document, its own idea of the selection, and its own undo
 * stack. Three of those disagree the moment one of them applies an op the
 * others do not see.
 *
 * So this is deliberately the only place a document changes. A panel, a canvas,
 * a keyboard handler and an agent all reach the same `apply`, and undo works
 * for all of them because it is built from what the op layer actually did
 * rather than from what each caller believed it was doing.
 *
 * **Undo is the op layer's inverse, not a snapshot of the document.** Snapshots
 * are the obvious design and they are wrong here for a reason that shows up
 * late: a document is a tree of unbounded size, so a stack of snapshots grows
 * with page size times history depth, and the copies are of a value that is
 * mostly unchanged between steps. An inverse is one op. It also composes with
 * anything else that produces ops — a collaborative stream, a replayed agent
 * edit — which a snapshot stack does not.
 *
 * @module editor-state
 */

import type { BlockDocument, DocumentLimits } from "@nextlyhq/blocks-engine";
import { useCallback, useMemo, useRef, useState } from "react";

import { applyOp, type BuilderOp } from "./ops";

/** How deep the undo history goes before the oldest step is dropped. */
export const MAX_HISTORY = 100;

export interface EditorState {
  /** The document as it currently stands. */
  document: BlockDocument;
  /** The selected node's id, or null when nothing is selected. */
  selectedId: string | null;
  /** Select a node, or clear the selection with null. */
  select: (id: string | null) => void;
  /**
   * Apply an edit. Returns the applied op's outcome, or null when the op was
   * refused — a caller that needs to know whether its edit landed can ask,
   * rather than comparing documents afterwards.
   */
  apply: (op: BuilderOp) => BlockDocument | null;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /**
   * How many edits are on the undo stack.
   *
   * Exported because "did anything change" is not answerable from the document
   * alone: an edit and its undo leave a document equal to the original but not
   * identical to it, so a host comparing references sees a change and a host
   * comparing values misses a real one. A depth is the honest signal, and a
   * test can read it — which a boolean derived inside a component cannot.
   */
  undoDepth: number;
}

export interface UseEditorStateArgs {
  /** The document to start from. */
  initialDocument: BlockDocument;
  /** The caps this site holds its documents to. */
  limits?: DocumentLimits;
}

/**
 * Hold a document and the edits made to it.
 *
 * The document is state and the history is a ref: history changes on every edit
 * but nothing RENDERS from the stacks themselves, only from whether they are
 * empty, so keeping them in state would re-render every consumer on each edit
 * to deliver a value none of them read.
 */
export function useEditorState({
  initialDocument,
  limits,
}: UseEditorStateArgs): EditorState {
  const [document, setDocument] = useState<BlockDocument>(initialDocument);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const undoStack = useRef<BuilderOp[]>([]);
  const redoStack = useRef<BuilderOp[]>([]);
  // Mirrors the stack lengths so the flags below are STATE and re-render when
  // they change. Reading `undoStack.current.length` directly would leave an
  // undo button disabled after the first edit, because a ref mutation does not
  // schedule a render.
  const [depths, setDepths] = useState({ undo: 0, redo: 0 });

  /**
   * Run an op and record its inverse on the given stack.
   *
   * Shared by `apply`, `undo` and `redo` because all three are the same
   * operation with a different destination for the inverse — undo pushes onto
   * redo and vice versa. Written once so the three cannot disagree about what
   * a refused op does, which is nothing at all: no state change, no history
   * entry, and the caller told.
   */
  const run = useCallback(
    (op: BuilderOp, into: "undo" | "redo" | "new"): BlockDocument | null => {
      let applied;
      try {
        applied = applyOp(document, op, limits);
      } catch {
        // A refused op is an ordinary outcome, not a crash: an insert past a
        // cap, a move onto a node that no longer exists, an update to a node a
        // concurrent edit removed. The caller decides what to say about it.
        return null;
      }

      if (into === "new") {
        undoStack.current.push(applied.inverse);
        // Bounded from the OLD end. Dropping the newest would make the most
        // recent edit unrepeatable, which is the one an author is most likely
        // to want back.
        if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift();
        // A new edit invalidates the redo branch: those inverses were computed
        // against a document that no longer exists, so replaying one would
        // apply an edit derived from a tree that has since changed.
        redoStack.current = [];
      } else if (into === "undo") {
        undoStack.current.push(applied.inverse);
      } else {
        redoStack.current.push(applied.inverse);
      }

      setDepths({
        undo: undoStack.current.length,
        redo: redoStack.current.length,
      });
      setDocument(applied.document);

      // A selection pointing at a node this edit removed would leave every
      // panel describing something the author cannot see. Cleared by asking the
      // NEW document whether the id is still there, rather than by inspecting
      // the op — an op that removes a container removes its subtree too, and
      // the op names only the container.
      setSelectedId(current =>
        current !== null && !hasNode(applied.document, current) ? null : current
      );

      return applied.document;
    },
    [document, limits]
  );

  const apply = useCallback((op: BuilderOp) => run(op, "new"), [run]);

  const undo = useCallback(() => {
    const op = undoStack.current.pop();
    if (op === undefined) return;
    // Popped before running, and NOT pushed back on failure. A refused undo
    // means the inverse no longer applies to this document, so keeping it would
    // leave a step that fails every time it is reached — an undo button that
    // does nothing and never clears.
    setDepths(d => ({ ...d, undo: undoStack.current.length }));
    run(op, "redo");
  }, [run]);

  const redo = useCallback(() => {
    const op = redoStack.current.pop();
    if (op === undefined) return;
    setDepths(d => ({ ...d, redo: redoStack.current.length }));
    run(op, "undo");
  }, [run]);

  const select = useCallback((id: string | null) => setSelectedId(id), []);

  return useMemo(
    () => ({
      document,
      selectedId,
      select,
      apply,
      undo,
      redo,
      canUndo: depths.undo > 0,
      canRedo: depths.redo > 0,
      undoDepth: depths.undo,
    }),
    [document, selectedId, select, apply, undo, redo, depths]
  );
}

/**
 * Whether a node id is anywhere in the document.
 *
 * An explicit walk rather than the engine's tree helpers, because this asks the
 * cheapest possible question — presence — and stops at the first hit. The
 * helpers that find a node also compute its path and parent, which nothing here
 * reads.
 */
function hasNode(doc: BlockDocument, id: string): boolean {
  const stack = [...doc.nodes];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) continue;
    if (node.id === id) return true;
    if (node.slots !== undefined) {
      for (const children of Object.values(node.slots)) stack.push(...children);
    }
  }
  return false;
}
