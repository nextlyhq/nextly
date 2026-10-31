/**
 * Which view of the library is on screen: every item, or one of the views
 * beside the folders (images missing alt text, items nothing uses). Shared by
 * the sidebar, which picks it, and the library, which lists it; a folder
 * picked in either clears it, since a view spans every folder.
 */

import { useSyncExternalStore } from "react";

import type { MediaLibraryView } from "@admin/types/media";

let current: MediaLibraryView | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): MediaLibraryView | null {
  return current;
}

/** Show a view, or every item (`null`). */
export function setMediaLibraryView(view: MediaLibraryView | null): void {
  if (view === current) return;
  current = view;
  for (const listener of listeners) listener();
}

/** The view on screen, or `null` for every item. */
export function useMediaLibraryView(): MediaLibraryView | null {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}

/** What each view is called, on its row and above its items. */
export const MEDIA_LIBRARY_VIEW_LABELS: Record<MediaLibraryView, string> = {
  "missing-alt": "Missing alt text",
  unused: "Unused",
};
