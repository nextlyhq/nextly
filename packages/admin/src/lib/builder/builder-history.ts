/**
 * The Builder's undo history: states of the definition, not a log of actions.
 *
 * Undo and redo move between the states, and a new edit drops the states it
 * could have redone. Edits made in a row with one key (one field's settings,
 * typed a character at a time) replace one another as a single step, so
 * typing a label is undone at once. Pure and immutable: every function
 * returns a new history, or the same one when nothing changes.
 *
 * @module lib/builder/builder-history
 */

/** A history of states, with the one shown. */
export interface BuilderHistory<T> {
  readonly states: readonly T[];
  /** Which state is shown. */
  readonly index: number;
  /** The key of the step at `index` while edits may still join it, else null. */
  readonly key: string | null;
  /** How many steps back can be undone at most. */
  readonly limit: number;
}

/** A history holding `initial` alone. */
export function createHistory<T>(initial: T, limit = 200): BuilderHistory<T> {
  return { states: [initial], index: 0, key: null, limit };
}

/** The state shown. */
export function currentState<T>(history: BuilderHistory<T>): T {
  return history.states[history.index] as T;
}

/**
 * Record `next` as the state shown. With the `key` of the step just made, it
 * replaces that step rather than adding one. A `next` that is the state shown
 * changes nothing.
 */
export function commit<T>(
  history: BuilderHistory<T>,
  next: T,
  key?: string
): BuilderHistory<T> {
  if (Object.is(next, currentState(history))) return history;
  const joins = key !== undefined && key === history.key && history.index > 0;
  // Everything after the state shown could have been redone: a new edit
  // drops it. A joined step replaces the state shown.
  const kept = history.states.slice(
    0,
    joins ? history.index : history.index + 1
  );
  const states = [...kept, next];
  // Beyond the limit, the oldest states go: they can no longer be undone to.
  const dropped = Math.max(0, states.length - 1 - history.limit);
  return {
    states: states.slice(dropped),
    index: states.length - 1 - dropped,
    key: key ?? null,
    limit: history.limit,
  };
}

/** Show the state before, if there is one. An undo ends the step being joined. */
export function undo<T>(history: BuilderHistory<T>): BuilderHistory<T> {
  if (!canUndo(history)) return history;
  return { ...history, index: history.index - 1, key: null };
}

/** Show the state after, if there is one. */
export function redo<T>(history: BuilderHistory<T>): BuilderHistory<T> {
  if (!canRedo(history)) return history;
  return { ...history, index: history.index + 1, key: null };
}

export function canUndo<T>(history: BuilderHistory<T>): boolean {
  return history.index > 0;
}

export function canRedo<T>(history: BuilderHistory<T>): boolean {
  return history.index < history.states.length - 1;
}
