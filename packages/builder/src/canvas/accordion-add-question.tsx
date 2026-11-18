"use client";

/**
 * "+ Add a question", drawn on the canvas under an Accordion's last question
 * while the accordion or one of its questions is selected.
 *
 * Pressed, it adds a question at the end, numbered after the others
 * (`accordion-questions.ts`), as one step to undo; selects it; opens it on
 * the canvas, so its answer shows; and puts the cursor in its title, through
 * the host's way into typing a block's text. With one question open at a
 * time, opening it closes the others, as a visitor's click would.
 *
 * Drawn like the other controls over the canvas, in the overlay at the
 * accordion's measured rectangle (`watchCanvasFor` keeps it current). The
 * accordion is given a row of room after its last question, on the canvas
 * only and inside its own box, where the button sits, so the button never
 * covers a question or the block that follows; the room is taken back as
 * soon as the accordion is no longer selected. Not drawn where a lock
 * refuses the insert.
 *
 * @module canvas/accordion-add-question
 */
import {
  expandSlotDefaults,
  findNode,
  getBlock,
  locateNode,
  makeNode,
  registryBlockSource,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { Plus } from "lucide-react";
import * as React from "react";

import {
  numberedForPlace,
  QUESTION_BLOCK,
  QUESTION_ROOM_ATTRIBUTE,
  QUESTION_ROOM_PROPERTY,
} from "../accordion-questions";
import { isHTMLElement } from "../dom-kind";
import type { EditorState } from "../editor-state";
import type { Rect } from "../geometry";
import type { BuilderOp } from "../op-vocabulary";
import { CANVAS_ROOT_CLASS } from "../shell-state";

import { nodeElement } from "./canvas-addressing";
import { CHROME_ATTRIBUTE } from "./canvas-chrome";
import { useCanvasFrame } from "./canvas-frame-context";
import { watchCanvasFor } from "./canvas-geometry-watch";
import {
  canvasContentRect,
  layoutFragments,
  overlaySpaceOf,
  renderSkips,
  visiblePartOf,
} from "./geometry-dom";

/** The button's words. */
const ADD_QUESTION_WORDS = "Add a question";

/** The Accordion's registered name. */
const ACCORDION_BLOCK = "core/accordion";

/** The room's height, in the page's pixels, as the frame's sheet draws it. */
const ROOM_PX = 44;

export interface AccordionAddQuestionProps {
  /** The editor the question is added through. */
  readonly editor: EditorState;
  /** A block is being dragged: nothing is drawn, so the drag reaches the page. */
  readonly hidden?: boolean;
  /**
   * The host's way into typing a block's text on the canvas, begun on the
   * new question, whose first value typed in place is its title. Without
   * one, the question is added and opened, and selected for the panel.
   */
  readonly onEditText?: ((nodeId: string) => boolean) | undefined;
}

/**
 * The accordion the button is drawn for: the one selected, or the one
 * holding the selected question. One selected block only, as the toolbar
 * acts on one.
 */
export function accordionForSelection(
  document: EditorState["document"],
  ids: readonly string[]
): BlockNode | undefined {
  if (ids.length !== 1) return undefined;
  const [id] = ids;
  if (id === undefined) return undefined;
  const node = findNode(document.nodes, id);
  if (node?.type === ACCORDION_BLOCK) return node;
  if (node?.type !== QUESTION_BLOCK) return undefined;
  const parent = locateNode(document.nodes, id)?.parent;
  return parent?.type === ACCORDION_BLOCK ? parent : undefined;
}

/**
 * The insert that adds a question at the end of an accordion: a new
 * question made as the Add panel makes one, its answer included, numbered
 * after the others. `undefined` where the question block is not registered.
 */
export function addQuestionOp(
  document: EditorState["document"],
  accordion: BlockNode
): Extract<BuilderOp, { kind: "insert" }> | undefined {
  const definition = getBlock(QUESTION_BLOCK);
  if (definition === undefined) return undefined;
  const at = {
    parentId: accordion.id,
    slot: "children",
    index: accordion.slots?.children?.length ?? 0,
  };
  const made = makeNode(
    QUESTION_BLOCK,
    definition.version,
    structuredClone({
      ...(definition.defaultProps as Record<string, unknown> | undefined),
    }),
    expandSlotDefaults(QUESTION_BLOCK, registryBlockSource())
  );
  return { kind: "insert", node: numberedForPlace(made, at, document), at };
}

/** How far an edge may sit past another and still count as inside it. */
const EDGE_SLACK_PX = 0.5;

/** The room's height in the page's pixels: the button's 44px at the zoom. */
function roomHeight(scale: number): number {
  return ROOM_PX / (scale > 0 ? scale : 1);
}

/**
 * The room after an accordion's last question, where the button sits, in the
 * canvas's content coordinates: the last row of the accordion's whole box,
 * as the frame's sheet draws it. `null` while a clipping container leaves
 * any of it, or the left edge the button starts from, out of view, so the
 * button is never drawn over a question when the room is scrolled away;
 * as wide as the part of the room in view.
 */
export function questionRoomRow(
  full: Rect,
  visible: Rect,
  scale: number
): Rect | null {
  const height = roomHeight(scale);
  const row = {
    x: full.x,
    y: full.y + full.height - height,
    width: full.width,
    height,
  };
  const shows =
    row.y >= visible.y - EDGE_SLACK_PX &&
    row.y + row.height <= visible.y + visible.height + EDGE_SLACK_PX &&
    row.x >= visible.x - EDGE_SLACK_PX &&
    row.x < visible.x + visible.width;
  if (!shows) return null;
  // As wide as the room shows: a container cutting the accordion's right
  // side cuts the room too, and the button, drawn over the canvas, is
  // never clipped by it, so it is kept to what shows.
  const right = Math.min(row.x + row.width, visible.x + visible.width);
  return { ...row, width: right - row.x };
}

/**
 * Where the button sits and how wide it may grow, in the overlay's pixels:
 * at the room's start, and never wider than the room, so over a narrow
 * accordion its words shorten rather than reach the block beside it.
 */
export function questionButtonBox(room: Rect): {
  readonly left: number;
  readonly top: number;
  readonly maxWidth: number;
} {
  return { left: room.x, top: room.y, maxWidth: room.width };
}

/** Where the button is drawn: the accordion's room, and the zoom. */
interface Place {
  readonly rect: Rect;
  readonly scale: number;
}

/** A place as one comparable value, so an unchanged measure sets nothing. */
function placeKey(place: Place | null): string {
  if (place === null) return "";
  const { x, y, width, height } = place.rect;
  return [x, y, width, height, place.scale].join(" ");
}

/**
 * Mark the accordion the button is drawn for, on the canvas's element only,
 * never stored: the frame's sheet gives a marked accordion a 44px row after
 * its last question (`canvas-frame-sheet.ts`), where the button sits. Inside
 * the accordion's own box, so its margins, and the blocks around it, are as
 * the author set them. Written only when it changes, since the canvas
 * watches the page's attributes and measures again.
 */
function markRoom(
  holder: { current: Element | null },
  element: Element,
  scale: number
) {
  if (holder.current !== element) {
    unmarkRoom(holder);
    holder.current = element;
  }
  if (!element.hasAttribute(QUESTION_ROOM_ATTRIBUTE)) {
    element.setAttribute(QUESTION_ROOM_ATTRIBUTE, "");
  }
  // The room as tall as the button at the canvas's zoom: the button keeps
  // its own size over a zoomed page, so the page's pixels are scaled back.
  // A custom property only, which no author value is overridden by.
  const height = `${String(roomHeight(scale))}px`;
  if (
    isHTMLElement(element) &&
    element.style.getPropertyValue(QUESTION_ROOM_PROPERTY) !== height
  ) {
    element.style.setProperty(QUESTION_ROOM_PROPERTY, height);
  }
}

/** Take the room back from the accordion last given it. */
function unmarkRoom(holder: { current: Element | null }): void {
  const element = holder.current;
  element?.removeAttribute(QUESTION_ROOM_ATTRIBUTE);
  if (isHTMLElement(element)) {
    element.style.removeProperty(QUESTION_ROOM_PROPERTY);
  }
  holder.current = null;
}

/** "+ Add a question" under the selected accordion's last question. */
export function AccordionAddQuestion({
  editor,
  hidden = false,
  onEditText,
}: AccordionAddQuestionProps): React.JSX.Element {
  const layer = React.useRef<HTMLDivElement | null>(null);
  const room = React.useRef<Element | null>(null);
  const [place, setPlace] = React.useState<Place | null>(null);
  // The question just added, opened and typed into once the canvas draws it.
  const [added, setAdded] = React.useState<string | undefined>(undefined);
  const selected = accordionForSelection(editor.document, editor.selection.ids);
  // Not offered where a lock refuses the insert, as the Add panel's are not.
  const op =
    selected === undefined
      ? undefined
      : addQuestionOp(editor.document, selected);
  const accordion =
    op === undefined || editor.lockRefusalFor([op]) !== undefined
      ? undefined
      : selected;
  // The room is kept mid-drag, with only the button hidden: taking it away
  // would move every block below the accordion under the drag's measured
  // targets.
  const accordionId = accordion?.id;

  const latest = React.useRef(accordionId);
  latest.current = accordionId;

  const measure = React.useCallback(() => {
    const element = layer.current;
    const id = latest.current;
    const space =
      element === null ? null : overlaySpaceOf(element, CANVAS_ROOT_CLASS);
    const block =
      space === null || id === undefined ? null : nodeElement(space.root, id);
    if (
      space === null ||
      block === null ||
      layoutFragments(block) === 0 ||
      renderSkips(block)
    ) {
      unmarkRoom(room);
      setPlace(current => (current === null ? current : null));
      return;
    }
    markRoom(room, block, space.scale);
    // Placed from the accordion's whole box, where the room is, and drawn
    // only while a clipping container leaves the room in view.
    const visible = visiblePartOf(block, space.root);
    const row =
      visible === null || visible === "hidden"
        ? null
        : questionRoomRow(
            canvasContentRect(block, space.root),
            visible,
            space.scale
          );
    const rect = row === null ? null : space.place(row);
    const next = rect === null ? null : { rect, scale: space.scale };
    setPlace(current =>
      placeKey(current) === placeKey(next) ? current : next
    );
  }, []);

  const canvasFrame = useCanvasFrame();
  React.useLayoutEffect(() => {
    measure();
  }, [measure, editor.document, accordionId, canvasFrame]);
  React.useEffect(
    () => watchCanvasFor(() => layer.current, measure),
    [measure, accordionId, canvasFrame]
  );
  // The room goes once the accordion is no longer the one drawn for.
  React.useEffect(() => () => unmarkRoom(room), [accordionId]);

  // Once the canvas draws the new question: open it, and type its title.
  React.useLayoutEffect(() => {
    if (added === undefined) return;
    const space =
      layer.current === null
        ? null
        : overlaySpaceOf(layer.current, CANVAS_ROOT_CLASS);
    const element = space === null ? null : nodeElement(space.root, added);
    if (element === null) return;
    setAdded(undefined);
    if (element.tagName === "DETAILS") element.setAttribute("open", "");
    onEditText?.(added);
  }, [added, editor.document, onEditText]);

  const add = (): void => {
    if (accordion === undefined || op === undefined) return;
    if (editor.apply(op) === null) return;
    editor.select(op.node.id);
    setAdded(op.node.id);
  };

  return (
    <div
      ref={layer}
      className="nx-add-question"
      {...{ [CHROME_ATTRIBUTE]: "" }}
    >
      {accordion === undefined || place === null || hidden ? null : (
        <button
          type="button"
          className="nx-add-question__button"
          data-add-question={accordion.id}
          // In the room at the foot of the accordion, at the canvas's zoom.
          style={questionButtonBox(place.rect)}
          // Named in full, and told in full on hover, when a narrow
          // accordion shortens the words it shows.
          aria-label={ADD_QUESTION_WORDS}
          title={ADD_QUESTION_WORDS}
          onClick={event => {
            // Kept off the canvas, which would select what lies under it.
            event.stopPropagation();
            add();
          }}
          onPointerDown={event => event.stopPropagation()}
        >
          <Plus size={14} aria-hidden="true" />
          <span className="nx-add-question__words">{ADD_QUESTION_WORDS}</span>
        </button>
      )}
    </div>
  );
}
