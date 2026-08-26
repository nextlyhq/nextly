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
        siteStyles={{ css: "", classes: {} } as never}
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
    static last: FakeResizeObserver | undefined;
    readonly observed: Element[] = [];
    disconnected = false;
    constructor(readonly callback: ResizeObserverCallback) {
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
    FakeResizeObserver.last = undefined;
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
        siteStyles={{ css: "", classes: {} } as never}
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
        siteStyles={{ css: "", classes: {} } as never}
        preview={{ container: "nx-preview-viewport" }}
      />
    );

    expect(FakeResizeObserver.last).toBeUndefined();
  });
});
