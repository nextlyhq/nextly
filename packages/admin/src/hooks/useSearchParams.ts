"use client";

import { useEffect, useMemo, useState } from "react";

import { parseSearchParams, type SearchParams } from "@admin/lib/routing";

import { useHydration } from "./useHydration";

/**
 * Reactive read of the current URL's query string, independent of the host
 * framework's router.
 *
 * Subscribes to the same signals `useRouter` reacts to — `popstate`, plus the
 * `locationchange` event that its history patch emits on pushState/replaceState
 * — but deliberately does not patch history itself. Each `useRouter` instance
 * wraps the previous instance's pushState, so components that only need to read
 * the query string stay out of that chain rather than lengthening it.
 *
 * The raw search string is what's held in state: it compares by value, so an
 * unrelated navigation that leaves the query untouched re-renders nothing.
 */
export function useSearchParams(): SearchParams {
  const isHydrated = useHydration();
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!isHydrated) return;

    let mounted = true;
    const read = () => {
      if (mounted) setSearch(window.location.search);
    };

    read();
    window.addEventListener("popstate", read);
    window.addEventListener("locationchange", read);

    return () => {
      mounted = false;
      window.removeEventListener("popstate", read);
      window.removeEventListener("locationchange", read);
    };
  }, [isHydrated]);

  return useMemo(() => parseSearchParams(search), [search]);
}
