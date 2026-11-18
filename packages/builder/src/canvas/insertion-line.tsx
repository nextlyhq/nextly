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
import { useIsomorphicLayoutEffect } from "@nextlyhq/ui";
import * as React from "react";

import type { Rect } from "../geometry";

import { CANVAS_ROOT_CLASS } from "./canvas";
import { CHROME_ATTRIBUTE } from "./canvas-chrome";
import { blockElements } from "./canvas-drag-gesture";
import { useCanvasFrame } from "./canvas-frame-context";
import {
  OVERLAY_OUTPUT_ATTRIBUTE,
  watchCanvasFor,
  watchScreenBand,
} from "./canvas-geometry-watch";
import { DropIndicator } from "./drop-indicator";
import {
  targetLineRect,
  type DropTarget,
  type RectSource,
} from "./drop-targets";
import { canvasContentRect, onScreenOf, overlaySpaceOf } from "./geometry-dom";
import { insertionMarkOf, type Neighbour } from "./insertion-line-geometry";
import {
  useInsertionPreview,
  type InsertionPreview,
} from "./insertion-preview";
import { styleCapable } from "./spacing-response";

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
      /** No room right of a row's line on screen, so the label goes left. */
      readonly labelBefore: boolean;
      /** The widest the label may be: the room on its side of the line. */
      readonly labelRoom: number;
    }
  | {
      readonly kind: "edge";
      /** The block beside the place, scrolled into view to show it. */
      readonly near: Neighbour | undefined;
      /** The place itself, in the canvas's content coordinates. */
      readonly place: Rect;
      /** Which edge of the canvas the label is pinned to. */
      readonly edge: Edge;
      readonly left: number;
      readonly top: number;
      /** At the top or bottom, too near the right to fit: grows leftwards. */
      readonly before: boolean;
      /** The widest the label may be: the room on its side. */
      readonly room: number;
    }
  | { readonly kind: "empty"; readonly rect: Rect };

/** An edge of what the canvas shows. */
type Edge = "top" | "bottom" | "left" | "right";

/** The arrow an edge label points with. */
const ARROWS: Readonly<Record<Edge, string>> = {
  top: "↑",
  bottom: "↓",
  left: "←",
  right: "→",
};

/** How far an edge label keeps from the canvas's edge, in pixels. */
const EDGE_GAP = 8;

/** The room a label above its line needs on screen, in pixels. */
const LABEL_ROOM = 22;

/**
 * The widest a label is drawn, in pixels: the stylesheet's `max-width` of
 * 24rem on `.nx-insertion-line__label`, the room a label beside a row's line
 * needs on screen.
 */
const LABEL_WIDEST = 384;

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
 * The element that stands for each block is the drag's own answer
 * (`blockElements`), so the preview and a drag measure the same box.
 */
function lazyRects(
  root: HTMLElement
): RectSource & { elementOf: (id: string) => Element | undefined } {
  const elements = blockElements(root);
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
    elementOf: id => elements.get(id),
  };
}

/** Which edge of the screen a place lies past, or `undefined` for none. */
function edgePast(drawnAt: Rect, screen: Rect): Edge | undefined {
  if (drawnAt.y + drawnAt.height < screen.y) return "top";
  if (drawnAt.y > screen.y + screen.height) return "bottom";
  if (drawnAt.x + drawnAt.width < screen.x) return "left";
  if (drawnAt.x > screen.x + screen.width) return "right";
  return undefined;
}

