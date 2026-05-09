"use client";

import { useEffect, useState, useCallback } from "react";

const STORAGE_KEY = "nextly:admin:entry-rail-collapsed";

/**
 * Persists the entry-form rail's collapsed state in localStorage. The hook
 * intentionally starts in the expanded state during SSR and on first render
 * so the rail isn't hidden during hydration; it then reads localStorage
 * after mount and updates if the persisted value differs.
 */
export function useRailCollapsed(): {
  collapsed: boolean;
  toggle: () => void;
  setCollapsed: (next: boolean) => void;
} {
  const [collapsed, setCollapsedState] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "1") setCollapsedState(true);
    } catch {
      // localStorage may throw under privacy modes / quota; default to expanded.
    }
  }, []);

  const setCollapsed = useCallback((next: boolean) => {
    setCollapsedState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      // ignore — UI still updates in-memory.
    }
  }, []);

  const toggle = useCallback(() => {
    setCollapsedState(prev => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  return { collapsed, toggle, setCollapsed };
}
