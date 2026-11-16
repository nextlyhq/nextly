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
  /**
   * One id per state, for its place in the history: an edit that joins a
   * step keeps that step's id, so a place can be found again after the state
   * in it was replaced.
   */
  readonly ids: readonly number[];
  /** Which state is shown. */
  readonly index: number;
  /** The key of the step at `index` while edits may still join it, else null. */
  readonly key: string | null;
  /** How many steps back can be undone at most. */
  readonly limit: number;
  /** The id a new step takes. */
  readonly nextId: number;
}

/** A history holding `initial` alone. */
export function createHistory<T>(initial: T, limit = 200): BuilderHistory<T> {
  return { states: [initial], ids: [0], index: 0, key: null, limit, nextId: 1 };
}

/** The state shown. */
export function currentState<T>(history: BuilderHistory<T>): T {
  return history.states[history.index];
}

/** The id of the place shown: kept by an edit that joins its step. */
export function currentId<T>(history: BuilderHistory<T>): number {
  return history.ids[history.index] ?? 0;
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
  // drops it. A joined step replaces the state shown, keeping its id.
  const keep = joins ? history.index : history.index + 1;
  const states = [...history.states.slice(0, keep), next];
  const ids = [
    ...history.ids.slice(0, keep),
    joins ? currentId(history) : history.nextId,
  ];
  // Beyond the limit, the oldest states go: they can no longer be undone to.
  const dropped = Math.max(0, states.length - 1 - history.limit);
  return {
    states: states.slice(dropped),
    ids: ids.slice(dropped),
    index: states.length - 1 - dropped,
    key: key ?? null,
    limit: history.limit,
    nextId: joins ? history.nextId : history.nextId + 1,
  };
}

/**
 * The history from `state` on: what came before it can no longer be undone
 * to, and every step after it stays.
 *
 * A later edit to the same field joins the step `state` was, as typing does,
 * and replaces it in its place; `id`, the place's id when `state` was shown,
 * finds that place, and `state` comes back just before it, so Undo returns to
 * exactly `state` and every step since stays. Without the place, `state`
 * comes back as the start with the state shown one step on. Either way the
 * step shown is closed: the next edit is a step of its own.
 */
export function startFrom<T>(
  history: BuilderHistory<T>,
  state: T,
  id?: number
): BuilderHistory<T> {
  const at = history.states.indexOf(state);
  if (at >= 0 && at <= history.index) {
    return {
      ...history,
      states: history.states.slice(at),
      ids: history.ids.slice(at),
      index: history.index - at,
      key: null,
    };
  }
  const place = id === undefined ? -1 : history.ids.indexOf(id);
  if (place >= 0 && place <= history.index) {
    return {
      ...history,
      states: [state, ...history.states.slice(place)],
      ids: [history.nextId, ...history.ids.slice(place)],
      index: history.index - place + 1,
      key: null,
      nextId: history.nextId + 1,
    };
  }
  const now = currentState(history);
  if (Object.is(now, state)) return createHistory(state, history.limit);
  return {
    states: [state, now],
    ids: [history.nextId, currentId(history)],
    index: 1,
    key: null,
    limit: history.limit,
    nextId: history.nextId + 1,
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
