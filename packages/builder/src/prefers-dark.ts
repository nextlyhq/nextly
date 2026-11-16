/**
 * The viewer's colour-scheme preference, as the canvas sees it.
 *
 * One hook for every panel that shows token values the way the canvas does:
 * the style inspector's swatches and the Variables view's preview.
 *
 * @module prefers-dark
 */
import { DARK_MODE_ATTRIBUTE, type TokenMode } from "@nextlyhq/blocks-engine";
import * as React from "react";

import { useCanvasFrame } from "./canvas-frame-context";
import { nearestThemeMode } from "./nearest-theme";
import { CANVAS_ROOT_CLASS } from "./shell-state";

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

/**
 * The mode the canvas shows site variables in where the selected block is
 * drawn: the `data-nx-theme` marker nearest that block's element, which a
 * marker nested inside the page can set, else the one nearest the canvas
 * root, else the device's preference.
 *
 * THE one answer for every inspector control that shows a variable's value,
 * the colour picker's swatches, the variables list and its chip, and what a
 * typed variable name may match, so none of them shows or accepts a value of
 * the mode the selected block is not drawn in.
 *
 * Asked ONCE, by the Style panel, which hands the answer to its controls
 * through {@link CanvasTokenModeProvider}: a subscription per control would
 * repeat the same reading, on every change to the canvas, once per field.
 */
export function useCanvasTokenModeAt(selectedId: string | null): TokenMode {
  const prefersDark = usePrefersDark();
  const doc = useCanvasFrame().document;
  const marker = React.useSyncExternalStore(
    React.useCallback(
      (changed: () => void) =>
        doc === null ? () => undefined : watchMarkers(doc, changed),
      [doc]
    ),
    () => (doc === null ? null : canvasMarker(doc, selectedId)),
    // A server render has no canvas, and the device decides, as it does
    // before the client's first answer.
    () => null
  );
  return marker ?? (prefersDark ? "dark" : "light");
}

/** The mode the Style panel read, handed to its controls. */
const CanvasTokenModeContext = React.createContext<TokenMode | null>(null);

/** Hands the panel's one reading of the mode to every control inside it. */
export const CanvasTokenModeProvider: React.Provider<TokenMode | null> =
  CanvasTokenModeContext.Provider;

/**
 * The mode a control shows variables in, as its panel read it. Light outside
 * a panel, which is what a document with no mode resolves.
 */
export function useCanvasTokenMode(): TokenMode {
  return React.useContext(CanvasTokenModeContext) ?? "light";
}

/**
 * The mode the marker nearest the selected block's element names, else the
 * one nearest the canvas root, or `null` where no marker names one.
 */
function canvasMarker(
  doc: Document,
  selectedId: string | null
): TokenMode | null {
  const drawn =
    selectedId === null
      ? undefined
      : [...doc.querySelectorAll("[data-nx-node]")].find(
          element => element.getAttribute("data-nx-node") === selectedId
        );
  const at = drawn ?? doc.querySelector(`.${CANVAS_ROOT_CLASS}`);
  return at === null ? null : nearestThemeMode(at);
}

/**
 * The listeners waiting on one document's markers, and the one observer that
 * serves them, so a second panel reading the same canvas adds a listener and
 * not an observer.
 */
const MARKER_WATCHERS = new WeakMap<
  Document,
  { listeners: Set<() => void>; observer: MutationObserver | null }
>();

/**
 * Call `changed` whenever a marker is set, changed or removed in `doc`, or
 * the canvas root arrives already under one. Answers the way to stop.
 */
function watchMarkers(doc: Document, changed: () => void): () => void {
  let watch = MARKER_WATCHERS.get(doc);
  if (watch === undefined) {
    const listeners = new Set<() => void>();
    const Observer = doc.defaultView?.MutationObserver;
    // Built from the document's own window, the realm of what it observes.
    const observer =
      typeof Observer === "function"
        ? new Observer(() => {
            for (const listener of listeners) listener();
          })
        : null;
    observer?.observe(doc.documentElement, {
      attributes: true,
      attributeFilter: [DARK_MODE_ATTRIBUTE],
      childList: true,
      subtree: true,
    });
    watch = { listeners, observer };
    MARKER_WATCHERS.set(doc, watch);
  }
  const held = watch;
  held.listeners.add(changed);
  return () => {
    held.listeners.delete(changed);
    if (held.listeners.size > 0) return;
    held.observer?.disconnect();
    MARKER_WATCHERS.delete(doc);
  };
}
