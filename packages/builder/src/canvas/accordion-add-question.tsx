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
 * accordion is given room for the button below it on the canvas only, while
 * the button shows, so the button never covers the block that follows; the
 * room is taken back as soon as the button goes.
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
  layoutFragments,
  overlaySpaceOf,
  renderSkips,
  visiblePartOf,
} from "./geometry-dom";

/** The button's words. */
export const ADD_QUESTION_WORDS = "Add a question";

/** The Accordion's registered name. */
const ACCORDION_BLOCK = "core/accordion";

/** The room made under the accordion for the button, in the page's pixels. */
const ROOM_PX = 48;

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

/** Two rectangles at the same place and size. */
function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
  );
}

/** The room made under an accordion, and the margin it had before. */
interface Room {
  readonly element: HTMLElement;
  /** Its own inline margin, put back afterwards ("" for none). */
  readonly before: string;
  /** The margin the page gave it before the room was made. */
  readonly base: string;
}

/** Put back the margin an accordion carried before its room was made. */
function release(room: Room | null): void {
  if (room === null) return;
  if (room.before === "") {
    room.element.style.removeProperty("margin-block-end");
  } else {
    room.element.style.setProperty("margin-block-end", room.before);
  }
}

/**
 * Make room under the accordion for the button: the margin the page gave it,
 * read once before the room is added, and the button's height beside it.
 * Written on the canvas's element only, never stored, and only when it
 * changes, since the canvas watches the page's styles and measures again.
 */
function makeRoom(holder: { current: Room | null }, element: Element): void {
  if (!isHTMLElement(element)) return;
  const view = element.ownerDocument.defaultView;
  if (view === null) return;
  if (holder.current?.element !== element) {
    release(holder.current);
    holder.current = {
      element,
      before: element.style.getPropertyValue("margin-block-end"),
      base: view.getComputedStyle(element).marginBlockEnd,
    };
  }
  const wanted = `calc(${holder.current.base} + ${String(ROOM_PX)}px)`;
  if (element.style.getPropertyValue("margin-block-end") !== wanted) {
    element.style.setProperty("margin-block-end", wanted);
  }
}

/** "+ Add a question" under the selected accordion's last question. */
export function AccordionAddQuestion({
  editor,
  hidden = false,
  onEditText,
}: AccordionAddQuestionProps): React.JSX.Element {
  const layer = React.useRef<HTMLDivElement | null>(null);
  const room = React.useRef<Room | null>(null);
  const [rect, setRect] = React.useState<Rect | null>(null);
  // The question just added, opened and typed into once the canvas draws it.
  const [added, setAdded] = React.useState<string | undefined>(undefined);
  const accordion = hidden
    ? undefined
    : accordionForSelection(editor.document, editor.selection.ids);
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
      release(room.current);
      room.current = null;
      setRect(current => (current === null ? current : null));
      return;
    }
    makeRoom(room, block);
    const visible = visiblePartOf(block, space.root);
    const next =
      visible === null || visible === "hidden" ? null : space.place(visible);
    setRect(current => (sameRect(current, next) ? current : next));
  }, []);

  const canvasFrame = useCanvasFrame();
  React.useLayoutEffect(() => {
    measure();
  }, [measure, editor.document, accordionId, canvasFrame]);
  React.useEffect(
    () => watchCanvasFor(() => layer.current, measure),
    [measure, accordionId, canvasFrame]
  );
  // The accordion's own margin comes back once the button goes.
  React.useEffect(
    () => () => {
      release(room.current);
      room.current = null;
    },
    [accordionId]
  );

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
    if (accordion === undefined) return;
    const op = addQuestionOp(editor.document, accordion);
    if (op === undefined || editor.apply(op) === null) return;
    editor.select(op.node.id);
    setAdded(op.node.id);
  };

  return (
    <div
      ref={layer}
      className="nx-add-question"
      {...{ [CHROME_ATTRIBUTE]: "" }}
    >
      {accordion === undefined || rect === null ? null : (
        <button
          type="button"
          className="nx-add-question__button"
          data-add-question={accordion.id}
          style={{ left: rect.x, top: rect.y + rect.height + 2 }}
          onClick={event => {
            // Kept off the canvas, which would select what lies under it.
            event.stopPropagation();
            add();
          }}
          onPointerDown={event => event.stopPropagation()}
        >
          <Plus size={14} aria-hidden="true" />
          {ADD_QUESTION_WORDS}
        </button>
      )}
    </div>
  );
}
