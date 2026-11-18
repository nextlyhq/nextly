"use client";

/**
 * The line on the canvas where the Add panel's highlighted tile would land.
 *
 * While a tile is pointed at or has the keyboard's highlight, the panel hands
 * its place and words to the canvas (`insertion-preview`), and this draws
 * them: the drag's drop line at that place, with the panel's words on a small
 * label at its start, so the author sees where a click would put the block
 * before clicking. An empty container the block would go inside is lit
 * instead, in the look an empty container takes when pointed at.
 *
 * **Calm.** It never animates and never scrolls the canvas: a new tile moves
 * it at once, and the panel keeps it a moment after the pointer leaves the
 * tiles, so crossing the gaps between them does not make it blink. A place
 * off screen gets its label alone, pinned to the canvas edge nearest it with
 * an arrow; pressing that label, never pointing at it, scrolls the place into
 * view.
 *
 * Drawn in the canvas's overlay and only re-rendered by the preview: the page
 * is never drawn again for it, and only the place's own region is measured.
 *
 * @module insertion-line
 */
import type { BlockDocument } from "@nextlyhq/blocks-engine";
import { NODE_ID_ATTRIBUTE } from "@nextlyhq/blocks-react";
import { useIsomorphicLayoutEffect } from "@nextlyhq/ui";
import * as React from "react";

import type { Rect } from "../geometry";

import {
  CANVAS_ROOT_CLASS,
  isOutermostForAddress,
  nodeAddressOf,
} from "./canvas";
import { useCanvasFrame } from "./canvas-frame-context";
import {
  OVERLAY_OUTPUT_ATTRIBUTE,
  watchCanvasFor,
  watchScreenBand,
} from "./canvas-geometry-watch";
import { DropIndicator } from "./drop-indicator";
import type { DropTarget, RectSource } from "./drop-targets";
import {
  canvasContentRect,
  canvasScroller,
  onScreenBandOf,
  onScreenOf,
  overlaySpaceOf,
} from "./geometry-dom";
import { insertionMarkOf } from "./insertion-line-geometry";
import {
  useInsertionPreview,
  type InsertionPreview,
} from "./insertion-preview";

export interface InsertionLineProps {
  /** The page the place is in, as the panel judged it. */
  readonly document: BlockDocument;
}

/** What is drawn for the preview, in the chrome's coordinates. */
type Drawn =
  | {
      readonly kind: "line";
      readonly target: DropTarget;
      /** The line's start, where its label sits. */
      readonly start: { readonly x: number; readonly y: number };
      /** No room above the line on screen, so the label goes below it. */
      readonly labelBelow: boolean;
    }
  | {
      readonly kind: "edge";
      /** The place, in the canvas's content coordinates, to scroll to. */
      readonly place: Rect;
      /** Which edge of the canvas the label is pinned to. */
      readonly edge: "top" | "bottom";
      readonly left: number;
      readonly top: number;
    }
  | { readonly kind: "empty"; readonly rect: Rect };

/** How far an edge label keeps from the canvas's edge, in pixels. */
const EDGE_GAP = 8;

/** The room a label above its line needs on screen, in pixels. */
const LABEL_ROOM = 22;

/**
 * How long an edge label outlasts the panel letting go of its place: long
 * enough for the pointer to cross from the tiles to the label and press it.
 * Pointed at, it stays for as long as the pointer does.
 */
export const EDGE_HOLD_MS = 1500;

/**
 * The rectangles of a canvas's blocks, each measured only when asked for, so
 * the place's region is measured and the rest of the page is not.
 *
 * Found by comparing each element's address in JavaScript rather than with a
 * selector built from an id, which reaches this from stored data. The
 * outermost element stands for a block, as a drag measures it.
 */
