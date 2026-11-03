"use client";

/**
 * The marks drawn over blocks: the selection, the editable parts of a selected
 * component placement, and during a drag the container a drop would land in or
 * the one refusing it.
 *
 * A selected component placement is ONE frame around every part its component
 * draws, tagged with its name, because the parts are one thing the author
 * placed; its exposed parts keep their dash inside it, as the parts an author
 * can edit.
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
  outsetCornerRadii,
  scaleCornerRadii,
  SQUARE_CORNERS,
  type CornerRadii,
} from "./border-radii";
import {
  CANVAS_ROOT_CLASS,
  DROP_PARENT_ATTRIBUTE,
  DROP_REFUSED_ATTRIBUTE,
  LOCKED_ATTRIBUTE,
  SELECTED_ATTRIBUTE,
} from "./canvas";
import { useCanvasFrame } from "./canvas-frame-context";
import {
  OVERLAY_OUTPUT_ATTRIBUTE,
  watchCanvasFor,
} from "./canvas-geometry-watch";
import { EXPOSED_ATTRIBUTE } from "./exposed-outline";
import type { Rect } from "./geometry";
import {
  canvasContentRect,
  clippedByAncestor,
  overlaySpaceOf,
  renderedScale,
  usedRadiiOf,
  visiblePartOf,
  type OverlaySpace,
} from "./geometry-dom";
import { UNNAMED_COMPONENT } from "./layers";

/** One box to draw, in the chrome's coordinates. */
interface Mark {
  readonly kind: "selected" | "exposed" | "drop-parent" | "drop-refused";
  /** The rest of a multi-block selection, drawn thinner than the primary. */
  readonly secondary: boolean;
  /** A component placement, drawn in the component colour. */
  readonly component: boolean;
  /** A block locked in Layers, by its own lock or one around it: dashed. */
  readonly locked: boolean;
  /** Cut to the part a clipping ancestor leaves visible, with no halo band. */
  readonly clipped: boolean;
  /** The placement a component frame is drawn around, by its address. */
  readonly placement?: string;
  readonly rect: Rect;
  /** The block's own corners, in the chrome's coordinates, as `border-radius`. */
  readonly radius: string;
}

const NO_MARKS: readonly Mark[] = [];

/** @experimental */
export interface CanvasMarksProps {
  /**
   * A block's name by its address, for the tag on a component placement's
   * frame: the name its author gave it, or its component's. A placement it
   * does not name is tagged as a component.
   */
  readonly nameOf?: (address: string) => string | undefined;
}

/**
 * How far outside a block its selection ring is drawn: the ring and the halo
 * band inside it, each 2px. Outside, so the ring never covers the block's own
 * content, the first glyph of a heading set flush with its box.
 */
const RING_OUTSIDE = 4;

/**
 * The height of a placement's tag, drawn above its frame. A frame closer than
 * this to the top of the page has its tag drawn inside instead, where it is
 * still on the page.
 */
const PLACEMENT_TAG_HEIGHT = 18;

/** Everything that decides how a mark is drawn, as one comparable value. */
function markKey(mark: Mark): string {
  const { kind, secondary, component, locked, clipped, placement } = mark;
  const { radius, rect } = mark;
  return JSON.stringify([
    kind,
    secondary,
    component,
    locked,
    clipped,
    placement,
    radius,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
  ]);
}

