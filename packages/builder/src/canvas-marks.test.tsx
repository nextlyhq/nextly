// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createElement } from "react";

import {
  clearBlocks,
  registerBlocks,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import { INSTANCE_ATTRIBUTE, NODE_ID_ATTRIBUTE } from "@nextlyhq/blocks-react";

import { Canvas } from "./canvas";
import { CanvasMarks } from "./canvas-marks";
import { EXPOSED_ATTRIBUTE } from "./exposed-outline";

/**
 * The selection ring and its halo are drawn for EVERY selected rendering, by
 * the editor, in its own layer: each member of a multi-selection, and each copy
 * of a node a block draws more than once. A mark positioned on one anchor
 * could mark only one of them, and nothing the mark needs is written onto the
 * page's elements.
 *
 * @module canvas-marks.test
 */

// Explicit: this package does not enable vitest globals, so testing-library
// never registers its own cleanup.
afterEach(cleanup);
afterEach(() => {
  vi.restoreAllMocks();
});

/*
 * Give every element a layout box, which jsdom does not: the halo is declined
 * for an element with none, as every canvas overlay declines it, so without
 * this each test would assert against the refusal. The same allowance the
 * spacing overlay's tests take.
 */
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
        // A block that clips what it holds: its child sits partly outside it.
        name: "acme/clip",
        version: 1,
        description: "A block that clips its child.",
        example: { props: {} },
        render: ({ className }: { className: string }) =>
          createElement(
            "div",
            { className, style: { overflow: "hidden" }, "data-clip": "" },
            createElement("div", { [NODE_ID_ATTRIBUTE]: "inner" })
          ),
      },
      {
        // A block that draws its child twice: the shape of
        // `core/collection-loop`, which renders its children once per entry.
        name: "acme/twice",
        version: 1,
        description: "A block that repeats its child.",
        example: { props: {} },
        render: ({ className }: { className: string }) =>
          createElement(
            "div",
            { className },
            createElement("div", { key: "one", [NODE_ID_ATTRIBUTE]: "child" }),
            createElement("div", { key: "two", [NODE_ID_ATTRIBUTE]: "child" })
          ),
      },
      {
        // A component placement as the renderer draws it: the definition's
        // two parts, each carrying the placement's address and no element of
        // the placement's own around them.
        name: "acme/placed",
        version: 1,
        description: "A placement of a two-part component.",
        example: { props: {} },
        render: ({ className }: { className: string }) =>
          createElement(
            "div",
            { className },
            createElement("div", {
              key: "one",
              [NODE_ID_ATTRIBUTE]: "part-1",
              [INSTANCE_ATTRIBUTE]: "place",
            }),
            createElement("div", {
              key: "two",
              [NODE_ID_ATTRIBUTE]: "part-2",
              [INSTANCE_ATTRIBUTE]: "place",
            })
          ),
      },
    ] as never,
    { source: "canvas-marks-test" }
  );
});
afterAll(clearBlocks);

const leaves: BlockDocument = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    { id: "a", type: "acme/leaf", version: 1, props: {} },
    { id: "b", type: "acme/leaf", version: 1, props: {} },
    { id: "c", type: "acme/leaf", version: 1, props: {} },
  ],
};

/** The selection rings drawn, ring and halo together. */
const halosIn = (container: HTMLElement) =>
  Array.from(
    container.querySelectorAll('.nx-canvas-mark[data-mark="selected"]')
  );

