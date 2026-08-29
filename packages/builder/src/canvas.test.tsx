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
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as React from "react";
import { createElement } from "react";

import {
  clearBlocks,
  PAGE_ROOT_CLASS,
  previewStateClass,
  registerBlocks,
  STYLE_STATES,
  type StyleState,
} from "@nextlyhq/blocks-engine";

import { NODE_ID_ATTRIBUTE } from "@nextlyhq/blocks-react";

import {
  CANVAS_ROOT_CLASS,
  Canvas,
  SELECTED_ATTRIBUTE,
  canvasScale,
  nodeIdFromEvent,
} from "./canvas";
import type { CanvasZoom } from "./canvas-zoom";

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

describe("a selection with more than one block in it", () => {
  /*
   * Registered here as well as in the describe above, because that one scopes
   * its registration to itself. A `beforeAll` inside a describe does not reach
   * a sibling, and the first version of these cases rendered nothing at all —
   * every assertion came back an empty NodeList, which reads as the canvas
   * marking nothing rather than as an unregistered block type.
   */
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
      { source: "canvas-multi-test" }
    );
  });

  afterAll(clearBlocks);

  function multi(selectedIds: readonly string[], primary: string | null) {
    return render(
      <Canvas
        document={
          {
            formatVersion: 1,
            kind: "page",
            nodes: [
              { id: "a", type: "acme/leaf", version: 1, props: {} },
              { id: "b", type: "acme/leaf", version: 1, props: {} },
              { id: "c", type: "acme/leaf", version: 1, props: {} },
            ],
          } as never
        }
        siteStyles={{ css: "", classes: {} } as never}
        selectedId={primary}
        selectedIds={selectedIds}
      />
    );
  }

  it("marks every selected block, not only the primary", () => {
    const { container } = multi(["a", "c"], "a");

    expect(
      Array.from(container.querySelectorAll(`[${SELECTED_ATTRIBUTE}]`)).map(e =>
        e.getAttribute(NODE_ID_ATTRIBUTE)
      )
    ).toEqual(["a", "c"]);
  });

  it("names WHICH member the panels answer for", () => {
    // Without this a multi-selection would draw three identical outlines and
    // the author would have no way to tell which block the inspector is
    // editing.
    const { container } = multi(["a", "c"], "c");
    const marked = Array.from(
      container.querySelectorAll(`[${SELECTED_ATTRIBUTE}]`)
    );

    expect(
      marked.map(e => [
        e.getAttribute(NODE_ID_ATTRIBUTE),
        e.getAttribute(SELECTED_ATTRIBUTE),
      ])
    ).toEqual([
      ["a", ""],
      ["c", "primary"],
    ]);
  });

  it("marks nothing outside the set, which is the control", () => {
    // Without it, "mark everything" would pass both cases above.
    const { container } = multi(["a"], "a");

    expect(container.querySelectorAll(`[${SELECTED_ATTRIBUTE}]`).length).toBe(
      1
    );
  });

  it("falls back to the primary alone for a caller that passes no set", () => {
    // Every existing host. The canvas must not decide what a selection IS, so
    // it marks exactly what it was told and no more.
    const { container } = render(
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

    const marked = Array.from(
      container.querySelectorAll(`[${SELECTED_ATTRIBUTE}]`)
    );
    expect(marked.map(e => e.getAttribute(NODE_ID_ATTRIBUTE))).toEqual(["b"]);
    expect(marked[0]?.getAttribute(SELECTED_ATTRIBUTE)).toBe("primary");
  });
});

describe("the gesture a click's modifiers meant", () => {
  /*
   * Registered here as well as in the describe above, because that one scopes
   * its registration to itself. A `beforeAll` inside a describe does not reach
   * a sibling, and the first version of these cases rendered nothing at all —
   * every assertion came back an empty NodeList, which reads as the canvas
   * marking nothing rather than as an unregistered block type.
   */
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
      { source: "canvas-multi-test" }
    );
  });

  afterAll(clearBlocks);

  function clickable(onSelect: (id: string | null, mode: string) => void) {
    return render(
      <Canvas
        document={
          {
            formatVersion: 1,
            kind: "page",
            nodes: [{ id: "a", type: "acme/leaf", version: 1, props: {} }],
          } as never
        }
        siteStyles={{ css: "", classes: {} } as never}
        onSelect={onSelect as never}
      />
    );
  }

  it("selects the block under a secondary click before any menu opens", () => {
    /*
     * A menu opened over one block while the selection sits on another acts on
     * the other one, and the author is looking at the block they aimed at — so
     * a destructive verb would be aimed somewhere off screen. The selection has
     * to move on the contextmenu event itself, which is the only thing that
     * happens before a menu above this can open.
     */
    const onSelect = vi.fn();
    const { container } = clickable(onSelect);
    const block = container.querySelector(`[${NODE_ID_ATTRIBUTE}]`);
    if (block === null) throw new Error("expected a rendered block");

    fireEvent.contextMenu(block);
    expect(onSelect).toHaveBeenCalledWith("a", "replace");
  });

  it("keeps a selection that already holds the block", () => {
    /*
     * Right-clicking one of several chosen blocks to act on all of them is what
     * every comparable editor does. Re-selecting would drop the rest of the
     * author's selection at the exact moment they went looking for a verb.
     */
    const onSelect = vi.fn();
    const { container } = render(
      <Canvas
        document={
          {
            formatVersion: 1,
            kind: "page",
            nodes: [{ id: "a", type: "acme/leaf", version: 1, props: {} }],
          } as never
        }
        siteStyles={{ css: "", classes: {} } as never}
        selectedIds={["a", "other"]}
        onSelect={onSelect as never}
      />
    );
    const block = container.querySelector(`[${NODE_ID_ATTRIBUTE}]`);
    if (block === null) throw new Error("expected a rendered block");

    fireEvent.contextMenu(block);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("withholds the event from above when no block is under it", () => {
    /*
     * A menu of block verbs over the canvas background would have no subject.
     * Stopping the event here rather than opening an empty menu keeps that
     * decision beside the hit test that establishes it — and an ancestor
     * listening for the gesture is exactly how the menu is mounted.
     */
    const onSelect = vi.fn();
    const above = vi.fn();
    const { container } = render(
      <div onContextMenu={above}>
        <Canvas
          document={
            {
              formatVersion: 1,
              kind: "page",
              nodes: [{ id: "a", type: "acme/leaf", version: 1, props: {} }],
            } as never
          }
          siteStyles={{ css: "", classes: {} } as never}
          onSelect={onSelect as never}
        />
      </div>
    );
    // The page wrapper: inside the canvas, carrying no node id of its own.
    const background = container.querySelector(".nx-pb-page");
    if (background === null) throw new Error("expected the page wrapper");

    fireEvent.contextMenu(background);
    expect(onSelect).not.toHaveBeenCalled();
    expect(above).not.toHaveBeenCalled();
  });

  it("lets the event reach above when a block IS under it", () => {
    // The control on the other side: a rule that stopped every contextmenu
    // event would pass the test above while no menu could ever open.
    const above = vi.fn();
    const { container } = render(
      <div onContextMenu={above}>
        <Canvas
          document={
            {
              formatVersion: 1,
              kind: "page",
              nodes: [{ id: "a", type: "acme/leaf", version: 1, props: {} }],
            } as never
          }
          siteStyles={{ css: "", classes: {} } as never}
          onSelect={vi.fn() as never}
        />
      </div>
    );
    const block = container.querySelector(`[${NODE_ID_ATTRIBUTE}]`);
    if (block === null) throw new Error("expected a rendered block");

    fireEvent.contextMenu(block);
    expect(above).toHaveBeenCalledTimes(1);
  });

  it("reports the mode alongside the id", () => {
    // The mode travels with the id because only the event knows it: a caller
    // reading modifiers off a later render's event would read a different
    // click.
    const onSelect = vi.fn();
    const { container } = clickable(onSelect);
    const block = container.querySelector(`[${NODE_ID_ATTRIBUTE}]`);
    if (block === null) throw new Error("expected a rendered block");

    fireEvent.click(block, { metaKey: true });
    expect(onSelect).toHaveBeenCalledWith("a", "toggle");

    fireEvent.click(block, { shiftKey: true });
    expect(onSelect).toHaveBeenCalledWith("a", "extend");

    fireEvent.click(block);
    expect(onSelect).toHaveBeenCalledWith("a", "replace");
  });
});

