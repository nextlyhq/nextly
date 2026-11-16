"use client";

/**
 * The controls that add a section to the page itself: a start card on an
 * empty page, and a "+" in each gap between two of its top-level sections.
 *
 * An empty page used to be a blank frame with nothing on it to press, and a
 * section could only be added after the selected one, by opening Add first.
 * These put the control where the section will go, as the editor's design
 * asks ("a '+' between sections").
 *
 * Like the empty-container appenders beside it, this only REPORTS: pressing
 * the start card calls {@link PageInsertersProps.onStart}, and pressing a "+"
 * calls {@link PageInsertersProps.onAddAfter} with the section above the gap.
 * The host selects that section and opens Add, which already adds after the
 * selected block and names the place, so no new insertion path exists.
 *
 * ## When the "+" shows
 *
 * At rest a gap's "+" is not drawn, and takes no pointer events: a row of
 * buttons down the page would sit on every section's edge, and an unseen one
 * would take the press an author meant for a short block beside the gap. It
 * shows, and takes the pointer, while the pointer is within
 * {@link NEAR_GAP_PX} of the gap or on the "+" itself, and while it has
 * keyboard focus, so Tab still reaches every one. Nearness is measured rather
 * than read from the hovered block: a short block's middle is as close to its
 * edge as a "+" is tall, so "the pointer is in the section beside it" would
 * put the "+" under a press meant for that block. Nothing shows while a block
 * is dragged: the drag's own line says where it will land.
 *
 * @module page-inserters
 */

import type { BlockDocument } from "@nextlyhq/blocks-engine";
import { TooltipProvider } from "@nextlyhq/ui";
import { Plus } from "lucide-react";
import * as React from "react";

import {
  CANVAS_ROOT_CLASS,
  CHROME_ATTRIBUTE,
  outermostElementsOf,
} from "./canvas";
import { useCanvasFrame } from "./canvas-frame-context";
import { watchCanvasFor, watchScreenBand } from "./canvas-geometry-watch";
import { ChromeTooltip } from "./chrome-tooltip";
import type { Point, Rect } from "./geometry";
import {
  canvasContentPoint,
  canvasContentRect,
  drawnBoxes,
  onScreenOf,
  overlaySpaceOf,
} from "./geometry-dom";
import { blockNameOf, type ComponentTitleOf } from "./layers";
import { startWords } from "./page-start-words";
import { unionRect } from "./toolbar-actions";

/** @experimental */
export interface PageInsertersProps {
  /** The page whose top-level sections the controls sit between. */
  readonly document: BlockDocument;
  /**
   * Draws nothing: while a block is dragged, and wherever the host offers no
   * adding at all.
   */
  readonly hidden?: boolean;
  /** The empty page's start card was pressed. */
  readonly onStart: () => void;
  /** A gap's "+" was pressed: add a section after this one. */
  readonly onAddAfter: (nodeId: string) => void;
  /**
   * Names a component by its library title, as Layers does, so the "+" after a
   * placement names the component rather than "Component".
   */
  readonly componentTitle?: ComponentTitleOf;
}

/** One gap between two top-level sections, where its "+" is drawn. */
interface Gap {
  /** The section above the gap, which a new section goes after. */
  readonly after: string;
  /** The section below it. */
  readonly before: string;
  /** The gap's middle, in the chrome's coordinates. */
  readonly x: number;
  readonly y: number;
  /** How wide the line across the gap is drawn. */
  readonly width: number;
}

/**
 * How near the pointer must be to a gap for its "+" to show, in the chrome's
 * pixels: less than half a short block's height, so the middle of a block
 * one line tall stays the block's to press.
 */
const NEAR_GAP_PX = 8;

/** The gap the pointer is within {@link NEAR_GAP_PX} of, by its key. */
function gapNear(gaps: readonly Gap[], y: number): string | undefined {
  const near = gaps.find(gap => Math.abs(gap.y - y) <= NEAR_GAP_PX);
  return near === undefined ? undefined : keyOf(near);
}

/** A gap's identity: the two sections it is between. */
function keyOf(gap: Gap): string {
  // Encoded rather than joined: an id can hold any character, so a separator
  // could make two different pairs read the same.
  return JSON.stringify([gap.after, gap.before]);
}

/**
 * Where the start card is centred: the middle of what of the canvas is on
 * screen, as an empty page's root is only as tall as nothing in it.
 */
function measureStart(layer: HTMLElement): Point | null {
  const space = overlaySpaceOf(layer, CANVAS_ROOT_CLASS);
  if (space === null) return null;
  const band = onScreenOf(space);
  return { x: band.x + band.width / 2, y: band.y + band.height / 2 };
}

