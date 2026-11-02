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
import { NODE_ID_ATTRIBUTE } from "@nextlyhq/blocks-react";

import { Canvas } from "./canvas";
import { CanvasMarks } from "./canvas-marks";

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
});
