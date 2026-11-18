"use client";

/**
 * The controls that add a block to the page itself: the start area on an
 * empty page (`page-start-area.tsx`), and a "+" in each gap between blocks.
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
 * the start area's "＋ Add a block" calls {@link PageInsertersProps.onStart},
 * and pressing a "+"
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
import { watchCanvasFor } from "./canvas-geometry-watch";
import {
  boxInFrameViewport,
  canvasContentPoint,
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
import { StartArea, startPlaceIn, type StarterPage } from "./page-start-area";
import { gapWords } from "./page-start-words";

/**
 * What an empty page's start area says and reports.
 *
 * @experimental
 */
export interface StartOptions {
  /** The page's title, which a page's start area is headed with. */
  readonly title?: string;
  /** "＋ Add a block" was pressed; `control` is the button. */
  readonly onStart: (control: HTMLElement) => void;
  /**
   * "Insert a saved section" was pressed. Absent where a saved section cannot
   * be inserted, and so is the button.
   */
  readonly onSavedSection?: () => void;
  /** Starter pages an empty page can begin from; none, no row. */
  readonly starters?: readonly StarterPage[];
  /** A starter page was chosen. */
  readonly onStarter?: (id: string) => void;
}

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
  /**
   * A block is dragged over the canvas: no "+" shows, and an empty page's
   * start area is drawn as where it drops.
   */
  readonly dragging?: boolean;
  /** What an empty page's start area says and reports. */
  readonly start: StartOptions;
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

/** Where the start area goes on an empty page, or `null` outside a canvas. */
function measureStart(layer: HTMLElement): Point | null {
  const space = overlaySpaceOf(layer, CANVAS_ROOT_CLASS);
  return space === null ? null : startPlaceIn(space);
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

/** What the gaps and the start area are measured from, and what moves them. */
interface Measured {
  readonly gaps: readonly Gap[];
  readonly start: Point | null;
}

const NOTHING_MEASURED: Measured = { gaps: [], start: null };

/**
 * The gaps, or the start area's place on an empty page, measured now and
 * again on everything that moves the canvas: a change inside it, a resize and
 * a zoom.
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
    // A finger has no hover to come near with: a touch screen keeps a roomy
    // "+" shown and pressable all over, and the stylesheet decides which.
    if (event.nativeEvent.pointerType === "touch") return;
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

/**
 * The start area on an empty page and the "+" in the gaps between blocks.
 *
 * @experimental
 */
export function PageInserters({
  document,
  selectedId = null,
  hidden = false,
  dragging = false,
  start,
  onAddAfter,
  componentTitle,
}: PageInsertersProps): React.JSX.Element | null {
  const layer = React.useRef<HTMLDivElement | null>(null);
  const empty = document.nodes.length === 0;
  // While a block is dragged no "+" shows: the drag's own line says where it
  // lands. An empty page's start area stays, as where it drops.
  const noGaps = hidden || dragging;
  const measured = useMeasured(layer, document, selectedId, hidden);
  const gaps = noGaps ? NO_GAPS : measured.gaps;
  const [near, setNear] = useNearGap(layer, gaps, noGaps);
  useTabToGap(layer, gaps, selectedId);
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
          <StartArea
            document={document}
            place={measured.start}
            dragging={dragging}
            {...start}
          />
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

/** No gaps, the one value, so a drag's render changes no gap watcher. */
const NO_GAPS: readonly Gap[] = [];
