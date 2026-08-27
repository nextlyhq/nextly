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
 *   rectangle rather than jsdom's zero. Whether an element generates a box at
 *   all is stubbed there too and separately, since jsdom reports none for
 *   every element — see `layout` and `laidOut`.
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
  SLOTS_ATTRIBUTE,
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
import { EMPTY_CONTAINER_SELECTOR } from "./empty-slot";
import { BUILDER_CHROME_CLASS } from "./shell-state";
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
  // `withCheckVisibility` writes to a prototype rather than to a global, which
  // `vi.unstubAllGlobals` does not reach — and leaving it installed would make
  // its own absence assertion fail for the next case that asks for it.
  Reflect.deleteProperty(Element.prototype, "checkVisibility");
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

/**
 * The `<details>` rendering that decides whether a descendant is skipped.
 *
 * `Element.checkVisibility` is absent from jsdom, and so is the box an engine
 * generates for a closed disclosure's contents — `getComputedStyle` refuses a
 * pseudo-element argument outright — so neither the method nor the state it
 * reports can be reached here without being supplied.
 *
 * This is the RULE the method applies, taken from the CSSOM View algorithm and
 * driven entirely by the fixture's own DOM: walking outwards, a descendant is
 * skipped when it passes through an ancestor with `content-visibility: hidden`,
 * or through a closed `<details>` by any route other than its `<summary>` —
 * which is rendered while the disclosure is closed and is the reason a check
 * for a closed-`<details>` ANCESTOR is not the same question. `node` is always
 * the child the walk entered `parent` through, which is what distinguishes
 * those two routes.
 *
 * Only the ancestor step is modelled. The algorithm's first step — an element
 * with no box at all — is answered by {@link laidOut}, which `layout` already
 * applies to the same elements' fragment counts and which `measure` asks about
 * through `layoutFragments` BEFORE it reaches this question at all.
 *
 * `=== "hidden"` rather than a list of the values that do not skip: an element
 * no rule reaches computes to the empty string here, so an allow-list would
 * report every ordinary container as skipped.
 */
