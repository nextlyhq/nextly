"use client";

/**
 * The line a canvas drag draws where the dragged block would land. Moved out
 * of `canvas-drag.tsx`, which still exports it beside the hook that decides
 * the target it draws.
 *
 * @module drop-indicator
 */

import { useIsomorphicLayoutEffect } from "@nextlyhq/ui";
import * as React from "react";

import { CANVAS_ROOT_CLASS } from "./canvas";
import { useCanvasFrame } from "./canvas-frame-context";
import type { DropTarget } from "./drop-targets";
import type { Rect } from "./geometry";
import { overlaySpaceOf } from "./geometry-dom";

export interface DropIndicatorProps {
  /** Where a drop would land, or null to draw nothing. */
  target: DropTarget | null;
}

/**
 * The line showing where a dropped block will go.
 *
 * The target is in the canvas root's content coordinates, which is what the
 * rectangles were measured in. Where the line is drawn in those coordinates
 * depends on where it is drawn: inside the root over a canvas sharing the
 * editor's document, or in the layer over the canvas's frame, where they are
 * scaled to the frame's zoom while the line keeps its own thickness. Asked of
 * the line's own element, through `overlaySpaceOf`, the one mapping every
 * piece of chrome uses.
 *
 * Written to the element's style before paint rather than rendered: the
 * mapping needs the element in the document, and a render to apply it would
 * draw the line at the unmapped position for a frame on every pointer move.
 *
 * `aria-hidden`, and deliberately: the equivalent keyboard move announces its
 * own outcome through the editor's one live region, and a second element
 * describing the same pointer gesture would be read alongside it. A pointer drag
 * is also self-describing to anyone who can see the line.
 */
export function DropIndicator({
  target,
}: DropIndicatorProps): React.JSX.Element | null {
  const line = React.useRef<HTMLDivElement | null>(null);
  // A zoom, or the frame's page arriving, moves the line on screen while the
  // target stays where it was.
  const canvasFrame = useCanvasFrame();
  useIsomorphicLayoutEffect(() => {
    const element = line.current;
    if (element === null || target === null) return;
    // The line is drawn ACROSS the axis children are separated along: a
    // region stacking its children downward gets a horizontal rule, a row
    // gets a vertical one.
    const span = target.to - target.from;
    const rect: Rect =
      target.axis === "y"
        ? { x: target.from, y: target.line, width: span, height: 0 }
        : { x: target.line, y: target.from, width: 0, height: span };
    const space = overlaySpaceOf(element, CANVAS_ROOT_CLASS);
    const at = space === null ? rect : space.place(rect);
    element.style.left = `${String(at.x)}px`;
    element.style.top = `${String(at.y)}px`;
    // The other dimension is the stylesheet's, so a line that changes axis
    // does not keep the length it had along the old one.
    element.style.width = target.axis === "y" ? `${String(at.width)}px` : "";
    element.style.height = target.axis === "x" ? `${String(at.height)}px` : "";
  }, [target, canvasFrame]);

  if (target === null) return null;

  return (
    <div
      ref={line}
      className="nx-drop-indicator"
      data-axis={target.axis}
      aria-hidden="true"
    />
  );
}
