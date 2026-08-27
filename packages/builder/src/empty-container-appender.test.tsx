// @vitest-environment jsdom

/**
 * The affordance drawn over a container with nothing in it.
 *
 * jsdom lays nothing out, so an element MEASURED here reports a zero-sized
 * rectangle and a position assertion taken from one would pass against any
 * implementation. That is a limit on measurement and nothing else, and this
 * file draws the line in the two places it actually falls:
 *
 * - `centeredControlRect` is arithmetic over two rectangles with no DOM in it,
 *   and is asserted directly.
 * - the cases that need a rendered canvas STUB each element's rectangle first
 *   — the same thing `canvas-drag.test.tsx` does — and then drive the resize
 *   the component already subscribes to, so what is measured is a real
 *   rectangle rather than jsdom's zero.
 *
 * The cases that assert only which controls EXIST mount no canvas at all, and
 * deliberately: which containers get a control comes from the document alone.
 *
 * `fireEvent` rather than `@testing-library/user-event`: this package does not
 * depend on that library and no other suite here does either, and the control
 * under test responds to a plain `onClick`, so one synthetic click exercises it
 * exactly as a full pointer-event sequence would.
 *
 * No jest-dom matcher is used, for the same reason `inspector-panel.test.tsx`
 * gives: this package does not register jest-dom, so a matcher like
 * `toBeEmptyDOMElement` is not available and every assertion below reaches for
 * a plain vitest one instead.
 */
