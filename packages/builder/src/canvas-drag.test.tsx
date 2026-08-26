// @vitest-environment jsdom

/**
 * Dragging a block, driven through a host that renders a real canvas.
 *
 * The harness mounts what a consumer mounts — an editor state, a canvas
 * carrying the handlers, and the indicator in its overlay — rather than the
 * smallest thing that makes the hook execute. A harness that mounted the hook
 * and returned null would exercise every pointer path while the rendering never
 * ran, which is precisely how a dropped field survives review in this package.
 *
 * **Rectangles are stubbed, because jsdom reports every element as zero-sized.**
 * That is not a limitation being worked around: the geometry is deliberately
 * pure and asserted in `drop-targets.test.ts`, so what remains for this file is
 * the GESTURE — when a press becomes a drag, what a release commits, and what
 * abandons one. Each of those is real here.
 *
 * @module canvas-drag.test
 */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import * as React from "react";

import {
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { NODE_ID_ATTRIBUTE } from "@nextlyhq/blocks-react";

import { Canvas, CANVAS_ROOT_CLASS } from "./canvas";
import { DropIndicator, useCanvasDrag } from "./canvas-drag";
import { useEditorState, type EditorState } from "./editor-state";
import { registrySlotSource } from "./inserter";

afterEach(() => {
  cleanup();
  clearBlocks();
  captured = [];
});

/** Pointer ids the canvas has taken capture of, newest last. */
let captured: number[] = [];

beforeAll(() => {
  // Absent from jsdom entirely. Without them the first pointerdown throws and
  // every case below fails on the harness rather than on the behaviour.
  const element = window.Element.prototype as unknown as Record<
    string,
    unknown
  >;
  element.setPointerCapture = function setPointerCapture(id: number): void {
    captured.push(id);
  };
  element.releasePointerCapture = function releasePointerCapture(): void {};
  element.hasPointerCapture = function hasPointerCapture(): boolean {
    return true;
  };
  element.scrollIntoView = function scrollIntoView(): void {};
});

/** A block that renders its children inside a wrapper, so slots are reachable. */
const BLOCKS = [
  {
    name: "test/heading",
    version: 1,
    description: "A heading.",
    example: { props: {} },
    editor: { label: "Heading" },
    render: () => React.createElement("h2", null, "heading"),
  },
  {
    name: "test/box",
    version: 1,
    description: "A container.",
    example: { props: {} },
    editor: { label: "Box" },
    slots: { children: {} },
    render: () => React.createElement("div", null, "box"),
  },
];

function node(id: string, type: string, slots?: Record<string, BlockNode[]>) {
  return {
    id,
    type,
    version: 1,
    props: {},
    ...(slots ? { slots } : {}),
  } as BlockNode;
}

function documentOf(nodes: BlockNode[]): BlockDocument {
  return { formatVersion: 1, kind: "page", nodes } as BlockDocument;
}

/** The editor the last render produced, for asserting what a drop did. */
let editorRef: EditorState | null = null;

function Host({ document }: { document: BlockDocument }): React.JSX.Element {
  const editor = useEditorState({ initialDocument: document });
  editorRef = editor;
  const drag = useCanvasDrag({
    editor,
    slots: registrySlotSource(),
    // Everything is permitted, so a refused placement never masks a case that
    // is about the gesture rather than about nesting.
    nesting: { parentsOf: () => undefined, slotAllowOf: () => undefined },
  });

  return (
    <Canvas
      document={editor.document}
      siteStyles={{ css: "" } as never}
      selectedId={editor.selectedId}
      onSelect={editor.select}
      dragHandlers={drag.handlers}
      overlay={<DropIndicator target={drag.target} />}
    />
  );
}

/**
 * Give every rendered element a rectangle, since jsdom gives them none.
 *
 * The canvas root spans the viewport and each block is stacked beneath the last,
 * which is what the real layout does and what the axis derivation reads.
 */
function layout(container: HTMLElement, heights: Record<string, number>): void {
  const root = container.querySelector<HTMLElement>(`.${CANVAS_ROOT_CLASS}`);
  if (root === null) throw new Error("no canvas root rendered");
  root.getBoundingClientRect = () =>
    ({ x: 0, y: 0, width: 400, height: 1000, top: 0, left: 0 }) as DOMRect;

  let top = 0;
  root
    .querySelectorAll<HTMLElement>(`[${NODE_ID_ATTRIBUTE}]`)
    .forEach(element => {
      const id = element.getAttribute(NODE_ID_ATTRIBUTE) ?? "";
      const height = heights[id] ?? 100;
      const box = { x: 0, y: top, width: 400, height, top, left: 0 } as DOMRect;
      element.getBoundingClientRect = () => box;
      top += height;
    });
}

function rootOf(container: HTMLElement): HTMLElement {
  const root = container.querySelector<HTMLElement>(`.${CANVAS_ROOT_CLASS}`);
  if (root === null) throw new Error("no canvas root rendered");
  return root;
}

function indicator(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>(".nx-drop-indicator");
}

function press(root: HTMLElement, target: Element, x: number, y: number): void {
  fireEvent.pointerDown(target, {
    button: 0,
    pointerId: 1,
    clientX: x,
    clientY: y,
  });
  void root;
}

function moveTo(root: HTMLElement, x: number, y: number): void {
  fireEvent.pointerMove(root, { pointerId: 1, clientX: x, clientY: y });
}

function release(root: HTMLElement, x: number, y: number): void {
  fireEvent.pointerUp(root, { pointerId: 1, clientX: x, clientY: y });
}

function blockElement(container: HTMLElement, id: string): Element {
  const element = container.querySelector(`[${NODE_ID_ATTRIBUTE}="${id}"]`);
  if (element === null) throw new Error(`no element for ${id}`);
  return element;
}

/** Three stacked blocks: 0-100, 100-200, 200-300. */
function renderThree() {
  registerBlocks(BLOCKS as never, { source: "canvas-drag-test" });
  const result = render(
    <Host
      document={documentOf([
        node("a", "test/heading"),
        node("b", "test/heading"),
        node("c", "test/heading"),
      ])}
    />
  );
  layout(result.container, { a: 100, b: 100, c: 100 });
  return { ...result, root: rootOf(result.container) };
}

describe("useCanvasDrag", () => {
  it("does not start a drag, or move anything, on a click", () => {
    // A press that never travels is a click. Without the activation threshold
    // every click on a block commits a move to the position it already occupies,
    // and the undo history fills with edits the author never made.
    const { container, root } = renderThree();
    const before = editorRef?.undoDepth ?? -1;

    press(root, blockElement(container, "a"), 200, 50);
    moveTo(root, 201, 51);
    release(root, 201, 51);

    expect(indicator(container)).toBeNull();
    expect(editorRef?.undoDepth).toBe(before);
  });

  it("does not capture the pointer for a press that stays a click", () => {
    /*
     * The mechanism behind a regression that made every canvas click CLEAR the
     * selection instead of setting it.
     *
     * Capture retargets later pointer events to the capturing element, and the
     * browser derives a click's target from where the press and the release
     * landed — so capturing on `pointerdown` made every click report the canvas
     * ROOT as its target, and the canvas read "no block above this target" as a
     * click on the background.
     *
     * jsdom implements no capture retargeting and synthesises no click from a
     * press, so the SYMPTOM cannot be reproduced here. When capture is taken is
     * observable, and it is what the defect actually was.
     */
    const { container, root } = renderThree();

    press(root, blockElement(container, "a"), 200, 50);
    moveTo(root, 201, 51);
    release(root, 201, 51);

    expect(captured).toEqual([]);
  });

  it("captures the pointer once the drag activates", () => {
    // The positive control, and the reason capture exists at all: a drag may
    // leave the canvas and has to keep receiving moves. Without this, "never
    // captures" would also pass on a canvas that never captures.
    const { container, root } = renderThree();

    press(root, blockElement(container, "a"), 200, 50);
    moveTo(root, 200, 250);

    expect(captured).toEqual([1]);
  });

  it("shows an indicator once the pointer has travelled far enough", () => {
    const { container, root } = renderThree();

    press(root, blockElement(container, "a"), 200, 50);
    expect(indicator(container)).toBeNull();

    moveTo(root, 200, 250);

    // The presence of the line is asserted BEFORE anything about where it is:
    // every later assertion about a position would be satisfied by absence, and
    // an indicator that never appears would certify them all.
    expect(indicator(container)).not.toBeNull();
  });

  it("measures the activation threshold in CLIENT pixels, not canvas ones", () => {
    /*
     * The threshold separates a click from an intent to move, which is a fact
     * about the hand rather than about the canvas's coordinate system. The
     * canvas is scaled so a tier wider than the region stays editable, and
     * every client rectangle then comes back in painted pixels — so a distance
     * converted into canvas coordinates is LARGER than the hand moved.
     *
     * Measured in that space the threshold shrinks with the canvas: painted at
     * half size, the 4px separating a click from a drag needs only 2px of real
     * movement, and ordinary click jitter starts committing moves the author
     * never made.
     */
    const { container, root } = renderThree();
    // Painted 400 wide against 800 laid out: the canvas is drawn at half size.
    Object.defineProperty(root, "offsetWidth", { value: 800 });
    Object.defineProperty(root, "offsetHeight", { value: 2000 });

    press(root, blockElement(container, "a"), 200, 50);
    // Three pixels of hand movement, below the four the threshold asks for —
    // but six once converted into the canvas's own coordinates.
    moveTo(root, 200, 53);

    expect(indicator(container)).toBeNull();
  });

  it("still activates on a real drag while the canvas is scaled", () => {
    /*
     * The control on the case above, and it has to be here: a threshold that
     * had become unreachable — or a drag that never starts under a scaled
     * canvas at all — satisfies that assertion perfectly, because it is
     * satisfied by absence.
     */
    const { container, root } = renderThree();
    Object.defineProperty(root, "offsetWidth", { value: 800 });
    Object.defineProperty(root, "offsetHeight", { value: 2000 });

    press(root, blockElement(container, "a"), 200, 50);
    moveTo(root, 200, 250);

    expect(indicator(container)).not.toBeNull();
  });

  it("commits a move to the position the line was drawn at", () => {
    const { container, root } = renderThree();

    press(root, blockElement(container, "a"), 200, 50);
    // Past the middle of the last block, so the line is the document end.
    moveTo(root, 200, 290);
    expect(indicator(container)).not.toBeNull();
    release(root, 200, 290);

    // "a" removed from the front and re-inserted at the end.
    expect(editorRef?.document.nodes.map(n => n.id)).toEqual(["b", "c", "a"]);
  });

  it("leaves the document alone when the pointer is released off the canvas", () => {
    // Committing "the last valid target" from a pointer that has since left
    // would drop the block somewhere the author was not pointing when they let
    // go.
    const { container, root } = renderThree();
    const order = editorRef?.document.nodes.map(n => n.id);

    press(root, blockElement(container, "a"), 200, 50);
    moveTo(root, 200, 250);
    moveTo(root, 200, 5000);
    release(root, 200, 5000);

    expect(editorRef?.document.nodes.map(n => n.id)).toEqual(order);
    expect(indicator(container)).toBeNull();
  });

  it("abandons the drag on Escape, and commits nothing after it", () => {
    const { container, root } = renderThree();
    const order = editorRef?.document.nodes.map(n => n.id);

    press(root, blockElement(container, "a"), 200, 50);
    moveTo(root, 200, 290);
    expect(indicator(container)).not.toBeNull();

    // Dispatched on the DOCUMENT, which is the point: pointer capture does not
    // move focus, so a handler bound to the canvas would never see this.
    fireEvent.keyDown(document, { key: "Escape" });

    expect(indicator(container)).toBeNull();
    release(root, 200, 290);
    expect(editorRef?.document.nodes.map(n => n.id)).toEqual(order);
  });

  it("abandons the drag when the browser cancels the gesture", () => {
    // A cancel is the pointer being taken away — captured elsewhere, or a touch
    // that became a scroll. Dropping there would commit a move the author never
    // released.
    const { container, root } = renderThree();
    const order = editorRef?.document.nodes.map(n => n.id);

    press(root, blockElement(container, "a"), 200, 50);
    moveTo(root, 200, 290);
    fireEvent.pointerCancel(root, { pointerId: 1 });

    expect(indicator(container)).toBeNull();
    expect(editorRef?.document.nodes.map(n => n.id)).toEqual(order);
  });

  it("refuses to drag a locked block", () => {
    // The engine declares `locked` as "the editor command layer must not let the
    // author move or delete this node", and a drag is that layer.
    registerBlocks(BLOCKS as never, { source: "canvas-drag-test" });
    const locked = { ...node("a", "test/heading"), locked: true } as BlockNode;
    const { container } = render(
      <Host document={documentOf([locked, node("b", "test/heading")])} />
    );
    layout(container, { a: 100, b: 100 });
    const root = rootOf(container);
    const order = editorRef?.document.nodes.map(n => n.id);

    press(root, blockElement(container, "a"), 200, 50);
    moveTo(root, 200, 190);

    expect(indicator(container)).toBeNull();
    release(root, 200, 190);
    expect(editorRef?.document.nodes.map(n => n.id)).toEqual(order);
  });

  it("ignores a press that is not the primary button", () => {
    // A right-click opens a context menu and a middle-click scrolls; starting a
    // drag from either takes a gesture the browser has already given a meaning.
    const { container, root } = renderThree();

    fireEvent.pointerDown(blockElement(container, "a"), {
      button: 2,
      pointerId: 1,
      clientX: 200,
      clientY: 50,
    });
    moveTo(root, 200, 290);

    expect(indicator(container)).toBeNull();
  });

  it("selects the dragged block when the drag begins", () => {
    const { container, root } = renderThree();

    press(root, blockElement(container, "b"), 200, 150);
    moveTo(root, 200, 290);

    expect(editorRef?.selectedId).toBe("b");
  });
});
