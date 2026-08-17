// @vitest-environment jsdom

/**
 * What the canvas adds on top of the renderer: hit-testing and selection.
 *
 * `jsdom` per-file rather than for the package: the rest of this suite is static
 * analysis over source files and gains nothing from a DOM but its startup cost.
 * These cases need real `closest` traversal and real event dispatch, which is
 * the capability the package config named as the reason to switch a file when
 * renderer tests arrived.
 *
 * The rendering itself is `blocks-react`'s and is asserted there. What is only
 * true here is that a pointer landing anywhere inside a block resolves to that
 * block, and that a pointer landing on nothing clears the selection instead of
 * being swallowed.
 *
 * @module canvas.test
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createElement } from "react";

import { clearBlocks, registerBlocks } from "@nextlyhq/blocks-engine";

import { NODE_ID_ATTRIBUTE } from "@nextlyhq/blocks-react";

import {
  CANVAS_ROOT_CLASS,
  Canvas,
  SELECTED_ATTRIBUTE,
  nodeIdFromEvent,
} from "./canvas";

// Explicit because this package does not enable vitest globals, and without
// them testing-library never registers its own cleanup: every render stays
// mounted, so a later query matches this test's element AND the previous one's
// and fails on the duplicate rather than on anything being wrong.
afterEach(cleanup);

/**
 * A node's rendered output, as a block actually emits it: a wrapper carrying the
 * id and real content nested inside.
 *
 * The nesting is the point. A fixture whose clickable element IS the element
 * carrying the attribute passes whether or not the lookup walks ancestors, so it
 * would certify a canvas that can only select blocks rendering exactly one
 * element — which is almost none of them.
 */
function canvas(children: React.ReactNode) {
  return <div className={CANVAS_ROOT_CLASS}>{children}</div>;
}

function block(id: string, label: string) {
  return (
    <section {...{ [NODE_ID_ATTRIBUTE]: id }}>
      <h2>
        <span data-testid={`leaf-${id}`}>{label}</span>
      </h2>
    </section>
  );
}

describe("resolving a pointer target to the node that owns it", () => {
  it("walks up from a deep leaf to the block that rendered it", () => {
    render(canvas(block("node-a", "Heading A")));

    // Two levels below the element carrying the attribute.
    const leaf = screen.getByTestId("leaf-node-a");

    expect(nodeIdFromEvent(leaf)).toBe("node-a");
  });

  it("resolves to the NEAREST block, so a nested block wins over its parent", () => {
    render(
      canvas(
        <section {...{ [NODE_ID_ATTRIBUTE]: "outer" }}>
          {block("inner", "Nested")}
        </section>
      )
    );

    // Without this, a container would swallow every click meant for its
    // children and the whole page would select as one block.
    expect(nodeIdFromEvent(screen.getByTestId("leaf-inner"))).toBe("inner");
  });

  it("resolves to null when the target is outside every block", () => {
    render(canvas(<p data-testid="background">canvas background</p>));

    expect(nodeIdFromEvent(screen.getByTestId("background"))).toBeNull();
  });

  it("resolves to null OUTSIDE the canvas, rather than to an ancestor node", () => {
    // The case the boundary exists for. A block that renders a fragment or a
    // component carries no attribute of its own, so a click inside it walks up
    // to whatever ancestor has one. Modelled here as a node OUTSIDE the canvas
    // root, which is the same walk reaching past the boundary.
    render(
      <section {...{ [NODE_ID_ATTRIBUTE]: "outside-node" }}>
        <span data-testid="stray">not in any canvas</span>
      </section>
    );

    // Wrong-and-confident is the failure being prevented: without the bound
    // this returns "outside-node" and the editor acts on a node the author
    // never clicked.
    expect(nodeIdFromEvent(screen.getByTestId("stray"))).toBeNull();
  });

  it("resolves to null for a non-Element target, which a document click is", () => {
    // `EventTarget` is not always an `Element` — a click reaching the document
    // has one, and reading `closest` off it would throw rather than deselect.
    expect(nodeIdFromEvent(null)).toBeNull();
    expect(nodeIdFromEvent(new EventTarget())).toBeNull();
  });
});

