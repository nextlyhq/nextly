/**
 * State a caller can also read SYNCHRONOUSLY.
 *
 * @module use-shown
 */
import { useCallback, useRef, useState } from "react";

/**
 * A value that RENDERS like state and can also be read synchronously.
 *
 * React exposes no way to read an update that has been dispatched and not yet
 * committed, and one caller here needs exactly that: a token import resolves
 * after a wait, and merging into the set from before an edit made during that
 * wait would persist the merge and undo the edit — an edit made, seen, and
 * silently undone.
 *
 * The ref is NOT returned beside the setter. A caller gets a reader and a
 * writer and no way to reach the state's own setter, so there is no second
 * place a write could happen and the two cannot drift into disagreeing. That
 * is the difference between an invariant and a note asking everyone to
 * remember one.
 */
export function useShown<T>(initial: T): [T, (next: T) => void, () => T] {
  const [value, setValue] = useState(initial);
  const held = useRef(value);
  const set = useCallback((next: T): void => {
    // Written BEFORE React is told, which is the whole point: a reader running
    // before the resulting render commits still sees this.
    held.current = next;
    setValue(next);
  }, []);
  const read = useCallback((): T => held.current, []);
  return [value, set, read];
}