import {
  clearBlocks,
  hasBlock,
  registerBlocks,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import {
  NODE_ID_ATTRIBUTE,
  type BlockRenderArgs,
  type SiteSheetInput,
} from "@nextlyhq/blocks-react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CANVAS_ROOT_CLASS, Canvas } from "./canvas";
import {
  centeredControlRect,
  EmptyContainerAppenders,
} from "./empty-container-appender";
import { registrySlotSource } from "./inserter";

// This suite queries by role against the whole document (`screen`), so a tree
// left mounted by one test is still there for the next `getByRole` to trip
// over — matching why `block-toolbar.test.tsx` and `spacing-overlay.test.tsx`
// both call this between cases.
afterEach(() => {
  cleanup();
  clearBlocks();
  vi.unstubAllGlobals();
});

// Two container TYPES, not just two nodes of one type — `core/card` exists so
// the cardinality tests below can name each control by a distinct accessible
// name rather than by an assumption about array or DOM order.
const slots = {
  slotsOf: (type: string) =>
    type === "core/box" || type === "core/card"
      ? (["children"] as const)
      : undefined,
};

// No cast: `LabelledBlock` asks for nothing beyond `editor?.label`, so this
// honest, minimal fixture satisfies `BlockLookup` on its own.
const blocks = {
  get: (type: string) => {
    if (type === "core/box") return { editor: { label: "Box" } };
    if (type === "core/card") return { editor: { label: "Card" } };
    return undefined;
  },
};

function doc(nodes: BlockDocument["nodes"]): BlockDocument {
  return { formatVersion: 1, kind: "page", nodes };
}

/**
 * The site sheet `Canvas` requires, declared rather than cast past the checker.
 *
 * `SiteSheetInput` requires `breakpoints` and has no `css` field at all, so the
 * `{ css: "", classes: {} }` shape this file used to hand `Canvas` was not a
 * site sheet under any reading — the cast was hiding a wrong value, not a
 * verbose one. Both axes are empty because nothing here previews a tier: a
 * canvas with no viewport breakpoint renders through the published path, which
 * is the path every case below is about.
 */
const SITE_STYLES: SiteSheetInput = {
  breakpoints: { viewport: [], container: [] },
};

const emptyBox = { id: "box-1", type: "core/box", version: 1, props: {} };
const filledBox = {
  id: "box-2",
  type: "core/box",
  version: 1,
  props: {},
  slots: {
    children: [{ id: "h", type: "core/heading", version: 1, props: {} }],
  },
};

describe("the empty-container appender", () => {
  it("offers one control per empty container, naming the block", () => {
    render(
      <EmptyContainerAppenders
        document={doc([emptyBox])}
        slots={slots}
        blocks={blocks}
        onAppend={() => undefined}
      />
    );
    expect(screen.getByRole("button", { name: /Box/ })).toBeTruthy();
  });

  it("offers nothing for a container that already has a child", () => {
    render(
      <EmptyContainerAppenders
        document={doc([filledBox])}
        slots={slots}
        blocks={blocks}
        onAppend={() => undefined}
      />
    );
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("reports the container's id when pressed", () => {
    const onAppend = vi.fn();
    render(
      <EmptyContainerAppenders
        document={doc([emptyBox])}
        slots={slots}
        blocks={blocks}
        onAppend={onAppend}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /Box/ }));
    expect(onAppend).toHaveBeenCalledWith("box-1");
  });

  it("marks itself as chrome so a press does not clear the selection", () => {
    const { container } = render(
      <EmptyContainerAppenders
        document={doc([emptyBox])}
        slots={slots}
        blocks={blocks}
        onAppend={() => undefined}
      />
    );
    expect(container.querySelector("[data-nx-chrome]")).not.toBeNull();
  });

  it("renders nothing at all while hidden", () => {
    // Matching `BlockToolbar`: a control that is merely invisible would still
    // take a press, and a mid-drag press here would run an insert against a
    // container that is about to be somewhere else.
    const { container } = render(
      <EmptyContainerAppenders
        document={doc([emptyBox])}
        slots={slots}
        blocks={blocks}
        onAppend={() => undefined}
        hidden
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("gives two sibling empty containers their own control, reporting its own id", () => {
    // Cardinality, not just presence: a filled container sits BETWEEN the two
    // empty ones, so an implementation that stopped at the first match would
    // still show a control here — just one short of the right count. Asserting
    // the count alone would also pass an implementation offering two controls
    // for the SAME node, which is why each press is checked against its own id
    // below rather than trusting the count on its own.
    const emptyCard = {
      id: "card-1",
      type: "core/card",
      version: 1,
      props: {},
    };
    const onAppend = vi.fn();
    render(
      <EmptyContainerAppenders
        document={doc([emptyBox, filledBox, emptyCard])}
        slots={slots}
        blocks={blocks}
        onAppend={onAppend}
      />
    );

    expect(screen.getAllByRole("button")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: /Box/ }));
    expect(onAppend).toHaveBeenLastCalledWith("box-1");
    fireEvent.click(screen.getByRole("button", { name: /Card/ }));
    expect(onAppend).toHaveBeenLastCalledWith("card-1");
  });

  it("finds a container nested inside another container's populated slot", () => {
    // The specific claim `emptyContainersIn`'s use of `walkNodes` is for: it
    // descends into every slot of every node regardless of whether that node
    // itself offers a control, so a still-empty container sitting AFTER a
    // filled sibling, inside another container's own slot, is still found.
    const nestedEmptyCard = {
      id: "card-2",
      type: "core/card",
      version: 1,
      props: {},
    };
    const outerBoxWithPopulatedSlot = {
      id: "box-3",
      type: "core/box",
      version: 1,
      props: {},
      slots: {
        children: [
          { id: "h2", type: "core/heading", version: 1, props: {} },
          nestedEmptyCard,
        ],
      },
    };
    const onAppend = vi.fn();
    render(
      <EmptyContainerAppenders
        document={doc([outerBoxWithPopulatedSlot])}
        slots={slots}
        blocks={blocks}
        onAppend={onAppend}
      />
    );

    // The outer box already has children, so IT offers nothing; only the
    // nested card, which has none of its own, does — one control, not zero.
    expect(screen.getAllByRole("button")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /Card/ }));
    expect(onAppend).toHaveBeenCalledWith("card-2");
  });
});

describe("the accessible name it announces", () => {
  it("prefers the author's own instance name over the block's label", () => {
    // Two containers of the SAME type, one the author has named. A label
    // taken from the type alone would give both the identical name, which is
    // exactly what makes them impossible to tell apart by ear.
    const namedBox = {
      id: "box-named",
      type: "core/box",
      version: 1,
      props: {},
      name: "Header slot",
    };
    render(
      <EmptyContainerAppenders
        document={doc([namedBox, emptyBox])}
        slots={slots}
        blocks={blocks}
        onAppend={() => undefined}
      />
    );

    expect(
      screen.getByRole("button", { name: "Add a block to Header slot" })
    ).toBeTruthy();
    // The un-named sibling still falls back to the block's own label, proving
    // the precedence runs one way: a name wins when given, and its absence
    // does not disturb the existing fallback.
    expect(
      screen.getByRole("button", { name: "Add a block to Box" })
    ).toBeTruthy();
  });

  it("ignores a name of only whitespace, the same way the Layers panel does", () => {
    // `authoredName` trims and treats a blank result as absent; a control
    // announcing "Add a block to    " would be no name at all.
    const blankName = {
      id: "box-blank",
      type: "core/box",
      version: 1,
      props: {},
      name: "   ",
    };
    render(
      <EmptyContainerAppenders
        document={doc([blankName])}
        slots={slots}
        blocks={blocks}
        onAppend={() => undefined}
      />
    );

    expect(
      screen.getByRole("button", { name: "Add a block to Box" })
    ).toBeTruthy();
  });
});

