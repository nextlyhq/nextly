"use client";

/**
 * The marks drawn over blocks: the selection, and during a drag the container
 * a drop would land in or the one refusing it.
 *
 * The canvas decides WHICH elements are marked and says so with attributes on
 * them (`useCanvasMarkers` in `canvas.tsx`): every rendering of a selected
 * node, the outermost element of a component placement, the drop container.
 * This draws a box over each of those elements, in the editor's chrome rather
 * than as a style of the element, so the site's CSS cannot restyle or hide the
 * mark and the mark keeps its width at any zoom. Reading the attributes rather
 * than resolving the ids again keeps one answer to "what is marked".
 *
 * @module canvas-marks
 */

import { INSTANCE_ATTRIBUTE } from "@nextlyhq/blocks-react";
import * as React from "react";

import {
  CANVAS_ROOT_CLASS,
  DROP_PARENT_ATTRIBUTE,
  DROP_REFUSED_ATTRIBUTE,
  SELECTED_ATTRIBUTE,
} from "./canvas";
import { useCanvasFrame } from "./canvas-frame-context";
import { watchCanvasFor } from "./canvas-geometry-watch";
import type { Rect } from "./geometry";
import { canvasContentRect, overlaySpaceOf } from "./geometry-dom";

/** One box to draw, in the chrome's coordinates. */
interface Mark {
  readonly kind: "selected" | "drop-parent" | "drop-refused";
  /** The rest of a multi-block selection, drawn thinner than the primary. */
  readonly secondary: boolean;
  /** A component placement, drawn in the component colour. */
  readonly component: boolean;
  readonly rect: Rect;
}

const NO_MARKS: readonly Mark[] = [];

/** Whether two lists of marks would draw the same boxes. */
function sameMarks(a: readonly Mark[], b: readonly Mark[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((mark, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      mark.kind === other.kind &&
      mark.secondary === other.secondary &&
      mark.component === other.component &&
      mark.rect.x === other.rect.x &&
      mark.rect.y === other.rect.y &&
      mark.rect.width === other.rect.width &&
      mark.rect.height === other.rect.height
    );
  });
}

/** The marked elements of a canvas root, as the boxes to draw over them. */
function marksOf(element: HTMLElement): readonly Mark[] {
  const space = overlaySpaceOf(element, CANVAS_ROOT_CLASS);
  if (space === null) return NO_MARKS;
  const { root } = space;
  const found: Mark[] = [];
  root
    .querySelectorAll(
      `[${SELECTED_ATTRIBUTE}], [${DROP_PARENT_ATTRIBUTE}], [${DROP_REFUSED_ATTRIBUTE}]`
    )
    .forEach(marked => {
      // A canvas rendered inside a block of this one marks its own elements.
      if (marked.closest(`.${CANVAS_ROOT_CLASS}`) !== root) return;
      const rect = space.place(canvasContentRect(marked, root));
      const selected = marked.getAttribute(SELECTED_ATTRIBUTE);
      if (selected !== null) {
        found.push({
          kind: "selected",
          secondary: selected !== "primary",
          component: marked.hasAttribute(INSTANCE_ATTRIBUTE),
          rect,
        });
      }
      if (marked.hasAttribute(DROP_PARENT_ATTRIBUTE)) {
        found.push({
          kind: "drop-parent",
          secondary: false,
          component: false,
          rect,
        });
      }
      if (marked.hasAttribute(DROP_REFUSED_ATTRIBUTE)) {
        found.push({
          kind: "drop-refused",
          secondary: false,
          component: false,
          rect,
        });
      }
    });
  return found;
}

/**
 * The marks over the canvas's blocks.
 *
 * Re-measured whenever the canvas may have moved or been re-marked —
 * `watchCanvasFor` hears the attributes change as well as the layout — and
 * when the frame's zoom or page changes, which moves every block on screen
 * while nothing inside the frame changes size.
 *
 * @experimental
 */
export function CanvasMarks(): React.JSX.Element {
  const layer = React.useRef<HTMLDivElement | null>(null);
  const [marks, setMarks] = React.useState<readonly Mark[]>(NO_MARKS);
  const canvasFrame = useCanvasFrame();

  const measure = React.useCallback(() => {
    const element = layer.current;
    const next = element === null ? NO_MARKS : marksOf(element);
    setMarks(current => (sameMarks(current, next) ? current : next));
  }, []);

  React.useLayoutEffect(() => {
    measure();
  }, [measure, canvasFrame]);

  React.useEffect(
    () => watchCanvasFor(() => layer.current, measure),
    [measure, canvasFrame]
  );

  return (
    // Hidden from assistive technology: the selection is announced by the
    // editor's live region and named in the inspector, and a box says nothing.
    <div ref={layer} className="nx-canvas-marks" aria-hidden="true">
      {marks.map((mark, index) => (
        <div
          // Position in the list is the identity: the boxes carry no state.
          key={index}
          className="nx-canvas-mark"
          data-mark={mark.kind}
          data-secondary={mark.secondary ? "" : undefined}
          data-component={mark.component ? "" : undefined}
          style={{
            left: mark.rect.x,
            top: mark.rect.y,
            width: mark.rect.width,
            height: mark.rect.height,
          }}
        />
      ))}
    </div>
  );
}
