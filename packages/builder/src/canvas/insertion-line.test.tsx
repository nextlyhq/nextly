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
import { EDGE_HOLD_MS, InsertionLine } from "./insertion-line";
import {
  InsertionPreviewProvider,
  PREVIEW_GRACE_MS,
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
        name: "acme/nothing",
        version: 1,
        description: "A block that draws nothing.",
        example: { props: {} },
        render: () => null,
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

/** The page with the empty Box moved far down, below the screen. */
const boxBelow: BlockDocument = {
  ...page,
  nodes: [page.nodes[0]!, page.nodes[2]!, page.nodes[1]!],
};

/** As {@link layOut}, with the Box at 1100px, past the 500px screen. */
function layOutBoxBelow(): void {
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
        case "far":
          return new DOMRect(0, 900, 1000, 100);
        case "box":
          return new DOMRect(0, 1100, 1000, 50);
        default:
          return new DOMRect(0, 0, 1000, 2000);
      }
    }
  );
}

/** The canvas with the line over it, inside a 500px-tall scroller. */
function canvasWith(
  preview: InsertionPreview | null,
  document: BlockDocument = page
) {
  return (
    <InsertionPreviewProvider>
      <div data-scroller="" style={{ overflowY: "auto" }}>
        <Canvas
          document={document}
          siteStyles={{ breakpoints: { viewport: [], container: [] } }}
          selectedId={null}
          overlay={<InsertionLine document={document} />}
        />
      </div>
      <Publish preview={preview} />
    </InsertionPreviewProvider>
  );
}

