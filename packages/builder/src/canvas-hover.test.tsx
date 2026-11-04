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
import { createRoot } from "react-dom/client";
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

  it("lets go of the hovered block in the commit that starts the drag, before a paint", async () => {
    /*
     * Outside `act`, which flushes every effect before it returns and so
     * cannot tell the two phases apart. A mutation observer's callback runs as
     * a microtask straight after React commits the drag, before the browser
     * paints and before a passive effect runs: what it reads is what the first
     * frame of the drag shows.
     */
    const flags = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const before = flags.IS_REACT_ACT_ENVIRONMENT;
    flags.IS_REACT_ACT_ENVIRONMENT = false;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const settle = async (done: () => boolean) => {
      for (let tries = 0; tries < 50 && !done(); tries += 1) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    };
    try {
      root.render(canvas());
      await settle(() => node("inner") !== null);
      const inner = node("inner");
      if (inner === null) throw new Error("no inner block");
      fireEvent.pointerMove(inner);
      await settle(() => pointed() === "inner");
      expect(pointed()).toBe("inner");

      const shown = new Promise<string | null>(resolve => {
        const observer = new MutationObserver(() => {
          if (host.querySelector("[data-nx-dragging]") === null) return;
          observer.disconnect();
          resolve(pointed());
        });
        observer.observe(host, {
          attributes: true,
          childList: true,
          characterData: true,
          subtree: true,
        });
      });
      root.render(canvas(true));
      expect(await shown).toBe("nothing");
    } finally {
      root.unmount();
      host.remove();
      flags.IS_REACT_ACT_ENVIRONMENT = before;
    }
  });
});
