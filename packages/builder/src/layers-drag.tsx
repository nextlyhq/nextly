"use client";

/**
 * Dragging a Layers row: the pointer, the line, and the reason a drop is
 * refused.
 *
 * Decides nothing about WHERE a row lands — {@link layersDrop} does that, from
 * measured rows, and judges it by the one placement rule and the editor's
 * locks. This is the seam between that and a browser: it reads the rows the
 * tree drew, follows one gesture, and commits the drop through the editor's
 * own `move`, the op a keyboard move applies, as one undo step.
 *
 * ## Driven from the panel, not the tree
 *
 * The rows are the shared `TreeView`'s, and nothing here changes it. The
 * gesture is read by delegation on an element around the tree: a press finds
 * its row through `role="treeitem"` and the block through `data-nx-layer`, and
 * the depth through `aria-level` — the attributes the tree already draws for
 * assistive technology, so the drag reads the same structure a screen reader
 * does.
 *
 * ## Drag is an enhancement, never the only way
 *
 * WCAG 2.2 SC 2.5.7 asks for a way to do what a drag does without dragging.
 * The editor's move keys and the block menu's Move up, down, in and out do
 * every move this does, judged by the same rule.
 *
 * ## The rows are measured on every move
 *
 * Unlike the canvas, which measures once, a Layers drag changes the list under
 * the pointer: a collapsed row opens after a hover, and the tree draws only
 * the rows near the visible window, so a scroll swaps rows in and out. The rows
 * are therefore read again for each aim — a few dozen rectangles at most.
 *
 * @module layers-drag
 */

import type {
  BlockDocument,
  BlockNode,
  ComponentLookup,
  NestingSource,
} from "@nextlyhq/blocks-engine";
import { useIsomorphicLayoutEffect } from "@nextlyhq/ui";
import * as React from "react";

import { autoscrollStep } from "./autoscroll";
import { DEFAULT_ACTIVATION_PX } from "./canvas-drag";
import { isElement } from "./dom-kind";
import { placementSources } from "./drop-targets";
import type { EditorState } from "./editor-state";
import type { Point, Rect } from "./geometry";
import {
  canvasContentPoint,
  canvasContentRect,
  containerEdges,
} from "./geometry-dom";
import { holdsBlocks } from "./keyboard-move";
import {
  LAYERS_DEPTH_PX,
  layersDrop,
  layersRefusalWording,
  layersVerdictCache,
  rowAt,
  type LayersDropResult,
  type LayersRow,
  type LayersVerdictCache,
} from "./layers-drop";
import { isLayersLockFacts } from "./lock-refusal";
import { refusalAnnouncement, unmovedAnnouncement } from "./move-refusal";
import { RefusalNotice } from "./refusal-notice";

/** How long the pointer rests on a collapsed row before it opens. */
export const LAYERS_OPEN_DELAY_MS = 500;

/**
 * How long a finger holds a row before it is picked up.
 *
 * A touch cannot use the mouse's distance threshold: a finger moving on a list
 * is a scroll, and the tree keeps the browser's own touch panning so that it
 * stays one. So a touch drag begins with a HOLD, the sortable-list pattern a
 * touch user already knows, and only a still finger becomes a drag.
 */
export const LAYERS_TOUCH_HOLD_MS = 300;

/**
 * How far a finger may tremble during the hold and still be holding. Past it
 * the finger is moving, which is a scroll, and the press is let go.
 */
export const LAYERS_TOUCH_TOLERANCE_PX = 5;

/** How far past the panel's edge a refusal's reason sits. */
const NOTICE_GAP_PX = 8;
/** How far above the line the reason starts, so its first line meets it. */
const NOTICE_LIFT_PX = 10;
/** The least margin a reason keeps from the window's edges. */
const NOTICE_MARGIN_PX = 8;

/** The class the tree's scrolling element carries, set by the panel. */
export const LAYERS_TREE_CLASS = "nx-layers-panel__tree";

export interface UseLayersDragOptions {
  /** The editor whose document a drop moves a block in. */
  editor: EditorState;
  /** The nesting rules the placement is judged by. */
  nesting: NestingSource;
  /** The component definitions an instance is judged by, when there are any. */
  definitions?: ComponentLookup;
  /**
   * Whether a press may start a drag. Off while a search filters the rows:
   * a filtered list hides the neighbours a gap is between, so a line drawn
   * there would name a place the author cannot see.
   */
  enabled: boolean;
  /** Opens a collapsed row the pointer has rested on. */
  onOpen: (id: string) => void;
}

