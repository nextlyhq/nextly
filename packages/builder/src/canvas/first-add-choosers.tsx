"use client";

/**
 * The chooser a block just added asks for, drawn on the canvas in place of
 * the block's body while the editor's first-add step holds (`first-add.ts`).
 *
 * Drawn like `ImageStates`, in the overlay over the canvas, at the block's
 * measured rectangle and kept current by `watchCanvasFor`. A new block is
 * often shorter than its chooser (a Columns row of two empty columns is one
 * empty-container's height), so while the chooser shows the block is given
 * the chooser's height as its minimum, on the canvas only: the page makes
 * room for it rather than the chooser covering what follows. That minimum is
 * taken back the moment the chooser goes.
 *
 * Focus moves to the chooser when it opens (the block brought into view
 * first), so it is reached from the keyboard whichever way the block was added, and goes back where it was
 * once the author picks or skips.
 *
 * @module canvas/first-add-choosers
 */
import { COLLECTION_LIST_TYPE, findNode } from "@nextlyhq/blocks-engine";
import * as React from "react";

import {
  CollectionListPicker,
  type CollectionPickerServices,
} from "../collection-list-picker";
import { ColumnsLayoutPicker } from "../columns-layout-picker";
import { isHTMLElement } from "../dom-kind";
import type { EditorState } from "../editor-state";
import type { FirstAdd } from "../first-add";
import type { Rect } from "../geometry";
import { CANVAS_ROOT_CLASS } from "../shell-state";

import { nodeElement } from "./canvas-addressing";
import { CHROME_ATTRIBUTE } from "./canvas-chrome";
import { returnFocusToCanvas } from "./canvas-escape";
import { useCanvasFrame } from "./canvas-frame-context";
import { watchCanvasFor } from "./canvas-geometry-watch";
import {
  layoutFragments,
  overlaySpaceOf,
  renderSkips,
  visiblePartOf,
} from "./geometry-dom";
import { revealNode } from "./reveal-node";

export interface FirstAddChoosersProps {
  /** The editor whose first-add step this draws. */
  readonly editor: EditorState;
  /**
   * A block is being dragged: the chooser is not drawn, so the drag reaches
   * the canvas beneath. The step itself holds.
   */
  readonly hidden?: boolean;
  /**
   * The host's collections, for a Collection list's first step. Absent, the
   * step says the collections couldn't be listed, and Skip still leaves a
   * blank list.
   */
  readonly services?: CollectionPickerServices | undefined;
}

/**
 * Whether a list has no source: no collection, no custom source and no
 * related entries. Such a list asks which entries it shows whenever it is
 * selected, not only just after it is added, so a reload or an Escape lands
 * on the same question.
 */
function hasNoSource(props: Readonly<Record<string, unknown>>): boolean {
  const collection = props.collection;
  return (
    (typeof collection !== "string" || collection.trim() === "") &&
    props.namedQuery === undefined &&
    props.relation === undefined
  );
}

/**
 * The selected list's question, where the editor holds no first-add step:
 * a pick is its own step of the history, and Skip puts the question away
 * until the list is selected again.
 */
function useSourcelessListAsk(
  editor: EditorState,
  dismissed: string | undefined,
  dismiss: (nodeId: string) => void
): FirstAdd | undefined {
  const selected = editor.selectedId;
  const node =
    selected === null ? undefined : findNode(editor.document.nodes, selected);
  const asks =
    node !== undefined &&
    node.type === COLLECTION_LIST_TYPE &&
    node.id !== dismissed &&
    hasNoSource(node.props);
  const nodeId = asks ? node.id : undefined;
  const { applyAll } = editor;
  return React.useMemo(
    () =>
      nodeId === undefined
        ? undefined
        : {
            nodeId,
            chooser: "collection-source",
            choose: ops => applyAll(ops) !== null,
            skip: () => dismiss(nodeId),
          },
    [nodeId, applyAll, dismiss]
  );
}

/** The block's minimum height while its chooser shows, and what it had. */
interface Reserved {
  readonly element: HTMLElement;
  /** The inline value the block carried before, put back afterwards. */
  readonly before: string;
}

/** Where the chooser is drawn: its block's shown part, in overlay space. */
function shownRectOf(
  layer: HTMLElement,
  nodeId: string
): { rect: Rect; element: Element; scale: number } | null {
  const space = overlaySpaceOf(layer, CANVAS_ROOT_CLASS);
  if (space === null) return null;
  const element = nodeElement(space.root, nodeId);
  // A block the canvas lays out nowhere has no place for a chooser.
  if (element === null || layoutFragments(element) === 0) return null;
  if (renderSkips(element)) return null;
  const visible = visiblePartOf(element, space.root);
  if (visible === null || visible === "hidden") return null;
  return { rect: space.place(visible), element, scale: space.scale };
}

