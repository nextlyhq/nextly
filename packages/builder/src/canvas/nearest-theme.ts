/**
 * The nearest `data-nx-theme` marker above an element.
 *
 * The site sheet declares its token values on each marker element and custom
 * properties inherit, so what an element resolves is decided by its NEAREST
 * marker, however the markers nest. `closest()` asks exactly that question of
 * the DOM, so a surface stating this answer cannot disagree with the values it
 * draws, at any depth of alternation; a set of fixed descendant selectors can
 * only ever cover a fixed number of them.
 *
 * @module nearest-theme
 */
import { DARK_MODE_ATTRIBUTE, type TokenMode } from "@nextlyhq/blocks-engine";
import * as React from "react";

/**
 * The mode the nearest marker names, or `null` where none does.
 *
 * Exported so the inspector reads the canvas's mode by the same rule the
 * canvas states it by, rather than by a second reading of the markers.
 */
export function nearestThemeMode(element: Element): TokenMode | null {
  const mode = element
    .closest(`[${DARK_MODE_ATTRIBUTE}]`)
    ?.getAttribute(DARK_MODE_ATTRIBUTE);
  return mode === "light" || mode === "dark" ? mode : null;
}

/** The attribute the canvas states the nearest marker's mode in. */
const NEAREST_THEME_ATTRIBUTE = "data-nx-site-theme";

/**
 * State the mode the nearest marker above `root` names on `root` itself, as
 * `data-nx-site-theme`, and keep it current as markers are set, changed or
 * removed anywhere in its document. Absent while no marker names a mode,
 * which leaves the choice to the device.
 *
 * Written in a layout effect, so the first paint already shows the canvas in
 * its marker's scheme rather than the device's for a frame. Written to the
 * element directly rather than through state, because a state update from a
 * layout effect only lands in a second render, after the commit that mounted
 * the canvas.
 */
export function useNearestThemeMarker(
  root: React.RefObject<HTMLElement | null>
): void {
  React.useLayoutEffect(() => {
    const element = root.current;
    if (element === null) return;
    const write = (): void => {
      const mode = nearestThemeMode(element);
      if (mode === null) element.removeAttribute(NEAREST_THEME_ATTRIBUTE);
      else element.setAttribute(NEAREST_THEME_ATTRIBUTE, mode);
    };
    write();
    const watch = new MutationObserver(write);
    watch.observe(element.ownerDocument.documentElement, {
      attributes: true,
      attributeFilter: [DARK_MODE_ATTRIBUTE],
      subtree: true,
    });
    return () => watch.disconnect();
  }, [root]);
}
