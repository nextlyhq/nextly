// @vitest-environment jsdom

/**
 * The editor's chrome, drawn in the editor's document over a canvas in a
 * frame.
 *
 * The page is in the frame's document and the chrome is in the layer
 * `CanvasFrame` draws over it, so every rectangle read inside the frame has to
 * be carried into the layer: scaled by the frame's painted scale, while the
 * chrome keeps its own size. These cases paint the frame at half its layout
 * size and stub the rectangles jsdom does not lay out — the frame's in the
 * editor's coordinates, the blocks' in the frame's — so a piece of chrome
 * that forgot the scale lands at twice the distance it should.
 *
 * @module canvas-overlay-frame.test
 */
import {
  clearBlocks,
  registerBlocks,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import { NODE_ID_ATTRIBUTE } from "@nextlyhq/blocks-react";
import { ShortcutProvider } from "@nextlyhq/ui";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BlockContextMenu } from "./block-context-menu";
import { Canvas, DropRefusal } from "./canvas";
import type { CanvasDragState } from "./canvas-drag";
import { DropIndicator } from "./canvas-drag";
import {
  CanvasFrame,
  SRCDOC_FRAME_SOURCE,
  type CanvasFrameSource,
} from "./canvas-frame";
import { CanvasFrameProvider } from "./canvas-frame-context";
import { CanvasMarks } from "./canvas-marks";
import { useEditorState, type EditorState } from "./editor-state";
import {
  framePointInHost,
  frameViewportOf,
  hostPointInFrame,
  overlaySpaceOf,
} from "./geometry-dom";
import { BlockKeyboardActions } from "./keyboard-actions";
import { CANVAS_ROOT_CLASS } from "./shell-state";

const PAGE_MARKER = "data-test-page";
const TEST_SOURCE: CanvasFrameSource = {
  srcDoc: SRCDOC_FRAME_SOURCE.srcDoc,
  ready: doc => doc.documentElement.hasAttribute(PAGE_MARKER),
  mountPoint: doc => doc.body,
};

/** Where the frame sits in the editor, and how large it is painted. */
const FRAME_BOX = { x: 100, y: 50, width: 640, height: 400 };
/** The frame's layout size: twice what it is painted at. */
const FRAME_LAYOUT = { width: 1280, height: 800 };
/** Where the block is in the frame's viewport. */
const BLOCK_BOX = { x: 100, y: 200, width: 400, height: 100 };

function rect(box: {
  x: number;
  y: number;
  width: number;
  height: number;
}): DOMRect {
  return {
    ...box,
    left: box.x,
    top: box.y,
    right: box.x + box.width,
    bottom: box.y + box.height,
    toJSON: () => box,
  } as DOMRect;
}

const PAGE: BlockDocument = {
  formatVersion: 1,
  kind: "page",
  nodes: [{ id: "box", type: "frame/box", version: 1, props: {} }],
};

beforeEach(() => {
  registerBlocks(
    [
      {
        name: "frame/box",
        version: 1,
        description: "A box.",
        example: { props: {} },
        editor: { label: "Box" },
        render: ({ className }: { className: string }) =>
          React.createElement("div", { className }, "box"),
      },
    ] as never,
    { source: "canvas-overlay-frame-test" }
  );
});