/**
 * A stand-in for `ResizeObserver`, which jsdom does not implement.
 *
 * Mirrors `spacing-overlay.test.tsx`'s own fake for the same reason: these
 * tests assert the SUBSCRIPTION rather than the redraw, since jsdom never
 * reflows and so can never produce the resize the real observer would report.
 */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  readonly observed: Element[] = [];
  disconnected = false;
  private readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }
  observe(target: Element): void {
    this.observed.push(target);
  }
  unobserve(): void {}
  disconnect(): void {
    this.disconnected = true;
  }
  /**
   * Report a resize, which is the only way to make the component measure a
   * canvas whose rectangles were stubbed AFTER it mounted.
   *
   * No entries: the component's own callback ignores them and re-measures
   * everything, which is what a caller here wants to happen.
   */
  fire(): void {
    this.callback([], this);
  }
}

function withFakeResizeObserver() {
  FakeResizeObserver.instances = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
}

describe("what it stays subscribed to", () => {
  /**
   * A real container and a real leaf, registered so `Canvas` renders an
   * actual tree with `NODE_ID_ATTRIBUTE` markers this suite's own `doc`/
   * `blocks` fixtures never produce — the bare-render tests above assert this
   * component's OWN behaviour and deliberately mount no canvas at all, but
   * "which elements a resize is watched on" is a question only a rendered
   * canvas root can answer.
   */
  function registerCanvasBlocks() {
    if (hasBlock("acme/empty-container-appender-box")) return;
    registerBlocks(
      [
        {
          name: "acme/empty-container-appender-box",
          version: 1,
          description: "A container with one slot.",
          example: { props: {} },
          slots: { children: {} },
          // Annotated with the renderer's OWN argument type rather than cast:
          // the engine types `renderSlot` as returning `unknown`, since it
          // carries no React types, and `@nextlyhq/blocks-react` is the package
          // that names the React answer. Every first-party block is written
          // against exactly this type.
          render: ({ className, renderSlot }: BlockRenderArgs<object>) =>
            React.createElement("div", { className }, renderSlot("children")),
        },
        {
          name: "acme/empty-container-appender-leaf",
          version: 1,
          description: "A leaf with nothing to fill.",
          example: { props: {} },
          render: () => React.createElement("p", null, "leaf"),
        },
      ],
      { source: "empty-container-appender-test" }
    );
  }

  const CANVAS_DOCUMENT: BlockDocument = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "empty-container",
        type: "acme/empty-container-appender-box",
        version: 1,
        props: {},
      },
      {
        id: "sibling-leaf",
        type: "acme/empty-container-appender-leaf",
        version: 1,
        props: {},
      },
    ],
  };

  it("watches EVERY rendered node, not only the container it draws a control for", () => {
    // The separating property for this fix: a populated sibling resizing —
    // an image finishing its load — moves nothing this component drew a
    // control for and nothing the canvas root itself reports, so an observer
    // scoped to only the empty containers never fires. `sibling-leaf` is
    // never empty and gets no button, and it must still be observed.
    registerCanvasBlocks();
    withFakeResizeObserver();

    const { container } = render(
      <Canvas
        document={CANVAS_DOCUMENT}
        siteStyles={SITE_STYLES}
        overlay={
          <EmptyContainerAppenders
            document={CANVAS_DOCUMENT}
            slots={registrySlotSource()}
            // The accessible name is not what this test asks about; a lookup
            // that resolves nothing still exercises which nodes get a
            // control, since that decision comes from `slots` alone.
            blocks={{ get: () => undefined }}
            onAppend={() => undefined}
          />
        }
      />
    );

    const observer = FakeResizeObserver.instances.at(-1);
    expect(observer?.observed).toContain(
      container.querySelector(`[${NODE_ID_ATTRIBUTE}="empty-container"]`)
    );
    expect(observer?.observed).toContain(
      container.querySelector(`[${NODE_ID_ATTRIBUTE}="sibling-leaf"]`)
    );
    expect(observer?.observed).toContain(
      container.querySelector(`.${CANVAS_ROOT_CLASS}`)
    );
  });
});

