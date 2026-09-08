/**
 * A list of requests made by descendants, each held for as long as its
 * requester is mounted.
 *
 * Two layout providers ask the same question in the same shape — which
 * surfaces want chrome hidden, which panels want space kept clear — and the
 * shape is where the subtlety is, not in either answer. What they resolve the
 * list INTO differs and stays with each of them.
 *
 * @module components/layout/lib/mount-registry
 */

import { useCallback, useState } from "react";

export interface MountRegistry<T> {
  /** Everything currently registered, in registration order. */
  entries: readonly T[];
  /** Adds an entry and returns the release for it. */
  register: (entry: T) => () => void;
}

/**
 * Holds registrations for a provider.
 *
 * Release is by IDENTITY, which is the part worth having once. Two requesters
 * asking for the same thing produce equal values — two panels of one width,
 * two surfaces hiding one layer — and a release that filtered by value would
 * drop both when either unmounted. The result is a provider that reports
 * nothing registered while a requester is still on screen, which reads as the
 * feature never having worked rather than as a release bug.
 */
export function useMountRegistry<T>(): MountRegistry<T> {
  const [entries, setEntries] = useState<readonly T[]>([]);

  const register = useCallback((entry: T) => {
    setEntries(current => [...current, entry]);
    return () =>
      setEntries(current => {
        const at = current.indexOf(entry);
        if (at === -1) return current;
        return [...current.slice(0, at), ...current.slice(at + 1)];
      });
  }, []);

  return { entries, register };
}
