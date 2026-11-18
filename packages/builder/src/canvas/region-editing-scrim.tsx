"use client";

/**
 * The dim over the rest of the canvas while a region of the page's layout is
 * edited in place: everything above and below the region, the page and the
 * other region, under a see-through wash of the editor's well.
 *
 * Drawn in the chrome layer over the canvas, never on the page: the page
 * keeps its own colours and is only covered, so nothing of a site's design is
 * changed to show it is out of reach. (The page itself is also `inert` and
 * hidden from assistive technology while the region is edited, which the
 * canvas does; this is what a pointer meets.)
 *
 * A press on the dim changes nothing on the page and asks the host to pulse
 * Done (`onPress`), the way back.
 *
 * Placed as the canvas's other overlays are: the region's element found by
 * its area, measured in the canvas's content coordinates and placed in the
 * chrome's, again whenever the canvas's geometry moves.
 *
 * @module region-editing-scrim
 * @experimental Settles with editing a header or footer in place.
 */

import type { RegionArea } from "@nextlyhq/blocks-engine";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type SyntheticEvent,
} from "react";

import type { Rect } from "../geometry";
import { CANVAS_ROOT_CLASS } from "../shell-state";

import { CHROME_ATTRIBUTE } from "./canvas-chrome";
import { watchCanvasFor } from "./canvas-geometry-watch";
import { REGION_ATTRIBUTE } from "./canvas-regions";
import { canvasContentRect, overlaySpaceOf } from "./geometry-dom";

export interface RegionEditingScrimProps {
  /** The region edited in place, or `undefined` while the page is edited. */
  area: RegionArea | undefined;
  /** A press on the dim: the host pulses Done. */
  onPress: () => void;
}

export function RegionEditingScrim({
  area,
  onPress,
}: RegionEditingScrimProps): JSX.Element | null {
  const layer = useRef<HTMLDivElement | null>(null);
  const [boxes, setBoxes] = useState<readonly Rect[]>([]);
  const measure = useCallback(() => {
    const element = layer.current;
    const space =
      element === null ? null : overlaySpaceOf(element, CANVAS_ROOT_CLASS);
    if (space === null || area === undefined) {
      setBoxes(current => (current.length === 0 ? current : []));
      return;
    }
    const { root } = space;
    const region = root.querySelector(`[${REGION_ATTRIBUTE}="${area}"]`);
    const whole = canvasContentRect(root, root);
    const next = dimmedAround(
      whole,
      region === null ? undefined : canvasContentRect(region, root)
    ).map(space.place);
    setBoxes(current => (sameBoxes(current, next) ? current : next));
  }, [area]);

  useLayoutEffect(measure, [measure]);
  useEffect(() => {
    if (area === undefined) return;
    return watchCanvasFor(() => layer.current, measure);
  }, [area, measure]);

  if (area === undefined) return null;
  // Taken here, so the canvas under it never sees the press as a click on
  // its ground, which would clear the region's selection.
  const press = (event: SyntheticEvent): void => {
    event.stopPropagation();
    event.preventDefault();
  };
  return (
    <div
      ref={layer}
      className="nx-region-scrim"
      // Chrome, so the canvas's hit-testing and deselect leave it alone; and
      // a wash, which says nothing to assistive technology.
      {...{ [CHROME_ATTRIBUTE]: "" }}
      aria-hidden="true"
    >
      {boxes.map(box => (
        <div
          key={`${String(box.x)}:${String(box.y)}`}
          className="nx-region-scrim__dim"
          style={{
            left: box.x,
            top: box.y,
            width: box.width,
            height: box.height,
          }}
          onPointerDown={press}
          onClick={event => {
            press(event);
            onPress();
          }}
        />
      ))}
    </div>
  );
}

/**
 * The parts of `whole` to dim around `region`: above it and below it, the
 * full width, each left out where it has no height. Without the region
 * drawn, the whole canvas, so nothing of the page is ever left in reach.
 */
export function dimmedAround(whole: Rect, region: Rect | undefined): Rect[] {
  if (region === undefined) return [whole];
  const top = Math.max(region.y, whole.y);
  const bottom = Math.min(region.y + region.height, whole.y + whole.height);
  return [
    { x: whole.x, y: whole.y, width: whole.width, height: top - whole.y },
    {
      x: whole.x,
      y: bottom,
      width: whole.width,
      height: whole.y + whole.height - bottom,
    },
  ].filter(box => box.height > 0);
}

/** Whether two measures draw the same boxes. */
function sameBoxes(before: readonly Rect[], after: readonly Rect[]): boolean {
  return (
    before.length === after.length &&
    before.every((box, index) => {
      const other = after[index];
      return (
        other !== undefined &&
        box.x === other.x &&
        box.y === other.y &&
        box.width === other.width &&
        box.height === other.height
      );
    })
  );
}
