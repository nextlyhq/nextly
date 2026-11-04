// @vitest-environment jsdom

/**
 * Pointing at a block on the canvas outlines it, as pointing at its Layers
 * row does: the canvas points the editor's one hovered block at the deepest
 * block under the pointer, and at nothing once the pointer leaves or a drag
 * begins.
 *
 * @module canvas-hover.test
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  clearBlocks,
  registerBlocks,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";

import { Canvas } from "./canvas";
import { HoveredBlockProvider, useHoveredBlock } from "./hovered-block";

afterEach(cleanup);

beforeAll(() => {
  clearBlocks();
  registerBlocks(
    [
      {
        name: "acme/box",
        version: 1,
        description: "A box with a region.",
        example: { props: {} },
        slots: { children: {} },
        render: ({
          className,
          renderSlot,
        }: {
          className: string;
          renderSlot: (name: string) => ReactNode;
        }) => createElement("section", { className }, renderSlot("children")),
      },
      {
        name: "acme/leaf",
        version: 1,
        description: "A block.",
        example: { props: {} },
        render: ({ className }: { className: string }) =>
          createElement("p", { className }, "words"),
      },
    ] as never,
    { source: "canvas-hover-test" }
  );
});
afterAll(clearBlocks);

const DOCUMENT: BlockDocument = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    {
      id: "outer",
      type: "acme/box",
      version: 1,
      props: {},
      slots: {
        children: [{ id: "inner", type: "acme/leaf", version: 1, props: {} }],
      },
    },
  ],
};

/** What the editor's hovered block is, written where a test can read it. */
function Pointed(): React.JSX.Element {
  return (
    <output data-testid="pointed">{useHoveredBlock() ?? "nothing"}</output>
  );
}

function canvas(dragging = false): React.JSX.Element {
  return (
    <HoveredBlockProvider>
      <Canvas
        document={DOCUMENT}
        siteStyles={{ breakpoints: { viewport: [], container: [] } }}
        selectedId={null}
        drag={
          dragging
            ? {
                draggingId: "outer",
                draggingBlockName: "acme/box",
                target: null,
                refusal: null,
              }
            : undefined
        }
      />
      <Pointed />
    </HoveredBlockProvider>
  );
}

const pointed = () => screen.getByTestId("pointed").textContent;
const node = (id: string) =>
  document.querySelector<HTMLElement>(`[data-nx-node="${id}"]`);

describe("pointing at a block on the canvas", () => {
  it("outlines the deepest block under the pointer, and nothing once it leaves", async () => {
    render(canvas());
    await act(async () => undefined);
    const inner = node("inner");
    if (inner === null) throw new Error("no inner block");
    fireEvent.pointerMove(inner);
    expect(pointed()).toBe("inner");
    const outer = node("outer");
    if (outer === null) throw new Error("no outer block");
    fireEvent.pointerMove(outer);
    expect(pointed()).toBe("outer");
    const root = document.querySelector<HTMLElement>(".nx-canvas");
    if (root === null) throw new Error("no canvas");
    fireEvent.pointerLeave(root);
    expect(pointed()).toBe("nothing");
  });

  it("points at nothing while a block is being dragged", async () => {
    const { rerender } = render(canvas());
    await act(async () => undefined);
    const inner = node("inner");
    if (inner === null) throw new Error("no inner block");
    fireEvent.pointerMove(inner);
    expect(pointed()).toBe("inner");
    // A drag's own marks say where the block will land.
    rerender(canvas(true));
    expect(pointed()).toBe("nothing");
    fireEvent.pointerMove(inner);
    expect(pointed()).toBe("nothing");
  });
});
