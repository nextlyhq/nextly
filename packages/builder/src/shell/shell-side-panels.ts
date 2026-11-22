/**
 * The shell's side panels: which one shows, whether each side is open, and
 * focus kept inside the shell when a side closes under it.
 *
 * @module shell-side-panels
 */
import * as React from "react";

import {
  LEFT_PANELS,
  panelAfterRailClick,
  type LeftPanel,
  type ShellPreferences,
} from "../shell-state";

import { useSidesShortcut, type Region } from "./shell-region-cycling";

/**
 * The left panel to show when the author asks for the left side back: the one
 * they had open, else the first the host offers, in the rail's order.
 */
function panelToShow(
  remembered: LeftPanel | null,
  isAvailable: (panel: LeftPanel) => boolean
): LeftPanel | null {
  if (remembered !== null && isAvailable(remembered)) return remembered;
  return LEFT_PANELS.find(isAvailable) ?? remembered;
}

/**
 * Move focus out of the sides about to be hidden, onto the canvas.
 *
 * A hidden side unmounts the element holding focus, which leaves it on the
 * page body. With two editors on a page, neither claims a key pressed there,
 * so the same shortcut could not bring the sides back.
 */
function keepFocusInShell(
  regions: Record<Region, HTMLElement | null>,
  hiding: readonly Region[]
): void {
  // The host's own reading, for the reason `shellClaimsRegionCycling` gives.
  const focused = document.activeElement;
  if (!hiding.some(region => regions[region]?.contains(focused) === true)) {
    return;
  }
  (regions.canvas ?? regions.header)?.focus();
}

/**
 * Which sides of the editor show, and the actions that change them: the
 * rail, the top bar's two buttons and mod+backslash.
 *
 * `isAvailable` is the shell's one answer to "can the host fill this panel",
 * so the panel shown here and the item the rail draws cannot disagree.
 */
export function useSidePanels(
  preferences: ShellPreferences,
  update: (change: (current: ShellPreferences) => ShellPreferences) => void,
  isAvailable: (panel: LeftPanel) => boolean,
  active: boolean,
  claims: () => boolean,
  regionRefs: React.RefObject<Record<Region, HTMLElement | null>>
): {
  openPanel: LeftPanel | null;
  inspectorShown: boolean;
  leftShown: boolean;
  selectPanel: (panel: LeftPanel) => void;
  /** Absent when the host offers no left panel: there is nothing to show. */
  toggleLeft: (() => void) | undefined;
  toggleInspector: () => void;
} {
  const restored = preferences.leftPanel;
  // A hidden left side shows no panel, but keeps which one was open.
  const openPanel =
    !preferences.leftPanelHidden && restored !== null && isAvailable(restored)
      ? restored
      : null;
  const inspectorShown = !preferences.inspectorHidden;
  // From the rail. While the left side is hidden, choosing a panel shows it
  // rather than toggling: the author asked to see that panel.
  const selectPanel = (panel: LeftPanel) => {
    // Closing the open panel, by its item or its key, unmounts what may hold
    // focus: it goes to the canvas, as hiding a side sends it.
    if (openPanel === panel) keepFocusInShell(regionRefs.current, ["panel"]);
    update(current =>
      current.leftPanelHidden
        ? { ...current, leftPanel: panel, leftPanelHidden: false }
        : {
            ...current,
            leftPanel: panelAfterRailClick(current.leftPanel, panel),
          }
    );
  };
  /*
   * The top bar's left-panel button. Showing it with no panel chosen opens
   * the first panel the host offers, Add where it offers that.
   */
  const leftShown = openPanel !== null;
  const toggleLeft = () => {
    if (leftShown) keepFocusInShell(regionRefs.current, ["panel"]);
    update(current =>
      leftShown
        ? { ...current, leftPanelHidden: true }
        : {
            ...current,
            leftPanel: panelToShow(current.leftPanel, isAvailable),
            leftPanelHidden: false,
          }
    );
  };
  const toggleInspector = () => {
    if (inspectorShown) keepFocusInShell(regionRefs.current, ["inspector"]);
    update(current => ({
      ...current,
      inspectorHidden: !current.inspectorHidden,
    }));
  };
  /*
   * mod+backslash: hide both sides when either is showing, so one press
   * always gives the canvas the whole width; show both when neither is.
   */
  const toggleSides = () => {
    const anyShown = leftShown || inspectorShown;
    if (anyShown) keepFocusInShell(regionRefs.current, ["panel", "inspector"]);
    update(current => ({
      ...current,
      leftPanelHidden: anyShown,
      inspectorHidden: anyShown,
      ...(anyShown
        ? {}
        : { leftPanel: panelToShow(current.leftPanel, isAvailable) }),
    }));
  };
  const toggleSidesRef = React.useRef(toggleSides);
  toggleSidesRef.current = toggleSides;
  useSidesShortcut(toggleSidesRef, active, claims);
  return {
    openPanel,
    inspectorShown,
    leftShown,
    selectPanel,
    toggleLeft: LEFT_PANELS.some(isAvailable) ? toggleLeft : undefined,
    toggleInspector,
  };
}