describe("selection marks", () => {
  it("are drawn over the canvas they are given to", async () => {
    // Chrome, drawn wherever the host draws its chrome: inside the root for a
    // canvas sharing the editor's document, over the frame otherwise.
    const { container } = render(
      <Canvas
        document={leaves}
        siteStyles={{ breakpoints: { viewport: [], container: [] } }}
        selectedId="b"
        overlay={<CanvasMarks />}
      />
    );
    await act(async () => undefined);
    await waitFor(() => expect(halosIn(container)).toHaveLength(1));
  });

  it("still mark a block positioned against the viewport", async () => {
    /*
     * Over a frame the mark is the only ring a block has, so a fixed or sticky
     * block keeps one; the geometry watch hears a scroll and places it again.
     */
    for (const position of ["fixed", "sticky"]) {
      const { container } = render(
        <Canvas
          document={{
            formatVersion: 1,
            kind: "page",
            nodes: [
              { id: "pin", type: "acme/leaf", version: 1, props: {} },
              { id: "a", type: "acme/leaf", version: 1, props: {} },
            ],
          }}
          siteStyles={{ breakpoints: { viewport: [], container: [] } }}
          selectedId="pin"
          selectedIds={["pin", "a"]}
          overlay={<CanvasMarks />}
        />
      );
      await act(async () => undefined);
      const pin = container.querySelector<HTMLElement>('[data-nx-node="pin"]');
      expect(pin, "the pinned block rendered").not.toBeNull();
      await act(async () => {
        if (pin !== null) pin.style.position = position;
      });
      await waitFor(() => expect(halosIn(container)).toHaveLength(2));
      expect(
        halosIn(container).some(halo => !halo.hasAttribute("data-secondary")),
        `the ${position} block keeps its ring`
      ).toBe(true);
      cleanup();
    }
  });

  it("draws one for each member of a multi-selection", async () => {
    const { container } = render(
      <Canvas
        document={leaves}
        siteStyles={{ breakpoints: { viewport: [], container: [] } }}
        selectedId="a"
        selectedIds={["a", "c"]}
        overlay={<CanvasMarks />}
      />
    );
    await act(async () => undefined);
    await waitFor(() => expect(halosIn(container)).toHaveLength(2));
    // The primary's ring is the full width; the other's, the thin one.
    expect(
      halosIn(container).filter(halo => !halo.hasAttribute("data-secondary"))
    ).toHaveLength(1);
  });

  it("draws one for every copy of a node a block renders more than once", async () => {
    const { container } = render(
      <Canvas
        document={{
          formatVersion: 1,
          kind: "page",
          nodes: [{ id: "loop", type: "acme/twice", version: 1, props: {} }],
        }}
        siteStyles={{ breakpoints: { viewport: [], container: [] } }}
        selectedId="child"
        overlay={<CanvasMarks />}
      />
    );
    await act(async () => undefined);
    await waitFor(() => expect(halosIn(container)).toHaveLength(2));
  });

  it("draws none while nothing is selected", async () => {
    const { container } = render(
      <Canvas
        document={leaves}
        siteStyles={{ breakpoints: { viewport: [], container: [] } }}
        selectedId={null}
        overlay={<CanvasMarks />}
      />
    );
    await act(async () => undefined);
    expect(halosIn(container)).toHaveLength(0);
  });

  it("dashes the ring of a locked block, carried onto the mark", async () => {
    const { container } = render(
      <Canvas
        document={{
          formatVersion: 1,
          kind: "page",
          nodes: [
            { id: "a", type: "acme/leaf", version: 1, props: {}, locked: true },
            { id: "b", type: "acme/leaf", version: 1, props: {} },
          ],
        }}
        siteStyles={{ breakpoints: { viewport: [], container: [] } }}
        selectedIds={["a", "b"]}
        selectedId="a"
        overlay={<CanvasMarks />}
      />
    );
    await act(async () => undefined);
    await waitFor(() => expect(halosIn(container)).toHaveLength(2));
    // The locked block's mark says so; the free one's does not.
    expect(
      halosIn(container).map(mark => mark.hasAttribute("data-locked"))
    ).toEqual([true, false]);
  });

  it("marks a placement's exposed parts, but not one that is selected", async () => {
    const { container } = render(
      <Canvas
        document={leaves}
        siteStyles={{ breakpoints: { viewport: [], container: [] } }}
        selectedId="a"
        overlay={<CanvasMarks />}
      />
    );
    await act(async () => undefined);
    await waitFor(() => expect(halosIn(container)).toHaveLength(1));
    const exposedIn = () =>
      container.querySelectorAll('.nx-canvas-mark[data-mark="exposed"]');
    const node = (id: string) =>
      container.querySelector(`[${NODE_ID_ATTRIBUTE}="${id}"]`);
    // What the inspector writes for a selected placement's exposed values.
    act(() => {
      node("a")?.setAttribute(EXPOSED_ATTRIBUTE, "");
      node("b")?.setAttribute(EXPOSED_ATTRIBUTE, "");
    });
    // The selected element keeps its ring alone; the other gets the dash.
    await waitFor(() => expect(exposedIn()).toHaveLength(1));
    act(() => {
      node("b")?.removeAttribute(EXPOSED_ATTRIBUTE);
    });
    await waitFor(() => expect(exposedIn()).toHaveLength(0));
  });

  it("draws a selected placement as one frame around all its parts, tagged with its name", async () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function boxOf(this: Element) {
        const id = this.getAttribute(NODE_ID_ATTRIBUTE);
        if (id === "part-1") return new DOMRect(100, 100, 200, 50);
        if (id === "part-2") return new DOMRect(100, 200, 200, 50);
        return new DOMRect(0, 0, 1000, 1000);
      }
    );
    const { container } = render(
      <Canvas
        document={{
          formatVersion: 1,
          kind: "page",
          nodes: [{ id: "host", type: "acme/placed", version: 1, props: {} }],
        }}
        siteStyles={{ breakpoints: { viewport: [], container: [] } }}
        selectedId="place"
        overlay={
          <CanvasMarks
            nameOf={id => (id === "place" ? "Promo card" : undefined)}
          />
        }
      />
    );
    await act(async () => undefined);
    // One frame, not a ring per part.
    await waitFor(() => expect(halosIn(container)).toHaveLength(1));
    const frame = halosIn(container)[0] as HTMLElement;
    expect(frame.hasAttribute("data-component")).toBe(true);
    expect(frame.getAttribute("data-label")).toBe("◇ Promo card");
    // Room above it on the page, so the tag sits outside the frame.
    expect(frame.hasAttribute("data-tag-inside")).toBe(false);
    // Around both parts, and outside them by the ring and its halo.
    expect({
      left: frame.style.left,
      top: frame.style.top,
      width: frame.style.width,
      height: frame.style.height,
    }).toEqual({ left: "96px", top: "96px", width: "208px", height: "158px" });

    // An exposed part keeps its dash while the placement is selected.
    act(() => {
      container
        .querySelector(`[${NODE_ID_ATTRIBUTE}="part-2"]`)
        ?.setAttribute(EXPOSED_ATTRIBUTE, "");
    });
    await waitFor(() =>
      expect(
        container.querySelectorAll('.nx-canvas-mark[data-mark="exposed"]')
      ).toHaveLength(1)
    );
  });

  it("names a placement whose component has no name a component", async () => {
    const { container } = render(
      <Canvas
        document={{
          formatVersion: 1,
          kind: "page",
          nodes: [{ id: "host", type: "acme/placed", version: 1, props: {} }],
        }}
        siteStyles={{ breakpoints: { viewport: [], container: [] } }}
        selectedId="place"
        overlay={<CanvasMarks />}
      />
    );
    await act(async () => undefined);
    await waitFor(() => expect(halosIn(container)).toHaveLength(1));
    expect(halosIn(container)[0]?.getAttribute("data-label")).toBe(
      "◇ Component"
    );
    // At the top of the page, where a tag above would leave it.
    expect(halosIn(container)[0]?.hasAttribute("data-tag-inside")).toBe(true);
  });

  it("draws the ring outside the block, kept inside the page at its edge", async () => {
    /*
     * Drawn inside, the ring covered the first glyph of a heading set flush
     * with its box. Outside, it would leave the page for a block flush with
     * the page's edge, so there it is held to the page.
     */
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function boxOf(this: Element) {
        const id = this.getAttribute(NODE_ID_ATTRIBUTE);
        if (id === "a") return new DOMRect(0, 0, 100, 50);
        if (id === "b") return new DOMRect(100, 100, 200, 50);
        return new DOMRect(0, 0, 1000, 1000);
      }
    );
    const { container } = render(
      <Canvas
        document={leaves}
        siteStyles={{ breakpoints: { viewport: [], container: [] } }}
        selectedId="b"
        selectedIds={["a", "b"]}
        overlay={<CanvasMarks />}
      />
    );
    await act(async () => undefined);
    await waitFor(() => expect(halosIn(container)).toHaveLength(2));
    const boxes = halosIn(container).map(mark => {
      const { left, top, width, height } = (mark as HTMLElement).style;
      return { left, top, width, height };
    });
    expect(boxes).toEqual([
      { left: "0px", top: "0px", width: "104px", height: "54px" },
      { left: "96px", top: "96px", width: "208px", height: "58px" },
    ]);
  });

  it("draws only the part of a block its clipping ancestor leaves visible", async () => {
    /*
     * The page's own outline used to be clipped with the block; over the
     * frame the mark is drawn outside the page and has to be cut to the
     * visible part itself, or it rings an area the reader cannot see.
     */
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function boxOf(this: Element) {
        if (this.hasAttribute("data-clip")) return new DOMRect(0, 0, 100, 50);
        if (this.getAttribute(NODE_ID_ATTRIBUTE) === "inner") {
          return new DOMRect(50, 20, 100, 100);
        }
        return new DOMRect(0, 0, 1000, 1000);
      }
    );
    const { container } = render(
      <Canvas
        document={{
          formatVersion: 1,
          kind: "page",
          nodes: [{ id: "clip", type: "acme/clip", version: 1, props: {} }],
        }}
        siteStyles={{ breakpoints: { viewport: [], container: [] } }}
        selectedId="inner"
        overlay={<CanvasMarks />}
      />
    );
    await act(async () => undefined);
    const mark = await waitFor(() => {
      const [found] = halosIn(container);
      if (found === undefined) throw new Error("no mark yet");
      return found as HTMLElement;
    });
    expect({
      left: mark.style.left,
      top: mark.style.top,
      width: mark.style.width,
      height: mark.style.height,
    }).toEqual({ left: "50px", top: "20px", width: "50px", height: "30px" });
    // Cut by the clip, so the halo band is not drawn along the cut edges.
    expect(mark.hasAttribute("data-clipped")).toBe(true);
  });

  it("draws no mark for a block its clipping ancestor hides entirely", async () => {
    /*
     * Selected from Layers, a block can sit wholly outside the container that
     * clips it. The page shows none of it, so a ring there would mark an area
     * the reader cannot see; a clip that cannot be described is a different
     * case, which keeps a square ring.
     */
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function boxOf(this: Element) {
        if (this.hasAttribute("data-clip")) return new DOMRect(0, 0, 100, 50);
        if (this.getAttribute(NODE_ID_ATTRIBUTE) === "inner") {
          return new DOMRect(200, 120, 100, 100);
        }
        return new DOMRect(0, 0, 1000, 1000);
      }
    );
    const { container } = render(
      <Canvas
        document={{
          formatVersion: 1,
          kind: "page",
          nodes: [
            { id: "clip", type: "acme/clip", version: 1, props: {} },
            { id: "other", type: "acme/leaf", version: 1, props: {} },
          ],
        }}
        siteStyles={{ breakpoints: { viewport: [], container: [] } }}
        selectedIds={["inner", "other"]}
        selectedId="other"
        overlay={<CanvasMarks />}
      />
    );
    await act(async () => undefined);
    // The visible block's mark is drawn, so the canvas has measured.
    await waitFor(() => expect(halosIn(container).length).toBeGreaterThan(0));
    expect(halosIn(container)).toHaveLength(1);
  });
});