function lazyRects(root: HTMLElement): RectSource {
  const elements = new Map<string, Element>();
  root.querySelectorAll(`[${NODE_ID_ATTRIBUTE}]`).forEach(element => {
    const id = nodeAddressOf(element);
    if (id !== null && isOutermostForAddress(element, id, root)) {
      elements.set(id, element);
    }
  });
  // Each block read once per measure, however often the geometry asks.
  const measured = new Map<string, Rect | undefined>();
  return {
    rectOf: id => {
      if (!measured.has(id)) {
        const element = elements.get(id);
        measured.set(
          id,
          element === undefined ? undefined : canvasContentRect(element, root)
        );
      }
      return measured.get(id);
    },
    rootRect: () => canvasContentRect(root, root),
  };
}

/** The line's rectangle in the canvas's content coordinates. */
function lineRectOf(target: DropTarget): Rect {
  return target.axis === "y"
    ? {
        x: target.from,
        y: target.line,
        width: target.to - target.from,
        height: 0,
      }
    : {
        x: target.line,
        y: target.from,
        width: 0,
        height: target.to - target.from,
      };
}

/**
 * The label pinned to the canvas edge for a place off screen, or `undefined`
 * for one on screen. `place` is in the canvas's coordinates, to scroll to;
 * `drawnAt` and `screen` are in the chrome's.
 */
function edgeLabelFor(
  place: Rect,
  drawnAt: Rect,
  screen: Rect
): Drawn | undefined {
  const above = drawnAt.y + drawnAt.height < screen.y;
  const below = drawnAt.y > screen.y + screen.height;
  if (!above && !below) return undefined;
  return {
    kind: "edge",
    place,
    edge: above ? "top" : "bottom",
    left: Math.max(screen.x + EDGE_GAP, drawnAt.x),
    top: above ? screen.y + EDGE_GAP : screen.y + screen.height - EDGE_GAP,
  };
}

/** The preview's drawing, measured from the layer it is drawn in. */
function drawnFor(
  layer: HTMLElement,
  document: BlockDocument,
  at: Parameters<typeof insertionMarkOf>[1]
): Drawn | null {
  const space = overlaySpaceOf(layer, CANVAS_ROOT_CLASS);
  if (space === null) return null;
  const rects = lazyRects(space.root);
  const mark = insertionMarkOf(document, at, rects);
  if (mark === undefined) return null;
  // The place in the canvas's own coordinates: the line, or the empty
  // container it would light.
  const place =
    mark.kind === "empty"
      ? rects.rectOf(mark.containerId)
      : lineRectOf(mark.target);
  if (place === undefined) return null;
  const drawnAt = space.place(place);
  const screen = onScreenOf(space);
  const edge = edgeLabelFor(place, drawnAt, screen);
  if (edge !== undefined) return edge;
  if (mark.kind === "empty") return { kind: "empty", rect: drawnAt };
  return {
    kind: "line",
    target: mark.target,
    start: { x: drawnAt.x, y: drawnAt.y },
    labelBelow: drawnAt.y - LABEL_ROOM < screen.y,
  };
}

/**
 * Scroll the canvas so the place is in the middle of what it shows. Asked of
 * the canvas's own scroller, the frame's page where the canvas has a frame.
 */
function scrollToPlace(layer: HTMLElement, place: Rect): void {
  const space = overlaySpaceOf(layer, CANVAS_ROOT_CLASS);
  if (space === null) return;
  const scroller = canvasScroller(space.root, space.frame !== null);
  if (scroller === null) return;
  const band = onScreenBandOf(space.root, space.frame);
  const along = place.y + place.height / 2;
  scroller.scrollBy({ top: along - (band.y + band.height / 2) });
}

/**
 * The preview to draw: the panel's, or the one an edge label is holding on
 * to after the panel let go, so the pointer can reach the label and press
 * it. Held for {@link EDGE_HOLD_MS}, and for as long as the label is
 * pointed at; let go of when pressed.
 */