describe("the rectangle the control is drawn at", () => {
  /*
   * Asserted directly, because `centeredControlRect` is arithmetic over two
   * rectangles with no DOM in it. The suite header's reason for not asserting
   * geometry — jsdom lays nothing out — is about MEASURING an element, and it
   * does not reach a pure function that is handed a rectangle.
   */
  it("centres the control in a container larger than it", () => {
    expect(
      centeredControlRect({ x: 10, y: 20, width: 200, height: 100 }, 44)
    ).toEqual({ x: 88, y: 48, width: 44, height: 44 });
  });

  it("never grows taller than the container it sits in", () => {
    // A container shorter than the control. Unclamped, the height stays 44 and
    // the top is (19 - 44) / 2 = -12.5 ABOVE the container — over whatever is
    // laid out before it, which is where a press meant for that neighbour then
    // lands.
    const container = { x: 0, y: 200, width: 400, height: 19 };
    const control = centeredControlRect(container, 44);

    // Full 44 on the axis with room for it: the clamp is per axis, so a short
    // container loses no width.
    expect(control).toEqual({ x: 178, y: 200, width: 44, height: 19 });
    expect(control.y).toBeGreaterThanOrEqual(container.y);
    expect(control.y + control.height).toBeLessThanOrEqual(
      container.y + container.height
    );
  });

  it("never grows wider than the container it sits in", () => {
    // The axis with no guarantee behind it: `[data-nx-slots]:empty` sets a
    // `min-height` and no `min-width`, so a narrow empty column is a perfectly
    // ordinary container that is narrower than the control.
    const container = { x: 100, y: 0, width: 20, height: 300 };
    const control = centeredControlRect(container, 44);

    expect(control).toEqual({ x: 100, y: 128, width: 20, height: 44 });
    expect(control.x).toBeGreaterThanOrEqual(container.x);
    expect(control.x + control.width).toBeLessThanOrEqual(
      container.x + container.width
    );
  });
});

/**
 * A container whose ROOT carries content of its own beside its slot.
 *
 * The shape `core/accordion-item` has: a `<details>` holding a `<summary>` and
 * the slot's output, so an instance with an empty `children` slot renders a
 * root that is NOT `:empty` and measures the summary's own height. That is the
 * separating property between the two questions this component used to ask
 * separately — the document says the slot is empty, the render says the
 * element carries no affordance.
 */
const DETAILS_CONTAINER = "acme/empty-container-appender-details";

/** The canvas root's own rectangle, and the one every wrapper reports. */
const CANVAS_BOX = { x: 0, y: 0, width: 800, height: 600 };

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Give a rendered canvas the rectangles jsdom never lays out.
 *
 * Every element reports the canvas's own box first, so no wrapper between a
 * node and the root reads as clipping it — jsdom's computed `overflow` is the
 * empty string rather than `visible`, so an ancestor left unstubbed would
 * report a zero-sized clip rectangle and cut every node inside it. The named
 * nodes are then overridden with the boxes the case is about.
 */
function layout(container: HTMLElement, boxes: Record<string, Box>): void {
  const root = container.querySelector<HTMLElement>(`.${CANVAS_ROOT_CLASS}`);
  if (root === null) throw new Error("no canvas root rendered");
  const stub = (element: Element, box: Box): void => {
    element.getBoundingClientRect = () =>
      new DOMRect(box.x, box.y, box.width, box.height);
  };
  stub(root, CANVAS_BOX);
  // `forEach` rather than `for...of`: this package's `lib` predicates
  // `NodeListOf` having an iterator on a DOM iterable declaration it does not
  // include, so the loop form does not compile here.
  root.querySelectorAll("*").forEach(element => stub(element, CANVAS_BOX));
  for (const [id, box] of Object.entries(boxes)) {
    const element = root.querySelector(`[${NODE_ID_ATTRIBUTE}="${id}"]`);
    if (element === null) throw new Error(`no element for ${id}`);
    stub(element, box);
  }
}

/** The inline rectangle a control was drawn at, in the order left/top/w/h. */
function drawnAt(name: string): [string, string, string, string] {
  const button = screen.getByRole("button", { name: `Add a block to ${name}` });
  if (!(button instanceof HTMLElement)) throw new Error(`${name}: no element`);
  return [
    button.style.left,
    button.style.top,
    button.style.width,
    button.style.height,
  ];
}

