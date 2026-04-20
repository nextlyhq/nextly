"use client";

import React from "react";

interface UseSidebarPinsOptions {
  storageKey: string;
}

function loadPinnedItems(storageKey: string): string[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function savePinnedItems(storageKey: string, pinnedItems: string[]): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(pinnedItems));
  } catch {
    // Ignore localStorage write errors (private mode, quota, etc.)
  }
}

/**
 * Shared localStorage-backed pin manager for sidebar lists.
 */
export function useSidebarPins({ storageKey }: UseSidebarPinsOptions) {
  const [pinned, setPinned] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    setPinned(new Set(loadPinnedItems(storageKey)));
  }, [storageKey]);

  const togglePin = React.useCallback(
    (itemId: string) => {
      setPinned(prev => {
        const next = new Set(prev);
        if (next.has(itemId)) {
          next.delete(itemId);
        } else {
          next.add(itemId);
        }

        savePinnedItems(storageKey, Array.from(next));
        return next;
      });
    },
    [storageKey]
  );

  const isPinned = React.useCallback(
    (itemId: string) => pinned.has(itemId),
    [pinned]
  );

  return {
    pinned,
    isPinned,
    togglePin,
  };
}