/**
 * A site sheet with one viewport tier, which is what makes a canvas previewable.
 *
 * A preview compile rewrites every container-axis rule to a query that matches
 * nothing, so the canvas refuses to enter preview mode for a set with no
 * viewport tier to simulate — the price would buy nothing. A fixture without
 * one therefore exercises the published path however the preview props are set,
 * which is a fine thing to test and is NOT what the cases below are about.
 */
const PREVIEWABLE = {
  css: "",
  classes: {},
  breakpoints: {
    viewport: [{ id: "tablet", label: "Tablet", maxWidth: 991 }],
    container: [],
  },
} as never;

describe("the preview box the canvas establishes", () => {
  /** A canvas with nothing selected, so only the box props vary. */
  function boxed(props: Record<string, unknown>) {
    return render(
      <Canvas
        document={
          {
            formatVersion: 1,
            kind: "page",
            nodes: [{ id: "a", type: "acme/leaf", version: 1, props: {} }],
          } as never
        }
        siteStyles={PREVIEWABLE}
        {...props}
      />
    );
  }

  const root = (container: HTMLElement): HTMLElement => {
    const found = container.querySelector(`.${CANVAS_ROOT_CLASS}`);
    if (!(found instanceof HTMLElement)) throw new Error("no canvas root");
    return found;
  };

  it("carries the container NAME and TYPE together, or neither", () => {
    /*
     * Either alone does nothing and the failure is silent: a named container
     * left at the default `container-type: normal` is not a size-query
     * container, so every rule the preview compile emitted stays inactive while
     * the sheet is valid and the name matches. Resizing the box then changes
     * nothing, with no error anywhere to say why.
     */
    const { container } = boxed({
      preview: { container: "nx-preview-viewport" },
    });
    const style = root(container).style;

    expect(style.containerName).toBe("nx-preview-viewport");
    expect(style.containerType).toBe("inline-size");
  });

  it("establishes NO container when the compiler would refuse the name", () => {
    /*
     * The symmetry is load-bearing rather than tidy. A refused name makes the
     * compile PUBLISHED — viewport tiers emit `@media` and container tiers emit
     * UNNAMED `@container` rules — so a box that established a query container
     * anyway would let those unnamed rules resolve against IT. Viewport tiers
     * would then follow the window while container tiers followed the box: a
     * hybrid neither mode intends.
     */
    const { container } = boxed({ preview: { container: "none" } });
    const style = root(container).style;

    expect(style.containerName).toBe("");
    expect(style.containerType).toBe("");
  });

  it("constrains the box to a MAXIMUM, not a fixed width", () => {
    /*
     * The region can be narrower than the tier being asked for — a wide
     * breakpoint inside a half-width editor pane cannot be honoured. A fixed
     * width would push the page under the inspector rather than admitting the
     * request could not be met.
     */
    const { container } = boxed({
      preview: { container: "nx-preview-viewport", width: 991 },
    });
    const style = root(container).style;

    expect(style.maxWidth).toBe("991px");
    expect(style.width).toBe("");
    // Centred: an off-centre narrow box reads as a broken layout rather than as
    // a viewport being simulated.
    expect(style.marginInline).toBe("auto");
  });

  it("leaves the box UNCONSTRAINED when no width was asked for", () => {
    /*
     * The control. Without it, a canvas that always constrained would satisfy
     * the case above while making the widest tier narrower than its region —
     * the box would gain gutters on selecting the tier it was already showing.
     *
     * PREVIEWING, with no width. Not "no preview at all": those are different
     * states and only this one reaches the width decision. Asserted from an
     * absent preview instead, this case returns before the width is ever
     * consulted, and a canvas that constrained every previewing box would
     * satisfy it — the test would carry the name of a branch it no longer
     * enters.
     */
    const { container } = boxed({
      preview: { container: "nx-preview-viewport" },
    });
    const style = root(container).style;

    expect(style.maxWidth).toBe("");
    expect(style.marginInline).toBe("");
    // Previewing, though: the state under test is "no width", and a box that
    // established no container would satisfy the two assertions above by not
    // previewing at all.
    expect(style.containerName).toBe("nx-preview-viewport");
  });

  it("establishes NO box at all when the canvas is not previewing", () => {
    /*
     * Distinct from the case above, and the distinction is the whole contract:
     * a canvas rendering at the region's own width against a published sheet
     * must not establish a query container. One that did would let the
     * UNNAMED `@container` rules a published compile emits for container tiers
     * resolve against the canvas, so those would follow the box while viewport
     * tiers followed the window.
     */
    const { container } = boxed({});
    const style = root(container).style;

    expect(style.containerName).toBe("");
    expect(style.containerType).toBe("");
    expect(style.maxWidth).toBe("");
  });
});

describe("how far the canvas must shrink for a width to fit", () => {
  it("is the ratio when the region is too narrow", () => {
    // The measured case: ~912px of canvas on the supported 1280px shell.
    expect(canvasScale(1280, 912)).toBe(912 / 1280);
  });

  it("never MAGNIFIES a box the region can already hold", () => {
    /*
     * A region wider than the request means the box is simply narrower than
     * the space, which the auto margins centre. Scaled up it would show the
     * author a page larger than life, and every judgement they make from the
     * screen — type size, spacing, whether a line wraps — would be wrong in the
     * flattering direction.
     */
    expect(canvasScale(600, 912)).toBe(1);
    expect(canvasScale(912, 912)).toBe(1);
  });

  it("is the IDENTITY for anything it cannot divide", () => {
    /*
     * Each of these reaches the real code. The unmeasured region runs on every
     * mount before the first observation; a region of zero is what a collapsed
     * pane reports. Neither `NaN` nor `Infinity` fails loudly — both paint the
     * canvas nowhere while leaving it present in the tree, which reads as the
     * editor having lost the page rather than as a bad number.
     */
    expect(canvasScale(1280, undefined)).toBe(1);
    expect(canvasScale(undefined, 912)).toBe(1);
    expect(canvasScale(1280, 0)).toBe(1);
    expect(canvasScale(0, 912)).toBe(1);
    expect(canvasScale(1280, Number.NaN)).toBe(1);
  });
});

