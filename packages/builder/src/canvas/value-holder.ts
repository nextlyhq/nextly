/**
 * A value one surface of the editor sets and another reads, held outside
 * React state so a change re-renders only its readers.
 *
 * The editor keeps two: the block pointed at from Layers (`hovered-block`)
 * and the Add panel's highlighted place (`insertion-preview`). Both change
 * far more often than anything else in the editor, and a value in the
 * editor's state would draw the whole page again on every change.
 *
 * @module value-holder
 */

/** A value, readable and writable by any surface under one editor. */
export interface ValueHolder<T> {
  /** The value, or `null` for none. */
  readonly get: () => T | null;
  /** Set it, or clear it with `null`. A value equal to the one held changes nothing. */
  readonly set: (value: T | null) => void;
  /** Be told when it changes; answers the unsubscribe. */
  readonly subscribe: (listener: () => void) => () => void;
}

/** A fresh holder, holding nothing, judging equal values by `same`. */
export function createValueHolder<T>(
  same: (a: T, b: T) => boolean = Object.is
): ValueHolder<T> {
  let current: T | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set: value => {
      const unchanged =
        value === null || current === null
          ? value === current
          : same(value, current);
      if (unchanged) return;
      current = value;
      listeners.forEach(listener => listener());
    },
    subscribe: listener => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * What a surface outside any editor reads: nothing held, and a set that goes
 * nowhere, so a panel or the canvas drawn alone in a test still work.
 */
export function nowhereHolder<T>(): ValueHolder<T> {
  return {
    get: () => null,
    set: () => undefined,
    subscribe: () => () => undefined,
  };
}