describe("which containers it actually draws a control on", () => {
  function registerShapes() {
    if (hasBlock(DETAILS_CONTAINER)) return;
    registerBlocks(
      [
        {
          name: "acme/empty-container-appender-box",
          version: 1,
          description: "A container whose root holds nothing but its slot.",
          example: { props: {} },
          slots: { children: {} },
          render: ({ className, renderSlot }: BlockRenderArgs<object>) =>
            React.createElement("div", { className }, renderSlot("children")),
        },
        {
          name: DETAILS_CONTAINER,
          version: 1,
          description: "A container whose root also renders a summary.",
          example: { props: {} },
          slots: { children: {} },
          render: ({ className, renderSlot }: BlockRenderArgs<object>) =>
            React.createElement(
              "details",
              { className },
              React.createElement("summary", null, "Section"),
              renderSlot("children")
            ),
        },
      ],
      { source: "empty-container-appender-shapes" }
    );
  }

  const SHAPES: BlockDocument = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "wide",
        type: "acme/empty-container-appender-box",
        version: 1,
        props: {},
        name: "Wide box",
      },
      {
        id: "narrow",
        type: "acme/empty-container-appender-box",
        version: 1,
        props: {},
        name: "Narrow column",
      },
      {
        id: "summary-bearing",
        type: DETAILS_CONTAINER,
        version: 1,
        props: {},
        name: "Closed section",
      },
    ],
  };

  /**
   * A container nested inside another, so that the walk between a node's root
   * and the canvas root has an ancestor to ask about.
   *
   * Every node in {@link SHAPES} is a direct child of the canvas root, and
   * `clippedByAncestorRect` stops strictly BELOW the root — so no arrangement
   * of those three rectangles can reach the clip refusal at all. `clipper`
   * holds a child, so it is not an empty container itself and offers no
   * control of its own.
   */
  const NESTED: BlockDocument = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "wide",
        type: "acme/empty-container-appender-box",
        version: 1,
        props: {},
        name: "Wide box",
      },
      {
        id: "clipper",
        type: "acme/empty-container-appender-box",
        version: 1,
        props: {},
        name: "Clipping wrapper",
        slots: {
          children: [
            {
              id: "clipped",
              type: "acme/empty-container-appender-box",
              version: 1,
              props: {},
              name: "Clipped box",
            },
          ],
        },
      },
    ],
  };

  /**
   * A document the overlay knows about and the canvas has not rendered.
   *
   * `ghost` is a perfectly ordinary empty container that no element in the DOM
   * carries the id of, which is the state every container is in for the frame
   * before the canvas mounts. The measurement pass finds no element for it and
   * records nothing — leaving it UNMEASURED rather than declined.
   */
  const SHAPES_PLUS_UNRENDERED: BlockDocument = {
    ...SHAPES,
    nodes: [
      ...SHAPES.nodes,
      {
        id: "ghost",
        type: "acme/empty-container-appender-box",
        version: 1,
        props: {},
        name: "Ghost box",
      },
    ],
  };

  /**
   * Mount the canvas, give it a layout, and let the component re-measure.
   *
   * The stubs cannot be in place before mount — the elements do not exist yet
   * — so the resize the component already subscribes to is what drives the
   * second measurement, exactly as a breakpoint or a webfont swap would.
   *
   * `overlayDocument` defaults to the canvas's own, which is the ordinary
   * case; a caller passes a different one to model a container the document
   * holds and the render does not.
   */
  function measuredCanvas(
    canvasDocument: BlockDocument,
    boxes: Record<string, Box>,
    overlayDocument: BlockDocument = canvasDocument
  ): void {
    registerShapes();
    withFakeResizeObserver();

    const { container } = render(
      <Canvas
        document={canvasDocument}
        siteStyles={SITE_STYLES}
        overlay={
          <EmptyContainerAppenders
            document={overlayDocument}
            slots={registrySlotSource()}
            blocks={{ get: () => undefined }}
            onAppend={() => undefined}
          />
        }
      />
    );

    layout(container, boxes);
    const observer = FakeResizeObserver.instances.at(-1);
    if (observer === undefined) throw new Error("no observer subscribed");
    act(() => observer.fire());
  }

  it("draws NO control on a container whose root the stylesheet declines", () => {
    /*
     * `builder-chrome.css` gives its 44px box to `[data-nx-slots]:empty`, and
     * a closed `<details>` is not `:empty` — it holds its summary. So there is
     * no box under this container, its rectangle is the summary's own 19px,
     * and a 44px control centred in it would start 12.5px ABOVE the container
     * and paint over the node laid out before it.
     *
     * The wide box is the positive control, in the same render and measured in
     * the same pass. Without it the absence below is satisfied by a component
     * that rendered nothing at all; with it, the query is known to find a
     * button here, so finding none for the details container is a statement
     * about THAT container.
     */
    measuredCanvas(SHAPES, {
      wide: { x: 0, y: 0, width: 400, height: 200 },
      "summary-bearing": { x: 0, y: 400, width: 400, height: 19 },
    });

    expect(drawnAt("Wide box")).toEqual(["178px", "78px", "44px", "44px"]);
    expect(
      screen.queryByRole("button", { name: "Add a block to Closed section" })
    ).toBeNull();
  });

  it("draws NO control on a container an authored ancestor clips", () => {
    /*
     * The second permanent refusal, which has to be covered on its own: the
     * two guards are separate branches, and a fix applied to one leaves the
     * other returning whatever it returned before.
     *
     * `layout` gives every unnamed element the canvas's own 800x600 box, so
     * the wrapper reports that and the nested container is stubbed a thousand
     * pixels below it — outside the wrapper's rectangle on both vertical
     * edges, which is a straight-edge cut no corner refinement is involved in.
     * Same positive control as above, for the same reason.
     */
    measuredCanvas(NESTED, {
      wide: { x: 0, y: 0, width: 400, height: 200 },
      clipped: { x: 0, y: 1000, width: 400, height: 200 },
    });

    expect(drawnAt("Wide box")).toEqual(["178px", "78px", "44px", "44px"]);
    expect(
      screen.queryByRole("button", { name: "Add a block to Clipped box" })
    ).toBeNull();
  });

  it("tells a DECLINED container apart from one no pass has reached", () => {
    /*
     * The separating property between the two states, in one render: `ghost`
     * is UNMEASURED — in the overlay's document, in no element's id — and
     * `summary-bearing` is DECLINED. They must come out differently.
     *
     * A single representation for both gives them the SAME outcome whichever
     * way it is spelled: hide the unmeasured one and neither button exists;
     * draw the declined one at the zero rectangle and both do. Only two
     * distinct states pass this pair of assertions.
     */
    measuredCanvas(
      SHAPES,
      {
        wide: { x: 0, y: 0, width: 400, height: 200 },
        "summary-bearing": { x: 0, y: 400, width: 400, height: 19 },
      },
      SHAPES_PLUS_UNRENDERED
    );

    expect(drawnAt("Ghost box")).toEqual(["0px", "0px", "0px", "0px"]);
    expect(
      screen.queryByRole("button", { name: "Add a block to Closed section" })
    ).toBeNull();
  });

  it("keeps the control inside a container narrower than it", () => {
    /*
     * A legitimately narrow empty container: `[data-nx-slots]:empty` promises
     * a `min-height` and no `min-width`, so this one really is 20px wide and
     * really does carry the dashed box. Unclamped, a 44px control centred in
     * it starts at x = -12 and reaches 12px past its right edge, over both
     * neighbours.
     */
    measuredCanvas(SHAPES, {
      wide: { x: 0, y: 0, width: 400, height: 200 },
      narrow: { x: 0, y: 200, width: 20, height: 200 },
    });

    expect(drawnAt("Wide box")).toEqual(["178px", "78px", "44px", "44px"]);
    expect(drawnAt("Narrow column")).toEqual(["0px", "278px", "20px", "44px"]);
  });
});

describe("a container no measurement pass has reached", () => {
  it("renders its control anyway, at the zero rectangle", () => {
    /*
     * The property the module docblock's UNMEASURED state exists for, said
     * outright rather than left to emerge from the bare-mount cases above.
     * There is no canvas root here, so `measure` records nothing about any
     * container — and the control is still in the accessibility tree, where a
     * screen reader can reach it, because a control that has not been placed
     * yet is not a control that has been refused.
     */
    render(
      <EmptyContainerAppenders
        document={doc([emptyBox])}
        slots={slots}
        blocks={blocks}
        onAppend={() => undefined}
      />
    );

    expect(drawnAt("Box")).toEqual(["0px", "0px", "0px", "0px"]);
  });
});
