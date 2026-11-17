"use client";

/**
 * The controls that add a block to the page itself: a start card on an empty
 * page, and a "+" in each gap between blocks.
 *
 * An empty page used to be a blank frame with nothing on it to press, and a
 * block could only be added after the selected one, by opening Add first.
 * These put the control where the block will go.
 *
 * ## Where the "+" controls are
 *
 * In each gap between two top-level blocks, after the last top-level block
 * (above a Layout's footer), and between the children of the selected block,
 * in the direction they are laid out: a vertical gap between two Boxes in a
 * row. `page-gaps.ts` measures them. Each is drawn floating over its gap as
 * chrome, so showing one never moves, resizes or reflows the page.
 *
 * Like the empty-container appenders beside it, this only REPORTS: pressing
 * the start card calls {@link PageInsertersProps.onStart}, and pressing a "+"
 * calls {@link PageInsertersProps.onAddAfter} with the block before its gap
 * and the control itself, which the host opens the in-place picker beside,
 * aimed at exactly that gap. Nothing is selected on the way.
 *
 * ## When the "+" shows
 *
 * At rest a gap's "+" is not drawn, and takes no pointer events: a row of
 * buttons down the page would sit on every block's edge, and an unseen one
 * would take the press an author meant for a short block beside the gap. It
 * shows, and takes the pointer, only while the pointer is within the gap's
 * reach of its line, on the canvas or on the "+" itself, and while it has
 * keyboard focus. Nearness is measured rather than read from the hovered
 * block: a short block's middle is as close to its edge as a "+" is tall, so
 * "the pointer is in the block beside it" would put the "+" under a press
 * meant for that block.
 *
 * ## Never over a short block's middle
 *
 * The "+" is 24px on screen, so centred on the line between two blocks drawn
 * shorter than that (a line of text at a zoomed-out canvas) it covers their
 * middles. The reach is therefore at most a quarter of the shorter block,
 * and it holds on the "+" too: moving from the line towards a block's middle
 * lets the "+" go before the pointer gets there, so the press lands on the
 * block. A touch screen, which has no pointer to come near, keeps a "+"
 * shown only where both blocks beside it are at least as deep as the "+".
 * Nothing shows while a block is dragged: the drag's own line says where it
 * will land.
 *
 * ## The keyboard
 *
 * Every "+" is a Tab stop, in reading order. Tab on the canvas with a block
 * selected moves to the "+" below that block, so the next stop after a block
 * is the gap after it; from there Tab and Shift+Tab move through the others.
 *
 * @module page-inserters
 */

import type { BlockDocument } from "@nextlyhq/blocks-engine";
import { TooltipProvider } from "@nextlyhq/ui";
import { Plus } from "lucide-react";
import * as React from "react";

import { ChromeTooltip } from "../chrome-tooltip";
import { isElement } from "../dom-kind";
import type { Point } from "../geometry";
import { blockNameOf, type ComponentTitleOf } from "../panels/layers/layers";

import { CANVAS_ROOT_CLASS, CHROME_ATTRIBUTE } from "./canvas";
import { useCanvasFrame } from "./canvas-frame-context";
import { watchCanvasFor, watchScreenBand } from "./canvas-geometry-watch";
import {
  boxInFrameViewport,
  canvasContentPoint,
  onScreenOf,
  overlaySpaceOf,
} from "./geometry-dom";
import {
  blockRectOf,
  gapAfter,
  gapKey,
  gapNear,
  measureGaps,
  type Gap,
} from "./page-gaps";
import { gapWords, startWords } from "./page-start-words";