afterEach(() => {
  cleanup();
  clearBlocks();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

/**
 * Lay out what jsdom does not: the frame in the editor, painted at half its
 * layout size, and the canvas root and its block inside the frame.
 */
function layOut(frame: HTMLIFrameElement): void {
  frame.getBoundingClientRect = () => rect(FRAME_BOX);
  Object.defineProperty(frame, "offsetWidth", {
    value: FRAME_LAYOUT.width,
    configurable: true,
  });
  Object.defineProperty(frame, "offsetHeight", {
    value: FRAME_LAYOUT.height,
    configurable: true,
  });
  const view = frame.contentWindow as (Window & typeof globalThis) | null;
  if (view === null) throw new Error("no frame window");
  view.Element.prototype.getBoundingClientRect = function boxOf(
    this: Element
  ): DOMRect {
    if (this.getAttribute(NODE_ID_ATTRIBUTE) === "box") return rect(BLOCK_BOX);
    return rect({ x: 0, y: 0, width: FRAME_LAYOUT.width, height: 1600 });
  };
}

/** Mount the frame, lay it out, and deliver its page. */
function framed(ui: React.ReactElement): {
  container: HTMLElement;
  frame: HTMLIFrameElement;
} {
  const result = render(ui);
  const frame = result.container.querySelector("iframe");
  if (frame === null) throw new Error("no frame drawn");
  layOut(frame);
  act(() => {
    frame.contentDocument?.documentElement.setAttribute(PAGE_MARKER, "");
    frame.dispatchEvent(new Event("load"));
  });
  return { container: result.container, frame };
}

describe("the space chrome is drawn in over a frame", () => {
  it("scales a rectangle of the root's into the layer, and keeps the chrome's own size", () => {
    const { container } = framed(
      <CanvasFrame
        width={1280}
        title="Home"
        source={TEST_SOURCE}
        overlay={<div data-testid="chrome" />}
      >
        <Canvas document={PAGE} siteStyles={false} />
      </CanvasFrame>
    );
    const chrome = container.querySelector('[data-testid="chrome"]');
    if (chrome === null) throw new Error("no chrome");
    const space = overlaySpaceOf(chrome, CANVAS_ROOT_CLASS);
    expect(space?.root.ownerDocument).not.toBe(document);
    expect(space?.scale).toBe(0.5);
    expect(space?.place({ x: 100, y: 200, width: 400, height: 100 })).toEqual({
      x: 50,
      y: 100,
      width: 200,
      height: 50,
    });
    // A pointer at the editor's (150, 150) is 50 painted pixels into the
    // frame each way, which is 100 of the frame's own.
    expect(space?.pointInCanvas({ x: 150, y: 150 })).toEqual({
      x: 100,
      y: 200,
    });
  });

  it("maps a point into the frame and back to the same place", () => {
    const { frame } = framed(
      <CanvasFrame width={1280} title="Home" source={TEST_SOURCE} />
    );
    const inside = hostPointInFrame(frame, { x: 420, y: 310 });
    expect(framePointInHost(frame, inside)).toEqual({ x: 420, y: 310 });
  });
});

describe("chrome drawn over a frame lines up with the page", () => {
  it("draws the selection ring over the block, at the frame's scale", async () => {
    const { container } = framed(
      <CanvasFrame
        width={1280}
        title="Home"
        source={TEST_SOURCE}
        overlay={<CanvasMarks />}
      >
        <Canvas document={PAGE} siteStyles={false} selectedId="box" />
      </CanvasFrame>
    );
    // The marks follow the selection attribute, which the canvas writes after
    // paint.
    await act(async () => undefined);
    const ring = await vi.waitFor(() => {
      const found = container.querySelector<HTMLElement>(
        '.nx-canvas-mark[data-mark="selected"]'
      );
      if (found === null) throw new Error("no ring yet");
      return found;
    });
    // In the editor's document, never the page's, where the site's CSS could
    // reach it.
    expect(ring.ownerDocument).toBe(document);
    // The block's box at the frame's scale, 50,100 200x50, grown by the 4px
    // the ring stands outside it, which are the editor's pixels at any zoom.
    expect(ring.style.left).toBe("46px");
    expect(ring.style.top).toBe("96px");
    expect(ring.style.width).toBe("208px");
    expect(ring.style.height).toBe("58px");
    expect(ring.hasAttribute("data-secondary")).toBe(false);
  });

  it("draws its layer a ring's distance past the frame on every side, the chrome where it was", async () => {
    // A selection ring stands just outside its block, so for a block flush
    // with the page's edge it runs past the frame: the layer reaches that far
    // and moves its content back, so everything drawn in it stays put.
    const { container, frame } = framed(
      <CanvasFrame
        width={1280}
        title="Home"
        source={TEST_SOURCE}
        overlay={<CanvasMarks />}
      >
        <Canvas document={PAGE} siteStyles={false} selectedId="box" />
      </CanvasFrame>
    );
    await act(async () => undefined);
    // The viewport as the layer reads it, painted at the frame's half scale.
    const viewport = frameViewportOf(frame);
    const painted = (length: number | undefined): string =>
      `${String((length ?? 0) * (FRAME_BOX.width / FRAME_LAYOUT.width) + 8)}px`;
    const layer = container.querySelector<HTMLElement>(
      "[data-nx-canvas-layer]"
    );
    const content = container.querySelector<HTMLElement>(
      ".nx-canvas-layer__content"
    );
    expect(layer?.style.left).toBe("-4px");
    expect(layer?.style.top).toBe("-4px");
    expect(layer?.style.width).toBe(painted(viewport?.width));
    expect(layer?.style.height).toBe(painted(viewport?.height));
    expect(content?.style.transform).toMatch(/^translate\(4px, 4px\)/);
  });

  it("draws the drop line at the frame's scale", () => {
    const { container } = framed(
      <CanvasFrame
        width={1280}
        title="Home"
        source={TEST_SOURCE}
        overlay={
          <DropIndicator
            target={
              {
                axis: "y",
                line: 300,
                from: 100,
                to: 500,
                at: { parentId: undefined, slot: "children", index: 1 },
              } as never
            }
          />
        }
      >
        <Canvas document={PAGE} siteStyles={false} />
      </CanvasFrame>
    );
    const line = container.querySelector<HTMLElement>(".nx-drop-indicator");
    expect(line?.style.top).toBe("150px");
    expect(line?.style.left).toBe("50px");
    expect(line?.style.width).toBe("200px");
  });

  it("draws a refusal in the editor's document, over the container that refused", async () => {
    const drag: CanvasDragState = {
      draggingId: null,
      draggingBlockName: "frame/box",
      target: null,
      refusal: {
        regionId: "root",
        reason: "restricted-at-root",
        permitted: [],
      } as never,
    } as CanvasDragState;
    const { container, frame } = framed(
      <CanvasFrame
        width={1280}
        title="Home"
        source={TEST_SOURCE}
        overlay={<DropRefusal drag={drag} document={PAGE} />}
      >
        <Canvas document={PAGE} siteStyles={false} drag={drag} />
      </CanvasFrame>
    );
    await act(async () => undefined);
    const notice = container.querySelector<HTMLElement>(".nx-drop-refusal");
    expect(notice).not.toBeNull();
    // The one refusal notice Layers draws too: the neutral surface with the
    // warning mark, the reason and what the spot takes.
    expect(notice?.classList.contains("nx-refusal-notice")).toBe(true);
    expect(notice?.querySelector(".nx-refusal-notice__mark")).not.toBeNull();
    expect(notice?.querySelector(".nx-refusal-notice__why")).not.toBeNull();
    // Nothing of the editor's chrome is drawn into the page.
    expect(frame.contentDocument?.querySelector(".nx-drop-refusal")).toBeNull();
  });
});

describe("the block menu over a canvas in a frame", () => {
  function MenuHost({ onEditor }: { onEditor: (e: EditorState) => void }) {
    const editor = useEditorState({ initialDocument: PAGE });
    onEditor(editor);
    return (
      <ShortcutProvider>
        {/* Above the whole editor, as the editor provides it. */}
        <CanvasFrameProvider>
          <BlockKeyboardActions
            editor={editor}
            onSaveAsPattern={() => undefined}
          >
            <BlockContextMenu editor={editor}>
              <CanvasFrame width={1280} title="Home" source={TEST_SOURCE}>
                <Canvas
                  document={editor.document}
                  siteStyles={false}
                  selectedId={editor.selectedId}
                  onSelect={editor.select}
                />
              </CanvasFrame>
            </BlockContextMenu>
          </BlockKeyboardActions>
        </CanvasFrameProvider>
      </ShortcutProvider>
    );
  }

  it("selects the block pressed inside the frame, and opens where it was pressed", async () => {
    let editor: EditorState | null = null;
    const { frame } = framed(<MenuHost onEditor={e => (editor = e)} />);
    const block = frame.contentDocument?.querySelector(
      `[${NODE_ID_ATTRIBUTE}="box"]`
    );
    if (block === null || block === undefined) throw new Error("no block");
    await act(async () => {
      fireEvent.contextMenu(block, { clientX: 100, clientY: 200 });
    });
    expect((editor as EditorState | null)?.selectedId).toBe("box");
    const menu = await vi.waitFor(() => {
      const found = document.querySelector<HTMLElement>(
        '[aria-label="Block actions"]'
      );
      if (found === null) throw new Error("no menu yet");
      return found;
    });
    // Opened in the editor's document.
    expect(menu.ownerDocument).toBe(document);
    // At the press, in the editor's coordinates: (100, 200) in the frame's
    // viewport is (150, 150) in the editor's, the frame painted at half size
    // from (100, 50).
    expect(menu.parentElement?.style.transform).toMatch(/, 150px\)$/);
  });
});