/** What the panel draws while a drag is aimed somewhere. */
export interface LayersDrawn {
  readonly result: Exclude<LayersDropResult, { kind: "none" }>;
  /** The line's height, measured from the top of the element the drag is on. */
  readonly top: number;
  /** The line's start, measured from the left of that element. */
  readonly left: number;
  /**
   * Where a refusal's reason is placed, in WINDOW coordinates: level with the
   * line, just past the panel's right edge, so it covers none of the rows the
   * author is aiming between.
   */
  readonly notice: { readonly top: number; readonly left: number };
}

export interface LayersDrag {
  /** The handlers the element around the tree must carry. */
  readonly handlers: {
    readonly onPointerDown: React.PointerEventHandler<HTMLElement>;
    readonly onPointerMove: React.PointerEventHandler<HTMLElement>;
    readonly onPointerUp: React.PointerEventHandler<HTMLElement>;
    readonly onPointerCancel: React.PointerEventHandler<HTMLElement>;
    readonly onLostPointerCapture: React.PointerEventHandler<HTMLElement>;
  };
  /** The block being dragged, or null when no drag is in flight. */
  readonly draggingId: string | null;
  /** What to draw, or null when the pointer aims nowhere. */
  readonly drawn: LayersDrawn | null;
  /** The live region's text: why the drop under the pointer is refused. */
  readonly announcement: string;
  /**
   * Abandon the gesture, held or in flight, drawing nothing: for another
   * gesture that claims the same press, such as a touch's long press opening
   * the row menu.
   */
  readonly cancel: () => void;
}

/** What one gesture remembers, none of which renders. */
interface Gesture {
  readonly owner: number;
  readonly id: string;
  /** The element the handlers are on, which the rows are read inside. */
  readonly host: HTMLElement;
  readonly originX: number;
  readonly originY: number;
  /** Where depth zero begins: the press, less the pressed row's own depth. */
  readonly left: number;
  readonly document: BlockDocument;
  /** Every block of that document by id, read once (`placesIn`). */
  readonly places: ReadonlyMap<string, Placed>;
  /** Replaced, not kept, when the sources it was judged by are replaced. */
  verdicts: LayersVerdictCache;
  active: boolean;
  clientX: number;
  clientY: number;
  result: LayersDropResult;
  frame: number | null;
  /** The collapsed row being rested on, and the timer that opens it. */
  resting: { readonly id: string; readonly timer: number } | null;
  /**
   * Set when a row has opened under a pointer that may not move again: the
   * rows below it have shifted, so the aim is read again on the next frame
   * rather than leaving the line, and the release, on a list that has gone.
   */
  stale: boolean;
  /** The reason this gesture last put in the live region, or "". */
  spoken: string;
  /** The tree's scroll offset when the gesture last aimed. */
  seenScroll: number;
  /** Whether a finger drives it, which picks up by a hold, not a distance. */
  readonly touch: boolean;
  /** The hold that picks a touched row up, while it is still being held. */
  hold: number | null;
  /** Lets the page pan again; set while a touched row is picked up. */
  release: (() => void) | null;
}

/** The block a row stands for, read from the label the panel draws in it. */
function rowBlockId(row: Element): string | null {
  return (
    row.querySelector("[data-nx-layer]")?.getAttribute("data-nx-layer") ?? null
  );
}

/** Where one block sits in the document the drag began on. */
interface Placed {
  readonly node: BlockNode;
  readonly parentId: string | undefined;
  readonly slot: string | undefined;
  readonly index: number;
}

/**
 * Every block in the document by id, with where it sits, from ONE walk.
 *
 * Built when the gesture begins, because the document cannot change while a
 * drag lasts: the drag is the only gesture in flight and nothing is applied
 * until it ends. Each pointer move then places the rows on screen by lookup,
 * where finding each one in the document would walk it once per row per move.
 */
