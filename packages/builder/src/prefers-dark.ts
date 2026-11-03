/**
 * The viewer's colour-scheme preference, as the canvas sees it.
 *
 * One hook for every panel that shows token values the way the canvas does:
 * the style inspector's swatches and the Variables view's preview.
 *
 * @module prefers-dark
 */
import * as React from "react";

import { useCanvasFrame } from "./canvas-frame-context";

/**
 * Whether the viewer's system asks for a dark colour scheme.
 *
 * Read because the site sheet applies dark token values under
 * `@media (prefers-color-scheme:dark)`, so the canvas switches with the system
 * and nothing tells the panels. Resolving every token to its
 * light value regardless would paint swatches and report ratios for colours the
 * canvas is not showing.
 *
 * Starts `false` and subscribes after mount, so a server render and the first
 * client render agree — React discards a subtree whose two renders disagree,
 * which would take the whole Style tab with it. A viewer already in dark mode
 * sees one frame of light-mode swatches; the alternative is a hydration
 * mismatch, which is worse and harder to see.
 *
 * Asked of the CANVAS's window, which is a frame's when the canvas is in one:
 * the page's own media queries are evaluated there, so that is the window
 * whose answer the canvas is showing.
 */
export function usePrefersDark(): boolean {
  const [prefersDark, setPrefersDark] = React.useState(false);
  const view = useCanvasFrame().window;
  React.useEffect(() => {
    // Detected by CALLABILITY, not by presence. `"matchMedia" in window` is
    // true under jsdom while the value is not a function, so the property test
    // passes and the call throws — measured, and it took 85 tests down. A
    // capability check has to ask the question the caller will ask.
    if (view === null || typeof view.matchMedia !== "function") return;
    const query = view.matchMedia("(prefers-color-scheme: dark)");
    setPrefersDark(query.matches);
    const listen = (event: MediaQueryListEvent): void =>
      setPrefersDark(event.matches);
    query.addEventListener("change", listen);
    return () => query.removeEventListener("change", listen);
  }, [view]);
  return prefersDark;
}
