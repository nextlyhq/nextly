"use client";

import { useEffect, useState, useCallback } from "react";

import {
  recallPreference,
  rememberPreference,
} from "@admin/lib/device-memory/device-memory";

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
    // Read through the device memory, which guards storage that throws
    // (privacy modes, quota): nothing read means expanded.
    if (recallPreference(STORAGE_KEY) === "1") setCollapsedState(true);
  }, []);

  const setCollapsed = useCallback((next: boolean) => {
    setCollapsedState(next);
    // Kept through the device memory, which keeps nothing where the site
    // turned remembering off; the UI still updates in memory.
    rememberPreference(STORAGE_KEY, next ? "1" : "0");
  }, []);

  const toggle = useCallback(() => {
    setCollapsedState(prev => {
      const next = !prev;
      rememberPreference(STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  }, []);

  return { collapsed, toggle, setCollapsed };
}