function placesIn(document: BlockDocument): ReadonlyMap<string, Placed> {
  const places = new Map<string, Placed>();
  const walk = (
    nodes: readonly BlockNode[],
    parentId: string | undefined,
    slot: string | undefined
  ): void => {
    nodes.forEach((node, index) => {
      // Read defensively, as the engine's own walk is: a stored document may
      // hold a hole or a slot that is not a list.
      if (typeof node?.id !== "string") return;
      places.set(node.id, { node, parentId, slot, index });
      for (const [name, children] of Object.entries(node.slots ?? {})) {
        if (Array.isArray(children)) walk(children, node.id, name);
      }
    });
  };
  walk(document.nodes, undefined, undefined);
  return places;
}

/**
 * The rows on screen, in order, with where each block sits, measured in the
 * coordinates of the element the drag is on — the space the line is drawn in,
 * so a measured gap can be handed to `top` and lands on what was measured.
 */
function measureRows(
  host: HTMLElement,
  places: ReadonlyMap<string, Placed>,
  definitions: ComponentLookup | undefined
): LayersRow[] {
  const items = Array.from(
    host.querySelectorAll<HTMLElement>('[role="treeitem"]')
  ).sort(
    (a, b) =>
      Number(a.getAttribute("data-tree-index")) -
      Number(b.getAttribute("data-tree-index"))
  );
  return items.flatMap(item => {
    const id = rowBlockId(item);
    const at = id === null ? undefined : places.get(id);
    if (id === null || at === undefined) return [];
    const box = canvasContentRect(item, host);
    return [
      {
        id,
        depth: Number(item.getAttribute("aria-level") ?? "1") - 1,
        parentId: at.parentId,
        slot: at.slot,
        index: at.index,
        expanded: item.getAttribute("aria-expanded") === "true",
        canHoldChildren: holdsBlocks(at.node, definitions),
        top: box.y,
        height: box.height,
      },
    ];
  });
}

/**
 * Keep the browser from panning the page while a touched row is held.
 *
 * The tree leaves `touch-action` alone so a finger still scrolls it, which
 * means the browser would take a moving finger for a pan and cancel the
 * pointer. A `touchmove` cancelled before the pan starts stops that, and is
 * listened for only while a row is picked up. The long-press menu a held
 * finger would open is stopped for the same span. Answers the undo.
 */
function holdPage(host: HTMLElement): () => void {
  const stop = (event: Event): void => {
    event.preventDefault();
  };
  // Not passive, or the cancel is ignored.
  host.addEventListener("touchmove", stop, { passive: false });
  host.addEventListener("contextmenu", stop);
  return () => {
    host.removeEventListener("touchmove", stop);
    host.removeEventListener("contextmenu", stop);
  };
}

/**
 * Where a row at depth zero starts its content, measured from a row on screen
 * and stepped back by the tree's indent: the line for a depth then starts
 * where a row at that depth draws its icon, with no offset assumed about how
 * the tree pads a row.
 */
function depthStart(host: HTMLElement): number {
  const content = host.querySelector(".nx-layer-row");
  const row = content?.closest('[role="treeitem"]');
  if (
    content === null ||
    content === undefined ||
    row === null ||
    row === undefined
  ) {
    return 0;
  }
  const depth = Number(row.getAttribute("aria-level") ?? "1") - 1;
  return canvasContentRect(content, host).x - depth * LAYERS_DEPTH_PX;
}

/** Whether a point is inside a rectangle, edges included. */
function inside(box: Rect, point: Point): boolean {
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  );
}

/**
 * Whether the editor's locks hold a block where it is, so no drag can move it.
 *
 * A block in an area locked "all" or to its content may not move at all, not
 * even within the area; one locked to its order may still be reordered there.
 * Asked of the editor's own lock question with a move out to the end of the
 * page, which leaves only the area the block is in to answer.
 */
function heldInPlace(editor: EditorState, id: string): boolean {
  const found = editor.lockRefusalFor([
    { kind: "move", id, to: { index: editor.document.nodes.length } },
  ]);
  // A slot locked to its order still lets it be reordered inside the slot. A
  // Layers lock is not asked here: the drag starts and every place refuses it
  // in the lock's words (`layersDrop`), so the author is told why.
  return (
    found !== undefined && !isLayersLockFacts(found) && found.lock !== "insert"
  );
}

