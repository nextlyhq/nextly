"use client";

/**
 * A block that asks for a choice when it is first added, and the editor step
 * that holds "this block was just added" while the canvas draws its chooser.
 *
 * The insert places the block at once, so the page is never left waiting on
 * the answer and one undo takes the block away. What the builder holds is
 * which node was just added, in editor state only: nothing is written to the
 * document, so a reload, another editor or the published page never sees it.
 *
 * It holds only while the author is still where the insert left them: the
 * page is the one the insert made and the new block is the one selected. Any
 * other edit, an undo or a redo, a step recorded outside the page, or a
 * selection elsewhere (Escape, a click on another block) ends it, and so do
 * the chooser's own Skip and pick. Because every way the history moves passes
 * through here, a pick knows the insert is still the newest step, and joins
 * it: the insert is taken back and the block placed again as chosen, as ONE
 * step, so one undo still removes the whole block.
 *
 * Which blocks ask stays inside the builder for the core blocks: opening it
 * to other blocks is a later decision.
 *
 * @module first-add
 */
import { findNode, type BlockNode } from "@nextlyhq/blocks-engine";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { EditorState } from "./editor-state";
import { applyOps, type BuilderOp, type OpPosition } from "./op-vocabulary";

/** The choosers a block can ask for when it is first added. */
export type FirstAddChooser = "columns-layout";

/**
 * The core blocks that ask for a choice when they are first added, by type,
 * and the chooser each asks for. Kept here, not on the block's definition:
 * the step is the builder's own until it is opened to other blocks.
 */
const FIRST_ADD_CHOOSERS: ReadonlyMap<string, FirstAddChooser> = new Map([
  ["core/columns", "columns-layout"],
]);

/** The chooser a block of this type asks for when first added, if any. */
export function firstAddChooserOf(type: string): FirstAddChooser | undefined {
  return FIRST_ADD_CHOOSERS.get(type);
}

/** A block just added that asks for a choice, while it still does. */
export interface FirstAdd {
  /** The block just added. */
  readonly nodeId: string;
  /** The chooser the canvas draws in place of its body. */
  readonly chooser: FirstAddChooser;
  /**
   * Make the author's choice: `ops` on the block as it was added, joined to
   * the insert as ONE step. Answers whether they landed. Ends the step.
   */
  readonly choose: (ops: readonly BuilderOp[]) => boolean;
  /** Keep the block as it was added, and end the step. */
  readonly skip: () => void;
}

/** What the insert left: where it placed the block, and the page it made. */
interface Added {
  readonly nodeId: string;
  readonly chooser: FirstAddChooser;
  readonly at: OpPosition;
  readonly document: EditorState["document"];
}

/** The parts of the editor this step wraps and reads. */
type Host = Pick<
  EditorState,
  | "document"
  | "selectedId"
  | "select"
  | "apply"
  | "applyAll"
  | "undo"
  | "redo"
  | "recordStep"
  | "limits"
>;

/** What an applied insert leaves to choose, if its block asks for a choice. */
function addedBy(
  op: BuilderOp,
  document: EditorState["document"]
): Added | undefined {
  if (op.kind !== "insert") return undefined;
  const chooser = firstAddChooserOf(op.node.type);
  if (chooser === undefined) return undefined;
  return { nodeId: op.node.id, chooser, at: op.at, document };
}

/** The block as `ops` leave it on the page the insert made, if they apply. */
function laidOut(
  added: Added,
  ops: readonly BuilderOp[],
  limits: Host["limits"]
): BlockNode | undefined {
  try {
    const after = applyOps(added.document, ops, limits).document;
    return findNode(after.nodes, added.nodeId);
  } catch {
    // Refused by the op layer: the choice is made as a step of its own below,
    // where the editor says why.
    return undefined;
  }
}

/**
 * The editor with the first-add step: the history's ways in wrapped so each
 * one ends the step (and an insert of a block that asks starts it), and
 * `firstAdd` while it holds.
 */
export function useFirstAdd<T extends Host>(
  host: T
): T & { firstAdd?: FirstAdd } {
  const [added, setAdded] = useState<Added | undefined>(undefined);
  // Read by the wrappers in the same tick a change is made: an insert and the
  // select after it run before the next render.
  const current = useRef<Added | undefined>(undefined);
  const put = useCallback((next: Added | undefined) => {
    current.current = next;
    setAdded(next);
  }, []);

  const { apply: hostApply, applyAll: hostApplyAll, undo: hostUndo } = host;
  const { redo: hostRedo, recordStep: hostRecordStep } = host;
  const { select, limits } = host;

  const apply = useCallback<Host["apply"]>(
    op => {
      const result = hostApply(op);
      // A refused op changed nothing, so the step stands as it was.
      if (result !== null) put(addedBy(op, result));
      return result;
    },
    [hostApply, put]
  );
  const applyAll = useCallback<Host["applyAll"]>(
    ops => {
      put(undefined);
      return hostApplyAll(ops);
    },
    [hostApplyAll, put]
  );
  const undo = useCallback<Host["undo"]>(() => {
    put(undefined);
    return hostUndo();
  }, [hostUndo, put]);
  const redo = useCallback<Host["redo"]>(() => {
    put(undefined);
    return hostRedo();
  }, [hostRedo, put]);
  const recordStep = useCallback<Host["recordStep"]>(
    step => {
      put(undefined);
      return hostRecordStep(step);
    },
    [hostRecordStep, put]
  );

  const skip = useCallback(() => put(undefined), [put]);
  const choose = useCallback(
    (ops: readonly BuilderOp[]): boolean => {
      const now = current.current;
      put(undefined);
      if (now === undefined) return false;
      const node = laidOut(now, ops, limits);
      // The insert is the newest step while this holds (every other way the
      // history moves ended it), so taking it back and placing the block as
      // chosen is one step in its place.
      if (node !== undefined && hostUndo() === true) {
        const placed = hostApplyAll([{ kind: "insert", node, at: now.at }]);
        if (placed !== null) {
          select(now.nodeId);
          return true;
        }
        // Not placed as chosen: the block comes back as it was added.
        void hostRedo();
        select(now.nodeId);
      }
      return hostApplyAll(ops) !== null;
    },
    [hostApplyAll, hostRedo, hostUndo, limits, put, select]
  );

  // Holds while the page is the one the insert made and its block is selected.
  const holding =
    added !== undefined &&
    host.document === added.document &&
    host.selectedId === added.nodeId
      ? added
      : undefined;
  const holds = holding !== undefined;
  // Once it stops holding it is over: selecting the block again later does
  // not bring the chooser back.
  useEffect(() => {
    if (added !== undefined && !holds) put(undefined);
  }, [added, holds, put]);

  const firstAdd = useMemo<FirstAdd | undefined>(
    () =>
      holding === undefined
        ? undefined
        : { nodeId: holding.nodeId, chooser: holding.chooser, choose, skip },
    [holding, choose, skip]
  );

  return useMemo(
    () => ({
      ...host,
      apply,
      applyAll,
      undo,
      redo,
      recordStep,
      ...(firstAdd === undefined ? {} : { firstAdd }),
    }),
    [host, apply, applyAll, undo, redo, recordStep, firstAdd]
  );
}