/** Whether two lists of marks would draw the same boxes. */
function sameMarks(a: readonly Mark[], b: readonly Mark[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((mark, index) => {
    const other = b[index];
    return other !== undefined && markKey(mark) === markKey(other);
  });
}

/** Corner radii as the `border-radius` shorthand writes them, both axes. */
function borderRadiusOf(radii: CornerRadii): string {
  const { topLeft, topRight, bottomRight, bottomLeft } = radii;
  const px = (value: number): string => `${String(value)}px`;
  return (
    `${px(topLeft.x)} ${px(topRight.x)} ${px(bottomRight.x)} ${px(bottomLeft.x)} / ` +
    `${px(topLeft.y)} ${px(topRight.y)} ${px(bottomRight.y)} ${px(bottomLeft.y)}`
  );
}

/** A marked element's box and corners, in the chrome's coordinates. */
interface Outline {
  readonly rect: Rect;
  readonly radii: CornerRadii;
  readonly clipped: boolean;
}

/**
 * A marked element's box and corners, in the chrome's coordinates.
 *
 * The corners follow the block's own curve, so the ring and its halo hug a
 * rounded card rather than squaring its corners off. Square where the corners
 * cannot be read — a block transformed out of its axes, or radii a computed
 * style leaves unresolved: over a frame the mark is the only ring the block
 * has, so a block whose shape cannot be described keeps a square one rather
 * than none.
 *
 * A block an ancestor clips (`overflow: hidden` or `clip`) is marked over the
 * part left visible, square and `clipped`: the page draws nothing of it past
 * the clip, and a ring drawn there would mark what the reader cannot see.
 * A block the clip hides entirely has no outline (`null`), and where the clip
 * cannot be described, the whole box keeps a square ring.
 */
function outlineOf(
  marked: Element,
  root: HTMLElement,
  space: OverlaySpace
): Outline | null {
  const own = canvasContentRect(marked, root);
  const style = marked.ownerDocument.defaultView?.getComputedStyle(marked);
  const scale = renderedScale(marked, root);
  const radii =
    style === undefined || !scale.describable
      ? undefined
      : usedRadiiOf(style, own, scale);
  // In the root's coordinates, where the clip is asked about.
  const inRoot =
    radii === undefined
      ? SQUARE_CORNERS
      : scaleCornerRadii(radii, { x: scale.x, y: scale.y });
  if (clippedByAncestor(marked, root, inRoot)) {
    const visible = visiblePartOf(marked, root) ?? own;
    if (visible === "hidden") return null;
    return {
      rect: space.place(visible),
      radii: SQUARE_CORNERS,
      clipped: true,
    };
  }
  return {
    rect: space.place(own),
    radii: scaleCornerRadii(inRoot, { x: space.scale, y: space.scale }),
    clipped: false,
  };
}

/** The intersection of two rectangles, or `null` where they do not meet. */
function intersection(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * Where a selection ring is drawn for an outline: outside the block by
 * {@link RING_OUTSIDE}, with its rounded corners grown to stay concentric,
 * but held inside the page where the block is flush with its edge, so the ring
 * never runs off the page there.
 *
 * A clipped outline is drawn where it is: the page shows nothing past the
 * clip, so a ring outside it would ring what the reader cannot see.
 */
function ringOf(outline: Outline, page: Rect): { rect: Rect; radius: string } {
  if (outline.clipped) {
    return { rect: outline.rect, radius: borderRadiusOf(outline.radii) };
  }
  const { x, y, width, height } = outline.rect;
  const grown = {
    x: x - RING_OUTSIDE,
    y: y - RING_OUTSIDE,
    width: width + 2 * RING_OUTSIDE,
    height: height + 2 * RING_OUTSIDE,
  };
  // A block wholly off the page keeps its own box rather than none.
  return {
    rect: intersection(grown, page) ?? outline.rect,
    radius: borderRadiusOf(outsetCornerRadii(outline.radii, RING_OUTSIDE)),
  };
}

/** The smallest rectangle holding every one given. */
function unionOf(rects: readonly Rect[]): Rect {
  const left = Math.min(...rects.map(rect => rect.x));
  const top = Math.min(...rects.map(rect => rect.y));
  const right = Math.max(...rects.map(rect => rect.x + rect.width));
  const bottom = Math.max(...rects.map(rect => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * The outline around every part of one placement: their union, square unless
 * there is one part, whose corners it keeps, and cut by a clip where any part
 * is.
 */
function placementOutline(parts: readonly Outline[]): Outline {
  const [only] = parts;
  if (parts.length === 1 && only !== undefined) return only;
  return {
    rect: unionOf(parts.map(part => part.rect)),
    radii: SQUARE_CORNERS,
    clipped: parts.some(part => part.clipped),
  };
}

/** A selected placement's parts, gathered to draw one frame around them. */
interface SelectedPlacement {
  readonly parts: Outline[];
  readonly secondary: boolean;
  readonly locked: boolean;
}

/** The marked elements of a canvas root, as the boxes to draw over them. */
function marksOf(element: HTMLElement): readonly Mark[] {
  const space = overlaySpaceOf(element, CANVAS_ROOT_CLASS);
  if (space === null) return NO_MARKS;
  const { root } = space;
  const page = space.place(canvasContentRect(root, root));
  const found: Mark[] = [];
  // In the order their first part is met, which is document order.
  const placements = new Map<string, SelectedPlacement>();
  root
    .querySelectorAll(
      `[${SELECTED_ATTRIBUTE}], [${EXPOSED_ATTRIBUTE}], [${DROP_PARENT_ATTRIBUTE}], [${DROP_REFUSED_ATTRIBUTE}]`
    )
    .forEach(marked => {
      // A canvas rendered inside a block of this one marks its own elements.
      if (marked.closest(`.${CANVAS_ROOT_CLASS}`) !== root) return;
      const outline = outlineOf(marked, root, space);
      // Wholly cut away by a clipping ancestor: the page shows none of it.
      if (outline === null) return;
      const plain = { secondary: false, component: false, locked: false };
      const drawn = {
        rect: outline.rect,
        radius: borderRadiusOf(outline.radii),
        clipped: outline.clipped,
      };
      const selected = marked.getAttribute(SELECTED_ATTRIBUTE);
      // A part of a placement, by the placement's address: the canvas marks
      // only the outermost elements, so each of these is one whole part.
      const placement = marked.getAttribute(INSTANCE_ATTRIBUTE) ?? "";
      const secondary = selected !== "primary";
      const locked = marked.hasAttribute(LOCKED_ATTRIBUTE);
      if (selected !== null && placement !== "") {
        const gathered = placements.get(placement);
        if (gathered === undefined) {
          placements.set(placement, { parts: [outline], secondary, locked });
        } else gathered.parts.push(outline);
      } else if (selected !== null) {
        found.push({
          ...ringOf(outline, page),
          clipped: outline.clipped,
          kind: "selected",
          secondary,
          component: false,
          locked,
        });
      }
      // An exposed part keeps its dash inside its placement's frame. A block
      // that is itself ringed keeps its ring alone: one element draws one
      // outline, and the ring says more there.
      if (
        marked.hasAttribute(EXPOSED_ATTRIBUTE) &&
        (selected === null || placement !== "")
      ) {
        found.push({ ...drawn, ...plain, kind: "exposed" });
      }
      if (marked.hasAttribute(DROP_PARENT_ATTRIBUTE)) {
        found.push({ ...drawn, ...plain, kind: "drop-parent" });
      }
      if (marked.hasAttribute(DROP_REFUSED_ATTRIBUTE)) {
        found.push({ ...drawn, ...plain, kind: "drop-refused" });
      }
    });
  placements.forEach(({ parts, secondary, locked }, placement) => {
    const outline = placementOutline(parts);
    found.push({
      ...ringOf(outline, page),
      clipped: outline.clipped,
      kind: "selected",
      secondary,
      component: true,
      locked,
      placement,
    });
  });
  return found;
}

/** The tag on a placement's frame: a component's mark and its name. */
function placementTag(
  placement: string,
  nameOf: CanvasMarksProps["nameOf"]
): string {
  const name = nameOf?.(placement)?.trim();
  return `◇ ${name === undefined || name === "" ? UNNAMED_COMPONENT : name}`;
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
export function CanvasMarks({
  nameOf,
}: CanvasMarksProps = {}): React.JSX.Element {
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
    <div
      ref={layer}
      className="nx-canvas-marks"
      aria-hidden="true"
      // Drawn over the page and moving nothing in it, so no overlay's watch
      // re-measures for a mark being drawn.
      {...{ [OVERLAY_OUTPUT_ATTRIBUTE]: "" }}
    >
      {marks.map((mark, index) => (
        <div
          // Position in the list is the identity: the boxes carry no state.
          key={index}
          className="nx-canvas-mark"
          data-mark={mark.kind}
          data-secondary={mark.secondary ? "" : undefined}
          data-component={mark.component ? "" : undefined}
          data-locked={mark.locked ? "" : undefined}
          data-clipped={mark.clipped ? "" : undefined}
          // The tag a placement's frame carries, drawn by the stylesheet from
          // this attribute: the layer is hidden from assistive technology,
          // and the inspector names the placement in words.
          data-label={
            mark.placement === undefined
              ? undefined
              : placementTag(mark.placement, nameOf)
          }
          data-tag-inside={
            mark.placement !== undefined && mark.rect.y < PLACEMENT_TAG_HEIGHT
              ? ""
              : undefined
          }
          style={{
            left: mark.rect.x,
            top: mark.rect.y,
            width: mark.rect.width,
            height: mark.rect.height,
            borderRadius: mark.radius,
          }}
        />
      ))}
    </div>
  );
}
