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

import { applyOps, type BuilderOp } from "./ops";
import {
  EMPTY_SELECTION,
  applySelection,
  pruneSelection,
  type BlockSelection,
  type SelectionMode,
} from "./selection";

/** How deep the undo history goes before the oldest step is dropped. */
export const MAX_HISTORY = 100;

export interface EditorState {
  /** The document as it currently stands. */
  document: BlockDocument;
  /** The selected node's id, or null when nothing is selected. */
  selectedId: string | null;
  /**
   * Everything selected, in document order, with the primary named.
   *
   * `selectedId` IS `selection.primary`, derived rather than stored twice: the
   * two disagreeing would put an outline on one block and the inspector on
   * another, and there is no render in which that is what an author meant.
   */
  selection: BlockSelection;
  /** Select a node, or clear the selection with null. */
  select: (id: string | null, mode?: SelectionMode) => void;
  /**
   * Apply an edit. Returns the applied op's outcome, or null when the op was
   * refused — a caller that needs to know whether its edit landed can ask,
   * rather than comparing documents afterwards.
   */
  apply: (op: BuilderOp) => BlockDocument | null;
  /**
   * Apply several ops as ONE action, or nothing at all.
   *
   * For an edit whose subject is a multi-block selection. Atomic — a group that
   * failed halfway would leave a document the author never asked for — and it
   * costs exactly one undo, because "delete these six" is one thing an author
   * did and six presses to take it back would read as the history being wrong.
   *
   * Returns the new document, or `null` when any op was refused and nothing was
   * committed.
   */
  applyAll: (ops: readonly BuilderOp[]) => BlockDocument | null;
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
  const [selection, setSelection] = useState<BlockSelection>(EMPTY_SELECTION);

  /**
   * The document as it stands NOW, for everything a LATER event reaches.
   *
   * Every callback below closes over the render it was made in. Most callers
   * take theirs from the current render and the distinction never shows, but
   * two paths do not, and both read this ref rather than the state.
   *
   * `select`, because a gesture is handled by whatever handler the last render
   * bound and the selection rules need the document that is current when the
   * click lands. Closing over it resolves a range against a stale tree, which
   * is a wrong selection rather than a missing one.
   *
   * `run`, because a panel that commits from an unmount cleanup necessarily
   * holds an older callback: the component going away does not render again, so
   * its closure predates the very edit that removed it. Folding onto that older
   * document did not merely apply a stale edit — it SUCCEEDED where it should
   * have been refused, the node still being present in that copy, and then
   * wrote the whole document back. Deleting a block with an unsaved panel open
   * restored the block and discarded everything since. Read through the ref the
   * same call is refused, which is what callers are already written to handle.
   *
   * The hazard was named here for `select` alone and left on the op path, which
   * is the more expensive of the two.
   */
  const latestDocument = useRef(document);
  latestDocument.current = document;

  // READONLY groups. A recorded inverse describes the document as it stood when
  // its op ran, so nothing may append to or reorder one after the fact — the
  // history would then describe an edit that never happened. `applyOps` returns
  // them already in undo order and already frozen to the type.
  const undoStack = useRef<(readonly BuilderOp[])[]>([]);
  const redoStack = useRef<(readonly BuilderOp[])[]>([]);
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
  /**
   * Apply a GROUP of ops as one action.
   *
   * ## Atomic, and that is the point
   *
   * Every op is folded onto a WORKING document and nothing is committed until
   * all of them have succeeded. A group that failed halfway would leave the
   * document in a state the author never asked for and no single undo could
   * leave — deleting four of six blocks because the fifth was locked is worse
   * than deleting none.
   *
   * ## One group, one undo
   *
   * The inverses are collected in REVERSE order and pushed as a single stack
   * entry. Undo granularity belongs to the history rather than to the document
   * format: the op vocabulary stays four flat kinds, which matters because ops
   * are persisted in a `json()` column and a nested "batch" op would make every
   * reader of that column understand recursion.
   *
   * A single op is a group of one, so there is one code path rather than a fast
   * path and a batch path that can drift.
   */
  const run = useCallback(
    (
      ops: readonly BuilderOp[],
      into: "undo" | "redo" | "new"
    ): BlockDocument | null => {
      // Nothing to do, and nothing to record. An empty group must NOT push an
      // entry: that would be an undo that appears to do nothing, which reads as
      // the history being broken.
      if (ops.length === 0) return latestDocument.current;

      let group;
      try {
        // ONE call rather than a fold here, so the group's caps are judged
        // where the group is understood. Folding `applyOp` in this file
        // measured every intermediate document against the cap, which made a
        // batch's outcome depend on the order its ops happened to arrive in:
        // a selection at the byte cap where one block grows and another shrinks
        // by more was refused when the growing one came first and accepted when
        // it came second, for the same resulting document.
        //
        // The inverses come back in undo order already — see `applyOps`, which
        // owns that ordering rule along with the cap one.
        group = applyOps(latestDocument.current, ops, limits);
      } catch {
        // A refused group is an ordinary outcome, not a crash: an insert past a
        // cap, a move onto a node that no longer exists, an update to a node
        // a concurrent edit removed. The caller decides what to say about it.
        // Nothing is committed — see the atomicity note above.
        return null;
      }

      const applied = { document: group.document, inverse: group.inverses };

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
      // Ahead of `setDocument`, which does not take effect until the next
      // render: two ops applied in one tick must see each other, or the second
      // is folded onto the document the first already replaced.
      latestDocument.current = applied.document;
      setDocument(applied.document);

      // A selection pointing at a node this edit removed would leave every
      // panel describing something the author cannot see. Cleared by asking the
      // NEW document whether the id is still there, rather than by inspecting
      // the op — an op that removes a container removes its subtree too, and
      // the op names only the container.
      setSelection(current => pruneSelection(applied.document, current));

      return applied.document;
    },
    // NOT `document`: it is read through the ref above, so depending on it here
    // would rebuild these callbacks every edit for a value none of them close
    // over. Stable identity is also the point — a stale `run` is now the same
    // `run`, folding onto the tree as it stands.
    [limits]
  );

  const apply = useCallback((op: BuilderOp) => run([op], "new"), [run]);

  const applyAll = useCallback(
    (ops: readonly BuilderOp[]) => run(ops, "new"),
    [run]
  );

  const undo = useCallback(() => {
    const group = undoStack.current.pop();
    if (group === undefined) return;
    // Popped before running, and NOT pushed back on failure. A refused undo
    // means the inverse no longer applies to this document, so keeping it would
    // leave a step that fails every time it is reached — an undo button that
    // does nothing and never clears.
    setDepths(d => ({ ...d, undo: undoStack.current.length }));
    run(group, "redo");
  }, [run]);

  const redo = useCallback(() => {
    const group = redoStack.current.pop();
    if (group === undefined) return;
    setDepths(d => ({ ...d, redo: redoStack.current.length }));
    run(group, "undo");
  }, [run]);

  const select = useCallback(
    (id: string | null, mode: SelectionMode = "replace") =>
      setSelection(current =>
        applySelection(latestDocument.current, current, id, mode)
      ),
    []
  );

  return useMemo(
    () => ({
      document,
      selectedId: selection.primary,
      selection,
      select,
      apply,
      applyAll,
      undo,
      redo,
      canUndo: depths.undo > 0,
      canRedo: depths.redo > 0,
      undoDepth: depths.undo,
    }),
    [document, selection, select, apply, applyAll, undo, redo, depths]
  );
}
