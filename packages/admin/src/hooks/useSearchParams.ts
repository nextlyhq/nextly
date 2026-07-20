"use client";

import { useMemo, useSyncExternalStore } from "react";

import { parseSearchParams, type SearchParams } from "@admin/lib/routing";

/**
 * Subscribe to the signals that change the URL without a document load:
 * `popstate` for back/forward, plus the `locationchange` event `useRouter`'s
 * history patch emits on pushState/replaceState.
 */
function subscribe(onStoreChange: () => void): () => void {
  window.addEventListener("popstate", onStoreChange);
  window.addEventListener("locationchange", onStoreChange);
  return () => {
    window.removeEventListener("popstate", onStoreChange);
    window.removeEventListener("locationchange", onStoreChange);
  };
}

/** The raw query string compares by value, so React can skip equal snapshots. */
function getSearchSnapshot(): string {
  return window.location.search;
}

/** No query string exists while rendering on the server. */
function getServerSearchSnapshot(): string {
  return "";
}

/**
 * Reactive read of the current URL's query string, independent of the host
 * framework's router.
 *
 * Reads through `useSyncExternalStore` rather than an effect so the value is
 * present on the first render: consumers key data fetches off these params, and
 * an initial empty pass would fetch once unfiltered and again once the real
 * params arrived. The server snapshot keeps that safe under SSR, where React
 * hydrates against the empty string and then re-reads.
 *
 * Deliberately does not patch history, unlike `useRouter` — each of those
 * instances wraps the previous one's pushState, so components that only read
 * the query string stay out of that chain rather than lengthening it.
 */
export function useSearchParams(): SearchParams {
  const search = useSyncExternalStore(
    subscribe,
    getSearchSnapshot,
    getServerSearchSnapshot
  );

  return useMemo(() => parseSearchParams(search), [search]);
}
