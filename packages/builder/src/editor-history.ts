"use client";

/**
 * The editor's undo history: the two stacks of steps, how deep they go, and
 * a step recorded from outside the document.
 *
 * Kept apart from `editor-state` so the document's state and the history it
 * replays read on their own. Nothing here knows the document: an entry is the
 * op layer's inverses, or a step whose halves say whether they took effect.
 *
 * @module editor-history
 */

import { useCallback, useRef, useState } from "react";

import type { BuilderOp } from "./op-vocabulary";
import { joinsTyping, typingRunNow, type TypingStep } from "./typing-run";

/** How deep the undo history goes before the oldest step is dropped. */
export const MAX_HISTORY = 100;

/**
 * A change made outside the document that the editor's history takes back and
 * puts forward, such as a write to the site's shared styles.
 *
 * Each half resolves whether it took effect. A half that did not (a refused
 * or failed write) leaves the change where it was, so the step is dropped
 * rather than kept as an undo that never clears.
 */
export interface HistoryStep {
  /** Takes the change back. */
  readonly undo: () => Promise<boolean>;
  /** Makes the change again. */
  readonly redo: () => Promise<boolean>;
}

/**
 * One entry of the history: a group of the op layer's inverses, or a step
 * recorded from outside the document. Both stacks hold the entry to replay
 * next, so a step on the redo stack is the recorded one with its halves
 * swapped.
 */
export type HistoryEntry =
  | { readonly kind: "ops"; readonly ops: readonly BuilderOp[] }
  | {
      readonly kind: "step";
      readonly step: HistoryStep;
      /** The step as recorded, kept as it moves between the stacks. */
      readonly origin: HistoryStep;
    };

/** The step that replays `step` the other way, for the opposite stack. */
function reversed(step: HistoryStep): HistoryStep {
  return { undo: step.redo, redo: step.undo };
}

/** How many entries change the document, which is what a save point counts. */
function documentEntries(stack: readonly HistoryEntry[]): number {
  return stack.filter(entry => entry.kind === "ops").length;
}

/**
 * The undo and redo stacks, and the depths a render reads from them.
 *
 * READONLY groups. A recorded inverse describes the document as it stood when
 * its op ran, so nothing may append to or reorder one after the fact — the
 * history would then describe an edit that never happened. `applyOps` returns
 * them already in undo order and already frozen to the type.
 */