/** The row a press landed in, inside `host`: its block and its depth. */
function pressedRow(
  target: EventTarget,
  host: HTMLElement
): { id: string; depth: number } | null {
  // Asked by node kind, so a row in another document still answers.
  if (!isElement(target)) return null;
  const row = target.closest('[role="treeitem"]');
  if (row === null || !host.contains(row)) return null;
  const id = rowBlockId(row);
  if (id === null) return null;
  return { id, depth: Number(row.getAttribute("aria-level") ?? "1") - 1 };
}

/**
 * Whether a drag may pick the block up. A block its area holds in place is
 * left alone: the press still selects it. A block a Layers lock holds, its own
 * or one inside or around it, is picked up so that the drag can say why it
 * will not land anywhere, as the canvas does.
 */
function movable(editor: EditorState, id: string): boolean {
  return !heldInPlace(editor, id);
}

/** A comparable spelling of what is drawn, so an unchanged aim draws nothing. */
function drawnKey(drawn: LayersDrawn | null): string {
  if (drawn === null) return "";
  const { result } = drawn;
  const why =
    result.kind === "refused"
      ? refusalAnnouncement(layersRefusalWording(result.refusal))
      : "";
  return [result.kind, drawn.top, drawn.left, why].join("\u0000");
}

/**
 * Wire pointer events on the element around the Layers tree to the drop rule.
 *
 * Returns handlers to spread onto that element and what to draw over it.
 */
