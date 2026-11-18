/**
 * A run of typing: the writes one field makes while an author types into it,
 * joined into ONE step of the editor's history.
 *
 * A field that writes as the author types — so the canvas shows the words as
 * they go in, rather than when the field is left — would otherwise put a step
 * on the history per keystroke, and undo would take a sentence back a letter
 * at a time. Inside {@link joinTyping}, every write the same run makes after
 * its first moves the document without a new step: undo takes the run back
 * whole, to what the value was before the author started.
 *
 * Ambient rather than passed through the write path, because the write path is
 * every field's: the run is named around the call that writes, and the
 * history asks for it when that write is applied, synchronously, inside it.
 *
 * @module typing-run
 */

/** The run the write being applied belongs to, or `null` for none. */
let ambient: object | null = null;

/**
 * Run `write` as part of the typing run `run`: a run is any object a field
 * keeps for as long as one stretch of typing lasts, and a new object starts a
 * new step.
 */
export function joinTyping<T>(run: object, write: () => T): T {
  const outer = ambient;
  ambient = run;
  try {
    return write();
  } finally {
    ambient = outer;
  }
}

/** The typing run the write being applied belongs to, or `null`. */
export function typingRunNow(): object | null {
  return ambient;
}

/**
 * Which stretch of typing the editor is in. Moved on by {@link endTypingRuns},
 * so every run open before it is over: its next write is a step of its own.
 */
let epoch = 0;

/**
 * End every run of typing now, as leaving the field would, without the author
 * leaving it. For a save made while a field is still being typed in: what was
 * saved is one step, and typing on is the next, so undo after the save takes
 * back only what came after it and the count of unsaved work stays right.
 *
 * @experimental
 */
export function endTypingRuns(): void {
  epoch += 1;
}

/** The current stretch, for a step or a field to note when its run began. */
export function typingEpoch(): number {
  return epoch;
}

/** The run of typing a step of the history was pushed for, and the step. */
export interface TypingStep<Entry> {
  readonly run: object;
  readonly entry: Entry;
  /** The stretch the step began in: a later one ({@link endTypingRuns}) ends it. */
  readonly epoch: number;
}

/**
 * Whether a write of `run` joins the step `last` was pushed for: the same
 * run, while that step is still the newest of the history. Any other step
 * since, and the run's next write is a step of its own.
 */
export function joinsTyping<Entry>(
  last: TypingStep<Entry> | null,
  newest: Entry | undefined,
  run: object | null
): boolean {
  return (
    run !== null &&
    last?.run === run &&
    newest === last.entry &&
    last.epoch === epoch
  );
}