describe("selection", () => {
  it("reports the clicked node, and reports null for the background", () => {
    const onSelect = vi.fn();

    // The handler is exercised through a plain element carrying the same
    // listener shape rather than through `Canvas`, so this file asserts the
    // hit-testing without standing up a renderer and a registry.
    render(
      <div
        className={CANVAS_ROOT_CLASS}
        data-testid="surface"
        onClick={e => onSelect(nodeIdFromEvent(e.target))}
      >
        {block("node-a", "Heading A")}
        <p data-testid="background">background</p>
      </div>
    );

    fireEvent.click(screen.getByTestId("leaf-node-a"));
    expect(onSelect).toHaveBeenLastCalledWith("node-a");

    fireEvent.click(screen.getByTestId("background"));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });
});

describe("the selected block is marked on its own element", () => {
  // A minimal registered block rather than the core library: the marking is
  // about the node attribute the renderer emits, not about what any particular
  // block draws, and importing `coreBlocks` here would couple a canvas test to
  // whatever that library ships next.
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
      ] as never,
      { source: "canvas-test" }
    );
  });

  afterAll(clearBlocks);

  /** A canvas over two blocks, with one of them selected. */
  function renderCanvas(selectedId: string | null) {
    return render(
      <Canvas
        document={
          {
            formatVersion: 1,
            kind: "page",
            nodes: [
              { id: "a", type: "acme/leaf", version: 1, props: {} },
              { id: "b", type: "acme/leaf", version: 1, props: {} },
            ],
          } as never
        }
        siteStyles={{ css: "", classes: {} } as never}
        selectedId={selectedId}
      />
    );
  }

  it("marks the selected element and no other", () => {
    // Both halves. Asserting only that the selected one is marked passes on an
    // implementation that marks every block, which draws an outline round the
    // whole page.
    const { container } = renderCanvas("b");

    const marked = container.querySelectorAll(`[${SELECTED_ATTRIBUTE}]`);
    expect(marked.length).toBe(1);
    expect(marked[0]?.getAttribute(NODE_ID_ATTRIBUTE)).toBe("b");
  });

  it("marks nothing when the selection is empty", () => {
    const { container } = renderCanvas(null);

    expect(container.querySelectorAll(`[${SELECTED_ATTRIBUTE}]`).length).toBe(
      0
    );
  });

  it("moves the mark when the selection changes", () => {
    // The stale-mark case: a re-render must CLEAR the previous element as well
    // as mark the new one, or two blocks read as selected at once.
    const { container, rerender } = renderCanvas("a");
    expect(
      container
        .querySelector(`[${SELECTED_ATTRIBUTE}]`)
        ?.getAttribute(NODE_ID_ATTRIBUTE)
    ).toBe("a");

    rerender(
      <Canvas
        document={
          {
            formatVersion: 1,
            kind: "page",
            nodes: [
              { id: "a", type: "acme/leaf", version: 1, props: {} },
              { id: "b", type: "acme/leaf", version: 1, props: {} },
            ],
          } as never
        }
        siteStyles={{ css: "", classes: {} } as never}
        selectedId="b"
      />
    );

    const marked = container.querySelectorAll(`[${SELECTED_ATTRIBUTE}]`);
    expect(marked.length).toBe(1);
    expect(marked[0]?.getAttribute(NODE_ID_ATTRIBUTE)).toBe("b");
  });

  it("reports the selected id on the canvas root", () => {
    // Named apart from the per-element marker on purpose: this carries an id
    // and that one is a boolean. A caller wanting the answer without walking
    // the tree reads this.
    const { container } = renderCanvas("a");

    expect(
      container
        .querySelector(`.${CANVAS_ROOT_CLASS}`)
        ?.getAttribute("data-nx-selected-id")
    ).toBe("a");
  });
});
