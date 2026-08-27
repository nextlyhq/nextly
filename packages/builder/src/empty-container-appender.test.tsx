// @vitest-environment jsdom

/**
 * The affordance drawn over a container with nothing in it.
 *
 * Geometry is NOT asserted here: jsdom reports every element as zero-sized, so
 * a position assertion would pass against any implementation. Placement is
 * verified in a real browser in Task 8.
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
import { NODE_ID_ATTRIBUTE } from "@nextlyhq/blocks-react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CANVAS_ROOT_CLASS, Canvas } from "./canvas";
import { EmptyContainerAppenders } from "./empty-container-appender";
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
  constructor(_callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }
  observe(target: Element): void {
    this.observed.push(target);
  }
  unobserve(): void {}
  disconnect(): void {
    this.disconnected = true;
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
          // Typed with the one shape this fixture reads, rather than the
          // full `BlockRenderArgs` — matching how `EmptyContainerAppenders`
          // itself narrows to `BlockLookup` above, and how it is discarded
          // anyway by `as never` below; the annotation only exists so `tsc`
          // can check the destructure rather than reporting an implicit `any`.
          render: ({
            className,
            renderSlot,
          }: {
            className: string;
            renderSlot: (name: string) => React.ReactNode;
          }) =>
            React.createElement("div", { className }, renderSlot("children")),
        },
        {
          name: "acme/empty-container-appender-leaf",
          version: 1,
          description: "A leaf with nothing to fill.",
          example: { props: {} },
          render: () => React.createElement("p", null, "leaf"),
        },
      ] as never,
      { source: "empty-container-appender-test" }
    );
  }

  const CANVAS_DOCUMENT = {
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
  } as unknown as BlockDocument;

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
        siteStyles={{ css: "", classes: {} } as never}
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