/** Each gap between two drawn top-level sections, measured in the chrome. */
function measureGaps(
  layer: HTMLElement,
  document: BlockDocument
): readonly Gap[] {
  const space = overlaySpaceOf(layer, CANVAS_ROOT_CLASS);
  if (space === null) return [];
  const { root } = space;
  const page = space.place(canvasContentRect(root, root));
  /*
   * Each top-level node as the union of every element drawn for it, and only
   * those that generate a box. A component placement draws one element per
   * top-level node of its definition, so its first element alone would end
   * the section early and put the next gap's "+" inside it; a node hidden on
   * this device (`display: none`) generates no box, and a gap measured from
   * its empty rectangle would add a "+" beside a section nobody can see.
   * Outermost only, as the drag measures a node, so an element nested inside
   * the same placement is not counted twice.
   */
  const parts = new Map<string, Rect[]>();
  const top = new Set(document.nodes.map(node => node.id));
  for (const [id, elements] of outermostElementsOf(root, top)) {
    parts.set(
      id,
      elements
        .flatMap(drawnBoxes)
        .map(drawn => space.place(canvasContentRect(drawn, root)))
    );
  }
  const drawn = document.nodes.flatMap(node => {
    const rect = unionRect(parts.get(node.id) ?? []);
    return rect === undefined ? [] : [{ id: node.id, rect }];
  });
  const gaps: Gap[] = [];
  for (let at = 1; at < drawn.length; at += 1) {
    const above = drawn[at - 1];
    const below = drawn[at];
    if (above === undefined || below === undefined) continue;
    gaps.push({
      after: above.id,
      before: below.id,
      x: page.x + page.width / 2,
      y: (above.rect.y + above.rect.height + below.rect.y) / 2,
      width: page.width,
    });
  }
  return gaps;
}

/**
 * The start card on an empty page and the "+" between its sections.
 *
 * @experimental
 */
export function PageInserters({
  document,
  hidden = false,
  onStart,
  onAddAfter,
  componentTitle,
}: PageInsertersProps): React.JSX.Element | null {
  const words = startWords(document.kind);
  const layer = React.useRef<HTMLDivElement | null>(null);
  const [gaps, setGaps] = React.useState<readonly Gap[]>([]);
  const canvasFrame = useCanvasFrame();
  // The gap the pointer is near, and the one whose "+" the pointer is on: a
  // pointer moving onto the "+" leaves the canvas's frame, which then reports
  // no further move, so the "+" holds itself shown while it is pointed at.
  const [near, setNear] = React.useState<string | undefined>(undefined);
  const [held, setHeld] = React.useState<string | undefined>(undefined);
  const empty = document.nodes.length === 0;

  const [start, setStart] = React.useState<Point | null>(null);

  const measure = React.useCallback(() => {
    const element = layer.current;
    setGaps(element === null || empty ? [] : measureGaps(element, document));
    setStart(element === null || !empty ? null : measureStart(element));
  }, [document, empty]);

  React.useLayoutEffect(() => {
    if (!hidden) measure();
  }, [measure, hidden, canvasFrame]);

  React.useEffect(() => {
    if (hidden) return;
    return watchCanvasFor(() => layer.current, measure);
  }, [measure, hidden, canvasFrame]);

  // And what moves the part of the canvas on screen, which the start card is
  // centred on: the scroller around the canvas, and the host's around a frame.
  React.useEffect(() => {
    const element = layer.current;
    const space =
      element === null ? null : overlaySpaceOf(element, CANVAS_ROOT_CLASS);
    if (hidden || space === null) return;
    return watchScreenBand(space.root, space.frame, measure);
  }, [measure, hidden, canvasFrame]);

  // The pointer's distance from each gap, from its moves over the canvas.
  React.useEffect(() => {
    const element = layer.current;
    const space =
      element === null ? null : overlaySpaceOf(element, CANVAS_ROOT_CLASS);
    if (hidden || empty || space === null) return;
    const { root } = space;
    const move = (event: PointerEvent): void => {
      const point = canvasContentPoint(event.clientX, event.clientY, root);
      const placed = space.place({ ...point, width: 0, height: 0 });
      setNear(gapNear(gaps, placed.y));
    };
    const leave = (): void => setNear(undefined);
    root.addEventListener("pointermove", move);
    root.addEventListener("pointerleave", leave);
    return () => {
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerleave", leave);
    };
  }, [gaps, hidden, empty, canvasFrame]);

  if (hidden) return null;

  return (
    <TooltipProvider delayDuration={300}>
      <div
        ref={layer}
        className="nx-page-inserters"
        data-empty={empty ? "" : undefined}
        // Chrome, so a press here is not read as a click on the page, which
        // would clear the selection.
        {...{ [CHROME_ATTRIBUTE]: "" }}
      >
        {empty ? (
          <div
            className="nx-page-inserters__start"
            // Kept out of sight until it has been placed, rather than drawn
            // at the layer's corner for a frame.
            style={
              start === null
                ? { visibility: "hidden" }
                : { left: start.x, top: start.y }
            }
          >
            <p className="nx-page-inserters__title">{words.title}</p>
            <p className="nx-page-inserters__hint">{words.hint}</p>
            <button
              type="button"
              className="nx-page-inserters__start-button"
              onClick={onStart}
            >
              <Plus size={16} aria-hidden="true" />
              {words.start}
            </button>
          </div>
        ) : (
          gaps.map(gap => (
            <div
              key={keyOf(gap)}
              className="nx-page-inserters__gap"
              data-near={
                near === keyOf(gap) || held === keyOf(gap) ? "" : undefined
              }
              style={{
                left: gap.x - gap.width / 2,
                top: gap.y,
                width: gap.width,
              }}
            >
              <span className="nx-page-inserters__line" aria-hidden="true" />
              <ChromeTooltip content={words.gap} side="top">
                <button
                  type="button"
                  className="nx-page-inserters__add"
                  aria-label={`${words.after} ${
                    blockNameOf(document, gap.after, componentTitle) ??
                    "this one"
                  }`}
                  onClick={() => onAddAfter(gap.after)}
                  onPointerEnter={() => setHeld(keyOf(gap))}
                  onPointerLeave={() => setHeld(undefined)}
                >
                  <Plus size={14} aria-hidden="true" />
                </button>
              </ChromeTooltip>
            </div>
          ))
        )}
      </div>
    </TooltipProvider>
  );
}
