"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * React state persisted to localStorage under a `nextly:admin:*` key.
 *
 * SSR-safe by design: the first render always uses `defaultValue` (so server
 * and client markup agree), and the stored value is applied in an effect
 * after mount. `validate` guards against stale or corrupt stored values -
 * anything it rejects falls back to the default instead of poisoning state.
 */
export function usePersistedState<T extends string>(
  key: string,
  defaultValue: T,
  validate: (value: string) => value is T
): [T, (next: T) => void] {
  const [value, setValueState] = useState<T>(defaultValue);

  // The guard lives in a ref so the mount-time read does not re-run (and
  // clobber user changes) when a caller passes a new function identity.
  const validateRef = useRef(validate);
  validateRef.current = validate;

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored !== null && validateRef.current(stored)) {
        setValueState(stored);
      }
    } catch {
      // localStorage can throw under privacy modes / quota; keep the default.
    }
  }, [key]);

  const setValue = useCallback(
    (next: T) => {
      setValueState(next);
      try {
        window.localStorage.setItem(key, next);
      } catch {
        // ignore - the UI still updates in memory.
      }
    },
    [key]
  );

  return [value, setValue];
}