describe("what the canvas reports about the box it got", () => {
  /**
   * A `ResizeObserver` that records what it was asked to watch and hands the
   * test the callback, so a measurement can be delivered on demand.
   *
   * jsdom ships none at all, which is not merely an inconvenience: the canvas
   * guards on the global being CALLABLE and silently reports nothing when it is
   * not, so without a stub every assertion here would pass on absence.
   */
  class FakeResizeObserver {
    /**
     * Every observer built since the last reset, newest first.
     *
     * The canvas builds more than one — the box it reports on, and the region
     * it derives its scale from — so "the last one constructed" names whichever
     * effect happened to run second. Addressing them by WHAT THEY OBSERVE is
     * the structural question; construction order is a proxy that silently
     * re-points when an effect is added, and every case here would then drive
     * an observer watching a different element and assert against nothing.
     */
    static all: FakeResizeObserver[] = [];
    static last: FakeResizeObserver | undefined;
    readonly observed: Element[] = [];
    disconnected = false;
    constructor(readonly callback: ResizeObserverCallback) {
      FakeResizeObserver.all.unshift(this);
      FakeResizeObserver.last = this;
    }
    observe(element: Element): void {
      this.observed.push(element);
    }
    disconnect(): void {
      this.disconnected = true;
    }
    unobserve(): void {}
    /** Deliver one entry, as the browser would after a layout. */
    deliver(entry: Partial<ResizeObserverEntry>): void {
      this.callback([entry as ResizeObserverEntry], this as never);
    }
  }

  const original = globalThis.ResizeObserver;

  beforeAll(() => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver =
      FakeResizeObserver;
  });

  afterAll(() => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = original;
  });

  afterEach(() => {
    FakeResizeObserver.all = [];
    FakeResizeObserver.last = undefined;
  });

  /**
   * The observer watching the canvas ROOT, which is the box the sheet queries.
   *
   * Found by the element rather than taken as the newest, so a case reading the
   * reported width cannot be handed the region observer instead.
   */
  function rootObserver(): FakeResizeObserver | undefined {
    return FakeResizeObserver.all.find(observer =>
      observer.observed.some(element =>
        element.classList.contains(CANVAS_ROOT_CLASS)
      )
    );
  }

  /** The observer watching the REGION, which is the canvas root's parent. */
  function regionObserver(): FakeResizeObserver | undefined {
    return FakeResizeObserver.all.find(observer =>
      observer.observed.some(
        element => !element.classList.contains(CANVAS_ROOT_CLASS)
      )
    );
  }

  /**
   * Report a region width, and REFUSE if there is no observer to report it to.
   *
   * `regionObserver()?.deliver(...)` is silent when the observer was never
   * built: the width is never delivered, the canvas keeps its unmeasured style,
   * and a case asserting the unscaled shape passes for the wrong reason. The
   * assertion is what turns a missing observer into a failure.
   *
   * Wrapped in `act` because this one sets React state rather than calling a
   * host's reporter — without it the render that reads the new width has not
   * happened when the assertions run.
   */
  function region(inlineSize: number): void {
    const observer = regionObserver();
    expect(observer).toBeDefined();
    act(() => {
      observer?.deliver({
        contentBoxSize: [{ inlineSize, blockSize: 700 }],
      } as never);
    });
  }

  /** A canvas asked for `width`, so it has a region to scale against. */
  function atWidth(width: number, zoom?: CanvasZoom) {
    return render(
      <Canvas
        document={
          {
            formatVersion: 1,
            kind: "page",
            nodes: [{ id: "a", type: "acme/leaf", version: 1, props: {} }],
          } as never
        }
        siteStyles={PREVIEWABLE}
        preview={{ container: "nx-preview-viewport", width }}
        {...(zoom === undefined ? {} : { zoom })}
      />
    );
  }

  const rootOf = (container: HTMLElement): HTMLElement =>
    container.querySelector(`.${CANVAS_ROOT_CLASS}`) as HTMLElement;

  /**
   * The canvas's `zoom`, normalised to a string.
   *
   * jsdom does not implement `zoom` as a CSS property: React's assignment lands
   * as a plain own property, so `getPropertyValue("zoom")` answers `""` even
   * where it was set, while `style.zoom` is `undefined` where it was not. Read
   * either way alone, one of the two states below reports the other's value —
   * and the case that would break is the one asserting the canvas is NOT
   * scaled, which is satisfied by absence.
   */
  const zoomOf = (root: HTMLElement): string =>
    String((root.style as { zoom?: string }).zoom ?? "");

  describe("which ancestor the region is measured from", () => {
    /*
     * `parentElement` is the DOM parent and not necessarily the element the
     * canvas is laid out by. `display: contents` leaves a node in the tree
     * while generating no box, so its children are laid out by ITS parent — and
     * a `ResizeObserver` on one reports an inline size of zero. Measured in a
     * browser: a boxless wrapper inside a 911px container observes `0` while
     * the container observes `911`.
     *
     * The block context menu wraps the canvas in exactly such a node, and
     * deliberately: a `span` around a block box would change the layout it is
     * meant to be transparent over. So the canvas measured zero, `canvasScale`
     * took its identity branch, and the fit was `1` forever — an author who
     * pinned Tablet at 1024 edited at the region's own width with the control
     * still showing Tablet selected.
     */
    it("skips an ancestor that generates no box", () => {
      const wrapper = document.createElement("div");
      wrapper.style.display = "contents";
      const laidOutBy = document.createElement("div");
      laidOutBy.id = "laid-out-by";
      laidOutBy.append(wrapper);
      document.body.append(laidOutBy);

      render(
        <Canvas
          document={
            {
              formatVersion: 1,
              kind: "page",
              nodes: [{ id: "a", type: "acme/leaf", version: 1, props: {} }],
            } as never
          }
          siteStyles={PREVIEWABLE}
          preview={{ container: "nx-preview-viewport", width: 1024 }}
        />,
        { container: wrapper }
      );

      const watched = regionObserver()?.observed ?? [];
      // The element it measures is the one that HAS a box, not the DOM parent.
      expect(watched.map(element => (element as HTMLElement).id)).toContain(
        "laid-out-by"
      );
      expect(watched).not.toContain(wrapper);

      laidOutBy.remove();
    });

    it("measures the DOM parent when that parent has a box", () => {
      /*
       * The control. A walk that skipped every ancestor, or that returned the
       * document element, would satisfy the case above while measuring
       * something the canvas is not laid out by — and the fit would be computed
       * against the whole window rather than the pane the canvas sits in.
       */
      const parent = document.createElement("div");
      parent.id = "ordinary-parent";
      document.body.append(parent);

      render(
        <Canvas
          document={
            {
              formatVersion: 1,
              kind: "page",
              nodes: [{ id: "a", type: "acme/leaf", version: 1, props: {} }],
            } as never
          }
          siteStyles={PREVIEWABLE}
          preview={{ container: "nx-preview-viewport", width: 1024 }}
        />,
        { container: parent }
      );

      const watched = regionObserver()?.observed ?? [];
      expect(watched.map(element => (element as HTMLElement).id)).toContain(
        "ordinary-parent"
      );

      parent.remove();
    });
  });

  describe("a tier wider than the region it has to fit in", () => {
    it("takes its FULL width and is scaled down to the region", () => {
      /*
       * The regression this exists for. The canvas region is around 912px on
       * the supported 1280px shell, so against a site whose widest bound is
       * 1024 there is no width an author can ask for that puts the box above
       * it — every edit lands in the tier below, and the unconditional one
       * cannot be reached at all.
       *
       * The width must therefore be EXACT rather than a maximum. Capped at the
       * region the box is not simulating a 1280px viewport; it is simulating a
       * 912px one and naming the wrong tier with confidence.
       */
      const { container } = atWidth(1280);
      region(912);

      const root = rootOf(container);
      expect(root.style.width).toBe("1280px");
      /*
       * `zoom`, not a transform, and the difference is what the SCROLL
       * CONTAINER sees. Both leave the layout width alone — which is what keeps
       * the container queries at the requested tier — but a transform is
       * paint-time, so the canvas section goes on reserving the unscaled box:
       * measured at 368px of blank horizontal scroll in a 912px region, and
       * 161px vertical once the height is compensated to fill it. `zoom`
       * participates in layout, so the section reserves what is painted.
       */
      expect(zoomOf(root)).toBe(`${912 / 1280}`);
      expect(root.style.transform).toBe("");
    });

    it("draws a chosen scale at the tier that asks for no width", () => {
      /*
       * The widest tier requests nothing — the box IS the region — and that is
       * the state the editor opens in, so it is where a zoom control is used
       * most. Nothing has to be fitted there, and a chosen scale still has to
       * reach the box: the alternative is a control whose label moves while
       * the canvas stays at `zoom: 1`.
       */
      const { container } = render(
        <Canvas
          document={
            {
              formatVersion: 1,
              kind: "page",
              nodes: [{ id: "a", type: "acme/leaf", version: 1, props: {} }],
            } as never
          }
          siteStyles={PREVIEWABLE}
          preview={{ container: "nx-preview-viewport" }}
          zoom={{ kind: "fixed", scale: 1.5 }}
        />
      );

      const root = rootOf(container);
      expect(zoomOf(root)).toBe("1.5");
      /*
       * And the width is COMPENSATED, which is the point rather than an
       * incidental. `zoom` participates in layout and divides the logical width
       * the container queries resolve against, so a plain full width came out
       * at region/scale: at 200% a 911px region became 455px and the canvas
       * started previewing the MOBILE tier. Magnifying showed a different
       * layout instead of a larger one.
       *
       * Multiplying the percentage back restores the width the box had. No
       * measurement is involved, so nothing here has to observe a region that
       * the zoom is itself changing.
       */
      // Matched on the RATIO rather than the spelling: engines normalise the
      // expression differently — jsdom reports `calc(150%)` for what is
      // authored as `calc(100% * 1.5)` — and the ratio is the behaviour.
      expect(root.style.width.replace(/\s+/g, "")).toMatch(/(100%\*1\.5|150%)/);
    });

    it("leaves that tier alone while FITTING", () => {
      // The control on the other side. A rule that zoomed whenever there was no
      // requested width would scale the default view by whatever the fit
      // produced, which is the behaviour this replaces rather than repeats.
      const { container } = render(
        <Canvas
          document={
            {
              formatVersion: 1,
              kind: "page",
              nodes: [{ id: "a", type: "acme/leaf", version: 1, props: {} }],
            } as never
          }
          siteStyles={PREVIEWABLE}
          preview={{ container: "nx-preview-viewport" }}
        />
      );

      expect(zoomOf(rootOf(container))).toBe("");
    });

    it("draws a chosen scale on a site that previews no viewport at all", () => {
      /*
       * Previewing needs a container name AND a site declaring viewport tiers,
       * and the default configuration has neither — so there is no preview
       * object, which is the state most sites are in. Nesting the scale inside
       * that object left the control moving a number on screen and changing
       * nothing for exactly those sites.
       */
      const { container } = render(
        <Canvas
          document={
            {
              formatVersion: 1,
              kind: "page",
              nodes: [{ id: "a", type: "acme/leaf", version: 1, props: {} }],
            } as never
          }
          siteStyles={{ css: "", classes: {} } as never}
          zoom={{ kind: "fixed", scale: 1.5 }}
        />
      );

      expect(zoomOf(rootOf(container))).toBe("1.5");
    });

    it("refuses a scale it cannot paint at", () => {
      /*
       * `CanvasZoom` is exported, so a host can build one directly and never
       * pass through the storage guard. Interpolated into a `zoom` declaration
       * these produce either a rule the browser drops or a canvas beyond reach
       * of the control that would undo it, so the check belongs where a scale
       * is USED rather than only where one is parsed.
       */
      /*
       * WITH a preview, which is the path the validation is load-bearing on.
       * Without one the box style already declines to apply an unchosen scale,
       * so a no-preview fixture passes whether or not the scale was checked —
       * it cannot separate the two guards.
       */
      const previewing = atWidth(1280, { kind: "fixed", scale: Number.NaN });
      region(912);
      expect(zoomOf(rootOf(previewing.container))).not.toContain("NaN");
      previewing.unmount();

      for (const scale of [Number.NaN, Infinity, 0, 500]) {
        const { container, unmount } = render(
          <Canvas
            document={
              {
                formatVersion: 1,
                kind: "page",
                nodes: [{ id: "a", type: "acme/leaf", version: 1, props: {} }],
              } as never
            }
            siteStyles={{ css: "", classes: {} } as never}
            zoom={{ kind: "fixed", scale }}
          />
        );
        // Falls back to fitting, which paints nothing rather than painting a
        // value the browser cannot use.
        expect(zoomOf(rootOf(container))).toBe("");
        unmount();
      }
    });

    it("draws a CHOSEN scale where fitting would not have", () => {
      /*
       * The case the old shape could not express. A fit that needs no shrinking
       * is left unzoomed and centred, so every scale at or above 1 took the
       * `maxWidth` path — and no reading of `maxWidth` magnifies. Choosing 150%
       * has to reach `zoom`, or the control moves a number on screen and
       * nothing else.
       */
      const { container } = atWidth(600, { kind: "fixed", scale: 1.5 });
      region(912);

      const root = rootOf(container);
      expect(zoomOf(root)).toBe("1.5");
      // And NOT the fitting shape, which has no way to magnify.
      expect(root.style.maxWidth).toBe("");
    });

    it("holds a chosen scale when the region changes under it", () => {
      /*
       * Choosing a scale means it stops moving when the panels do. Re-deriving
       * it anyway is the defect this replaces: the canvas fell from 89% to
       * 59.5% because a panel opened, with nothing said and no way back.
       *
       * The region is moved to a width that WOULD have produced a different
       * fit, so a canvas still fitting reports something else here.
       */
      const { container } = atWidth(1280, { kind: "fixed", scale: 1 });
      region(912);

      const root = rootOf(container);
      expect(zoomOf(root)).toBe("1");
      expect(root.style.width).toBe("1280px");
    });

    it("leaves a tier that FITS unscaled and centred", () => {
      /*
       * The control, and it has to come out different or the case above says
       * only that the canvas sets styles. A request the region can honour is
       * not a simulation of anything and must stay pixel-exact: resampling it
       * would soften a page the author is judging type and spacing on.
       */
      const { container } = atWidth(600);
      region(912);

      const root = rootOf(container);
      expect(root.style.maxWidth).toBe("600px");
      expect(root.style.marginInline).toBe("auto");
      expect(zoomOf(root)).toBe("");
      expect(root.style.width).toBe("");
    });

    it("does not scale before the region has been measured", () => {
      /*
       * Every mount runs this before the first measurement. A scale derived
       * from an unmeasured region is `NaN`, which does not fail loudly — it
       * paints the canvas nowhere and leaves nothing to aim at, on a surface
       * that looks present in the tree.
       */
      const { container } = atWidth(1280);

      const root = rootOf(container);
      expect(zoomOf(root)).toBe("");
      expect(root.style.maxWidth).toBe("1280px");
    });

    it("observes NOTHING extra when no width was asked for", () => {
      // A canvas filling its region has no scale to derive, and an observer
      // that exists to answer a question nobody asked still fires on every
      // pane drag.
      render(
        <Canvas
          document={
            {
              formatVersion: 1,
              kind: "page",
              nodes: [{ id: "a", type: "acme/leaf", version: 1, props: {} }],
            } as never
          }
          siteStyles={PREVIEWABLE}
          preview={{ container: "nx-preview-viewport" }}
        />
      );

      expect(regionObserver()).toBeUndefined();
    });
  });

  /** A canvas previewing, with a reporter the test can read. */
  function measured(onMeasured: (width: number | undefined) => void) {
    return render(
      <Canvas
        document={
          {
            formatVersion: 1,
            kind: "page",
            nodes: [{ id: "a", type: "acme/leaf", version: 1, props: {} }],
          } as never
        }
        siteStyles={PREVIEWABLE}
        preview={{ container: "nx-preview-viewport", onMeasured }}
      />
    );
  }

  it("reports the box's CONTENT-box inline size", () => {
    /*
     * `contentBoxSize` rather than the bounding rect, because the editor
     * applies a canvas zoom and the rect is the TRANSFORMED size. A container
     * query asks the element's own layout size, so at any zoom but 100% the
     * visual number names a different tier than the one the browser is
     * applying — and the canvas would look right while the inspector wrote to
     * the wrong breakpoint.
     *
     * The two are given DIFFERENT values here deliberately: equal ones would
     * let an implementation reading either satisfy this.
     */
    const onMeasured = vi.fn();
    measured(onMeasured);

    FakeResizeObserver.last?.deliver({
      contentBoxSize: [{ inlineSize: 900, blockSize: 500 }],
      contentRect: { width: 450 } as DOMRectReadOnly,
    });

    expect(onMeasured).toHaveBeenCalledWith(900);
  });

  it("observes the canvas ROOT, which is the box the sheet queries", () => {
    /*
     * The element carrying the container name is the element the queries
     * resolve against. Observing anything else would report a width that
     * decides nothing — and would do it convincingly, since the number moves
     * whenever the editor is resized.
     */
    const onMeasured = vi.fn();
    const { container } = measured(onMeasured);

    expect(FakeResizeObserver.last?.observed).toEqual([
      container.querySelector(`.${CANVAS_ROOT_CLASS}`),
    ]);
  });

  it("falls back to contentRect when contentBoxSize is absent", () => {
    /*
     * Polyfills and older engines expose only `contentRect`. Read as an array
     * alone, they report `undefined` on every notification — and the caller
     * cannot tell that from "nothing measured yet", so the canvas applies a
     * narrower tier's rules while the inspector stays on base and the author's
     * edits land in a breakpoint they are not looking at.
     *
     * `contentRect` is a LAYOUT size like `contentBoxSize`, so the canvas zoom
     * does not scale it; it is a fallback, not a compromise.
     */
    const onMeasured = vi.fn();
    measured(onMeasured);

    FakeResizeObserver.last?.deliver({
      contentRect: { width: 880 } as DOMRectReadOnly,
    });

    expect(onMeasured).toHaveBeenCalledWith(880);
  });

  it("reads contentBoxSize when it is a single object rather than a sequence", () => {
    /*
     * The spec settled on a sequence; Firefox shipped a single object first and
     * that shape is still reachable. Indexing `[0]` on it yields `undefined`,
     * which is the same silent stall as having no size at all.
     */
    const onMeasured = vi.fn();
    measured(onMeasured);

    FakeResizeObserver.last?.deliver({
      contentBoxSize: { inlineSize: 640, blockSize: 480 } as never,
    });

    expect(onMeasured).toHaveBeenCalledWith(640);
  });

  it("says UNDEFINED rather than a number when the entry carries no size", () => {
    /*
     * An entry without `contentBoxSize` is a real answer from older engines,
     * and `undefined` is what the caller must be told: it means nothing has
     * been observed, which is the state where a caller must not name a tier.
     * Reporting 0 instead would put the box in the narrowest tier the site
     * defines.
     */
    const onMeasured = vi.fn();
    measured(onMeasured);

    FakeResizeObserver.last?.deliver({ contentBoxSize: [] });

    expect(onMeasured).toHaveBeenCalledWith(undefined);
  });

  it("stops observing when the canvas goes away", () => {
    /*
     * The observer outlives the element otherwise, and reports into a caller
     * whose surface has been unmounted.
     */
    const { unmount } = measured(vi.fn());
    const observer = FakeResizeObserver.last;

    unmount();

    expect(observer?.disconnected).toBe(true);
  });

  it("reports UNDEFINED when the canvas goes away", () => {
    /*
     * The box is gone, so the last width it reported describes nothing.
     *
     * The editor unmounts this canvas whenever the site's stored styles stop
     * being readable, which a cached query can do on a refocus long after the
     * first measurement. Left standing, the caller keeps deriving a tier from a
     * width no element has — so the inspector writes into that tier with no
     * preview box on screen and the control that sets it disabled.
     */
    const onMeasured = vi.fn();
    const { unmount } = measured(onMeasured);
    FakeResizeObserver.last?.deliver({
      contentBoxSize: [{ inlineSize: 900, blockSize: 500 }],
    });
    expect(onMeasured).toHaveBeenLastCalledWith(900);

    unmount();

    expect(onMeasured).toHaveBeenLastCalledWith(undefined);
  });

  it("compiles the sheet against the container the BOX establishes", () => {
    /*
     * Registered here, because this describe does not otherwise need blocks and
     * an UNregistered type renders as a placeholder whose styles never compile
     * — which would leave this asserting against an empty sheet and passing on
     * the `not.toContain` half alone.
     */
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
      { source: "canvas-coupling-test" }
    );
    /*
     * The two are one fact with two places to say it, and a caller saying it
     * twice can say it differently. A box establishing `a` while the sheet was
     * compiled against `b` observes and constrains a query container whose
     * rules nothing wrote: the window decides what is rendered, the measured
     * width decides what is reported, and nothing anywhere reads as wrong.
     *
     * Asserted against the EMITTED SHEET rather than against the props the
     * canvas passed on, because the sheet is the artifact that either names
     * this box or does not — comparing the canvas's own inputs to its own
     * output would be two readings of one value.
     *
     * The host is given a DIFFERENT name deliberately, so this fails on a
     * version that defaults rather than overwrites.
     */
    const { container } = render(
      <Canvas
        document={
          {
            formatVersion: 1,
            kind: "page",
            nodes: [
              {
                id: "a",
                type: "acme/leaf",
                version: 1,
                props: {},
                styles: { base: { tablet: { color: "#f00" } } },
              },
            ],
          } as never
        }
        siteStyles={{ css: "", classes: {} } as never}
        preview={{ container: "nx-preview-box" }}
        render={{
          styleContext: {
            breakpoints: {
              viewport: [{ id: "tablet", label: "Tablet", maxWidth: 991 }],
              container: [],
            },
            previewContainer: "nx-preview-somewhere-else",
          },
        }}
      />
    );

    // `forEach` rather than spreading: a `NodeList` is only iterable under a
    // lib this package does not compile with, which `canvas.tsx` records for
    // the same reason. The suite transpiles without type checking, so the
    // spread ran green here and failed only under `tsc`.
    const sheets: string[] = [];
    container.querySelectorAll("style").forEach(node => {
      sheets.push(node.textContent ?? "");
    });
    const sheet = sheets.join("\n");

    expect(sheet).toContain("@container nx-preview-box");
    expect(sheet).not.toContain("nx-preview-somewhere-else");
    // And the element the queries resolve against is the same one.
    const box = container.querySelector(`.${CANVAS_ROOT_CLASS}`);
    expect((box as HTMLElement | null)?.style.containerName).toBe(
      "nx-preview-box"
    );
    clearBlocks();
  });

  it("compiles the SITE sheet against the box as well as the page's", () => {
    /*
     * Two tiers emit breakpoint rules, not one: the page's node styles and the
     * site's named classes. Bound on only the page tier, a class's tablet rule
     * stays an `@media` answered by the WINDOW while the node's tablet rule
     * became a `@container` answered by the box — so narrowing the canvas moves
     * one and not the other, and a block styled by a class does not respond at
     * all.
     *
     * Driven through `siteStyles` with NO `render.styleContext`, which is the
     * stored-artifact path a host can legitimately use, and the branch the page
     * tier's coupling skips.
     */
    const { container } = render(
      <Canvas
        document={
          {
            formatVersion: 1,
            kind: "page",
            nodes: [{ id: "a", type: "acme/leaf", version: 1, props: {} }],
          } as never
        }
        siteStyles={
          {
            breakpoints: {
              viewport: [{ id: "tablet", label: "Tablet", maxWidth: 991 }],
              container: [],
            },
            classes: [
              {
                id: "c1",
                slug: "card",
                styles: { base: { tablet: { color: "#f00" } } },
              },
            ],
          } as never
        }
        preview={{ container: "nx-preview-box" }}
      />
    );

    const sheets: string[] = [];
    container.querySelectorAll("style").forEach(node => {
      sheets.push(node.textContent ?? "");
    });
    const sheet = sheets.join("\n");

    expect(sheet).toContain("@container nx-preview-box");
    // The published form must NOT survive beside it: a sheet carrying both
    // would answer the same tier from two different boxes.
    expect(sheet).not.toContain("@media (max-width: 991px)");
  });

  it("leaves the SITE sheet alone when the canvas is not previewing", () => {
    /*
     * The control. Without it, a canvas that rewrote the site sheet
     * unconditionally would satisfy the case above while turning every
     * published canvas into a preview one.
     */
    const { container } = render(
      <Canvas
        document={
          {
            formatVersion: 1,
            kind: "page",
            nodes: [{ id: "a", type: "acme/leaf", version: 1, props: {} }],
          } as never
        }
        siteStyles={
          {
            breakpoints: {
              viewport: [{ id: "tablet", label: "Tablet", maxWidth: 991 }],
              container: [],
            },
            classes: [
              {
                id: "c1",
                slug: "card",
                styles: { base: { tablet: { color: "#f00" } } },
              },
            ],
          } as never
        }
      />
    );

    const sheets: string[] = [];
    container.querySelectorAll("style").forEach(node => {
      sheets.push(node.textContent ?? "");
    });
    const sheet = sheets.join("\n");

    expect(sheet).toContain("@media (max-width: 991px)");
    expect(sheet).not.toContain("@container");
  });

  it("neither constrains nor measures when the NAME is refused", () => {
    /*
     * `previewContainerStyle` turns down a reserved name, so no query container
     * exists and the sheet falls back to published `@media`. A box that went on
     * narrowing and measuring itself would then resize without changing a
     * single tier — and a caller deriving an edit target from the measurement
     * would write to a breakpoint the canvas is not displaying.
     *
     * A refused name is therefore not a preview at all, for the width and the
     * measurement as much as for the container.
     */
    const onMeasured = vi.fn();
    const { container } = render(
      <Canvas
        document={
          {
            formatVersion: 1,
            kind: "page",
            nodes: [{ id: "a", type: "acme/leaf", version: 1, props: {} }],
          } as never
        }
        siteStyles={PREVIEWABLE}
        preview={{ container: "none", width: 991, onMeasured }}
      />
    );

    const style = (
      container.querySelector(`.${CANVAS_ROOT_CLASS}`) as HTMLElement | null
    )?.style;
    expect(style?.containerName).toBe("");
    expect(style?.maxWidth).toBe("");
    expect(FakeResizeObserver.last).toBeUndefined();
  });

  it("does not report a removal when the CALLBACK identity changes", () => {
    /*
     * A host writing `onMeasured={w => setWidth(w)}` inline hands a new
     * function every render. If the observer effect depended on it, each real
     * measurement would update the parent, produce a new identity, tear the
     * observer down — reporting `undefined` as if the canvas had gone — and
     * rebuild it, so the derived tier oscillates and the churn can sustain a
     * render loop, on a host that did nothing wrong.
     *
     * Asserted as "never called with undefined while mounted" rather than on a
     * call count, because the count is allowed to grow: what must not happen is
     * the false removal.
     */
    const onMeasured = vi.fn();
    const view = measured(onMeasured);
    FakeResizeObserver.last?.deliver({
      contentBoxSize: [{ inlineSize: 900, blockSize: 500 }],
    });

    // A re-render with a BRAND NEW callback identity, which is what an inline
    // arrow produces.
    React.act(() => {
      view.rerender(
        <Canvas
          document={
            {
              formatVersion: 1,
              kind: "page",
              nodes: [{ id: "a", type: "acme/leaf", version: 1, props: {} }],
            } as never
          }
          siteStyles={PREVIEWABLE}
          preview={{
            container: "nx-preview-viewport",
            onMeasured: (width: number | undefined) => onMeasured(width),
          }}
        />
      );
    });

    expect(onMeasured).not.toHaveBeenCalledWith(undefined);
  });

  it("tells the CURRENT reporter about the removal, not the one it started with", () => {
    /*
     * The effect deliberately does not re-run when the callback identity
     * changes, so the reporter captured when the observer was built can be
     * stale by the time the canvas goes away. Notifying that one leaves the
     * host that is actually listening holding the last real width, deriving a
     * tier from a box that no longer exists — the same stale-measurement bug
     * the removal notice was added to prevent, arrived at one layer down.
     */
    const first = vi.fn();
    const second = vi.fn();
    const tree = (report: (width: number | undefined) => void) => (
      <Canvas
        document={
          {
            formatVersion: 1,
            kind: "page",
            nodes: [{ id: "a", type: "acme/leaf", version: 1, props: {} }],
          } as never
        }
        siteStyles={PREVIEWABLE}
        preview={{ container: "nx-preview-viewport", onMeasured: report }}
      />
    );

    const view = render(tree(first));
    React.act(() => {
      view.rerender(tree(second));
    });
    view.unmount();

    expect(second).toHaveBeenCalledWith(undefined);
    expect(first).not.toHaveBeenCalledWith(undefined);
  });

  it("does not preview when there is nowhere to BIND the container", () => {
    /*
     * A preview has exactly two binding sites: the page tier's style context
     * and the site tier's sheet. `siteStyles={false}` opts out of the shared
     * sheet and no `styleContext` is the stored-artifact path — so nothing is
     * compiled against this box, its viewport rules stay `@media` and follow
     * the window, and a box that established a container and reported its width
     * anyway would have a caller deriving edits for a tier the canvas is not
     * displaying.
     *
     * The name here is perfectly VALID, which is what separates this from the
     * refused-name case: the failure is having nowhere to put it.
     */
    const onMeasured = vi.fn();
    const { container } = render(
      <Canvas
        document={
          {
            formatVersion: 1,
            kind: "page",
            nodes: [{ id: "a", type: "acme/leaf", version: 1, props: {} }],
          } as never
        }
        siteStyles={false as never}
        preview={{
          container: "nx-preview-viewport",
          width: 991,
          onMeasured,
        }}
      />
    );

    const style = (
      container.querySelector(`.${CANVAS_ROOT_CLASS}`) as HTMLElement | null
    )?.style;
    expect(style?.containerName).toBe("");
    expect(style?.maxWidth).toBe("");
    expect(FakeResizeObserver.last).toBeUndefined();
  });

  it("stays PUBLISHED for a set with no viewport tier to simulate", () => {
    /*
     * A preview compile rewrites every container-axis rule to
     * `@container nx-not-previewable (width < 0px)`, which matches nothing.
     * With viewport tiers to gain that is a fair trade; with none it costs a
     * container-only site every breakpoint it has on the canvas while they keep
     * working on the published page.
     *
     * Decided HERE rather than at one mount, so every consumer of this API gets
     * it. The container name is valid and the sheet is bindable — the only
     * thing missing is anything to simulate.
     */
    const onMeasured = vi.fn();
    const { container } = render(
      <Canvas
        document={
          {
            formatVersion: 1,
            kind: "page",
            nodes: [{ id: "a", type: "acme/leaf", version: 1, props: {} }],
          } as never
        }
        siteStyles={
          {
            css: "",
            classes: {},
            breakpoints: {
              viewport: [],
              container: [{ id: "narrow", label: "Narrow", maxWidth: 400 }],
            },
          } as never
        }
        preview={{ container: "nx-preview-viewport", width: 991, onMeasured }}
      />
    );

    const style = (
      container.querySelector(`.${CANVAS_ROOT_CLASS}`) as HTMLElement | null
    )?.style;
    expect(style?.containerName).toBe("");
    expect(style?.maxWidth).toBe("");
    expect(FakeResizeObserver.last).toBeUndefined();
  });

  it("decides from the SITE's breakpoints, which are the ones that compile", () => {
    /*
     * `sharedStyleInputs` resolves `breakpoints` as
     * `firstStated(stored.breakpoints, route.breakpoints)` — the site tier
     * wins, "because stored overrides code, which is the layering every
     * global-styles system uses".
     *
     * Read the other way round, a route context carrying viewport tiers beside
     * a container-only stored set turns preview ON, and the compile that
     * actually runs then disables every container-axis rule as
     * `nx-not-previewable` with no viewport tier to show for it — the exact
     * loss the eligibility rule exists to prevent, caused by deciding it from
     * inputs the renderer does not use.
     *
     * The two sets DISAGREE here deliberately: equal ones could not tell which
     * was consulted.
     */
    const onMeasured = vi.fn();
    const { container } = render(
      <Canvas
        document={
          {
            formatVersion: 1,
            kind: "page",
            nodes: [{ id: "a", type: "acme/leaf", version: 1, props: {} }],
          } as never
        }
        siteStyles={
          {
            css: "",
            classes: {},
            breakpoints: {
              viewport: [],
              container: [{ id: "narrow", label: "Narrow", maxWidth: 400 }],
            },
          } as never
        }
        render={
          {
            styleContext: {
              breakpoints: {
                viewport: [{ id: "tablet", label: "Tablet", maxWidth: 991 }],
                container: [],
              },
            },
          } as never
        }
        preview={{ container: "nx-preview-viewport", width: 991, onMeasured }}
      />
    );

    const style = (
      container.querySelector(`.${CANVAS_ROOT_CLASS}`) as HTMLElement | null
    )?.style;
    expect(style?.containerName).toBe("");
    expect(FakeResizeObserver.last).toBeUndefined();
  });

  it("treats a stated NULL breakpoint set as the site having none", () => {
    /*
     * `firstStated` is `find(tier => tier !== undefined)`, so a stored `null` —
     * which runtime or imported data can supply — is KEPT by the renderer and
     * read as defining no viewport tiers. Nullish coalescing falls through to
     * the route set instead, turning preview on for a canvas the renderer left
     * on the unconditional tier: the box then measures and selects a route tier
     * that is not on screen.
     *
     * The route set carries a viewport tier deliberately, so the two readings
     * give opposite answers.
     */
    const onMeasured = vi.fn();
    const { container } = render(
      <Canvas
        document={
          {
            formatVersion: 1,
            kind: "page",
            nodes: [{ id: "a", type: "acme/leaf", version: 1, props: {} }],
          } as never
        }
        siteStyles={{ css: "", classes: {}, breakpoints: null } as never}
        render={
          {
            styleContext: {
              breakpoints: {
                viewport: [{ id: "tablet", label: "Tablet", maxWidth: 991 }],
                container: [],
              },
            },
          } as never
        }
        preview={{ container: "nx-preview-viewport", width: 991, onMeasured }}
      />
    );

    const style = (
      container.querySelector(`.${CANVAS_ROOT_CLASS}`) as HTMLElement | null
    )?.style;
    expect(style?.containerName).toBe("");
    expect(FakeResizeObserver.last).toBeUndefined();
  });

  it("does not re-render the page when only the box WIDTH changes", () => {
    /*
     * The width changes on every switcher selection and alters no emitted rule,
     * but rebuilding the compile inputs rebuilds the rendered page — which
     * re-runs `PageRenderer` and recompiles the document and site sheet
     * synchronously. On a large document that is a whole compile per width
     * change, and continuous resizing pays it per frame.
     *
     * Counted at a BLOCK's own render function, which is the only thing here
     * that runs if and only if the page re-rendered. Asserting on DOM identity
     * would not do it: React reuses the element across a re-render, so the node
     * is the same whether the page was rebuilt or not — measured, that version
     * of this case passed against the defect.
     */
    let drawn = 0;
    clearBlocks();
    registerBlocks(
      [
        {
          name: "acme/counted",
          version: 1,
          description: "A block that reports being drawn.",
          example: { props: {} },
          render: ({ className }: { className: string }) => {
            drawn += 1;
            return createElement("div", { className });
          },
        },
      ] as never,
      { source: "canvas-memo-test" }
    );

    /*
     * ONE document object across both renders. The rendered page is memoised on
     * the document's identity, so a fresh literal per render rebuilds it for a
     * reason that has nothing to do with the width — measured, that version of
     * this fixture reported the defect while the code was correct.
     */
    const doc = {
      formatVersion: 1,
      kind: "page",
      nodes: [{ id: "a", type: "acme/counted", version: 1, props: {} }],
    } as never;
    const tree = (width: number | undefined) => (
      <Canvas
        document={doc}
        siteStyles={PREVIEWABLE}
        preview={{
          container: "nx-preview-viewport",
          ...(width === undefined ? {} : { width }),
        }}
      />
    );
    const view = render(tree(undefined));
    const before = drawn;
    expect(before).toBeGreaterThan(0);

    React.act(() => {
      view.rerender(tree(640));
    });

    expect(drawn).toBe(before);
    // And the width really did change, or this proves nothing.
    expect(
      (view.container.querySelector(`.${CANVAS_ROOT_CLASS}`) as HTMLElement)
        .style.maxWidth
    ).toBe("640px");
    clearBlocks();
  });

  it("observes NOTHING when no reporter was given", () => {
    /*
     * The control. Without it, an implementation that observed unconditionally
     * would satisfy every case above while costing a `ResizeObserver` to every
     * canvas that is not previewing.
     */
    render(
      <Canvas
        document={
          {
            formatVersion: 1,
            kind: "page",
            nodes: [{ id: "a", type: "acme/leaf", version: 1, props: {} }],
          } as never
        }
        siteStyles={PREVIEWABLE}
        preview={{ container: "nx-preview-viewport" }}
      />
    );

    expect(FakeResizeObserver.last).toBeUndefined();
  });
});