/** @experimental */
export interface PageInsertersProps {
  /** The page whose blocks the controls sit between. */
  readonly document: BlockDocument;
  /**
   * The selected block, whose children get a "+" between them too, and from
   * which Tab moves to the "+" below it. `null` or absent for none.
   */
  readonly selectedId?: string | null;
  /**
   * Draws nothing: while a block is dragged, and wherever the host offers no
   * adding at all.
   */
  readonly hidden?: boolean;
  /** The empty page's start card was pressed. */
  readonly onStart: () => void;
  /**
   * A gap's "+" was pressed: add a block in that gap, after `nodeId`, beside
   * it. `control` is the "+" pressed, for the host to open its picker beside.
   */
  readonly onAddAfter: (nodeId: string, control: HTMLElement) => void;
  /**
   * Names a component by its library title, as Layers does, so the "+" after a
   * placement names the component rather than "Component".
   */
  readonly componentTitle?: ComponentTitleOf;
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

/** The gaps measured in `layer`'s chrome, or none outside a canvas. */
function gapsIn(
  layer: HTMLElement | null,
  document: BlockDocument,
  selectedId: string | null
): readonly Gap[] {
  const space =
    layer === null ? null : overlaySpaceOf(layer, CANVAS_ROOT_CLASS);
  return space === null ? [] : measureGaps(space, document, selectedId);
}

/** What the gaps and the start card are measured from, and what moves them. */
interface Measured {
  readonly gaps: readonly Gap[];
  readonly start: Point | null;
}

const NOTHING_MEASURED: Measured = { gaps: [], start: null };

/**
 * The gaps, or the start card's place on an empty page, measured now and
 * again on everything that moves the canvas: a change inside it, a resize, a
 * zoom, and a scroll of what is on screen, which the start card is centred
 * on.
 */
function useMeasured(
  layer: React.RefObject<HTMLDivElement | null>,
  document: BlockDocument,
  selectedId: string | null,
  hidden: boolean
): Measured {
  const [measured, setMeasured] = React.useState<Measured>(NOTHING_MEASURED);
  const canvasFrame = useCanvasFrame();
  const empty = document.nodes.length === 0;
  const measure = React.useCallback(() => {
    const element = layer.current;
    setMeasured({
      gaps: empty ? [] : gapsIn(element, document, selectedId),
      start: element === null || !empty ? null : measureStart(element),
    });
  }, [layer, document, selectedId, empty]);

  React.useLayoutEffect(() => {
    if (!hidden) measure();
  }, [measure, hidden, canvasFrame]);

  React.useEffect(() => {
    if (hidden) return;
    return watchCanvasFor(() => layer.current, measure);
  }, [layer, measure, hidden, canvasFrame]);

  // And what moves the part of the canvas on screen, which the start card is
  // centred on: the scroller around the canvas, and the host's around a frame.
  React.useEffect(() => {
    const element = layer.current;
    const space =
      element === null ? null : overlaySpaceOf(element, CANVAS_ROOT_CLASS);
    if (hidden || space === null) return;
    return watchScreenBand(space.root, space.frame, measure);
  }, [layer, measure, hidden, canvasFrame]);
  return measured;
}

/** The gap the pointer is near, by its key, from its moves over the canvas. */
function useNearGap(
  layer: React.RefObject<HTMLDivElement | null>,
  gaps: readonly Gap[],
  hidden: boolean
): readonly [string | undefined, (key: string | undefined) => void] {
  const [near, setNear] = React.useState<string | undefined>(undefined);
  const canvasFrame = useCanvasFrame();
  React.useEffect(() => {
    const element = layer.current;
    const space =
      element === null ? null : overlaySpaceOf(element, CANVAS_ROOT_CLASS);
    if (hidden || gaps.length === 0 || space === null) return;
    const { root } = space;
    const move = (event: PointerEvent): void => {
      const point = canvasContentPoint(event.clientX, event.clientY, root);
      const placed = space.place({ ...point, width: 0, height: 0 });
      setNear(gapNear(gaps, placed.x, placed.y));
    };
    const leave = (): void => setNear(undefined);
    root.addEventListener("pointermove", move);
    root.addEventListener("pointerleave", leave);
    return () => {
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerleave", leave);
    };
  }, [layer, gaps, hidden, canvasFrame]);
  return [near, setNear];
}

/**
 * Whether a Tab pressed here is a Tab on the canvas itself: the page's own
 * document focused, rather than a control on the page or text being typed.
 */
function tabOnCanvas(event: KeyboardEvent, page: Document): boolean {
  if (event.key !== "Tab" || event.defaultPrevented) return false;
  if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
    return false;
  }
  const target = event.target;
  return (
    isElement(target) &&
    (target === page.body || target === page.documentElement)
  );
}

/**
 * Tab on the canvas with a block selected moves to the "+" below it, rather
 * than to whichever chrome comes first after the frame. Only in a frame: the
 * keys of an editor sharing the page's document are the editor's own.
 */
function useTabToGap(
  layer: React.RefObject<HTMLDivElement | null>,
  gaps: readonly Gap[],
  selectedId: string | null
): void {
  const canvasFrame = useCanvasFrame();
  const page = canvasFrame.frame === null ? null : canvasFrame.document;
  React.useEffect(() => {
    if (page === null || selectedId === null || gaps.length === 0) return;
    const keydown = (event: KeyboardEvent): void => {
      const element = layer.current;
      const space =
        element === null ? null : overlaySpaceOf(element, CANVAS_ROOT_CLASS);
      if (space === null || !tabOnCanvas(event, page)) return;
      const block = blockRectOf(space, selectedId);
      const gap = block === undefined ? undefined : gapAfter(gaps, block);
      const control = gap === undefined ? null : controlOf(element, gap);
      if (control === null) return;
      event.preventDefault();
      control.focus({ preventScroll: true });
    };
    page.addEventListener("keydown", keydown);
    return () => page.removeEventListener("keydown", keydown);
  }, [layer, page, gaps, selectedId]);
}

/** The attribute a "+" carries its gap's key in, so Tab can find it. */
const GAP_ATTRIBUTE = "data-nx-gap";

/** The "+" drawn for a gap, in this layer. */
function controlOf(layer: HTMLElement | null, gap: Gap): HTMLElement | null {
  const key = gapKey(gap);
  let found: HTMLElement | null = null;
  layer?.querySelectorAll<HTMLElement>(`[${GAP_ATTRIBUTE}]`).forEach(button => {
    if (found === null && button.getAttribute(GAP_ATTRIBUTE) === key) {
      found = button;
    }
  });
  return found;
}

