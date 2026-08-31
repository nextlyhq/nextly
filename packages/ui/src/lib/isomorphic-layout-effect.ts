import * as React from "react";

/**
 * A layout effect in the browser, a plain effect where there is no DOM.
 *
 * These components are client code, but a consumer may still PRERENDER them,
 * and React warns that `useLayoutEffect` does nothing on the server. Layout
 * timing is what the browser needs wherever an effect has to be settled before
 * anything else can observe it — a registration that must exist before the
 * first frame, or a native listener that must be the current one before the
 * next event reaches it. Neither effect runs during a server render, so
 * choosing between them by environment loses nothing and silences a warning
 * that reports no real problem.
 *
 * Published rather than kept beside its first caller, because a second one
 * arrived: two spellings of this choice would drift the first time either
 * learned something about a new environment.
 */
export const useIsomorphicLayoutEffect =
  typeof document === "undefined" ? React.useEffect : React.useLayoutEffect;