/** Where the chooser goes, when there is a layer and a block to draw it for. */
function shownFor(
  layer: HTMLElement | null,
  nodeId: string | undefined
): ReturnType<typeof shownRectOf> {
  return layer === null || nodeId === undefined
    ? null
    : shownRectOf(layer, nodeId);
}

/**
 * A block a scrolling box around it hides entirely (added below the box's
 * view) has no part to draw a chooser over: it is scrolled into view once,
 * then measured again.
 */
function unhide(
  layer: HTMLElement | null,
  nodeId: string | undefined,
  unhiddenFor: { current: string | undefined }
): ReturnType<typeof shownRectOf> {
  if (layer === null || nodeId === undefined) return null;
  if (unhiddenFor.current === nodeId) return null;
  const root = overlaySpaceOf(layer, CANVAS_ROOT_CLASS)?.root;
  const element = root === undefined ? null : nodeElement(root, nodeId);
  if (element === null || layoutFragments(element) === 0) return null;
  if (renderSkips(element)) return null;
  unhiddenFor.current = nodeId;
  revealNode(element.ownerDocument, nodeId, { instant: true });
  return shownRectOf(layer, nodeId);
}

/** Two rectangles at the same place and size. */
function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
  );
}

/** Put back the minimum height a block carried before its chooser showed. */
function release(reserved: Reserved | null): void {
  if (reserved === null) return;
  if (reserved.before === "")
    reserved.element.style.removeProperty("min-block-size");
  else reserved.element.style.setProperty("min-block-size", reserved.before);
}

/**
 * The chooser's own height, its padding and the plate's edge included. Read
 * from the body, not the plate, whose height follows the block's and would
 * hold a room once made.
 */
function chooserHeight(body: HTMLDivElement | null): number {
  if (body === null) return 0;
  const plate = body.parentElement;
  const edge = plate === null ? 0 : plate.offsetHeight - plate.clientHeight;
  return body.offsetHeight + edge;
}

/**
 * Give the block the chooser's height as its minimum, as the page measures
 * it: the overlay is drawn at the canvas's zoom, the page at its own size.
 * What the block carried before is kept, to be put back.
 */
function reserveRoom(
  reserved: { current: Reserved | null },
  found: { readonly element: Element; readonly scale: number },
  height: number
): void {
  const { element: block } = found;
  if (height <= 0 || !isHTMLElement(block)) return;
  const wanted = `${String(Math.ceil(height / found.scale))}px`;
  if (reserved.current?.element !== block) {
    release(reserved.current);
    reserved.current = {
      element: block,
      before: block.style.getPropertyValue("min-block-size"),
    };
  }
  // Only when it changes: the canvas watches the page's styles, and an
  // unchanged write would measure again for nothing.
  if (block.style.getPropertyValue("min-block-size") !== wanted) {
    block.style.setProperty("min-block-size", wanted);
  }
}

/**
 * Bring a block added off screen (at the end of a long page) into view once,
 * as soon as its room is laid out at the plate's real width, so the whole
 * chooser is shown rather than the empty row the block was.
 */
function revealOnce(
  revealedFor: { current: string | undefined },
  id: string,
  found: { readonly element: Element; readonly rect: Rect },
  laid: { readonly reserved: Reserved | null; readonly plateWidth: number }
): void {
  if (revealedFor.current === id) return;
  if (laid.reserved?.element !== found.element) return;
  if (Math.abs(laid.plateWidth - found.rect.width) >= 1) return;
  revealedFor.current = id;
  // At once: the plate is measured and focused at the block's new place.
  revealNode(found.element.ownerDocument, id, { instant: true });
}