function drawWith(
  preview: InsertionPreview | null,
  document: BlockDocument = page
) {
  return render(canvasWith(preview, document));
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

  it("puts the label below its line where there is no room above it", async () => {
    layOut();
    const { container } = drawWith({
      at: { index: 0 },
      words: "Text goes at the top of the page",
    });
    await act(async () => undefined);
    // The line is at the top of the screen, where a label above it is cut off.
    expect(lineIn(container)?.style.top).toBe("0px");
    expect(labelIn(container)?.hasAttribute("data-below")).toBe(true);
  });

  it("keeps the label above its line where there is room (the control)", async () => {
    layOut();
    const { container } = drawWith({
      at: { parentId: "hero", slot: "children", index: 1 },
      words: "Text goes after One, inside Hero",
    });
    await act(async () => undefined);
    expect(labelIn(container)?.hasAttribute("data-below")).toBe(false);
  });

  it("names an empty container below the screen at the edge, and scrolls it into view when pressed", async () => {
    layOutBoxBelow();
    const revealed = revealSpy();
    const { container } = drawWith(
      {
        at: { parentId: "box", slot: "children", index: 0 },
        words: "Text goes inside Box",
      },
      boxBelow
    );
    await act(async () => undefined);
    expect(litIn(container)).toBeNull();
    const edge = edgeIn(container);
    expect(edge?.textContent).toBe("↓ Text goes inside Box");
    if (edge === null) throw new Error("no edge label");
    fireEvent.click(edge);
    // The Box itself, to the middle of the canvas.
    expect(revealed()).toEqual([
      ["box", { block: "center", inline: "center" }],
    ]);
    // A press keeps the selection: the label is the editor's own chrome.
    expect(edge.closest("[data-nx-chrome]")).not.toBeNull();
  });

  it("keeps an edge label a while after the panel lets go, and while it is pointed at", async () => {
    vi.useFakeTimers();
    try {
      layOut();
      const far = {
        at: { index: 3 },
        words: "Text goes at the end of the page",
      };
      const { container, rerender } = drawWith(far);
      await act(async () => undefined);
      expect(edgeIn(container)).not.toBeNull();
      // The pointer leaves the tiles for the label: the panel lets go.
      rerender(canvasWith(null));
      act(() => {
        vi.advanceTimersByTime(PREVIEW_GRACE_MS + 50);
      });
      const edge = edgeIn(container);
      expect(edge).not.toBeNull();
      if (edge === null) throw new Error("no edge label");
      // Pointed at, it stays however long the author takes.
      fireEvent.pointerEnter(edge);
      act(() => {
        vi.advanceTimersByTime(EDGE_HOLD_MS * 3);
      });
      expect(edgeIn(container)).not.toBeNull();
      // Left, it goes once the hold runs out.
      fireEvent.pointerLeave(edge);
      act(() => {
        vi.advanceTimersByTime(EDGE_HOLD_MS);
      });
      expect(edgeIn(container)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not keep a line after the panel lets go (the control)", async () => {
    vi.useFakeTimers();
    try {
      layOut();
      const { container, rerender } = drawWith({
        at: { parentId: "hero", slot: "children", index: 1 },
        words: "Text goes after One, inside Hero",
      });
      await act(async () => undefined);
      expect(lineIn(container)).not.toBeNull();
      rerender(canvasWith(null));
      act(() => {
        vi.advanceTimersByTime(PREVIEW_GRACE_MS + 50);
      });
      expect(lineIn(container)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("names a place below the screen at the bottom edge, and scrolls only when that is pressed", async () => {
    layOut();
    const revealed = revealSpy();
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
    expect(revealed()).toEqual([]);
    if (edge === null) throw new Error("no edge label");
    fireEvent.click(edge);
    // The block before the place, "far", with its end, where the place is,
    // brought into view: a block taller than the screen still shows the gap.
    expect(revealed()).toEqual([["far", { block: "end", inline: "end" }]]);
  });

  it("names a place off to the side at that edge, in a row wider than the screen", async () => {
    // Hero's two blocks side by side, the second running past the 1000px
    // screen, as at a zoom wider than the canvas region.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function boxOf(this: Element) {
        if (this.hasAttribute("data-scroller")) {
          return new DOMRect(0, 0, 1000, 500);
        }
        switch (this.getAttribute(NODE_ID_ATTRIBUTE)) {
          case "hero":
            return new DOMRect(0, 0, 1700, 100);
          case "one":
            return new DOMRect(0, 0, 600, 100);
          case "two":
            return new DOMRect(1100, 0, 600, 100);
          default:
            return new DOMRect(0, 0, 1000, 2000);
        }
      }
    );
    const revealed = revealSpy();
    const { container } = drawWith({
      at: { parentId: "hero", slot: "children", index: 2 },
      words: "Text goes inside Hero, at the end",
    });
    await act(async () => undefined);
    // Past Two's right edge at 1700: off the right of the screen.
    expect(lineIn(container)).toBeNull();
    const edge = edgeIn(container);
    expect(edge?.getAttribute("data-edge")).toBe("right");
    expect(edge?.textContent).toBe("→ Text goes inside Hero, at the end");
    if (edge === null) throw new Error("no edge label");
    fireEvent.click(edge);
    expect(revealed()).toEqual([["two", { block: "end", inline: "end" }]]);
  });

  it("keeps a row line's label on its right where the screen is narrow but the left has less room", async () => {
    // A 320px screen with a row starting at its left edge: the label fits
    // nowhere whole, and the right has the room.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function boxOf(this: Element) {
        if (this.hasAttribute("data-scroller")) {
          return new DOMRect(0, 0, 320, 500);
        }
        switch (this.getAttribute(NODE_ID_ATTRIBUTE)) {
          case "hero":
            return new DOMRect(0, 0, 320, 100);
          case "one":
            return new DOMRect(0, 0, 100, 100);
          case "two":
            return new DOMRect(150, 0, 100, 100);
          default:
            return new DOMRect(0, 0, 320, 2000);
        }
      }
    );
    const { container } = drawWith({
      at: { parentId: "hero", slot: "children", index: 0 },
      words: "Text goes inside Hero, first",
    });
    await act(async () => undefined);
    expect(lineIn(container)?.getAttribute("data-axis")).toBe("x");
    expect(labelIn(container)?.hasAttribute("data-before")).toBe(false);
  });

  it("grows a top or bottom edge label leftwards where the place is near the right edge", async () => {
    // A row below the screen, ending at 995px of a 1000px screen.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function boxOf(this: Element) {
        if (this.hasAttribute("data-scroller")) {
          return new DOMRect(0, 0, 1000, 500);
        }
        switch (this.getAttribute(NODE_ID_ATTRIBUTE)) {
          case "hero":
            return new DOMRect(0, 900, 1000, 100);
          case "one":
            return new DOMRect(0, 900, 400, 100);
          case "two":
            return new DOMRect(500, 900, 495, 100);
          default:
            return new DOMRect(0, 0, 1000, 2000);
        }
      }
    );
    const { container } = drawWith({
      at: { parentId: "hero", slot: "children", index: 2 },
      words: "Text goes inside Hero, at the end",
    });
    await act(async () => undefined);
    const edge = edgeIn(container);
    expect(edge?.getAttribute("data-edge")).toBe("bottom");
    expect(edge?.hasAttribute("data-before")).toBe(true);
  });

  it("anchors the label to the part of its line on screen", async () => {
    // A zoomed canvas panned right: the screen shows 300px to 1300px, and the
    // line across Hero starts at 0, off its left.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function boxOf(this: Element) {
        if (this.hasAttribute("data-scroller")) {
          return new DOMRect(300, 0, 1000, 500);
        }
        switch (this.getAttribute(NODE_ID_ATTRIBUTE)) {
          case "hero":
            return new DOMRect(0, 0, 1000, 300);
          case "one":
            return new DOMRect(0, 0, 1000, 100);
          case "two":
            return new DOMRect(0, 120, 1000, 100);
          default:
            return new DOMRect(0, 0, 1000, 2000);
        }
      }
    );
    const { container } = drawWith({
      at: { parentId: "hero", slot: "children", index: 1 },
      words: "Text goes after One, inside Hero",
    });
    await act(async () => undefined);
    expect(lineIn(container)?.style.left).toBe("0px");
    expect(labelIn(container)?.style.left).toBe("300px");
  });

  it("reveals the rendered block nearest a place off screen, not one that draws nothing", async () => {
    layOut();
    const revealed = revealSpy();
    // The page ends with a block that draws nothing, after "far".
    const ending: BlockDocument = {
      ...page,
      nodes: [
        ...page.nodes,
        { id: "ghost", type: "acme/nothing", version: 1, props: {} },
      ],
    };
    const { container } = drawWith(
      { at: { index: 4 }, words: "Text goes at the end of the page" },
      ending
    );
    await act(async () => undefined);
    const edge = edgeIn(container);
    if (edge === null) throw new Error("no edge label");
    fireEvent.click(edge);
    expect(revealed()).toEqual([["far", { block: "end", inline: "end" }]]);
  });

  it("puts a row line's label on its left where the screen's right edge leaves no room", async () => {
    // Hero's two blocks side by side, the end of the row at the screen's edge.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function boxOf(this: Element) {
        if (this.hasAttribute("data-scroller")) {
          return new DOMRect(0, 0, 1000, 500);
        }
        switch (this.getAttribute(NODE_ID_ATTRIBUTE)) {
          case "hero":
            return new DOMRect(0, 0, 1000, 100);
          case "one":
            return new DOMRect(0, 0, 400, 100);
          case "two":
            return new DOMRect(500, 0, 495, 100);
          default:
            return new DOMRect(0, 0, 1000, 2000);
        }
      }
    );
    const { container, rerender } = drawWith({
      at: { parentId: "hero", slot: "children", index: 2 },
      words: "Text goes inside Hero, at the end",
    });
    await act(async () => undefined);
    expect(lineIn(container)?.getAttribute("data-axis")).toBe("x");
    expect(labelIn(container)?.hasAttribute("data-before")).toBe(true);
    // The control: the line between the two, with room to its right.
    rerender(
      canvasWith({
        at: { parentId: "hero", slot: "children", index: 1 },
        words: "Text goes after One, inside Hero",
      })
    );
    await act(async () => undefined);
    expect(labelIn(container)?.hasAttribute("data-before")).toBe(false);
  });

  it("draws a place before a block that renders nothing at the gap where it shows", async () => {
    // Hero holds One and then a block that draws nothing: the place between
    // them is the gap after One on screen.
    layOut();
    const withGhost: BlockDocument = {
      ...page,
      nodes: [
        {
          id: "hero",
          type: "acme/box",
          version: 1,
          props: {},
          slots: {
            children: [
              { id: "one", type: "acme/leaf", version: 1, props: {} },
              { id: "ghost", type: "acme/nothing", version: 1, props: {} },
            ],
          },
        },
      ],
    };
    const { container } = drawWith(
      {
        at: { parentId: "hero", slot: "children", index: 1 },
        words: "Text goes after One, inside Hero",
      },
      withGhost
    );
    await act(async () => undefined);
    expect(lineIn(container)?.style.top).toBe("100px");
  });
});

/**
 * Every block the canvas scrolled into view, by id, with how. Read from the
 * element's own node id rather than which element was asked, so a test reads
 * what was revealed.
 */
function revealSpy(): () => unknown[][] {
  const calls: unknown[][] = [];
  Element.prototype.scrollIntoView = function reveal(
    this: Element,
    how?: unknown
  ) {
    calls.push([this.getAttribute(NODE_ID_ATTRIBUTE), how]);
  };
  return () => calls;
}