export function useHistoryStacks(): {
  depths: { undo: number; redo: number; document: number };
  push: (
    entry: HistoryEntry,
    into: "undo" | "redo" | "new"
  ) => HistoryEntry | undefined;
  pop: (from: "undo" | "redo") => HistoryEntry | undefined;
  remove: (entry: HistoryEntry) => void;
  withdraw: (origin: HistoryStep, dropped: HistoryEntry | undefined) => void;
  /** A replay of the step took effect; the branch it ended is gone. */
  settle: (origin: HistoryStep) => void;
  /** Forget everything: both stacks, and what fell off the old end. */
  clear: () => void;
} {
  const undoStack = useRef<HistoryEntry[]>([]);
  const redoStack = useRef<HistoryEntry[]>([]);
  // Mirrors the stack lengths so the flags below are STATE and re-render when
  // they change. Reading `undoStack.current.length` directly would leave an
  // undo button disabled after the first edit, because a ref mutation does not
  // schedule a render.
  const [depths, setDepths] = useState({ undo: 0, redo: 0, document: 0 });
  /*
   * Document edits dropped off the old end. The save point measures the
   * document's position in its history, and that position does not move
   * because the history forgets how it got there: counted in, a page saved
   * before a run of style changes stays saved once its edit falls off.
   */
  const forgotten = useRef(0);
  const sync = useCallback(() => {
    setDepths({
      undo: undoStack.current.length,
      redo: redoStack.current.length,
      document: documentEntries(undoStack.current) + forgotten.current,
    });
  }, []);
  /*
   * The redo branch a run of recorded steps ended, with those steps and the
   * entry below the first, so that withdrawing every one of them before
   * anything else follows gives the branch back: changes that never took
   * effect must not cost the author their redo either. Kept while the steps
   * are recorded one after another, and while any of them only moves between
   * the stacks unanswered, since each change may still be refused; dropped
   * once a replay of one takes effect or any other entry is pushed.
   */
  const endedBranch = useRef<StepRun | null>(null);
  // The run of typing the newest step was pushed for (`typing-run.ts`).
  const typing = useRef<TypingStep<HistoryEntry> | null>(null);
  const push = useCallback(
    (entry: HistoryEntry, into: "undo" | "redo" | "new") => {
      // A later write of a run of typing keeps the run's one step, whose
      // inverse puts back what was there before the author started.
      const run = into === "new" ? typingRunNow() : null;
      if (joinsTyping(typing.current, undoStack.current.at(-1), run)) return;
      typing.current = run && { run, entry };
      let dropped: HistoryEntry | undefined;
      endedBranch.current = runAfterPush(
        endedBranch.current,
        entry,
        into,
        undoStack.current.at(-1),
        redoStack.current
      );
      if (into === "redo") {
        redoStack.current.push(entry);
      } else {
        undoStack.current.push(entry);
      }
      if (into === "new") {
        // Bounded from the OLD end. Dropping the newest would make the most
        // recent edit unrepeatable, which is the one an author is most likely
        // to want back.
        if (undoStack.current.length > MAX_HISTORY) {
          dropped = undoStack.current.shift();
          if (dropped?.kind === "ops") forgotten.current += 1;
        }
        // A new edit invalidates the redo branch: those inverses were computed
        // against a document that no longer exists, so replaying one would
        // apply an edit derived from a tree that has since changed.
        redoStack.current = [];
      }
      sync();
      return dropped;
    },
    [sync]
  );
  const pop = useCallback(
    (from: "undo" | "redo") => {
      const entry = (from === "undo" ? undoStack : redoStack).current.pop();
      sync();
      return entry;
    },
    [sync]
  );
  const remove = useCallback(
    (entry: HistoryEntry) => {
      undoStack.current = undoStack.current.filter(held => held !== entry);
      redoStack.current = redoStack.current.filter(held => held !== entry);
      sync();
    },
    [sync]
  );
  /*
   * Take a recorded step back out, wherever it sits: undone, it is on the
   * redo stack under another entry. The entry its recording pushed off a full
   * history comes back to the old end, since a change that never took effect
   * must not cost the oldest edit.
   */
  const withdraw = useCallback(
    (origin: HistoryStep, dropped: HistoryEntry | undefined) => {
      const kept = (held: HistoryEntry) =>
        held.kind !== "step" || held.origin !== origin;
      // With the last step of the run gone, the history as it was before it
      // began (nothing made since, and nothing else undone): the redo branch
      // the run ended comes back with that withdrawal. While others of the
      // run remain, one of them may yet take effect, so the branch waits.
      const ended = endedBranch.current;
      ended?.steps.delete(origin);
      const last = ended !== null && ended.steps.size === 0;
      if (last) endedBranch.current = null;
      undoStack.current = undoStack.current.filter(kept);
      const redo = redoStack.current.filter(kept);
      const restore =
        last && undoStack.current.at(-1) === ended.below && redo.length === 0
          ? ended.branch
          : [];
      redoStack.current = [...redo, ...restore];
      if (dropped !== undefined && undoStack.current.length < MAX_HISTORY) {
        undoStack.current.unshift(dropped);
        if (dropped.kind === "ops") forgotten.current -= 1;
      }
      sync();
    },
    [sync]
  );
  /*
   * A replay of a step of the run took effect: its change and its undo are
   * both real, so the branch the run ended is gone for good.
   */
  const settle = useCallback((origin: HistoryStep) => {
    if (endedBranch.current?.steps.has(origin) === true) {
      endedBranch.current = null;
    }
  }, []);
  /*
   * A history started again, for a new session of the editor: nothing to undo
   * or redo, no run of steps or of typing to join, and no edit forgotten, so
   * the save point counts from the session's own start.
   */
  const clear = useCallback(() => {
    undoStack.current = [];
    redoStack.current = [];
    forgotten.current = 0;
    endedBranch.current = null;
    typing.current = null;
    sync();
  }, [sync]);
  return { depths, push, pop, remove, withdraw, settle, clear };
}

/** A run of recorded steps, the redo branch it ended, and what lay below it. */
interface StepRun {
  steps: Set<HistoryStep>;
  below: HistoryEntry | undefined;
  branch: HistoryEntry[];
}

/**
 * The run of recorded steps once `entry` is pushed: a new step joins the run
 * or starts one (keeping the branch it ends and what lay below), a step of
 * the run moving between the stacks keeps it, and anything else ends it.
 */
function runAfterPush(
  run: StepRun | null,
  entry: HistoryEntry,
  into: "undo" | "redo" | "new",
  below: HistoryEntry | undefined,
  branch: HistoryEntry[]
): StepRun | null {
  if (entry.kind !== "step") return null;
  if (into !== "new") return run?.steps.has(entry.origin) === true ? run : null;
  if (run === null) return { steps: new Set([entry.origin]), below, branch };
  run.steps.add(entry.origin);
  return run;
}

/**
 * Replay a recorded step and move it to the other stack at once, so a second
 * press reaches the entry before it rather than waiting on a write. Dropped
 * again if the replay did not take effect, for the reason a refused inverse is
 * not pushed back.
 */
export function replayStep(
  { step, origin }: { step: HistoryStep; origin: HistoryStep },
  into: "undo" | "redo",
  push: (entry: HistoryEntry, into: "undo" | "redo") => void,
  remove: (entry: HistoryEntry) => void,
  settle: (origin: HistoryStep) => void
): Promise<boolean> {
  const moved: HistoryEntry = { kind: "step", step: reversed(step), origin };
  push(moved, into);
  return step.undo().then(
    took => {
      if (took) settle(origin);
      else remove(moved);
      return took;
    },
    () => {
      remove(moved);
      return false;
    }
  );
}
