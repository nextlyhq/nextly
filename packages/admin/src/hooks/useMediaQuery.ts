"use client";

import { useEffect, useState } from "react";

/**
 * Whether a CSS media query currently matches.
 *
 * For layouts that must CHOOSE a tree rather than style one. Where a class can
 * do the job — `hidden lg:flex` and friends — use the class: CSS needs no
 * hydration and no listener. This exists for the case where rendering both
 * branches is wrong rather than merely wasteful, which is any branch holding
 * labelled form controls: two copies means a screen reader announces every
 * field twice, and one of the two is invisible to the person hearing it.
 *
 * SSR-safe by construction: the first render always answers `false`, and the
 * real answer arrives in an effect. A caller that must not flash the wrong
 * branch should therefore gate on hydration as well as on this.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    // Guarded rather than assumed: jsdom without a matchMedia stub, and any
    // non-browser host, would otherwise throw during an effect.
    if (typeof window === "undefined" || !window.matchMedia) return;

    const list = window.matchMedia(query);
    setMatches(list.matches);

    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