/** The chooser for the block just added, over the canvas. */
export function FirstAddChoosers({
  editor,
  hidden = false,
  services,
}: FirstAddChoosersProps): React.JSX.Element {
  const layer = React.useRef<HTMLDivElement | null>(null);
  const body = React.useRef<HTMLDivElement | null>(null);
  const reserved = React.useRef<Reserved | null>(null);
  // The block last brought into view, so it is brought there once.
  const revealedFor = React.useRef<string | undefined>(undefined);
  // The block last scrolled out from under a box that hid it, likewise.
  const unhiddenFor = React.useRef<string | undefined>(undefined);
  const [rect, setRect] = React.useState<Rect | null>(null);
  // A list put away with Skip, until another block is selected.
  const [dismissed, setDismissed] = React.useState<string | undefined>();
  const dismiss = React.useCallback((id: string) => setDismissed(id), []);
  React.useEffect(() => {
    if (editor.selectedId !== dismissed) setDismissed(undefined);
  }, [editor.selectedId, dismissed]);
  const sourceless = useSourcelessListAsk(editor, dismissed, dismiss);
  const firstAdd = hidden ? undefined : (editor.firstAdd ?? sourceless);
  const nodeId = firstAdd?.nodeId;

  // Read by the measure, which outlives the render that made it.
  const latest = React.useRef(nodeId);
  latest.current = nodeId;

  const measure = React.useCallback(() => {
    const element = layer.current;
    const id = latest.current;
    const found = shownFor(element, id) ?? unhide(element, id, unhiddenFor);
    if (element === null || id === undefined || found === null) {
      setRect(current => (current === null ? current : null));
      return;
    }
    reserveRoom(reserved, found, chooserHeight(body.current));
    revealOnce(revealedFor, id, found, {
      reserved: reserved.current,
      plateWidth: body.current?.parentElement?.offsetWidth ?? 0,
    });
    // Read again: the room just made moves what follows, and may grow it.
    const next = shownRectOf(element, id)?.rect ?? found.rect;
    setRect(current => (sameRect(current, next) ? current : next));
  }, []);

  const canvasFrame = useCanvasFrame();
  React.useLayoutEffect(() => {
    measure();
  }, [measure, editor.document, nodeId, rect, canvasFrame]);
  React.useEffect(
    () => watchCanvasFor(() => layer.current, measure),
    [measure, nodeId, canvasFrame]
  );

  // The block's own height comes back once its chooser goes.
  React.useEffect(
    () => () => {
      release(reserved.current);
      reserved.current = null;
    },
    [nodeId]
  );

  // Focus moves into the chooser once it is placed, and goes back afterwards.
  // Once per block: a chooser placed again (scrolled back into view, or
  // after a drag) does not take focus from where the author has since gone.
  const { frame } = canvasFrame;
  const returnTo = React.useRef<Element | null>(null);
  const focusedFor = React.useRef<string | undefined>(undefined);
  const placed = rect !== null;
  React.useEffect(() => {
    if (nodeId === undefined || !placed) return;
    if (focusedFor.current === nodeId) return;
    focusedFor.current = nodeId;
    const own = layer.current?.ownerDocument;
    returnTo.current = own?.activeElement ?? null;
    const tile = (): HTMLElement | null | undefined =>
      body.current?.querySelector<HTMLElement>("[tabindex='0']");
    tile()?.focus({ preventScroll: true });
    const later = setTimeout(() => {
      // The surface the block was added from may hand focus on once it has
      // closed (the block picker hands it to the canvas, a turn later). Taken
      // back only from where nothing is being done: the canvas itself, or no
      // element at all.
      const active = own?.activeElement ?? null;
      const idle = active === null || active === own?.body || active === frame;
      if (idle && !body.current?.contains(active)) {
        tile()?.focus({ preventScroll: true });
      }
    }, 0);
    return () => clearTimeout(later);
  }, [nodeId, placed, frame]);
  const done = React.useCallback(() => {
    const back = returnTo.current;
    returnTo.current = null;
    if (isHTMLElement(back) && back.isConnected && back !== frame) {
      back.focus({ preventScroll: true });
      return;
    }
    // From a surface that has gone (the block picker), back to the canvas.
    if (frame !== null) returnFocusToCanvas(frame);
  }, [frame]);

  return (
    <div ref={layer} className="nx-first-add" {...{ [CHROME_ATTRIBUTE]: "" }}>
      {firstAdd === undefined ? null : (
        <div
          className="nx-first-add__plate"
          data-first-add={firstAdd.chooser}
          // Off screen until measured, so focus never lands on a chooser the
          // author cannot see.
          style={
            rect === null
              ? { visibility: "hidden", left: 0, top: 0 }
              : {
                  left: rect.x,
                  top: rect.y,
                  width: rect.width,
                  minHeight: rect.height,
                }
          }
          // The plate's own presses stay on it: the canvas beneath would
          // otherwise select whatever block is under the pointer.
          onClick={event => event.stopPropagation()}
          onPointerDown={event => event.stopPropagation()}
          onContextMenu={event => event.stopPropagation()}
        >
          <div ref={body} className="nx-first-add__room">
            <Chooser
              editor={editor}
              firstAdd={firstAdd}
              services={services}
              onDone={done}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** The chooser the step names. */
function Chooser({
  editor,
  firstAdd,
  services,
  onDone,
}: {
  editor: EditorState;
  firstAdd: FirstAdd;
  services: CollectionPickerServices | undefined;
  onDone: () => void;
}): React.JSX.Element | null {
  switch (firstAdd.chooser) {
    case "collection-source":
      return (
        <CollectionListPicker
          firstAdd={firstAdd}
          document={editor.document}
          services={services}
          onDone={onDone}
        />
      );
    case "columns-layout":
      return (
        <ColumnsLayoutPicker
          editor={editor}
          firstAdd={firstAdd}
          onDone={onDone}
        />
      );
    default:
      return null;
  }
}