/** `value` kept between `low` and `high`. */
function within(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/**
 * The label pinned to the canvas edge for a place off screen, or `undefined`
 * for one on screen. A canvas zoomed past its region can leave a place off
 * to either side as well as above or below. `drawnAt` and `screen` are in
 * the chrome's coordinates.
 */
function edgeLabelFor(
  near: Neighbour | undefined,
  place: Rect,
  drawnAt: Rect,
  screen: Rect
): Drawn | undefined {
  const edge = edgePast(drawnAt, screen);
  if (edge === undefined) return undefined;
  const right = screen.x + screen.width - EDGE_GAP;
  const bottom = screen.y + screen.height - EDGE_GAP;
  const across = edge === "top" || edge === "bottom";
  const sideways = edge === "left" ? screen.x + EDGE_GAP : right;
  const upright = edge === "top" ? screen.y + EDGE_GAP : bottom;
  return {
    kind: "edge",
    near,
    place,
    edge,
    left: across ? within(drawnAt.x, screen.x + EDGE_GAP, right) : sideways,
    top: across ? upright : within(drawnAt.y, screen.y + EDGE_GAP, bottom),
    before: across && goesLeft(drawnAt.x, screen),
    room: across ? roomFor(drawnAt.x, screen) : screen.width - 2 * EDGE_GAP,
  };
}

/**
 * Whether a row line's label goes on its left: only where its widest size
 * does not fit on the right, and the left has more room than the right.
 */
function goesLeft(x: number, screen: Rect): boolean {
  const right = screen.x + screen.width - x;
  const left = x - screen.x;
  return right < LABEL_WIDEST && left > right;
}

/**
 * The width a label beside `x` may take: the room on the side it goes, less
 * the gap it keeps from the screen's edge, so even a long label keeps its
 * arrow and its first words on screen.
 */
function roomFor(x: number, screen: Rect): number {
  const side = goesLeft(x, screen) ? x - screen.x : screen.x + screen.width - x;
  return Math.max(0, side - EDGE_GAP);
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
      : targetLineRect(mark.target);
  if (place === undefined) return null;
  const drawnAt = space.place(place);
  const screen = onScreenOf(space);
  const edge = edgeLabelFor(
    mark.kind === "empty"
      ? { id: mark.containerId, side: "inside" }
      : mark.near,
    place,
    drawnAt,
    screen
  );
  if (edge !== undefined) return edge;
  if (mark.kind === "empty") return { kind: "empty", rect: drawnAt };
  return {
    kind: "line",
    target: mark.target,
    // At the start of the part of the line on screen: a zoomed canvas can
    // show a line whose own start is off to a side, or above.
    start: {
      x: within(drawnAt.x, screen.x, screen.x + screen.width),
      y: within(drawnAt.y, screen.y, screen.y + screen.height),
    },
    labelBelow: drawnAt.y - LABEL_ROOM < screen.y,
    labelBefore: goesLeft(drawnAt.x, screen),
    labelRoom: roomFor(
      within(drawnAt.x, screen.x, screen.x + screen.width),
      screen
    ),
  };
}

/** How a neighbour is scrolled to bring the place at its side into view. */
const ALIGN: Readonly<Record<Neighbour["side"], ScrollLogicalPosition>> = {
  // The place is at the block's end: that end in view, however tall it is.
  after: "end",
  before: "start",
  inside: "center",
};

/** Room kept past the place when it is scrolled into view, for its label. */
const REVEAL_ROOM = 24;

/**
 * How far past the neighbour's side the place lies, plus room for its label,
 * as a CSS `scroll-margin`: the line sits in the middle of the gap after a
 * block, not on its edge. Along the line's own axis only; none for a place
 * inside an empty container, which is centred.
 */
function revealMargin(near: Neighbour, block: Rect, place: Rect): string {
  if (near.side === "inside") return "";
  const down = place.height === 0;
  const past =
    near.side === "after"
      ? down
        ? place.y - (block.y + block.height)
        : place.x - (block.x + block.width)
      : down
        ? block.y - place.y
        : block.x - place.x;
  const margin = `${String(Math.max(0, past) + REVEAL_ROOM)}px`;
  const sides = [0, 0, 0, 0].map(() => "0px");
  // top, right, bottom, left
  const at = near.side === "after" ? (down ? 2 : 1) : down ? 0 : 3;
  sides[at] = margin;
  return sides.join(" ");
}

/**
 * Bring the place into view: the side of the block beside it that the place
 * touches, with the place itself past that side as a scroll margin, scrolled
 * into view by the browser, which moves every scroller that clips it, the
 * frame's page and the region around a zoomed frame alike, in both
 * directions. The block's own style is left as it was.
 */
function revealPlace(
  layer: HTMLElement,
  near: Neighbour | undefined,
  place: Rect
): void {
  if (near === undefined) return;
  const space = overlaySpaceOf(layer, CANVAS_ROOT_CLASS);
  if (space === null) return;
  const rects = lazyRects(space.root);
  const element = rects.elementOf(near.id);
  const block = rects.rectOf(near.id);
  // Any element with an inline style: a block drawn as an SVG root has one,
  // and scrolls into view as any element does.
  if (element === undefined || !styleCapable(element) || block === undefined) {
    return;
  }
  const align = ALIGN[near.side];
  // Each side as the block had it, with its priority: the shorthand reads
  // empty where only one side is set, so restoring it would drop that side.
  const kept = SCROLL_MARGIN_SIDES.map(side => ({
    side,
    value: element.style.getPropertyValue(side),
    priority: element.style.getPropertyPriority(side),
  }));
  // Side by side, as they are put back.
  revealMargin(near, block, place)
    .split(" ")
    .forEach((value, index) => {
      element.style.setProperty(SCROLL_MARGIN_SIDES[index] ?? "", value);
    });
  element.scrollIntoView({ block: align, inline: align });
  for (const { side, value, priority } of kept) {
    if (value === "") element.style.removeProperty(side);
    else element.style.setProperty(side, value, priority);
  }
}

/** The longhands of `scroll-margin`, each kept and put back on its own. */
const SCROLL_MARGIN_SIDES = [
  "scroll-margin-top",
  "scroll-margin-right",
  "scroll-margin-bottom",
  "scroll-margin-left",
] as const;

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
  // Whether the edge label is pointed at now: no hold runs out under it.
  const over = React.useRef(false);
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
      if (!over.current) expire();
    }
  }, [preview, stop, expire]);
  React.useEffect(() => stop, [stop]);
  return {
    shown: preview ?? held,
    pointed: inside => {
      over.current = inside;
      if (inside) stop();
      else expire();
    },
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
      // The editor's own chrome: a press on the edge label is not a press on
      // the page, so it keeps the selection.
      {...{ [OVERLAY_OUTPUT_ATTRIBUTE]: "", [CHROME_ATTRIBUTE]: "" }}
    >
      {drawn?.kind === "line" ? (
        <>
          <DropIndicator target={drawn.target} />
          {/* The panel's line says these words for assistive technology. */}
          <span
            className="nx-insertion-line__label"
            data-axis={drawn.target.axis}
            {...(drawn.labelBelow ? { "data-below": "" } : {})}
            {...(drawn.labelBefore ? { "data-before": "" } : {})}
            aria-hidden="true"
            style={{
              left: drawn.start.x,
              top: drawn.start.y,
              maxWidth: drawn.labelRoom,
            }}
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
          {...(drawn.before ? { "data-before": "" } : {})}
          style={{ left: drawn.left, top: drawn.top, maxWidth: drawn.room }}
          onPointerEnter={() => pointed(true)}
          onPointerLeave={() => pointed(false)}
          onClick={() => {
            if (layer.current !== null) {
              revealPlace(layer.current, drawn.near, drawn.place);
            }
            release();
          }}
        >
          {`${ARROWS[drawn.edge]} ${words}`}
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