export function useLayersDrag({
  editor,
  nesting,
  definitions,
  enabled,
  onOpen,
}: UseLayersDragOptions): LayersDrag {
  const gesture = React.useRef<Gesture | null>(null);
  const [draggingId, setDraggingId] = React.useState<string | null>(null);
  const [drawn, setDrawn] = React.useState<LayersDrawn | null>(null);
  const [announcement, setAnnouncement] = React.useState("");

  // Read at event time, so a handler bound on one render never acts on a
  // document or an option a later render replaced.
  const latest = React.useRef({
    editor,
    nesting,
    definitions,
    enabled,
    onOpen,
  });
  latest.current = { editor, nesting, definitions, enabled, onOpen };

  const stopResting = React.useCallback((drag: Gesture) => {
    if (drag.resting !== null) window.clearTimeout(drag.resting.timer);
    drag.resting = null;
  }, []);

  /** End the gesture and release what it holds, drawing nothing. */
  const teardown = React.useCallback(() => {
    const drag = gesture.current;
    if (drag === null) return;
    if (drag.frame !== null) cancelAnimationFrame(drag.frame);
    if (drag.hold !== null) window.clearTimeout(drag.hold);
    drag.release?.();
    stopResting(drag);
    if (drag.host.hasPointerCapture(drag.owner)) {
      drag.host.releasePointerCapture(drag.owner);
    }
    gesture.current = null;
  }, [stopResting]);

  const reset = React.useCallback(() => {
    teardown();
    setDraggingId(null);
    setDrawn(null);
    // The region describes the drag, so it goes quiet when the drag ends; the
    // next drag's reason is then a change it announces, even if identical.
    setAnnouncement("");
  }, [teardown]);

  /**
   * Open a collapsed row the pointer rests on, after a short wait.
   *
   * Started once per row: a pointer moving within the same row keeps the
   * timer it has rather than restarting it, or a hand that never holds
   * perfectly still would never open anything.
   */
  const restOn = React.useCallback(
    (drag: Gesture, row: LayersRow | undefined) => {
      const opens =
        row !== undefined &&
        row.id !== drag.id &&
        !row.expanded &&
        row.canHoldChildren;
      if (!opens) {
        stopResting(drag);
        return;
      }
      if (drag.resting?.id === row.id) return;
      stopResting(drag);
      const id = row.id;
      drag.resting = {
        id,
        timer: window.setTimeout(() => {
          if (gesture.current !== drag) return;
          drag.resting = null;
          drag.stale = true;
          latest.current.onOpen(id);
        }, LAYERS_OPEN_DELAY_MS),
      };
    },
    [stopResting]
  );

  /** Re-aim the drag at where the pointer is now, and draw the answer. */
  const aim = React.useCallback(
    (drag: Gesture) => {
      const { definitions: components, editor: current } = latest.current;
      const tree = drag.host.querySelector(`.${LAYERS_TREE_CLASS}`);
      const rows = measureRows(drag.host, drag.places, components);
      const pointer = canvasContentPoint(drag.clientX, drag.clientY, drag.host);
      // Outside the tree's own box is nowhere, even where a row the tree drew
      // just beyond its scrolled edge would be under the pointer.
      const within =
        tree !== null && inside(canvasContentRect(tree, drag.host), pointer);
      restOn(drag, within ? rowAt(rows, pointer.y) : undefined);
      drag.result = within
        ? layersDrop({
            rows,
            draggedId: drag.id,
            pointer,
            left: drag.left,
            placement: {
              document: drag.document,
              sources: placementSources({
                nesting: latest.current.nesting,
                ...(components === undefined
                  ? {}
                  : { definitions: components }),
              }),
              lockRefusalFor: current.lockRefusalFor,
              verdicts: drag.verdicts,
            },
          })
        : { kind: "none" };

      const result = drag.result;
      const edges = containerEdges(drag.host);
      const next: LayersDrawn | null =
        result.kind === "none"
          ? null
          : {
              result,
              notice: {
                top: edges.top + result.line.y - NOTICE_LIFT_PX,
                left: edges.right + NOTICE_GAP_PX,
              },
              top: result.line.y,
              left: depthStart(drag.host) + result.line.depth * LAYERS_DEPTH_PX,
            };
      setDrawn(previous =>
        drawnKey(previous) === drawnKey(next) ? previous : next
      );
      const sentence =
        result.kind === "refused"
          ? refusalAnnouncement(layersRefusalWording(result.refusal))
          : "";
      // Spoken when the reason CHANGES, not on every move over the same
      // refusal. Leaving a refused gap clears the region and so does the
      // drag's end, so the same reason met again is a change, read again.
      if (sentence !== drag.spoken) {
        drag.spoken = sentence;
        setAnnouncement(sentence);
      }
    },
    [restOn]
  );

  /**
   * Scroll the tree while the pointer rests near its top or bottom edge, and
   * keep aiming: the rows move under a pointer that does not.
   */
  const pump = React.useCallback(() => {
    const drag = gesture.current;
    if (drag === null || !drag.active) return;
    // The tree the drag is on was taken off the page — emptied, or the panel
    // swapped it for its note — so there is nothing left to aim at, and a
    // loop that kept running would hold a detached tree for ever.
    if (!drag.host.isConnected) {
      reset();
      return;
    }
    const tree = drag.host.querySelector<HTMLElement>(`.${LAYERS_TREE_CLASS}`);
    if (tree !== null) {
      const edges = containerEdges(tree);
      const step = autoscrollStep(drag.clientY, edges.top, edges.bottom);
      if (step !== 0) tree.scrollTop += step;
      // Whoever scrolled the tree — this loop, a wheel, a trackpad — the rows
      // have moved under a pointer that has not, so the aim is read again.
      // Compared with the offset last aimed at rather than with this frame's
      // own step, which a scroll from outside never shows up in.
      if (tree.scrollTop !== drag.seenScroll) {
        drag.seenScroll = tree.scrollTop;
        drag.stale = true;
      }
    }
    if (drag.stale) {
      drag.stale = false;
      aim(drag);
    }
    drag.frame = requestAnimationFrame(pump);
  }, [aim, reset]);

  /**
   * Turn a press into a drag: by distance for a mouse or a pen, by the hold
   * for a finger. Either way the block is selected and the pointer captured
   * only now, for the reason the canvas gives — capturing a press that stays
   * a click would retarget the click away from the row.
   */
  const activate = React.useCallback(
    (drag: Gesture) => {
      drag.active = true;
      drag.hold = null;
      // A new drag starts quiet, whatever the last one left in the region —
      // a refusal, or a move the editor did not make. Its own outcome is then
      // a change from silence and is read out, even if it repeats the last.
      setAnnouncement("");
      drag.host.setPointerCapture(drag.owner);
      if (drag.touch) drag.release = holdPage(drag.host);
      latest.current.editor.select(drag.id);
      setDraggingId(drag.id);
      drag.frame = requestAnimationFrame(pump);
      aim(drag);
    },
    [aim, pump]
  );

  const onPointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      // The primary button only, and one gesture at a time.
      if (event.button !== 0 || gesture.current?.active === true) return;
      const { editor: current, enabled: allowed } = latest.current;
      if (!allowed) return;
      const pressed = pressedRow(event.target, event.currentTarget);
      if (pressed === null || !movable(current, pressed.id)) return;
      const { id, depth } = pressed;
      gesture.current = {
        owner: event.pointerId,
        id,
        host: event.currentTarget,
        originX: event.clientX,
        originY: event.clientY,
        left:
          canvasContentPoint(event.clientX, event.clientY, event.currentTarget)
            .x -
          depth * LAYERS_DEPTH_PX,
        document: current.document,
        places: placesIn(current.document),
        verdicts: layersVerdictCache(),
        active: false,
        clientX: event.clientX,
        clientY: event.clientY,
        result: { kind: "none" },
        frame: null,
        resting: null,
        stale: false,
        spoken: "",
        seenScroll:
          event.currentTarget.querySelector(`.${LAYERS_TREE_CLASS}`)
            ?.scrollTop ?? 0,
        touch: event.pointerType === "touch",
        hold: null,
        release: null,
      };
      const drag = gesture.current;
      if (drag.touch) {
        drag.hold = window.setTimeout(() => {
          if (gesture.current === drag && !drag.active) activate(drag);
        }, LAYERS_TOUCH_HOLD_MS);
      }
    },
    [activate]
  );

  const onPointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const drag = gesture.current;
      if (drag === null || drag.owner !== event.pointerId) return;
      drag.clientX = event.clientX;
      drag.clientY = event.clientY;
      if (drag.active) {
        aim(drag);
        return;
      }
      const travelled = Math.hypot(
        event.clientX - drag.originX,
        event.clientY - drag.originY
      );
      if (drag.touch) {
        // A finger that moves before the hold is scrolling: let it go, and
        // the browser pans the list as it would have without this.
        if (travelled > LAYERS_TOUCH_TOLERANCE_PX) reset();
        return;
      }
      // The same threshold the canvas uses, so a click on a row stays a
      // click and never commits a move to where the block already is.
      if (travelled >= DEFAULT_ACTIVATION_PX) activate(drag);
    },
    [activate, aim, reset]
  );

  const onPointerUp = React.useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const drag = gesture.current;
      if (drag === null || drag.owner !== event.pointerId) return;
      const result = drag.result;
      // ONE op, through the editor's own move: one undo step, refused by its
      // apply as a keyboard move would be if anything changed under the drag.
      // A refused or empty aim moves nothing, so the block stays where it was.
      const applied =
        drag.active && result.kind === "drop"
          ? latest.current.editor.apply({
              kind: "move",
              id: drag.id,
              to: result.to,
              ...(result.dropSlotIfEmpty === undefined
                ? {}
                : { dropSlotIfEmpty: result.dropSlotIfEmpty }),
            })
          : undefined;
      reset();
      // A drop drawn as allowed that the store still refused is said, after
      // the reset that quiets the region: a move that did not happen must not
      // read like one that did.
      if (applied === null) {
        setAnnouncement(unmovedAnnouncement(drag.document, drag.id));
      }
    },
    [reset]
  );

  const onPointerCancel = React.useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (gesture.current?.owner !== event.pointerId) return;
      reset();
    },
    [reset]
  );

  /*
   * The browser took the pointer away — another element captured it, or the
   * window lost it. The drag cannot hear its release any more, so it ends
   * here rather than waiting for one. Only for an ACTIVE gesture of this
   * pointer: the release this hook makes itself fires it after the gesture
   * is already gone.
   */
  const onLostPointerCapture = React.useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const drag = gesture.current;
      if (drag === null || !drag.active) return;
      if (drag.owner !== event.pointerId) return;
      // The tree's OWN capture, and only that. A touch is captured by the row
      // it lands on, and picking the row up moves the capture to the tree: the
      // row reports losing it, and that event bubbles here. It is the drag
      // taking hold, and ending the drag for it would end every touch drag.
      if (event.target !== drag.host) return;
      reset();
    },
    [reset]
  );

  /*
   * The document changed under a drag — a Delete or an Undo pressed while the
   * pointer is held. Everything the gesture judged was judged against the
   * document it began on, and the dragged block may not exist any more, so
   * the drag ends rather than dropping into a page it never saw.
   */
  React.useEffect(() => {
    const drag = gesture.current;
    if (drag !== null && drag.document !== editor.document) reset();
  }, [editor.document, reset]);

  /*
   * The rules or the component definitions were replaced under a drag — the
   * component library finishing its load, typically. The document is the
   * same, so the gesture goes on, but every verdict it kept was reached with
   * the old sources and the store will not ask again on release: they are
   * dropped and the place under the pointer is judged afresh.
   */
  React.useEffect(() => {
    const drag = gesture.current;
    if (drag === null) return;
    drag.verdicts = layersVerdictCache();
    if (drag.active) aim(drag);
  }, [definitions, nesting, aim]);

  // A panel closed mid-drag must not leave a frame loop or a timer behind.
  React.useEffect(() => teardown, [teardown]);

  /*
   * Escape abandons the drag. On the DOCUMENT and in the capture phase, as the
   * canvas listens: the keyboard is wherever focus was when the drag began,
   * and the editor's own Escape (clearing the selection) must not also run.
   */
  React.useEffect(() => {
    if (draggingId === null) return;
    const abandon = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      reset();
    };
    document.addEventListener("keydown", abandon, true);
    return () => {
      document.removeEventListener("keydown", abandon, true);
    };
  }, [draggingId, reset]);

  return {
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onLostPointerCapture,
    },
    draggingId,
    drawn,
    announcement,
    cancel: reset,
  };
}

