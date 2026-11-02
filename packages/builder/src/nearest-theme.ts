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

/** The mode the nearest marker names, or `null` where none does. */
function nearestMarker(element: Element): TokenMode | null {
  const mode = element
    .closest(`[${DARK_MODE_ATTRIBUTE}]`)
    ?.getAttribute(DARK_MODE_ATTRIBUTE);
  return mode === "light" || mode === "dark" ? mode : null;
}

/**
 * The mode the nearest marker above `root` names, kept current as markers
 * are set, changed or removed anywhere in its document. `null` while there is
 * none, which leaves the choice to the device.
 */
export function useNearestThemeMarker(
  root: React.RefObject<HTMLElement | null>
): TokenMode | null {
  const [mode, setMode] = React.useState<TokenMode | null>(null);
  React.useEffect(() => {
    const element = root.current;
    if (element === null) return;
    const read = (): void => setMode(nearestMarker(element));
    read();
    const watch = new MutationObserver(read);
    watch.observe(element.ownerDocument.documentElement, {
      attributes: true,
      attributeFilter: [DARK_MODE_ATTRIBUTE],
      subtree: true,
    });
    return () => watch.disconnect();
  }, [root]);
  return mode;
}
