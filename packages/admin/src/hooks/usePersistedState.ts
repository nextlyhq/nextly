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

/**
 * A persisted Set of strings with functional updates.
 *
 * The updater form is the point: deriving the next Set from the previous
 * value inside the state setter means two rapid toggles (separate pointer
 * events, before React re-renders) both apply instead of the second one
 * clobbering the first from a stale closure. Same SSR behavior as
 * {@link usePersistedState}: empty on first render, hydrated after mount.
 */
export function usePersistedStringSet(
  key: string
): [Set<string>, (update: (prev: Set<string>) => Set<string>) => void] {
  const [value, setValueState] = useState<Set<string>>(() => new Set());

  // Mirror of the latest committed-or-pending value. Every change flows
  // through the hydration effect or setValue below, so the ref never needs a
  // render-phase assignment. It exists so consecutive setValue calls in the
  // same frame each build on the previous one instead of a stale render
  // value - and so the state updater itself stays a pure plain-value set
  // (React may replay or abandon updaters; side effects inside one can
  // persist a value that never commits).
  const valueRef = useRef(value);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored === null) return;
      const parsed: unknown = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        // Keep only string members; anything else is a corrupt/stale value.
        const strings = parsed.filter(
          (item): item is string => typeof item === "string"
        );
        const hydrated = new Set(strings);
        valueRef.current = hydrated;
        setValueState(hydrated);
      }
    } catch {
      // localStorage/JSON can throw under privacy modes or corruption; keep
      // the empty default.
    }
  }, [key]);

  const setValue = useCallback(
    (update: (prev: Set<string>) => Set<string>) => {
      const next = update(valueRef.current);
      valueRef.current = next;
      setValueState(next);
      // Persisting here (the event handler) keeps the write out of React's
      // render phase entirely.
      try {
        window.localStorage.setItem(key, JSON.stringify([...next]));
      } catch {
        // ignore - the UI still updates in memory.
      }
    },
    [key]
  );

  return [value, setValue];
}