/**
 * The line where a dragged row would land, and why it cannot when it cannot.
 *
 * Drawn over the tree by the panel, in the coordinates of the element the
 * drag is on. Hidden from assistive technology: the reason is spoken through
 * the panel's live region, and a pointer gesture describes itself to anyone
 * who can see the line.
 */
export function LayersDropOverlay({
  drawn,
}: {
  drawn: LayersDrawn | null;
}): React.JSX.Element | null {
  if (drawn === null) return null;
  const { result } = drawn;
  const refused = result.kind === "refused";
  const wording = refused ? layersRefusalWording(result.refusal) : null;
  return (
    <>
      <div
        className="nx-layers-drop-line"
        data-refused={refused ? "" : undefined}
        style={{ top: drawn.top, left: drawn.left }}
        aria-hidden="true"
      />
      {wording === null ? null : (
        <PlacedRefusal
          headline={wording.headline}
          remedy={wording.remedy}
          at={drawn.notice}
        />
      )}
    </>
  );
}

/**
 * A refused drop's reason, beside the panel rather than on it.
 *
 * Fixed in the window, level with the line, just past the panel's right edge,
 * so every row the author is aiming between stays readable. Fixed rather than
 * absolute so the panel's own clipping cannot cut it off; still drawn inside
 * the panel, so it keeps the editor's tokens and theme. Kept on screen by
 * moving it back inside the window by its own measured size.
 *
 * The one refusal notice the canvas draws too (`RefusalNotice`), placed here.
 */
function PlacedRefusal({
  headline,
  remedy,
  at,
}: {
  headline: string;
  remedy: string | null;
  at: LayersDrawn["notice"];
}): React.JSX.Element {
  const element = React.useRef<HTMLDivElement | null>(null);
  const [placed, setPlaced] = React.useState(at);
  useIsomorphicLayoutEffect(() => {
    const notice = element.current;
    if (notice === null) return;
    const right = window.innerWidth - notice.offsetWidth - NOTICE_MARGIN_PX;
    const bottom = window.innerHeight - notice.offsetHeight - NOTICE_MARGIN_PX;
    const left = Math.max(NOTICE_MARGIN_PX, Math.min(at.left, right));
    const top = Math.max(NOTICE_MARGIN_PX, Math.min(at.top, bottom));
    setPlaced(previous =>
      previous.left === left && previous.top === top ? previous : { left, top }
    );
  }, [at.left, at.top, headline, remedy]);
  return (
    <RefusalNotice
      ref={element}
      className="nx-layers-drop-refusal"
      style={{ position: "fixed", top: placed.top, left: placed.left }}
      headline={headline}
      remedy={remedy}
    />
  );
}