describe("reporting the scale to a host that keeps changing its mind", () => {
  /**
   * The document every case here draws, which is beside the point in all of
   * them: what varies is the reporter, not what is under it.
   */
  const DOCUMENT = {
    formatVersion: 1,
    kind: "page",
    nodes: [{ id: "a", type: "acme/leaf", version: 1, props: {} }],
  } as never;

  it("does not report again when only the reporter's IDENTITY changed", () => {
    /*
     * The conventional host writes the reporter inline, so every render of it
     * hands the canvas a new function. Depended on directly, each report would
     * update the host, the update would produce a new identity, and the new
     * identity would report again — a render loop on a host that did nothing
     * wrong. Two renders with the same scale must produce ONE report.
     */
    const reports: number[] = [];
    const view = render(
      <Canvas
        document={DOCUMENT}
        siteStyles={PREVIEWABLE}
        zoom={{ kind: "fixed", scale: 1.5 }}
        onScale={scale => reports.push(scale)}
      />
    );

    expect(reports).toEqual([1.5]);

    view.rerender(
      <Canvas
        document={DOCUMENT}
        siteStyles={PREVIEWABLE}
        zoom={{ kind: "fixed", scale: 1.5 }}
        onScale={scale => reports.push(scale)}
      />
    );

    expect(reports).toEqual([1.5]);
  });

  it("reports the CURRENT scale to a reporter that arrives late", () => {
    /*
     * A host can resolve its reporter from its own state, so the prop moves
     * from `undefined` to a function after the canvas has already settled on a
     * scale. Keyed on the scale alone the effect would not re-run at that
     * moment, and the host would hold its initial guess until the author
     * happened to pick a different zoom.
     *
     * The scale is deliberately NOT 1 here: a reporter told `1` cannot be
     * distinguished from one told the default, so the case would pass against
     * an implementation that reports nothing and a host that assumed.
     */
    const reports: number[] = [];
    const view = render(
      <Canvas
        document={DOCUMENT}
        siteStyles={PREVIEWABLE}
        zoom={{ kind: "fixed", scale: 1.5 }}
      />
    );

    view.rerender(
      <Canvas
        document={DOCUMENT}
        siteStyles={PREVIEWABLE}
        zoom={{ kind: "fixed", scale: 1.5 }}
        onScale={scale => reports.push(scale)}
      />
    );

    expect(reports).toEqual([1.5]);
  });

  it("reports each scale the canvas actually takes", () => {
    // The control for both cases above: an implementation that never reported
    // after the first render would satisfy the identity case, and one that
    // reported on every render would satisfy the arrival case.
    const reports: number[] = [];
    const onScale = (scale: number) => reports.push(scale);
    const view = render(
      <Canvas
        document={DOCUMENT}
        siteStyles={PREVIEWABLE}
        zoom={{ kind: "fixed", scale: 1.5 }}
        onScale={onScale}
      />
    );

    view.rerender(
      <Canvas
        document={DOCUMENT}
        siteStyles={PREVIEWABLE}
        zoom={{ kind: "fixed", scale: 0.75 }}
        onScale={onScale}
      />
    );

    expect(reports).toEqual([1.5, 0.75]);
  });
});

