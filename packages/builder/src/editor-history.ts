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

import { useCallback, useMemo, useRef, useState } from "react";

import type { BuilderOp } from "./op-vocabulary";
import {
  joinsTyping,
  typingEpoch,
  typingRunNow,
  type TypingStep,
} from "./typing-run";

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
  /**
   * Take a run of typing's step back out, as if the run had never been
   * typed: its entry comes off the undo stack, and the redo branch and the
   * oldest step its first write ended come back. Answers the entry, whose
   * ops take the document back, or nothing when `run` is not the newest step.
   */
  withdrawTyping: (run: object) => HistoryEntry | undefined;
  /**
   * Record a step from outside the document, answering the function that
   * withdraws it again: a no-op once the history has been cleared since, so
   * a change refused after its session ended cannot reach the next one.
   */
  record: (step: HistoryStep) => () => void;
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
  // The run of typing the newest step was pushed for (`typing-run.ts`), with
  // what its first write ended, kept so cancelling the run gives it back.
  const typing = useRef<TypingHeld | null>(null);
  const push = useCallback(
    (entry: HistoryEntry, into: "undo" | "redo" | "new") => {
      // A later write of a run of typing keeps the run's one step, whose
      // inverse puts back what was there before the author started.
      const run = into === "new" ? typingRunNow() : null;
      if (joinsTyping(typing.current, undoStack.current.at(-1), run)) {
        typing.current = widenedTyping(
          typing.current,
          entry,
          undoStack.current
        );
        return;
      }
      // Read before this push changes them; the redo stack is replaced, never
      // emptied in place, so the array kept here stays as it was.
      const redoBefore = redoStack.current;
      const endedBefore = endedBranch.current;
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
      typing.current = beganTyping(run, entry, {
        redo: redoBefore,
        ended: endedBefore,
        dropped,
      });
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
      forgotten.current -= giveBack(undoStack.current, dropped);
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
  /*
   * Which history a recorded step belongs to: counted up by every clear, so a
   * withdrawal from before it finds its history gone rather than putting the
   * entry it once pushed off back into a new one.
   */
  const generation = useRef(0);
  const record = useCallback(
    (step: HistoryStep) => {
      // Bounded and branch-ending exactly as a fresh document edit is.
      const dropped = push({ kind: "step", step, origin: step }, "new");
      const recordedIn = generation.current;
      return () => {
        if (generation.current === recordedIn) withdraw(step, dropped);
      };
    },
    [push, withdraw]
  );
  // The two that reset the stacks without replaying anything, made together:
  // each reads only the refs and `sync`, so both keep one identity.
  const { clear, withdrawTyping } = useMemo(
    () => ({
      clear: () => {
        generation.current += 1;
        undoStack.current = [];
        redoStack.current = [];
        forgotten.current = 0;
        endedBranch.current = null;
        typing.current = null;
        sync();
      },
      withdrawTyping: (run: object): HistoryEntry | undefined =>
        takeTypingBack(
          { undoStack, redoStack, endedBranch, forgotten, typing },
          run,
          sync
        ),
    }),
    [sync]
  );
  return { depths, push, pop, remove, withdrawTyping, record, settle, clear };
}

/** The run of typing a step was pushed for, or nothing for an edit that is not typing. */
function beganTyping(
  run: object | null,
  entry: HistoryEntry,
  before: TypingBefore
): TypingHeld | null {
  return run === null ? null : { run, entry, before, epoch: typingEpoch() };
}

/**
 * The run's step after a later write of it: that write may change what the
 * first did not, as a recognised embed link sets a style, so its inverse
 * joins the step's, applied first, and undo puts back every property the run
 * touched. The step stays the newest entry, replaced in place.
 */
function widenedTyping(
  held: TypingHeld | null,
  entry: HistoryEntry,
  undo: HistoryEntry[]
): TypingHeld | null {
  if (held === null || entry.kind !== "ops" || held.entry.kind !== "ops") {
    return held;
  }
  const joined: HistoryEntry = {
    kind: "ops",
    ops: [...entry.ops, ...held.entry.ops],
  };
  undo[undo.length - 1] = joined;
  return { ...held, entry: joined };
}

/** The history's stacks and runs, as `takeTypingBack` reads and resets them. */
interface HistoryRefs {
  readonly undoStack: { current: HistoryEntry[] };
  readonly redoStack: { current: HistoryEntry[] };
  readonly endedBranch: { current: StepRun | null };
  readonly forgotten: { current: number };
  readonly typing: { current: TypingHeld | null };
}

/**
 * Take a run of typing's step back out, as `withdrawTyping` describes: only
 * while its step is the newest, so nothing else has been pushed and the step
 * has not been undone. Once either has happened, the run is over and its step
 * is ordinary history, and nothing changes. `sync` runs only on a change.
 */
function takeTypingBack(
  refs: HistoryRefs,
  run: object,
  sync: () => void
): HistoryEntry | undefined {
  const last = refs.typing.current;
  // A run a save ended (`endTypingRuns`) is over: what it wrote was saved.
  if (last === null || last.run !== run || last.epoch !== typingEpoch()) {
    return undefined;
  }
  const { before } = last;
  if (refs.undoStack.current.at(-1) !== last.entry) return undefined;
  refs.undoStack.current.pop();
  refs.redoStack.current = before.redo;
  refs.endedBranch.current = before.ended;
  refs.forgotten.current -= giveBack(refs.undoStack.current, before.dropped);
  refs.typing.current = null;
  sync();
  return last.entry;
}

/**
 * Put back at the old end the entry a full history dropped for a change that
 * is now withdrawn, where there is room. Answers how many document edits came
 * back, which the count of forgotten edits loses.
 */
function giveBack(
  undo: HistoryEntry[],
  dropped: HistoryEntry | undefined
): number {
  if (dropped === undefined || undo.length >= MAX_HISTORY) return 0;
  undo.unshift(dropped);
  return dropped.kind === "ops" ? 1 : 0;
}

/** A run of typing's step, and what its first write ended. */
interface TypingHeld extends TypingStep<HistoryEntry> {
  readonly before: TypingBefore;
}

/** What a run of typing's first write ended, given back if it is cancelled. */
interface TypingBefore {
  readonly redo: HistoryEntry[];
  readonly ended: StepRun | null;
  readonly dropped: HistoryEntry | undefined;
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

/**
 * Run `restart` in the render that sees `session` change, never on the
 * first: for each piece of editor state that belongs to one editing session
 * (its document, its history, what the author asked of it), so a new session
 * starts with none of the old one's. Its updates are the calling component's
 * own state, so React drops that render and renders again at once with them.
 * The session is held through a function, so one named by a function is
 * stored as it is rather than called.
 */
export function useRestartOn(session: unknown, restart: () => void): void {
  const [held, setHeld] = useState(() => session);
  if (Object.is(held, session)) return;
  setHeld(() => session);
  restart();
}
