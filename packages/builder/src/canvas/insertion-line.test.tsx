// @vitest-environment jsdom
/**
 * The line the canvas draws where the Add panel's highlighted tile would
 * land: at the place a click would use, with the panel's words; an empty
 * container lit instead of a line; a place off screen named at the nearest
 * edge, scrolled to only when that label is pressed.
 *
 * @module insertion-line.test
 */
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createElement, type ReactNode } from "react";

import {
  clearBlocks,
  registerBlocks,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import { NODE_ID_ATTRIBUTE } from "@nextlyhq/blocks-react";

import { Canvas } from "./canvas";
import { InsertionLine } from "./insertion-line";
import {
  InsertionPreviewProvider,
  usePublishInsertionPreview,
  type InsertionPreview,
} from "./insertion-preview";

afterEach(cleanup);
afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.spyOn(Element.prototype, "getClientRects").mockImplementation(() => {
    const rects = [new DOMRect(0, 0, 100, 50)];
    return Object.assign(rects, {
      item: (index: number) => rects[index] ?? null,
    }) as unknown as DOMRectList;
  });
});

beforeAll(() => {
  clearBlocks();
  registerBlocks(
    [
      {
        name: "acme/leaf",
        version: 1,
        description: "A block.",
        example: { props: {} },
        render: ({ className }: { className: string }) =>
          createElement("div", { className }),
      },
      {
        name: "acme/box",
        version: 1,
        description: "A container.",
        example: { props: {} },
        slots: { children: {} },
        render: ({
          className,
          renderSlot,
        }: {
          className: string;
          renderSlot: (name: string) => ReactNode;
        }) => createElement("div", { className }, renderSlot("children")),
      },
    ] as never,
    { source: "core" }
  );
});

/** Hero holding two blocks, an empty Box, and a block far down the page. */
const page: BlockDocument = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    {
      id: "hero",
      type: "acme/box",
      version: 1,
      props: {},
      slots: {
        children: [
          { id: "one", type: "acme/leaf", version: 1, props: {} },
          { id: "two", type: "acme/leaf", version: 1, props: {} },
        ],
      },
    },
    { id: "box", type: "acme/box", version: 1, props: {} },
    { id: "far", type: "acme/leaf", version: 1, props: {} },
  ],
};

/** Where each block is laid out, on a 1000px-wide page. */
function layOut(): void {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function boxOf(this: Element) {
      if (this.hasAttribute("data-scroller")) {
        return new DOMRect(0, 0, 1000, 500);
      }
      switch (this.getAttribute(NODE_ID_ATTRIBUTE)) {
        case "hero":
          return new DOMRect(0, 0, 1000, 300);
        case "one":
          return new DOMRect(0, 0, 1000, 100);
        case "two":
          return new DOMRect(0, 120, 1000, 100);
        case "box":
          return new DOMRect(0, 320, 1000, 50);
        case "far":
          return new DOMRect(0, 900, 1000, 100);
        default:
          return new DOMRect(0, 0, 1000, 2000);
      }
    }
  );
}

function Publish({ preview }: { preview: InsertionPreview | null }): null {
  usePublishInsertionPreview(preview);
  return null;
}

/** The canvas with the line over it, inside a 500px-tall scroller. */
function drawWith(preview: InsertionPreview | null) {
  return render(
    <InsertionPreviewProvider>
      <div data-scroller="" style={{ overflowY: "auto" }}>
        <Canvas
          document={page}
          siteStyles={{ breakpoints: { viewport: [], container: [] } }}
          selectedId={null}
          overlay={<InsertionLine document={page} />}
        />
      </div>
      <Publish preview={preview} />
    </InsertionPreviewProvider>
  );
}

const lineIn = (container: HTMLElement) =>
  container.querySelector<HTMLElement>(".nx-insertion-line .nx-drop-indicator");
const labelIn = (container: HTMLElement) =>
  container.querySelector<HTMLElement>(".nx-insertion-line__label");
const edgeIn = (container: HTMLElement) =>
  container.querySelector<HTMLElement>(".nx-insertion-line__edge");
const litIn = (container: HTMLElement) =>
  container.querySelector<HTMLElement>(".nx-insertion-line__container");

describe("the line where a highlighted tile would land", () => {
  it("draws nothing while no tile is highlighted", async () => {
    layOut();
    const { container } = drawWith(null);
    await act(async () => undefined);
    expect(lineIn(container)).toBeNull();
    expect(labelIn(container)).toBeNull();
    expect(edgeIn(container)).toBeNull();
  });

  it("draws the line across Hero in the middle of the gap after its first block, with the panel's words", async () => {
    layOut();
    const { container } = drawWith({
      at: { parentId: "hero", slot: "children", index: 1 },
      words: "Text goes after One, inside Hero",
    });
    await act(async () => undefined);
    const line = lineIn(container);
    expect(line?.getAttribute("data-axis")).toBe("y");
    // Half way between One's bottom (100) and Two's top (120).
    expect(line?.style.top).toBe("110px");
    expect(line?.style.left).toBe("0px");
    expect(line?.style.width).toBe("1000px");
    const label = labelIn(container);
    expect(label?.textContent).toBe("Text goes after One, inside Hero");
    expect({ left: label?.style.left, top: label?.style.top }).toEqual({
      left: "0px",
      top: "110px",
    });
    // The panel's line says the words; the canvas's copy is for the eye.
    expect(label?.getAttribute("aria-hidden")).toBe("true");
  });

  it("draws a block going in at the end of Hero just below its last block", async () => {
    layOut();
    const { container } = drawWith({
      at: { parentId: "hero", slot: "children", index: 2 },
      words: "Text goes inside Hero, at the end",
    });
    await act(async () => undefined);
    expect(lineIn(container)?.style.top).toBe("220px");
  });

  it("lights an empty container the block would go inside, and draws no line", async () => {
    layOut();
    const { container } = drawWith({
      at: { parentId: "box", slot: "children", index: 0 },
      words: "Text goes inside Box",
    });
    await act(async () => undefined);
    expect(lineIn(container)).toBeNull();
    const lit = litIn(container);
    expect({
      left: lit?.style.left,
      top: lit?.style.top,
      width: lit?.style.width,
      height: lit?.style.height,
    }).toEqual({ left: "0px", top: "320px", width: "1000px", height: "50px" });
  });

  it("names a place below the screen at the bottom edge, and scrolls only when that is pressed", async () => {
    layOut();
    const scrollBy = vi.fn();
    Element.prototype.scrollBy = scrollBy;
    const { container } = drawWith({
      at: { index: 3 },
      words: "Text goes at the end of the page",
    });
    await act(async () => undefined);
    // The end of the page, under "far" at 1000px, is past the 500px screen.
    expect(lineIn(container)).toBeNull();
    const edge = edgeIn(container);
    expect(edge?.getAttribute("data-edge")).toBe("bottom");
    expect(edge?.textContent).toBe("↓ Text goes at the end of the page");
    // Drawing it scrolled nothing.
    expect(scrollBy).not.toHaveBeenCalled();
    if (edge === null) throw new Error("no edge label");
    fireEvent.click(edge);
    // To the middle of the 500px screen: 1000 - 250.
    expect(scrollBy).toHaveBeenCalledWith({ top: 750 });
  });
});