describe("forcing the interaction state the panel is editing", () => {
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
      { source: "canvas-state-test" }
    );
  });
  afterAll(clearBlocks);

  function renderCanvas(selectedId: string | null, forcedState?: StyleState) {
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
        {...(forcedState === undefined ? {} : { forcedState })}
      />
    );
  }

  const elementFor = (id: string) =>
    document.querySelector(`[${NODE_ID_ATTRIBUTE}="${id}"]`);

  it("marks the PRIMARY selection and nothing else", () => {
    // Forcing it page-wide would show every other block in a state nobody
    // asked about, so the second node is the separating half of this case.
    renderCanvas("a", "hover");

    expect(elementFor("a")?.className).toContain(previewStateClass("hover"));
    expect(elementFor("b")?.className).not.toContain(
      previewStateClass("hover")
    );
  });

  it("marks the rendered PAGE ROOT, which is what page rules select", () => {
    /*
     * `:hover` matches an element and every ANCESTOR of it — measured in a
     * browser, a pointer over a leaf puts the leaf, its parent and the root in
     * the chain. The page tier compiles onto `.nx-pb-page`, so a preview that
     * marked only the selected node would drop exactly the tiers a real pointer
     * triggers: a page-level hover colour would vanish in the simulation and
     * appear for the visitor.
     *
     * The element asserted is the RENDERED page root, not the canvas wrapper.
     * `PageRenderer` draws `.nx-pb-page` as a child of the wrapper and the
     * selector names that child — an earlier version of this case asserted the
     * wrapper, passed, and exercised nothing the compiler actually targets.
     */
    const view = renderCanvas("a", "hover");
    const pageRoot = view.container.querySelector(`.${PAGE_ROOT_CLASS}`);
    expect(pageRoot).not.toBeNull();
    expect((pageRoot as Element).className).toContain(
      previewStateClass("hover")
    );
  });

  it("does NOT mark ancestors for focus, which does not propagate", () => {
    /*
     * The three states disagree, and the difference is measurable:
     *
     *   :hover          an ancestor of the pointed element matches   YES
     *   :active         an ancestor of the pressed element matches   YES
     *   :focus-visible  an ancestor of the focused element matches   NO
     *
     * The last is `:focus-within`, a different selector the compiler does not
     * emit. Marking the chain for focus puts an enclosing block's focus styles
     * on screen for an appearance no visitor ever sees.
     */
    const view = renderCanvas("a", "focus");
    const pageRoot = view.container.querySelector(`.${PAGE_ROOT_CLASS}`);
    expect(pageRoot).not.toBeNull();
    expect((pageRoot as Element).className).not.toContain(
      previewStateClass("focus")
    );
    // The selected element itself still carries it — the control that separates
    // "focus does not propagate" from "focus does nothing".
    expect(elementFor("a")?.className).toContain(previewStateClass("focus"));
  });

  it("leaves the page root unmarked when nothing is being forced", () => {
    // The control: a root marked unconditionally would put every page-level
    // hover rule on screen permanently, which is worse than not previewing at
    // all — the author would be reading an appearance no visitor ever sees.
    const view = renderCanvas("a");
    const root = view.container.querySelector(`.${PAGE_ROOT_CLASS}`);
    for (const state of STYLE_STATES) {
      expect((root as Element).className).not.toContain(
        previewStateClass(state)
      );
    }
  });

  it("clears the previous state when the panel moves to another one", () => {
    // hover -> focus. A marker left behind would have the canvas showing two
    // states at once, and the author would be reading an appearance that
    // cannot occur.
    const view = renderCanvas("a", "hover");
    expect(elementFor("a")?.className).toContain(previewStateClass("hover"));

    view.rerender(
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
        selectedId="a"
        forcedState="focus"
      />
    );

    expect(elementFor("a")?.className).toContain(previewStateClass("focus"));
    expect(elementFor("a")?.className).not.toContain(
      previewStateClass("hover")
    );
  });

  it("does not touch the class of an element whose marking is unchanged", () => {
    /*
     * `classList.remove` of a token that is NOT present still touches the
     * attribute, and this canvas is observed: the empty-container appender
     * watches the subtree for layout-relevant mutations and re-measures on one.
     * An unconditional clear across every marked element made a selection
     * change schedule a re-measure of the whole overlay — caught by that
     * appender's own case, which asserts its control does not move for a
     * mutation of its own output, and it moved.
     *
     * The WRITE is what this observes, because the write is the defect. Two
     * earlier versions of this case watched for mutation records instead — one
     * on the primary alone, one on the whole subtree — and both passed the
     * break: the records never reached them, so each reported a guard it did
     * not have.
     *
     * `c` is the separating node: never selected, so its marking does not
     * change when the selection moves from `a` to `b`, and nothing should be
     * written to it at all.
     */
    const nodes = ["a", "b", "c"].map(id => ({
      id,
      type: "acme/leaf",
      version: 1,
      props: {},
    }));
    const canvas = (selectedId: string) => (
      <Canvas
        document={{ formatVersion: 1, kind: "page", nodes } as never}
        siteStyles={{ css: "", classes: {} } as never}
        selectedId={selectedId}
        forcedState="hover"
      />
    );

    const view = render(canvas("a"));
    const bystander = elementFor("c");
    expect(bystander).not.toBeNull();
    const remove = vi.spyOn((bystander as Element).classList, "remove");
    const add = vi.spyOn((bystander as Element).classList, "add");

    act(() => {
      view.rerender(canvas("b"));
    });

    expect(remove).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();

    // The other half: an element that KEEPS its marker must not have it
    // written again. `c` cannot show this — it never wants one — so the
    // now-selected `b` carries the case.
    const kept = elementFor("b");
    const keptAdd = vi.spyOn((kept as Element).classList, "add");
    act(() => {
      view.rerender(canvas("b"));
    });
    expect(keptAdd).not.toHaveBeenCalled();
  });

  it("forces nothing for `base`, or when the host states no state", () => {
    // `base` is what applies when no state does, and the compiler emits no
    // marker for it — so a canvas that marked it would be putting on a class
    // no selector contains.
    renderCanvas("a", "base");
    for (const state of STYLE_STATES) {
      expect(elementFor("a")?.className).not.toContain(
        previewStateClass(state)
      );
    }
    cleanup();

    renderCanvas("a");
    for (const state of STYLE_STATES) {
      expect(elementFor("a")?.className).not.toContain(
        previewStateClass(state)
      );
    }
  });
});