function useHeldPreview(
  preview: InsertionPreview | null,
  holdsEdge: boolean
): {
  shown: InsertionPreview | null;
  pointed: (inside: boolean) => void;
  release: () => void;
} {
  const [held, setHeld] = React.useState<InsertionPreview | null>(null);
  const last = React.useRef<InsertionPreview | null>(null);
  // Read when the panel lets go, not a reason to run again on its own.
  const edgeShown = React.useRef(holdsEdge);
  edgeShown.current = holdsEdge;
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = React.useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const expire = React.useCallback(() => {
    stop();
    timer.current = setTimeout(() => setHeld(null), EDGE_HOLD_MS);
  }, [stop]);
  React.useEffect(() => {
    if (preview !== null) {
      last.current = preview;
      stop();
      setHeld(null);
    } else if (edgeShown.current && last.current !== null) {
      setHeld(last.current);
      expire();
    }
  }, [preview, stop, expire]);
  React.useEffect(() => stop, [stop]);
  return {
    shown: preview ?? held,
    pointed: inside => (inside ? stop() : expire()),
    release: () => {
      stop();
      setHeld(null);
    },
  };
}

export function InsertionLine({
  document,
}: InsertionLineProps): React.JSX.Element {
  const layer = React.useRef<HTMLDivElement | null>(null);
  // A zoom, or the frame's page arriving, moves the place on screen.
  const canvasFrame = useCanvasFrame();
  const [drawn, setDrawn] = React.useState<Drawn | null>(null);
  const { shown, pointed, release } = useHeldPreview(
    useInsertionPreview(),
    drawn?.kind === "edge"
  );

  const measure = React.useCallback(() => {
    const element = layer.current;
    setDrawn(
      element === null || shown === null
        ? null
        : drawnFor(element, document, shown.at)
    );
  }, [document, shown]);

  useIsomorphicLayoutEffect(measure, [measure, canvasFrame]);

  // Kept where the place is as the page scrolls, resizes or reflows, only
  // while there is a place to keep; again for a frame's new page, whose
  // scrolls and sizes the old page's listeners never hear.
  React.useEffect(() => {
    if (shown === null) return undefined;
    const element = layer.current;
    const space =
      element === null ? null : overlaySpaceOf(element, CANVAS_ROOT_CLASS);
    const stopGeometry = watchCanvasFor(() => layer.current, measure);
    const stopBand =
      space === null
        ? undefined
        : watchScreenBand(space.root, space.frame, measure);
    return () => {
      stopGeometry?.();
      stopBand?.();
    };
  }, [shown, measure, canvasFrame]);

  const words = shown?.words ?? "";
  return (
    <div
      ref={layer}
      className="nx-insertion-line"
      {...{ [OVERLAY_OUTPUT_ATTRIBUTE]: "" }}
    >
      {drawn?.kind === "line" ? (
        <>
          <DropIndicator target={drawn.target} />
          {/* The panel's line says these words for assistive technology. */}
          <span
            className="nx-insertion-line__label"
            data-axis={drawn.target.axis}
            {...(drawn.labelBelow ? { "data-below": "" } : {})}
            aria-hidden="true"
            style={{ left: drawn.start.x, top: drawn.start.y }}
          >
            {words}
          </span>
        </>
      ) : null}
      {drawn?.kind === "edge" ? (
        <button
          type="button"
          className="nx-insertion-line__edge"
          data-edge={drawn.edge}
          style={{ left: drawn.left, top: drawn.top }}
          onPointerEnter={() => pointed(true)}
          onPointerLeave={() => pointed(false)}
          onClick={() => {
            if (layer.current !== null)
              scrollToPlace(layer.current, drawn.place);
            release();
          }}
        >
          {`${drawn.edge === "top" ? "↑" : "↓"} ${words}`}
        </button>
      ) : null}
      {drawn?.kind === "empty" ? (
        <div
          className="nx-insertion-line__container"
          aria-hidden="true"
          style={{
            left: drawn.rect.x,
            top: drawn.rect.y,
            width: drawn.rect.width,
            height: drawn.rect.height,
          }}
        />
      ) : null}
    </div>
  );
}
