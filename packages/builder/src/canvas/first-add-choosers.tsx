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
 * Focus moves to the chooser when it opens, so it is reached from the
 * keyboard whichever way the block was added, and goes back where it was
 * once the author picks or skips.
 *
 * @module canvas/first-add-choosers
 */
import * as React from "react";

import { ColumnsLayoutPicker } from "../columns-layout-picker";
import { isHTMLElement } from "../dom-kind";
import type { EditorState } from "../editor-state";
import type { FirstAdd } from "../first-add";
import type { Rect } from "../geometry";
import { CANVAS_ROOT_CLASS } from "../shell-state";

import { nodeElement } from "./canvas-addressing";
import { CHROME_ATTRIBUTE } from "./canvas-chrome";
import { useCanvasFrame } from "./canvas-frame-context";
import { watchCanvasFor } from "./canvas-geometry-watch";
import {
  layoutFragments,
  overlaySpaceOf,
  renderSkips,
  visiblePartOf,
} from "./geometry-dom";

export interface FirstAddChoosersProps {
  /** The editor whose first-add step this draws. */
  readonly editor: EditorState;
  /**
   * A block is being dragged: the chooser is not drawn, so the drag reaches
   * the canvas beneath. The step itself holds.
   */
  readonly hidden?: boolean;
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

/** The chooser for the block just added, over the canvas. */
export function FirstAddChoosers({
  editor,
  hidden = false,
}: FirstAddChoosersProps): React.JSX.Element {
  const layer = React.useRef<HTMLDivElement | null>(null);
  const body = React.useRef<HTMLDivElement | null>(null);
  const reserved = React.useRef<Reserved | null>(null);
  const [rect, setRect] = React.useState<Rect | null>(null);
  const firstAdd = hidden ? undefined : editor.firstAdd;
  const nodeId = firstAdd?.nodeId;

  // Read by the measure, which outlives the render that made it.
  const latest = React.useRef(nodeId);
  latest.current = nodeId;

  const measure = React.useCallback(() => {
    const element = layer.current;
    const id = latest.current;
    const found =
      element === null || id === undefined ? null : shownRectOf(element, id);
    if (element === null || id === undefined || found === null) {
      setRect(current => (current === null ? current : null));
      return;
    }
    // The chooser's own height, its padding and the plate's edge included,
    // as the page measures it: the overlay is drawn at the canvas's zoom, the
    // page at its own size. Read from the body, not the plate, whose height
    // follows the block's and would hold a room once made.
    const plate = body.current?.parentElement;
    const edge =
      plate === null || plate === undefined
        ? 0
        : plate.offsetHeight - plate.clientHeight;
    const height = (body.current?.offsetHeight ?? 0) + edge;
    if (height > 0 && isHTMLElement(found.element)) {
      const wanted = `${String(Math.ceil(height / found.scale))}px`;
      const { element: block } = found;
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
  const returnTo = React.useRef<Element | null>(null);
  const focusedFor = React.useRef<string | undefined>(undefined);
  const placed = rect !== null;
  React.useEffect(() => {
    if (nodeId === undefined || !placed) return;
    if (focusedFor.current === nodeId) return;
    focusedFor.current = nodeId;
    const own = layer.current?.ownerDocument;
    returnTo.current = own?.activeElement ?? null;
    body.current
      ?.querySelector<HTMLElement>("[tabindex='0']")
      ?.focus({ preventScroll: true });
  }, [nodeId, placed]);
  const done = React.useCallback(() => {
    const back = returnTo.current;
    returnTo.current = null;
    if (isHTMLElement(back) && back.isConnected) back.focus();
  }, []);

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
            <Chooser editor={editor} firstAdd={firstAdd} onDone={done} />
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
  onDone,
}: {
  editor: EditorState;
  firstAdd: FirstAdd;
  onDone: () => void;
}): React.JSX.Element | null {
  switch (firstAdd.chooser) {
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
