"use client";

/**
 * The white halo just inside every selected block's ring, drawn by the editor.
 *
 * The ring is an outline on the selected element, which the page never sets
 * and so cannot lose. The halo is the second tone that keeps the ring readable
 * on the page's own colours — the select blue vanishes on a blue section, and
 * the white carries it there — and it is drawn HERE, as positioned elements in
 * the canvas's own layer, rather than as anything on the page's elements: a
 * `box-shadow` replaced the block's own shadow, and an `anchor-name` replaced
 * the block's own anchor and could mark only one of the elements a selection
 * renders. Measured, the canvas leaves the page exactly as the page styles it.
 *
 * EVERY selected rendering gets one: each member of a multi-selection, and each
 * copy of a node a block draws more than once — `core/collection-loop` draws
 * its children once per entry, and the canvas marks every copy.
 *
 * @module selection-halos
 */

import { INSTANCE_ATTRIBUTE } from "@nextlyhq/blocks-react";
import * as React from "react";

import { SELECTED_ATTRIBUTE } from "./canvas";
import { watchCanvasFor } from "./canvas-geometry-watch";
import type { Rect } from "./geometry";
import { canvasContentRect, canvasRootFrom } from "./geometry-dom";
import { CANVAS_ROOT_CLASS } from "./shell-state";

/** One selected rendering, measured in the canvas's content coordinates. */
interface Halo extends Rect {
  /** The primary selection, whose ring is the full width. */
  readonly primary: boolean;
  /** A component placement, whose ring is the component colour. */
  readonly component: boolean;
}

const NO_HALOS: readonly Halo[] = [];

function sameHalos(a: readonly Halo[], b: readonly Halo[]): boolean {
  return (
    a.length === b.length &&
    a.every((halo, index) => {
      const other = b[index];
      return (
        other !== undefined &&
        halo.primary === other.primary &&
        halo.component === other.component &&
        halo.x === other.x &&
        halo.y === other.y &&
        halo.width === other.width &&
        halo.height === other.height
      );
    })
  );
}

/**
 * The halos, for the canvas's `overlay`.
 *
 * Reads WHICH elements are selected from the marks the canvas puts on them
 * rather than deciding it again: which rendering stands for a selected node is
 * the canvas's question, and a second answer here would drift from the ring.
 * The marks are written after this layer renders, so the geometry watch — which
 * hears attribute changes on the page — is what draws the first halo, as well
 * as moving every halo with the layout.
 */
export function SelectionHalos(): React.JSX.Element {
  const layer = React.useRef<HTMLDivElement | null>(null);
  const [halos, setHalos] = React.useState<readonly Halo[]>(NO_HALOS);

  const measure = React.useCallback(() => {
    const element = layer.current;
    const root =
      element === null ? null : canvasRootFrom(element, CANVAS_ROOT_CLASS);
    const next: Halo[] = [];
    if (root !== null) {
      root.querySelectorAll(`[${SELECTED_ATTRIBUTE}]`).forEach(selected => {
        // Another canvas's selection is that canvas's to draw.
        if (selected.closest(`.${CANVAS_ROOT_CLASS}`) !== root) return;
        // Through `canvasContentRect`, the one place this package reads a
        // rectangle, so the halo and every other overlay agree at any scroll.
        const rect = canvasContentRect(selected, root);
        next.push({
          ...rect,
          primary: selected.getAttribute(SELECTED_ATTRIBUTE) === "primary",
          component: selected.hasAttribute(INSTANCE_ATTRIBUTE),
        });
      });
    }
    setHalos(current => (sameHalos(current, next) ? current : next));
  }, []);

  // Before paint, so a halo never shows where the block was a render ago.
  React.useLayoutEffect(() => {
    measure();
  });

  // Every later move: a selection mark changing, an image loading, a resize, a
  // scroll. The layer is how the watch finds the root and ignores its own
  // writes, so drawing a halo does not schedule the next measurement.
  React.useEffect(
    () => watchCanvasFor(() => layer.current, measure),
    [measure]
  );

  return (
    <div ref={layer} className="nx-selection-halos" aria-hidden="true">
      {halos.map((halo, index) => (
        <div
          // By position in document order: the halos carry no identity of their
          // own, and a re-measure replaces them all.
          key={index}
          className="nx-selection-halo"
          data-primary={halo.primary ? "" : undefined}
          data-component={halo.component ? "" : undefined}
          // The element's own rectangle: the ring and band are drawn inside it
          // by the stylesheet, from the same edge the element's ring uses.
          style={{
            left: halo.x,
            top: halo.y,
            width: halo.width,
            height: halo.height,
          }}
        />
      ))}
    </div>
  );
}