/** One gap's "+", floating over the gap, with the line it adds on. */
function GapControl({
  gap,
  words,
  shown,
  onHold,
  onAddAfter,
}: {
  readonly gap: Gap;
  readonly words: string;
  readonly shown: boolean;
  readonly onHold: (key: string | undefined) => void;
  readonly onAddAfter: PageInsertersProps["onAddAfter"];
}): React.JSX.Element {
  const key = gapKey(gap);
  const across = gap.line === "across";
  // Held only while the pointer on the "+" is within the gap's reach of its
  // line, which runs through the "+"'s middle: further, towards a block's
  // middle, the "+" lets go so a press there is the block's.
  //
  // Let go at once, too, not on the next render: a press can follow the move
  // that left the reach before React draws again, and it must reach the
  // block under the "+" rather than the "+". Taken back once the "+" shows
  // again.
  const button = React.useRef<HTMLButtonElement | null>(null);
  // On every render that shows it, since a let-go and a fresh show can land
  // in one render, which leaves `shown` as it was.
  React.useLayoutEffect(() => {
    if (shown && button.current !== null) {
      button.current.style.pointerEvents = "";
    }
  });
  const hold = (event: React.PointerEvent<HTMLButtonElement>): void => {
    const target = event.currentTarget;
    // Both in the editor window's coordinates, which the chrome is drawn at.
    const box = boxInFrameViewport(target);
    const off = across
      ? event.clientY - (box.y + box.height / 2)
      : event.clientX - (box.x + box.width / 2);
    const inReach = Math.abs(off) <= gap.reach;
    if (!inReach) target.style.pointerEvents = "none";
    onHold(inReach ? key : undefined);
  };
  return (
    <div
      className="nx-page-inserters__gap"
      data-line={gap.line}
      data-near={shown ? "" : undefined}
      data-roomy={gap.roomy ? "" : undefined}
      style={
        across
          ? { left: gap.x - gap.length / 2, top: gap.y, width: gap.length }
          : { left: gap.x, top: gap.y - gap.length / 2, height: gap.length }
      }
    >
      <span className="nx-page-inserters__line" aria-hidden="true" />
      <ChromeTooltip content={words} side={across ? "top" : "right"}>
        <button
          ref={button}
          type="button"
          className="nx-page-inserters__add"
          aria-label={words}
          {...{ [GAP_ATTRIBUTE]: key }}
          onClick={event => onAddAfter(gap.after, event.currentTarget)}
          onPointerEnter={hold}
          onPointerMove={hold}
          onPointerLeave={() => onHold(undefined)}
        >
          <Plus size={14} aria-hidden="true" />
        </button>
      </ChromeTooltip>
    </div>
  );
}

/** The empty page's start card, centred where the component measured. */
function StartCard({
  document,
  start,
  onStart,
}: {
  readonly document: BlockDocument;
  readonly start: Point | null;
  readonly onStart: () => void;
}): React.JSX.Element {
  const words = startWords(document.kind);
  return (
    <div
      className="nx-page-inserters__start"
      // Kept out of sight until it has been placed, rather than drawn at the
      // layer's corner for a frame.
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
  );
}

/**
 * The start card on an empty page and the "+" in the gaps between blocks.
 *
 * @experimental
 */
export function PageInserters({
  document,
  selectedId = null,
  hidden = false,
  onStart,
  onAddAfter,
  componentTitle,
}: PageInsertersProps): React.JSX.Element | null {
  const layer = React.useRef<HTMLDivElement | null>(null);
  const { gaps, start } = useMeasured(layer, document, selectedId, hidden);
  const [near, setNear] = useNearGap(layer, gaps, hidden);
  useTabToGap(layer, hidden ? [] : gaps, selectedId);
  // The gap whose "+" the pointer is on: a pointer moving onto the "+"
  // leaves the canvas's frame, which then reports no further move, so the
  // "+" holds itself shown while it is pointed at.
  const [held, setHeld] = React.useState<string | undefined>(undefined);
  // Let go on the "+" is let go everywhere: the frame under it may not have
  // heard the pointer leave, and a "+" still shown would take the press.
  const hold = React.useCallback(
    (key: string | undefined) => {
      setHeld(key);
      if (key === undefined) setNear(undefined);
    },
    [setNear]
  );
  const empty = document.nodes.length === 0;
  const nameOf = (id: string): string =>
    blockNameOf(document, id, componentTitle) ?? "this block";

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
          <StartCard document={document} start={start} onStart={onStart} />
        ) : (
          gaps.map(gap => (
            <GapControl
              key={gapKey(gap)}
              gap={gap}
              words={gapWords(
                nameOf(gap.after),
                gap.before === undefined ? undefined : nameOf(gap.before)
              )}
              shown={near === gapKey(gap) || held === gapKey(gap)}
              onHold={hold}
              onAddAfter={onAddAfter}
            />
          ))
        )}
      </div>
    </TooltipProvider>
  );
}