function skipsContents(element: Element): boolean {
  for (
    let node: Element = element;
    node.parentElement !== null;
    node = node.parentElement
  ) {
    const parent = node.parentElement;
    if (getComputedStyle(parent).contentVisibility === "hidden") return true;
    if (
      parent instanceof HTMLDetailsElement &&
      !parent.open &&
      node.tagName !== "SUMMARY"
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Give this document the `checkVisibility` jsdom does not implement.
 *
 * Asserted absent rather than assumed so, because the assertion is what keeps
 * this a stand-in: a jsdom that gained its own implementation would have this
 * silently shadow it, and every case below would then be exercising this
 * function instead of one the fixture could have driven for real.
 *
 * Installed on the prototype rather than on the elements a case names, so the
 * component reaches it through the ordinary call on whichever element it
 * measures — the same reason `layout` stubs every element in the canvas rather
 * than the ones a case is about.
 */
function withCheckVisibility(): void {
  expect(
    Object.getOwnPropertyDescriptor(Element.prototype, "checkVisibility")
  ).toBeUndefined();
  Element.prototype.checkVisibility = function (this: Element): boolean {
    return !skipsContents(this);
  };
}

/** The canvas root's own rectangle, and the one every wrapper reports. */
const CANVAS_BOX = { x: 0, y: 0, width: 800, height: 600 };

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The nth canvas root inside a render, throwing rather than answering `null`.
 *
 * Indexed because one case mounts TWO canvases in a single render to compare
 * them; every other caller takes the only one there is. A missing root is a
 * broken fixture rather than a result, so it raises instead of letting a later
 * query report an absence that means nothing.
 */
function canvasRootIn(container: HTMLElement, which = 0): HTMLElement {
  const roots = container.querySelectorAll<HTMLElement>(
    `.${CANVAS_ROOT_CLASS}`
  );
  const root = roots[which];
  if (root === undefined) throw new Error(`no canvas root at index ${which}`);
  return root;
}

/**
 * Whether the render lays a box out for this element at all.
 *
 * jsdom performs no layout, so `getClientRects` answers with nothing for every
 * element and the component's no-box refusal would decline every container in
 * this file. What jsdom DOES resolve is the cascade: a `display` stored on a
 * node compiles into the page's own `<style>` and reaches `getComputedStyle`,
 * so the fixture's own value is what decides the answer here rather than a
 * per-case flag.
 *
 * The rule applied is the one measured in Chromium: an element inside a
 * subtree whose root computes `display: none` generates no box, and neither
 * does that root. So the walk climbs, and it climbs past the canvas root
 * because a hidden ancestor anywhere above has the same effect.
 */
function laidOut(element: Element): boolean {
  for (
    let node: Element | null = element;
    node !== null;
    node = node.parentElement
  ) {
    if (getComputedStyle(node).display === "none") return false;
  }
  return true;
}

/**
 * The layout boxes an element generates, in the shape `getClientRects`
 * returns them.
 *
 * An array carrying `item` rather than a cast: `DOMRectList` is a numeric
 * index, a `length` and that method, and an array already supplies the first
 * two — so the composed value satisfies the interface as it stands.
 */
function rectsOf(rects: readonly DOMRect[]): DOMRectList {
  const list = [...rects];
  return Object.assign(list, {
    item: (index: number): DOMRect | null => list[index] ?? null,
  });
}

/**
 * Give a rendered canvas the rectangles jsdom never lays out.
 *
 * Every element reports the canvas's own box first, so no wrapper between a
 * node and the root reads as clipping it — jsdom's computed `overflow` is the
 * empty string rather than `visible`, so an ancestor left unstubbed would
 * report a zero-sized clip rectangle and cut every node inside it. The named
 * nodes are then overridden with the boxes the case is about.
 *
 * The FRAGMENT count is stubbed beside the rectangle, and separately from it:
 * an element that generates a box reports exactly one whatever rectangle it
 * was given, and an element inside a hidden subtree reports none however large
 * a rectangle it was given. Keeping the two apart is what lets a case assert
 * that a container is refused for generating no box rather than for measuring
 * nothing.
 */
function layout(
  container: HTMLElement,
  boxes: Record<string, Box>,
  which = 0
): void {
  const root = canvasRootIn(container, which);
  const stub = (element: Element, box: Box): void => {
    element.getBoundingClientRect = () =>
      new DOMRect(box.x, box.y, box.width, box.height);
    element.getClientRects = () =>
      rectsOf(
        laidOut(element)
          ? [new DOMRect(box.x, box.y, box.width, box.height)]
          : []
      );
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

/**
 * Let queued mutation records reach the observer that asked for them.
 *
 * `MutationObserver` delivers its records in a microtask rather than at the
 * moment of the write, so an assertion taken straight after a DOM change runs
 * before the callback has been entered at all — which reads exactly like a
 * subscription that never fired. A macrotask turn drains the microtask queue,
 * so waiting one is enough for delivery however many turns it takes.
 */
async function flushObservers(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
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
          // `open` comes from the node's own props, exactly as
          // `core/accordion-item` takes it, so one registered block covers
          // both states of a disclosure rather than a second block that
          // differs from this one by an attribute. A node that stores no
          // `open` renders closed, which is that block's own default.
          render: ({
            props,
            className,
            renderSlot,
          }: BlockRenderArgs<{ open?: boolean }>) =>
            React.createElement(
              "details",
              { className, open: props.open === true },
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
   * An empty container inside a wrapper the author has hidden.
   *
   * `display` is a catalog keyword, so `none` is a value an author stores, and
   * the wrapper is where it can still take effect: it holds a child, so it is
   * not `:empty` and `builder-chrome.css`'s rule — which outranks the compiled
   * per-node one — never reaches it. The container inside is untouched by that
   * choice as far as every other question goes. It renders, it carries the
   * slots marker, it is `:empty`, its own `display` computes to whatever the
   * page gives it, it is `static`, and no ancestor clips it. It simply has no
   * box.
   */
  const NESTED_IN_HIDDEN: BlockDocument = {
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
        id: "hidden-wrapper",
        type: "acme/empty-container-appender-box",
        version: 1,
        props: {},
        name: "Hidden wrapper",
        styles: { base: { base: { display: "none" } } },
        slots: {
          children: [
            {
              id: "inside-hidden",
              type: "acme/empty-container-appender-box",
              version: 1,
              props: {},
              name: "Box in a hidden wrapper",
            },
          ],
        },
      },
    ],
  };

  /**
   * The same empty container inside a CLOSED disclosure and inside an OPEN one.
   *
   * The shape an author reaches by selecting a `core/accordion-item` in the
   * Layers panel and inserting a `core/box`: the section's `children` slot
   * carries no restriction, so any container may sit in it, and the section's
   * own defaults leave it closed. Neither `<details>` is an empty container
   * itself — each holds the box — so the two controls under test are the boxes'
   * own.
   *
   * The pair is the test. An engine that skips a closed disclosure's contents
   * still reports a full-size rectangle for the box inside one, positioned as
   * though the section were open, so every question `measure` asks before the
   * skip accepts it. Asserting only that the closed one draws nothing would be
   * satisfied by a component that drew nothing anywhere, and asserting it
   * WITHOUT the open one would be satisfied by a refusal that declined every
   * container inside any `<details>` at all.
   */
  const DISCLOSED: BlockDocument = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "closed-section",
        type: DETAILS_CONTAINER,
        version: 1,
        props: {},
        name: "Closed section",
        slots: {
          children: [
            {
              id: "in-closed",
              type: "acme/empty-container-appender-box",
              version: 1,
              props: {},
              name: "Box in a closed section",
            },
          ],
        },
      },
      {
        id: "open-section",
        type: DETAILS_CONTAINER,
        version: 1,
        props: { open: true },
        name: "Open section",
        slots: {
          children: [
            {
              id: "in-open",
              type: "acme/empty-container-appender-box",
              version: 1,
              props: {},
              name: "Box in an open section",
            },
          ],
        },
      },
    ],
  };

  /** The rendered `<details>` a node id addresses, for asking its state. */
  function disclosureIn(container: HTMLElement, id: string): HTMLElement {
    const element = canvasRootIn(container).querySelector<HTMLElement>(
      `[${NODE_ID_ATTRIBUTE}="${id}"]`
    );
    if (element === null) throw new Error(`no element for ${id}`);
    return element;
  }

  /**
   * A document the overlay knows about and the canvas does not render.
   *
   * `ghost` is a perfectly ordinary empty container that no element in the DOM
   * carries the id of — the state a node `PageRenderer` drops stays in for as
   * long as it is dropped, whether for a `visibility.conditions` gate or for
   * props that make it draw nothing. A pass with a canvas root under it has
   * searched that root and found nothing, so the refusal is a decision rather
   * than a wait.
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
   *
   * Returns the rendered container, for a case that has to re-stub a
   * rectangle and drive a second measurement of its own.
   *
   * Mounted inside a shell root, because that is the composition the affordance
   * exists in: `builder-chrome.css` scopes its box to `.nx-builder-chrome`, so a
   * canvas with no shell around it is drawn no box and gets no control. A plain
   * element carrying the class rather than `BuilderShell` itself — the class is
   * the whole of what the selector asks for, and mounting the real shell would
   * bring a rail, panels and a resize-driven layout into a file about which
   * rectangles are measured.
   */
  function measuredCanvas(
    canvasDocument: BlockDocument,
    boxes: Record<string, Box>,
    overlayDocument: BlockDocument = canvasDocument
  ): HTMLElement {
    registerShapes();
    withFakeResizeObserver();

    const { container } = render(
      <div className={BUILDER_CHROME_CLASS}>
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
      </div>
    );

    layout(container, boxes);
    const observer = FakeResizeObserver.instances.at(-1);
    if (observer === undefined) throw new Error("no observer subscribed");
    act(() => observer.fire());
    return container;
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

  it("draws NO control on a canvas with no builder shell around it", () => {
    /*
     * The third ancestor condition of the stylesheet's rule, and the only one
     * nothing else answers. `EmptyContainerAppenders` and `Canvas` are both
     * exported, so a host can compose them with no shell at all — the product
     * path does not, since `BlocksField` mounts the canvas inside
     * `BuilderShell`, but nothing prevents it. `builder-chrome.css` scopes its
     * 44px box to `.nx-builder-chrome`, so in that composition the container
     * keeps its natural size of nothing and a control drawn on the element-level
     * match alone is a zero-area button: focusable, announced by name, and
     * invisible.
     *
     * TWO canvases in one render, because an absence assertion on its own is
     * satisfied by a component that drew nothing anywhere. The shelled one holds
     * the identical container type and IS drawn, in the same render and the same
     * measurement pass, so the query is known to find a button here.
     *
     * The bare container is additionally checked to satisfy the element-level
     * half of the rule — it exists, it carries the slots marker, it is `:empty`
     * — so what is being read below is the ancestor condition refusing rather
     * than a node that never rendered.
     */
    registerShapes();
    withFakeResizeObserver();

    const container = (id: string, name: string): BlockDocument => ({
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id,
          type: "acme/empty-container-appender-box",
          version: 1,
          props: {},
          name,
        },
      ],
    });
    const shelled = container("shelled", "Shelled box");
    const bare = container("bare", "Bare box");
    const appenders = (document: BlockDocument) => (
      <EmptyContainerAppenders
        document={document}
        slots={registrySlotSource()}
        blocks={{ get: () => undefined }}
        onAppend={() => undefined}
      />
    );

    const { container: rendered } = render(
      <>
        <div className={BUILDER_CHROME_CLASS}>
          <Canvas
            document={shelled}
            siteStyles={SITE_STYLES}
            overlay={appenders(shelled)}
          />
        </div>
        <Canvas
          document={bare}
          siteStyles={SITE_STYLES}
          overlay={appenders(bare)}
        />
      </>
    );

    layout(rendered, { shelled: { x: 0, y: 0, width: 400, height: 200 } }, 0);
    layout(rendered, { bare: { x: 0, y: 0, width: 400, height: 200 } }, 1);
    // Every overlay in the render, not the newest: each canvas subscribes its
    // own observer, and firing one leaves the other never measured — which would
    // make the absence below a statement about a pass that did not happen.
    for (const observer of FakeResizeObserver.instances) {
      act(() => observer.fire());
    }

    const bareElement = canvasRootIn(rendered, 1).querySelector(
      `[${NODE_ID_ATTRIBUTE}="bare"]`
    );
    expect(bareElement).not.toBeNull();
    expect(bareElement?.matches(`[${SLOTS_ATTRIBUTE}]:empty`)).toBe(true);

    expect(drawnAt("Shelled box")).toEqual(["178px", "78px", "44px", "44px"]);
    expect(
      screen.queryByRole("button", { name: "Add a block to Bare box" })
    ).toBeNull();
  });

  it("draws NO control on a container an authored ancestor clips", () => {
    /*
     * The CLIP refusal, which has to be covered on its own: each refusal in
     * `measure` is its own branch, and a fix applied to one leaves the others
     * returning whatever they returned before. Named rather than numbered — an
     * ordinal here is a count of the branches kept by hand beside them, and it
     * goes stale the moment one is inserted between two others.
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

  it("draws NO control on a container the render lays out no box for", () => {
    /*
     * The NO-BOX refusal, which no other branch here stands in for. The
     * container's element exists, matches the stylesheet's whole rule, is
     * `static` and is clipped by nothing — so every other refusal accepts it,
     * and what is left is that a hidden wrapper above it means the render lays
     * out no box for it. `getBoundingClientRect` still answers, with the zero
     * rectangle, so a pass that measured on would draw a button of no area
     * that a keyboard still reaches.
     *
     * Stubbed with a 400x200 rectangle DELIBERATELY, the same size as the
     * positive control's. The refusal cannot then be coming from a container
     * that measured nothing: the fragment count is what differs, which is the
     * question the component asks.
     *
     * The wrapper's computed `display` is asserted first, so the absence below
     * is known to be about a container that really is inside a hidden subtree
     * rather than about a fixture whose styles never compiled — an element no
     * rule reaches computes to jsdom's own default, not to `none`. `Wide box`
     * is the positive control, in the same render and the same measurement
     * pass, because an absence assertion alone is satisfied by a component
     * that drew nothing anywhere.
     */
    const container = measuredCanvas(NESTED_IN_HIDDEN, {
      wide: { x: 0, y: 0, width: 400, height: 200 },
      "inside-hidden": { x: 0, y: 400, width: 400, height: 200 },
    });

    expect(computedStyleOf(container, "hidden-wrapper").display).toBe("none");
    expect(drawnAt("Wide box")).toEqual(["178px", "78px", "44px", "44px"]);
    expect(
      screen.queryByRole("button", {
        name: "Add a block to Box in a hidden wrapper",
      })
    ).toBeNull();
  });

  it("draws NO control on a container inside a CLOSED disclosure, and one inside an open one", () => {
    /*
     * The SKIPPED refusal, and the one no other branch here can stand in for.
     * Both boxes are asserted to pass every question `measure` asks before it:
     * each has an element, each matches the stylesheet's whole rule, and each
     * reports exactly ONE layout fragment — the reading an engine gives a
     * closed disclosure's contents once they are skipped rather than removed
     * from the rendering, and the reason the no-box refusal above lets this one
     * through. The two boxes are stubbed the SAME size for the same reason, so
     * the refusal cannot be coming from a container that measured differently.
     *
     * The open section is the positive control, in the same render and the same
     * measurement pass, and it is a stronger one than a bare container would
     * be: it is the identical block inside the identical `<details>`, differing
     * only in the attribute the refusal is about. An absence assertion beside a
     * plain box would also be satisfied by a refusal that declined everything
     * inside any disclosure at all.
     *
     * Each `<details>`'s own state is asserted before anything is read into the
     * controls, so this is known to be about a section that really is closed
     * rather than about a fixture whose `open` prop never reached the render.
     */
    withCheckVisibility();
    const container = measuredCanvas(DISCLOSED, {
      "in-closed": { x: 0, y: 0, width: 400, height: 200 },
      "in-open": { x: 0, y: 400, width: 400, height: 200 },
    });

    expect(disclosureIn(container, "closed-section").matches("details")).toBe(
      true
    );
    expect(disclosureIn(container, "closed-section").hasAttribute("open")).toBe(
      false
    );
    expect(disclosureIn(container, "open-section").hasAttribute("open")).toBe(
      true
    );
    for (const id of ["in-closed", "in-open"]) {
      const box = disclosureIn(container, id);
      expect(box.matches(EMPTY_CONTAINER_SELECTOR)).toBe(true);
      expect(box.getClientRects().length).toBe(1);
    }

    expect(drawnAt("Box in an open section")).toEqual([
      "178px",
      "478px",
      "44px",
      "44px",
    ]);
    expect(
      screen.queryByRole("button", {
        name: "Add a block to Box in a closed section",
      })
    ).toBeNull();
  });

  it("draws the control as soon as the disclosure is opened", async () => {
    /*
     * The refusal is re-decided rather than permanent, and this is the case
     * that says WHAT hears the change. Opening a disclosure is a press on the
     * canvas rather than an edit: `document` does not change, no React render
     * follows, nothing resizes, nothing scrolls and no transition finishes, so
     * every subscription except one stays silent. What the browser does do is
     * write the `open` attribute onto the `<details>`, which is an attribute
     * record inside the canvas root and outside this overlay's own layer — the
     * `MutationObserver` in `watchCanvasFor` is the only thing that reports it.
     *
     * The attribute is written directly, which is exactly what a press on the
     * summary produces; driving it through a synthetic click would additionally
     * be asserting that jsdom implements the disclosure's own activation
     * behaviour, which is a claim about jsdom rather than about this component.
     *
     * The rectangle is unchanged across the two measurements, so the control
     * appearing is the refusal being lifted rather than a container that moved.
     */
    withCheckVisibility();
    const container = measuredCanvas(DISCLOSED, {
      "in-closed": { x: 0, y: 0, width: 400, height: 200 },
      "in-open": { x: 0, y: 400, width: 400, height: 200 },
    });
    expect(
      screen.queryByRole("button", {
        name: "Add a block to Box in a closed section",
      })
    ).toBeNull();

    const section = disclosureIn(container, "closed-section");
    await act(async () => {
      section.setAttribute("open", "");
      await flushObservers();
    });

    expect(drawnAt("Box in a closed section")).toEqual([
      "178px",
      "78px",
      "44px",
      "44px",
    ]);
  });

  it("draws NO control on a container the render does not produce", () => {
    /*
     * The UNRENDERED refusal, and the only one with no element to ask anything
     * of. `ghost` is in the overlay's document and in no element's id, which is
     * where a node `PageRenderer` drops stays: one carrying
     * `visibility.conditions`, or one whose props make it draw nothing. A pass
     * that HAS a canvas root and cannot find the element has decided about
     * that container, so treating it as not-yet-measured would leave a
     * zero-sized button in the tab order, announced by name, for content the
     * canvas does not show.
     *
     * Two controls in the same render and the same pass, because an absence
     * assertion alone is satisfied by a component that drew nothing at all:
     * `Wide box` proves the query finds a button here, and `Closed section`
     * proves the OTHER refusal still refuses — so this is a statement about
     * `ghost` rather than about the render as a whole.
     */
    measuredCanvas(
      SHAPES,
      {
        wide: { x: 0, y: 0, width: 400, height: 200 },
        "summary-bearing": { x: 0, y: 400, width: 400, height: 19 },
      },
      SHAPES_PLUS_UNRENDERED
    );

    expect(drawnAt("Wide box")).toEqual(["178px", "78px", "44px", "44px"]);
    expect(
      screen.queryByRole("button", { name: "Add a block to Ghost box" })
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Add a block to Closed section" })
    ).toBeNull();
  });

  /**
   * Three containers of one type, told apart by where their `position` puts
   * them.
   *
   * The two refused ones carry an authored `styles` envelope, which is the same
   * route the inspector writes: `PageRenderer` compiles it into the page's own
   * `<style>` and the element's COMPUTED `position` is what the component then
   * reads. Nothing here assigns the value onto the element, so the fixture
   * exercises the production path from stored document to computed style rather
   * than standing in for it — and the assertions below check that the value
   * arrived before reading anything into the control's absence.
   */
  const PINNED: BlockDocument = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "anchored",
        type: "acme/empty-container-appender-box",
        version: 1,
        props: {},
        name: "Anchored box",
      },
      {
        id: "pinned-to-viewport",
        type: "acme/empty-container-appender-box",
        version: 1,
        props: {},
        name: "Fixed box",
        styles: { base: { base: { position: { type: "fixed" } } } },
      },
      {
        id: "pinned-to-scrollport",
        type: "acme/empty-container-appender-box",
        version: 1,
        props: {},
        name: "Sticky box",
        styles: { base: { base: { position: { type: "sticky" } } } },
      },
    ],
  };

  /**
   * The computed style of one node's rendered element.
   *
   * One entry point returning the whole declaration rather than a reader per
   * property: each case asks about the value its own fixture stores, and the
   * varying part is which property that is.
   */
  function computedStyleOf(
    container: HTMLElement,
    id: string
  ): CSSStyleDeclaration {
    const element = canvasRootIn(container).querySelector(
      `[${NODE_ID_ATTRIBUTE}="${id}"]`
    );
    if (element === null) throw new Error(`no element for ${id}`);
    return getComputedStyle(element);
  }

  it("draws NO control on a container the author pinned to the viewport", () => {
    /*
     * `position` is a catalog keyword, so `fixed` is a value an author stores.
     * A fixed container stops travelling with the canvas content this overlay
     * measures in, and nothing re-measures when it stops: the shell scrolls a
     * section ABOVE the canvas root, and a scroll event does not bubble, so the
     * capture-phase listener `watchCanvasFor` puts on the root never hears it.
     * The square would come to rest over unrelated content and take the presses
     * meant for it.
     *
     * `Anchored box` is the positive control, in the same render and the same
     * measurement pass: without it the absence below is satisfied by a
     * component that drew nothing anywhere. The computed value is asserted
     * first so the refusal is known to be about a container that really is
     * fixed rather than about a fixture whose styles never compiled.
     */
    const container = measuredCanvas(PINNED, {
      anchored: { x: 0, y: 0, width: 400, height: 200 },
      "pinned-to-viewport": { x: 0, y: 400, width: 400, height: 200 },
    });

    expect(computedStyleOf(container, "pinned-to-viewport").position).toBe(
      "fixed"
    );
    expect(drawnAt("Anchored box")).toEqual(["178px", "78px", "44px", "44px"]);
    expect(
      screen.queryByRole("button", { name: "Add a block to Fixed box" })
    ).toBeNull();
  });

  it("draws NO control on a container the author pinned to a scrollport", () => {
    /*
     * Asserted apart from the fixed case rather than assumed to follow it. The
     * two are one branch today, and a refusal narrowed to a single value passes
     * the case above while leaving this one drawn — so the pair is what says
     * the branch covers both keywords rather than the one that was written
     * first. A sticky container additionally moves WITHIN its scrollport, which
     * is the same drift arriving without the container leaving the page at all.
     */
    const container = measuredCanvas(PINNED, {
      anchored: { x: 0, y: 0, width: 400, height: 200 },
      "pinned-to-scrollport": { x: 0, y: 400, width: 400, height: 200 },
    });

    expect(computedStyleOf(container, "pinned-to-scrollport").position).toBe(
      "sticky"
    );
    expect(drawnAt("Anchored box")).toEqual(["178px", "78px", "44px", "44px"]);
    expect(
      screen.queryByRole("button", { name: "Add a block to Sticky box" })
    ).toBeNull();
  });

  it("re-measures when a scroller between a container and the root scrolls", () => {
    /*
     * `overflow: auto` and `overflow: scroll` are catalog values, so an empty
     * container can sit inside a scroller the author made. Scrolling it moves
     * the container relative to the canvas while resizing nothing, mutating
     * nothing and finishing no transition — so the resize observer this
     * component already had has nothing to report, and the control stays at
     * the coordinates the layout used to give it, over whatever is there now.
     *
     * The scroll is dispatched on the NESTED element rather than on the root,
     * and with the default `bubbles: false` a scroll event really has: only a
     * listener in the CAPTURE phase on the root hears one from a scroller
     * inside it, so a bubbling listener would see nothing here. That is what
     * makes this discriminate rather than merely pass.
     *
     * The rectangle is re-stubbed and the control's new position asserted, so
     * what is checked is a completed re-measurement rather than the presence
     * of a subscription.
     */
    const container = measuredCanvas(NESTED, {
      wide: { x: 0, y: 0, width: 400, height: 200 },
      clipped: { x: 0, y: 0, width: 400, height: 200 },
    });
    expect(drawnAt("Clipped box")).toEqual(["178px", "78px", "44px", "44px"]);

    // The same container, 100px further down its scroller, and nothing
    // resized: `clipper` still reports the canvas's own box.
    layout(container, {
      wide: { x: 0, y: 0, width: 400, height: 200 },
      clipped: { x: 0, y: 100, width: 400, height: 200 },
    });
    const scroller = container.querySelector(
      `[${NODE_ID_ATTRIBUTE}="clipper"]`
    );
    if (scroller === null) throw new Error("no element for clipper");
    act(() => {
      scroller.dispatchEvent(new Event("scroll"));
    });

    expect(drawnAt("Clipped box")).toEqual(["178px", "178px", "44px", "44px"]);
  });

  it("re-measures when a transition finishes inside the canvas", () => {
    /*
     * The second change that moves a control while resizing nothing:
     * `transition` is a catalog property, so a neighbour animating a margin or
     * a transform past the first frame moves an empty container without
     * changing any observed box. The completion event bubbles, so the one
     * listener on the root hears it wherever inside the canvas it is raised —
     * dispatched here on the wrapper rather than on the root to say so.
     */
    const container = measuredCanvas(NESTED, {
      wide: { x: 0, y: 0, width: 400, height: 200 },
      clipped: { x: 0, y: 0, width: 400, height: 200 },
    });
    expect(drawnAt("Clipped box")).toEqual(["178px", "78px", "44px", "44px"]);

    layout(container, {
      wide: { x: 0, y: 0, width: 400, height: 200 },
      clipped: { x: 0, y: 100, width: 400, height: 200 },
    });
    const animated = container.querySelector(
      `[${NODE_ID_ATTRIBUTE}="clipper"]`
    );
    if (animated === null) throw new Error("no element for clipper");
    act(() => {
      animated.dispatchEvent(new Event("transitionend", { bubbles: true }));
    });

    expect(drawnAt("Clipped box")).toEqual(["178px", "178px", "44px", "44px"]);
  });

  it("re-measures when a site style recompiles inside the canvas", async () => {
    /*
     * The change no other subscription can see: a recompiled site sheet arrives
     * as a `<style>` inside the page root, and a class-driven margin or position
     * moves an empty container while resizing nothing, scrolling nothing and
     * finishing no transition. Only a mutation record reports it.
     *
     * The sheet is REPLACED rather than added, because that is what a save
     * does, and the record it produces has the `<style>` element's text node as
     * its target — a `characterData` record from deep inside the page, which is
     * the shape the observer's options have to cover.
     *
     * The rectangle is re-stubbed and the new position asserted, so what is
     * checked is a completed re-measurement rather than the presence of a
     * subscription.
     */
    const container = measuredCanvas(NESTED, {
      wide: { x: 0, y: 0, width: 400, height: 200 },
      clipped: { x: 0, y: 0, width: 400, height: 200 },
    });
    expect(drawnAt("Clipped box")).toEqual(["178px", "78px", "44px", "44px"]);

    const root = canvasRootIn(container);
    const sheet = document.createElement("style");
    sheet.textContent = ".nx-pb-a { margin-top: 0 }";
    await act(async () => {
      root.append(sheet);
      await flushObservers();
    });

    // The class rule now pushes the container 100px down. Nothing resized:
    // `clipper` still reports the canvas's own box.
    layout(container, {
      wide: { x: 0, y: 0, width: 400, height: 200 },
      clipped: { x: 0, y: 100, width: 400, height: 200 },
    });
    await act(async () => {
      sheet.textContent = ".nx-pb-a { margin-top: 100px }";
      await flushObservers();
    });

    expect(drawnAt("Clipped box")).toEqual(["178px", "178px", "44px", "44px"]);
  });

  it("does NOT re-measure for a mutation of its own output", async () => {
    /*
     * The other half of the same subscription, and it needs its own case: the
     * overlay draws INSIDE the subtree it observes, so an observer with no
     * exclusion has every measurement schedule the next one off the DOM writes
     * that measurement just made.
     *
     * Driven the same way as the case above and asserted the opposite way
     * round: the rectangle is re-stubbed so a re-measure WOULD move the control,
     * and then a mutation is made inside the overlay's own layer. The control
     * staying where it was is the exclusion working — and the previous test is
     * what proves this fixture can move it at all, since an assertion that
     * nothing happened is satisfied by an observer that never fires for
     * anything.
     *
     * The mutation is the shape the overlay's own render produces — the `style`
     * attribute of a drawn button being written — and it is written back with
     * the value it already carries, so the mutation record is the only thing
     * that can move this assertion. A write that changed the position would be
     * asserting its own edit rather than whether a measurement ran.
     */
    const container = measuredCanvas(NESTED, {
      wide: { x: 0, y: 0, width: 400, height: 200 },
      clipped: { x: 0, y: 0, width: 400, height: 200 },
    });
    expect(drawnAt("Clipped box")).toEqual(["178px", "78px", "44px", "44px"]);

    layout(container, {
      wide: { x: 0, y: 0, width: 400, height: 200 },
      clipped: { x: 0, y: 100, width: 400, height: 200 },
    });
    const drawn = screen.getByRole("button", {
      name: "Add a block to Clipped box",
    });
    await act(async () => {
      drawn.setAttribute("style", drawn.getAttribute("style") ?? "");
      await flushObservers();
    });

    expect(drawnAt("Clipped box")).toEqual(["178px", "78px", "44px", "44px"]);
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
     *
     * This is one half of what separates UNMEASURED from DECLINED, and the
     * halves cannot share a render: whether a pass has run at all is a
     * property of the MOUNT rather than of a container. The other half is
     * "draws NO control on a container the render does not produce" above,
     * where the same missing element under a canvas root draws nothing.
     * Conflate the two states in either direction and one of the pair fails.
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
