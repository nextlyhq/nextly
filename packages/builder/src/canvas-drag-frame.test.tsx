// @vitest-environment jsdom

/**
 * A drag whose canvas is rendered in a frame of its own.
 *
 * The page is portalled into a real iframe's document, which jsdom gives a
 * window of its own, while the palette row stays in the editor's document —
 * the arrangement the editor is moving to. A pointer or key over the page is
 * then dispatched in the FRAME's document and never reaches the editor's, and
 * the cases below dispatch them there. Listening on the global `document`
 * alone hears none of them, which is what each case's failure looked like
 * before the drag asked the canvas frame where to listen.
 *
 * Rectangles are stubbed, as in `insert-drag.test.tsx`: jsdom lays nothing
 * out. They are stubbed in the FRAME's coordinates, because that is where the
 * canvas reads them.
 *
 * @module canvas-drag-frame.test
 */
import {
  clearBlocks,
  registerBlocks,
  type AnyBlockDefinition,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { NODE_ID_ATTRIBUTE } from "@nextlyhq/blocks-react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import * as React from "react";
import { createPortal } from "react-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { Canvas, CANVAS_ROOT_CLASS } from "./canvas";
import { useCanvasDrag } from "./canvas-drag";
import { CanvasFrameProvider } from "./canvas-frame-context";
import { useEditorState, type EditorState } from "./editor-state";
import { registrySlotSource } from "./inserter";

afterEach(async () => {
  // A click suppressor is armed for one task after a release; let it lapse
  // before the next case, as `insert-drag.test.tsx` does and for its reason.
  await new Promise(resolve => {
    setTimeout(resolve, 0);
  });
  cleanup();
  clearBlocks();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  editorRef = null;
  dragging = null;
});

beforeAll(() => {
  const element = window.Element.prototype as unknown as Record<
    string,
    unknown
  >;
  element.setPointerCapture = function setPointerCapture(): void {};
  element.releasePointerCapture = function releasePointerCapture(): void {};
  element.hasPointerCapture = function hasPointerCapture(): boolean {
    return true;
  };
  element.scrollIntoView = function scrollIntoView(): void {};
});

const BLOCKS: AnyBlockDefinition[] = [
  {
    name: "test/heading",
    version: 1,
    description: "A heading.",
    example: { props: {} },
    editor: { label: "Heading" },
    render: () => React.createElement("h2", null, "heading"),
  },
];

const INSERTED = "brand-new";

function node(id: string): BlockNode {
  return { id, type: "test/heading", version: 1, props: {} };
}

function documentOf(nodes: BlockNode[]): BlockDocument {
  return { formatVersion: 1, kind: "page", nodes };
}

let editorRef: EditorState | null = null;
let dragging: string | null = null;

/** The editor's half in this document, the page's half portalled into the frame. */
function Host({ frame }: { frame: HTMLIFrameElement }) {
  const editor = useEditorState({
    initialDocument: documentOf([node("a"), node("b")]),
  });
  editorRef = editor;
  const canvasRoot = React.useRef<HTMLElement | null>(null);
  const frameBody = frame.contentDocument?.body ?? null;
  React.useEffect(() => {
    canvasRoot.current =
      frameBody?.querySelector<HTMLElement>(`.${CANVAS_ROOT_CLASS}`) ?? null;
  });
  const drag = useCanvasDrag({
    editor,
    slots: registrySlotSource(),
    nesting: { parentsOf: () => undefined, slotAllowOf: () => undefined },
    canvasRoot,
  });
  dragging = drag.draggingBlockName;
  return (
    <>
      <button
        type="button"
        data-testid="palette-row"
        onPointerDown={event =>
          drag.beginInsertDrag(event, {
            blockName: "test/heading",
            makeNode: () => node(INSERTED),
            onInserted: () => {},
          })
        }
      >
        Heading
      </button>
      {frameBody === null
        ? null
        : createPortal(
            <Canvas
              document={editor.document}
              siteStyles={false}
              selectedId={editor.selectedId}
              onSelect={editor.select}
              dragHandlers={drag.handlers}
            />,
            frameBody
          )}
    </>
  );
}

/** Two stacked blocks at 0-100 and 100-200 in the frame's coordinates. */
function layout(frameDocument: Document): void {
  const root = frameDocument.querySelector<HTMLElement>(
    `.${CANVAS_ROOT_CLASS}`
  );
  if (root === null) throw new Error("no canvas root rendered in the frame");
  root.getBoundingClientRect = () =>
    ({ x: 0, y: 0, width: 400, height: 1000, top: 0, left: 0 }) as DOMRect;
  let top = 0;
  root
    .querySelectorAll<HTMLElement>(`[${NODE_ID_ATTRIBUTE}]`)
    .forEach(element => {
      const box = { x: 0, y: top, width: 400, height: 100, top, left: 0 };
      element.getBoundingClientRect = () => box as DOMRect;
      top += 100;
    });
}

function renderFramed() {
  registerBlocks(BLOCKS, { source: "canvas-drag-frame-test" });
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const inner = frame.contentDocument;
  if (inner === null) throw new Error("no frame document");
  const result = render(
    <CanvasFrameProvider frame={frame}>
      <Host frame={frame} />
    </CanvasFrameProvider>
  );
  layout(inner);
  // The control every case leans on: the page really is in another document.
  expect(inner.querySelector(`.${CANVAS_ROOT_CLASS}`)).not.toBeNull();
  expect(document.querySelector(`.${CANVAS_ROOT_CLASS}`)).toBeNull();
  return { frame, inner, row: result.getByTestId("palette-row") };
}

function press(row: HTMLElement): void {
  fireEvent.pointerDown(row, {
    button: 0,
    pointerId: 7,
    clientX: 300,
    clientY: 500,
  });
}

function ids(): string[] {
  return (editorRef?.document.nodes ?? []).map(n => n.id);
}

describe("a palette drag onto a canvas in a frame", () => {
  it("follows the pointer over the page, in the frame's document", () => {
    const { inner, row } = renderFramed();
    press(row);
    // The lower half of the first block, in the frame's coordinates.
    fireEvent.pointerMove(inner, { pointerId: 7, clientX: 200, clientY: 90 });
    expect(dragging).toBe("test/heading");
    fireEvent.pointerUp(inner, { pointerId: 7, clientX: 200, clientY: 90 });
    expect(ids()).toEqual(["a", INSERTED, "b"]);
  });

  it("carries a point over the editor's panels into the frame's coordinates", () => {
    // The frame sits at (100, 150) in the editor and is painted at half
    // size: 400 wide on screen, 800 to layout. A point the editor reports at
    // (200, 195) is (200, 90) in the frame — the lower half of the first
    // block. Taken unmapped, y 195 is the lower half of the SECOND block; mapped
    // without the scale, y 45 is the upper half of the first. Each lands in a
    // different gap, so only the full mapping inserts between the two.
    const { frame, row } = renderFramed();
    frame.getBoundingClientRect = () =>
      ({
        x: 100,
        y: 150,
        left: 100,
        top: 150,
        width: 400,
        height: 500,
        right: 500,
        bottom: 650,
      }) as DOMRect;
    Object.defineProperty(frame, "offsetWidth", { value: 800 });
    Object.defineProperty(frame, "offsetHeight", { value: 1000 });
    press(row);
    fireEvent.pointerMove(document, {
      pointerId: 7,
      clientX: 200,
      clientY: 195,
    });
    expect(dragging).toBe("test/heading");
    fireEvent.pointerUp(document, { pointerId: 7, clientX: 200, clientY: 195 });
    expect(ids()).toEqual(["a", INSERTED, "b"]);
  });

  it("measures the travel that starts a drag in one space, across the frame's edge", () => {
    // The row is pressed at (200, 195) in the editor, which is (200, 90) in
    // the half-size frame at (100, 150). The pointer then moves one frame pixel
    // each way, over the page: a jitter, not a drag. Compared against the
    // press as the editor reported it, the same jitter looks like a hundred
    // pixels of travel and starts one.
    const { frame, inner, row } = renderFramed();
    frame.getBoundingClientRect = () =>
      ({
        x: 100,
        y: 150,
        left: 100,
        top: 150,
        width: 400,
        height: 500,
      }) as DOMRect;
    Object.defineProperty(frame, "offsetWidth", { value: 800 });
    Object.defineProperty(frame, "offsetHeight", { value: 1000 });
    fireEvent.pointerDown(row, {
      button: 0,
      pointerId: 7,
      clientX: 200,
      clientY: 195,
    });
    fireEvent.pointerMove(inner, { pointerId: 7, clientX: 201, clientY: 91 });
    expect(dragging).toBeNull();
    // The control: a real move from the same press does start one.
    fireEvent.pointerMove(inner, { pointerId: 7, clientX: 200, clientY: 140 });
    expect(dragging).toBe("test/heading");
    fireEvent.keyDown(inner, { key: "Escape" });
  });

  it("is abandoned by Escape pressed with focus in the frame", () => {
    const { inner, row } = renderFramed();
    press(row);
    fireEvent.pointerMove(inner, { pointerId: 7, clientX: 200, clientY: 90 });
    expect(dragging).toBe("test/heading");
    fireEvent.keyDown(inner, { key: "Escape" });
    expect(dragging).toBeNull();
    fireEvent.pointerUp(inner, { pointerId: 7, clientX: 200, clientY: 90 });
    expect(ids()).toEqual(["a", "b"]);
  });

  it("runs its frame loop on the frame's window", () => {
    const { frame, inner, row } = renderFramed();
    const view = frame.contentWindow;
    if (view === null) throw new Error("no frame window");
    // The control: two different clocks, so a loop scheduled on the editor's
    // cannot be mistaken for one on the frame's.
    expect(view).not.toBe(window);
    const framed = vi.spyOn(view, "requestAnimationFrame");
    const editors = vi.spyOn(window, "requestAnimationFrame");
    press(row);
    fireEvent.pointerMove(inner, { pointerId: 7, clientX: 200, clientY: 90 });
    expect(framed).toHaveBeenCalled();
    expect(editors).not.toHaveBeenCalled();
    fireEvent.keyDown(inner, { key: "Escape" });
  });

  it("scrolls the frame's own viewport from the bottom band", () => {
    // Nothing above the root inside the frame is styled to scroll, so only
    // the frame's scrolling element can carry the page under a pointer held
    // at the frame's lower edge.
    const { frame, inner, row } = renderFramed();
    const view = frame.contentWindow;
    if (view === null) throw new Error("no frame window");
    // What a browser gives a standards-mode document, and what jsdom leaves
    // undefined: the root element scrolls the viewport. Its scroll offset is
    // made writable, since jsdom pins it at 0.
    const scrolling = inner.documentElement;
    Object.defineProperty(inner, "scrollingElement", { value: scrolling });
    let scrolled = 0;
    Object.defineProperty(scrolling, "scrollTop", {
      get: () => scrolled,
      set: (value: number) => {
        scrolled = value;
      },
    });
    Object.defineProperty(view, "innerHeight", { value: 600 });
    // The loop's callback is held rather than run by the clock, so the one
    // frame below is the only one that runs.
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(view, "requestAnimationFrame").mockImplementation(callback => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(view, "cancelAnimationFrame").mockImplementation(() => {});

    press(row);
    // 590 is 54 pixels into the 64-pixel band above the frame's 600.
    fireEvent.pointerMove(inner, { pointerId: 7, clientX: 200, clientY: 590 });
    expect(frames).toHaveLength(1);
    frames[0]?.(0);

    expect(scrolled).toBeGreaterThan(0);
    fireEvent.keyDown(inner, { key: "Escape" });
  });
});
