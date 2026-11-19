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

/** The run of typing a step of the history was pushed for, and the step. */
export interface TypingStep<Entry> {
  readonly run: object;
  readonly entry: Entry;
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
  return run !== null && last?.run === run && newest === last.entry;
}
