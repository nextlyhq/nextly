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
import { createElement, useEffect } from "react";

import {
  clearBlocks,
  COMPONENT_INSTANCE_TYPE,
  registerBlocks,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import { INSTANCE_ATTRIBUTE, NODE_ID_ATTRIBUTE } from "@nextlyhq/blocks-react";

import { appliedConditionsOf } from "./applied-conditions";
import {
  CANVAS_ROOT_CLASS,
  CONDITIONED_ATTRIBUTE,
  CONDITIONED_OWN_ATTRIBUTE,
  Canvas,
  ENTRY_CONTENT_ATTRIBUTE,
  SELECTED_ATTRIBUTE,
} from "./canvas";
import { CanvasMarks } from "./canvas-marks";
import { conditionFieldsOfShapes } from "./condition-model";
import { EXPOSED_ATTRIBUTE } from "./exposed-outline";
import { markLookReach } from "./look-reach";
import { HoveredBlockProvider, useHoveredBlockSetter } from "./hovered-block";
import { PreviewedEntryProvider } from "./previewed-entry";
import { VisitorUnreadableBadges } from "./visitor-unreadable-badges";

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
        // A block shaped by its own clip-path, which a case below gives it:
        // jsdom's CSS parser drops `clip-path`, so it is answered there.
        name: "acme/shaped",
        version: 1,
        description: "A block with its own clip-path.",
        example: { props: {} },
        render: ({ className }: { className: string }) =>
          createElement("div", { className, "data-shaped": "" }),
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
      {
        // A block that draws a placement twice, as a loop draws its slot once
        // per entry: each copy's parts sit in a wrapper of their own.
        name: "acme/placed-twice",
        version: 1,
        description: "Two copies of one placement.",
        example: { props: {} },
        render: ({ className }: { className: string }) =>
          createElement(
            "div",
            { className },
            ...["first", "second"].map(copy =>
              createElement(
                "div",
                { key: copy, "data-copy": copy },
                createElement("div", {
                  [NODE_ID_ATTRIBUTE]: `${copy}-1`,
                  [INSTANCE_ATTRIBUTE]: "place",
                }),
                createElement("div", {
                  [NODE_ID_ATTRIBUTE]: `${copy}-2`,
                  [INSTANCE_ATTRIBUTE]: "place",
                })
              )
            )
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

  it("badges every conditioned block, selected or not, and red where its conditions can't be checked", async () => {
    const vip = [[{ field: "tier", op: "equals", value: "vip" }]];
    const { container } = render(
      <Canvas
        document={{
          formatVersion: 1,
          kind: "page",
          nodes: [
            {
              id: "a",
              type: "acme/leaf",
              version: 1,
              props: {},
              visibility: { conditions: vip },
            },
            {
              id: "b",
              type: "acme/leaf",
              version: 1,
              props: {},
              visibility: { conditions: vip },
            },
            { id: "c", type: "acme/leaf", version: 1, props: {} },
          ],
        }}
        siteStyles={{ breakpoints: { viewport: [], container: [] } }}
        conditionsUnchecked={new Set(["b"])}
        overlay={<CanvasMarks />}
      />
    );
    await act(async () => undefined);
    const badges = () =>
      Array.from(
        container.querySelectorAll('.nx-canvas-mark[data-mark="at-rest"]')
      );
    // Two badges, none for the plain block, and nothing selected: the badge
    // is always on, unlike the selection ring.
    await waitFor(() => expect(badges()).toHaveLength(2));
    expect(halosIn(container)).toHaveLength(0);
    expect(badges().map(badge => badge.getAttribute("data-condition"))).toEqual(
      ["conditional", "unchecked"]
    );
    expect(badges().map(badge => badge.textContent)).toEqual([
      "Conditional",
      "Can’t be checked",
    ]);
  });

  it("badges a block shown for the previewed entry so, and draws a hidden one as its marker with its id", async () => {
    const document: BlockDocument = {
      formatVersion: 1,
      kind: "template",
      nodes: [
        {
          id: "a",
          type: "acme/leaf",
          version: 1,
          props: {},
          visibility: {
            conditions: [[{ field: "tier", op: "equals", value: "vip" }]],
          },
        },
        {
          id: "b",
          type: "acme/leaf",
          version: 1,
          props: {},
          visibility: {
            conditions: [[{ field: "tier", op: "equals", value: "gold" }]],
          },
        },
      ],
    };
    const fields = [{ name: "tier", type: "text" }] as const;
    const applied = appliedConditionsOf(
      document,
      {
        subject: {
          fields: { declared: new Set(["tier"]), readable: fields },
          values: { tier: "vip" },
        },
        noun: "post",
        fields: conditionFieldsOfShapes(fields),
      },
      node => (node.id === "b" ? "Gold offer" : node.id)
    );
    const { container } = render(
      <Canvas
        document={document}
        siteStyles={{ breakpoints: { viewport: [], container: [] } }}
        conditionsApplied={applied}
        overlay={<CanvasMarks shownLabel="Shown for this post" />}
      />
    );
    await act(async () => undefined);
    const badges = () =>
      Array.from(
        container.querySelectorAll('.nx-canvas-mark[data-mark="at-rest"]')
      );
    // One badge, the shown block's: the hidden one's marker says it all.
    await waitFor(() => expect(badges()).toHaveLength(1));
    expect(badges()[0]?.getAttribute("data-condition")).toBe("shown");
    expect(badges()[0]?.textContent).toBe("Shown for this post");
    // In the hidden block's place, by its id, so the canvas selects it.
    const marker = container.querySelector(".nx-condition-hidden");
    expect(marker?.getAttribute("data-nx-node")).toBe("b");
    expect(marker?.textContent).toBe(
      "Gold offer · hidden for this post: tier is not “gold”"
    );
  });

  it("judges a placed component's blocks for the previewed entry: one badged shown, one drawn as its marker", async () => {
    const promo: BlockDocument = {
      formatVersion: 1,
      kind: "component",
      nodes: [
        {
          id: "a",
          type: "acme/leaf",
          version: 1,
          props: {},
          visibility: {
            conditions: [[{ field: "tier", op: "equals", value: "vip" }]],
          },
        },
        {
          id: "b",
          type: "acme/leaf",
          version: 1,
          name: "Gold offer",
          props: {},
          visibility: {
            conditions: [[{ field: "tier", op: "equals", value: "gold" }]],
          },
        },
      ],
    };
    const definitions = new Map([["promo", promo]]);
    const document: BlockDocument = {
      formatVersion: 1,
      kind: "template",
      nodes: [
        {
          id: "placed",
          type: COMPONENT_INSTANCE_TYPE,
          version: 1,
          props: { componentId: "promo" },
        },
      ],
    };
    const fields = [{ name: "tier", type: "text" }] as const;
    const applied = appliedConditionsOf(
      document,
      {
        subject: {
          fields: { declared: new Set(["tier"]), readable: fields },
          values: { tier: "vip" },
        },
        noun: "post",
        fields: conditionFieldsOfShapes(fields),
      },
      node => (typeof node.name === "string" ? node.name : node.id),
      { definitions }
    );
    // CONTROL: judged, one shown and one hidden, by the ids they are drawn
    // under.
    expect(applied.shown.size).toBe(1);
    expect(applied.hidden).toHaveLength(1);
    const { container } = render(
      <Canvas
        document={document}
        render={{ definitions }}
        siteStyles={{ breakpoints: { viewport: [], container: [] } }}
        conditionsApplied={applied}
        overlay={<CanvasMarks shownLabel="Shown for this post" />}
      />
    );
    await act(async () => undefined);
    const marker = () => container.querySelector(".nx-condition-hidden");
    await waitFor(() => expect(marker()).not.toBeNull());
    expect(marker()?.getAttribute("data-nx-node")).toBe(applied.hidden[0]?.id);
    expect(marker()?.textContent).toBe(
      "Gold offer · hidden for this post: tier is not “gold”"
    );
    const shownBadges = Array.from(
      container.querySelectorAll(
        '.nx-canvas-mark[data-mark="at-rest"][data-condition="shown"]'
      )
    );
    expect(shownBadges).toHaveLength(1);
  });

  it("draws one badge for a conditioned placement whose definition has several roots", async () => {
    // A placement is drawn as its definition's roots, each carrying the
    // placement's address and each outermost for it, with no wrapper: marked
    // here as the canvas marks them.
    const part = (id: string) =>
      createElement("div", {
        key: id,
        [NODE_ID_ATTRIBUTE]: id,
        [INSTANCE_ATTRIBUTE]: "place",
        [CONDITIONED_ATTRIBUTE]: "conditional",
      });
    const { container } = render(
      <div className={CANVAS_ROOT_CLASS}>
        {part("root-1")}
        {part("root-2")}
        <CanvasMarks />
      </div>
    );
    await act(async () => undefined);
    await waitFor(() =>
      expect(
        container.querySelectorAll('.nx-canvas-mark[data-mark="at-rest"]')
      ).toHaveLength(1)
    );
  });

  it("moves a selected placement's condition tab off the corner its name takes, and keeps a wide block's tab on screen", async () => {
    // The screen shows 500px across; both placements sit well inside it
    // vertically, and the second runs 500px past its right edge.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function boxOf(this: Element) {
        if (this.hasAttribute("data-scroller")) {
          return new DOMRect(0, 0, 500, 500);
        }
        const id = this.getAttribute(NODE_ID_ATTRIBUTE);
        if (id === "picked") return new DOMRect(0, 100, 300, 50);
        if (id === "wide") return new DOMRect(0, 300, 1000, 50);
        return new DOMRect(0, 0, 1000, 2000);
      }
    );
    const placed = (id: string, placement: string, selected: boolean) =>
      createElement("div", {
        key: id,
        [NODE_ID_ATTRIBUTE]: id,
        [INSTANCE_ATTRIBUTE]: placement,
        [CONDITIONED_ATTRIBUTE]: "conditional",
        ...(selected ? { [SELECTED_ATTRIBUTE]: "primary" } : {}),
      });
    const { container } = render(
      <div data-scroller="" style={{ overflowY: "auto" }}>
        <div className={CANVAS_ROOT_CLASS}>
          {placed("picked", "place-a", true)}
          {placed("wide", "place-b", false)}
          <CanvasMarks />
        </div>
      </div>
    );
    await act(async () => undefined);
    const badges = () =>
      Array.from(
        container.querySelectorAll<HTMLElement>(
          '.nx-canvas-mark[data-mark="at-rest"]'
        )
      );
    await waitFor(() => expect(badges()).toHaveLength(2));
    // Selected, its name takes the top corner, so the tab goes below; the
    // unselected one, CONTROL, keeps the top.
    expect(badges().map(badge => badge.getAttribute("data-tab-at"))).toEqual([
      "below",
      "above",
    ]);
    // The wide one's tab moves in by what the screen cuts off its right.
    expect(badges()[1]?.style.getPropertyValue("--nx-tag-inset-side")).toBe(
      "500px"
    );
  });

  it("badges a component's two conditioned blocks apart, though they share its address", async () => {
    // Each is the definition's own block, marked by its composed id.
    const own = (id: string) =>
      createElement("div", {
        key: id,
        [NODE_ID_ATTRIBUTE]: id,
        [INSTANCE_ATTRIBUTE]: "place",
        [CONDITIONED_ATTRIBUTE]: "conditional",
        [CONDITIONED_OWN_ATTRIBUTE]: "",
      });
    const { container } = render(
      <div className={CANVAS_ROOT_CLASS}>
        {own("block-1")}
        {own("block-2")}
        <CanvasMarks />
      </div>
    );
    await act(async () => undefined);
    await waitFor(() =>
      expect(
        container.querySelectorAll('.nx-canvas-mark[data-mark="at-rest"]')
      ).toHaveLength(2)
    );
  });

  it("badges each copy of a component's own conditioned block apart, though they share its composed id", async () => {
    // A list drawing the component once per entry: each copy of the block
    // carries the same composed id, in a wrapper of its own.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function boxOf(this: Element) {
        const copy = this.parentElement?.getAttribute("data-copy");
        if (copy === "first") return new DOMRect(100, 100, 200, 50);
        if (copy === "second") return new DOMRect(100, 600, 200, 50);
        return new DOMRect(0, 0, 1000, 1000);
      }
    );
    const copyOfBlock = (copy: string) =>
      createElement(
        "div",
        { key: copy, "data-copy": copy },
        createElement("div", {
          [NODE_ID_ATTRIBUTE]: "block-1",
          [INSTANCE_ATTRIBUTE]: "place",
          [CONDITIONED_ATTRIBUTE]: "conditional",
          [CONDITIONED_OWN_ATTRIBUTE]: "",
        })
      );
    const { container } = render(
      <div className={CANVAS_ROOT_CLASS}>
        {copyOfBlock("first")}
        {copyOfBlock("second")}
        <CanvasMarks />
      </div>
    );
    await act(async () => undefined);
    const badges = () =>
      Array.from(
        container.querySelectorAll<HTMLElement>(
          '.nx-canvas-mark[data-mark="at-rest"]'
        )
      );
    // One outline per copy, not one spanning both and what lies between.
    await waitFor(() => expect(badges()).toHaveLength(2));
    expect(badges().map(badge => badge.style.top)).not.toEqual([
      badges()[0]?.style.top,
      badges()[0]?.style.top,
    ]);
  });

  it("badges the roots of one placement nested in a component together", async () => {
    // Each root has its own composed id; the value names the placement
    // whose gate they carry, so they share one outline and one badge.
    const root = (id: string) =>
      createElement("div", {
        key: id,
        [NODE_ID_ATTRIBUTE]: id,
        [INSTANCE_ATTRIBUTE]: "place",
        [CONDITIONED_ATTRIBUTE]: "conditional",
        [CONDITIONED_OWN_ATTRIBUTE]: "p1",
      });
    const { container } = render(
      <div className={CANVAS_ROOT_CLASS}>
        {root("root-1")}
        {root("root-2")}
        <CanvasMarks />
      </div>
    );
    await act(async () => undefined);
    await waitFor(() =>
      expect(
        container.querySelectorAll('.nx-canvas-mark[data-mark="at-rest"]')
      ).toHaveLength(1)
    );
  });

  it("keeps the tab with a block wholly off the screen's left", async () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function boxOf(this: Element) {
        if (this.hasAttribute("data-scroller")) {
          return new DOMRect(0, 0, 500, 500);
        }
        if (this.getAttribute(NODE_ID_ATTRIBUTE) === "gone") {
          return new DOMRect(-900, 200, 500, 50);
        }
        return new DOMRect(-900, 0, 2000, 2000);
      }
    );
    const { container } = render(
      <div data-scroller="" style={{ overflowY: "auto" }}>
        <div className={CANVAS_ROOT_CLASS}>
          {createElement("div", {
            [NODE_ID_ATTRIBUTE]: "gone",
            [CONDITIONED_ATTRIBUTE]: "conditional",
          })}
          <CanvasMarks />
        </div>
      </div>
    );
    await act(async () => undefined);
    const badge = () =>
      container.querySelector<HTMLElement>(
        '.nx-canvas-mark[data-mark="at-rest"]'
      );
    await waitFor(() => expect(badge()).not.toBeNull());
    // No inset pulling the tab back onto the screen, away from its block.
    const inset = Number.parseFloat(
      badge()?.style.getPropertyValue("--nx-tag-inset-side") || "0"
    );
    expect(inset).toBe(0);
  });

  it("keeps the tab on screen when the screen cuts a block's left side", async () => {
    // Only the block's rightmost 100px show, less than the tab's width.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function boxOf(this: Element) {
        if (this.hasAttribute("data-scroller")) {
          return new DOMRect(0, 0, 500, 500);
        }
        if (this.getAttribute(NODE_ID_ATTRIBUTE) === "cut") {
          return new DOMRect(-900, 200, 1000, 50);
        }
        return new DOMRect(-900, 0, 2000, 2000);
      }
    );
    const { container } = render(
      <div data-scroller="" style={{ overflowY: "auto" }}>
        <div className={CANVAS_ROOT_CLASS}>
          {createElement("div", {
            [NODE_ID_ATTRIBUTE]: "cut",
            [CONDITIONED_ATTRIBUTE]: "conditional",
          })}
          <CanvasMarks />
        </div>
      </div>
    );
    await act(async () => undefined);
    const badge = () =>
      container.querySelector<HTMLElement>(
        '.nx-canvas-mark[data-mark="at-rest"]'
      );
    await waitFor(() => expect(badge()).not.toBeNull());
    // Moved out past the block's right edge, a negative inset, so its left
    // starts on screen.
    const inset = Number.parseFloat(
      badge()?.style.getPropertyValue("--nx-tag-inset-side") ?? "0"
    );
    expect(inset).toBeLessThan(0);
  });

  it("puts a tall block's badge inside its top when neither edge outside it is on screen", async () => {
    // The screen shows 500px; the block starts at its top and runs past its
    // bottom, so a badge above or below it would be off screen.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function boxOf(this: Element) {
        if (this.hasAttribute("data-scroller")) {
          return new DOMRect(0, 0, 1000, 500);
        }
        const id = this.getAttribute(NODE_ID_ATTRIBUTE);
        if (id === "tall") return new DOMRect(0, 4, 1000, 1800);
        if (id === "short") return new DOMRect(0, 200, 1000, 50);
        return new DOMRect(0, 0, 1000, 2000);
      }
    );
    const gated = (id: string) => ({
      id,
      type: "acme/leaf",
      version: 1,
      props: {},
      visibility: {
        conditions: [[{ field: "tier", op: "equals", value: "vip" }]],
      },
    });
    const { container } = render(
      <div data-scroller="" style={{ overflowY: "auto" }}>
        <Canvas
          document={{
            formatVersion: 1,
            kind: "page",
            nodes: [gated("tall"), gated("short")] as never,
          }}
          siteStyles={{ breakpoints: { viewport: [], container: [] } }}
          overlay={<CanvasMarks />}
        />
      </div>
    );
    await act(async () => undefined);
    const badges = () =>
      Array.from(
        container.querySelectorAll('.nx-canvas-mark[data-mark="at-rest"]')
      );
    await waitFor(() => expect(badges()).toHaveLength(2));
    expect(badges().map(badge => badge.getAttribute("data-tab-at"))).toEqual([
      "inside",
      "above",
    ]);
  });

  /*
   * The tabs of conditioned blocks drawn at `boxes` (by id, in page order), on
   * a screen 1000px wide and 500px tall: where each block's tabs sit, and how
   * far in from its right edge.
   */
  const tabsOfBlocksAt = async (
    boxes: Readonly<Record<string, DOMRect>>
  ): Promise<{ at: (string | null)[]; inset: string[] }> => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function boxOf(this: Element) {
        if (this.hasAttribute("data-scroller")) {
          return new DOMRect(0, 0, 1000, 500);
        }
        const id = this.getAttribute(NODE_ID_ATTRIBUTE);
        return (
          (id === null ? undefined : boxes[id]) ?? new DOMRect(0, 0, 1000, 2000)
        );
      }
    );
    const { container } = render(
      <div data-scroller="" style={{ overflowY: "auto" }}>
        <Canvas
          document={{
            formatVersion: 1,
            kind: "page",
            nodes: Object.keys(boxes).map(id => ({
              id,
              type: "acme/leaf",
              version: 1,
              props: {},
              visibility: {
                conditions: [[{ field: "tier", op: "equals", value: "vip" }]],
              },
            })) as never,
          }}
          siteStyles={{ breakpoints: { viewport: [], container: [] } }}
          overlay={<CanvasMarks />}
        />
      </div>
    );
    await act(async () => undefined);
    const badges = () =>
      Array.from(
        container.querySelectorAll<HTMLElement>(
          '.nx-canvas-mark[data-mark="at-rest"]'
        )
      );
    await waitFor(() =>
      expect(badges()).toHaveLength(Object.keys(boxes).length)
    );
    return {
      at: badges().map(badge => badge.getAttribute("data-tab-at")),
      inset: badges().map(badge =>
        badge.style.getPropertyValue("--nx-tag-inset-side")
      ),
    };
  };

  it("keeps the tabs of two short blocks stacked one on another apart: the lower one's go on its bottom edge", async () => {
    // Each block 12px tall, shorter than a 20px tab, the second right under
    // the first, both as wide: above each block, the second's tabs would sit
    // over the first's, running from the same right edge.
    const short = await tabsOfBlocksAt({
      upper: new DOMRect(0, 200, 1000, 12),
      lower: new DOMRect(0, 212, 1000, 12),
    });
    expect(short.at).toEqual(["above", "below"]);
    expect(short.inset).toEqual(["0px", "0px"]);
  });

  it("keeps the tabs of stacked blocks taller than a tab, and of short blocks side by side, on their top edges", async () => {
    // CONTROLS: nothing overlaps, so each block's tabs go where they go alone.
    // Stacked, 50px each: the lower one's tabs stand clear of the upper one's.
    const tall = await tabsOfBlocksAt({
      upper: new DOMRect(0, 200, 1000, 50),
      lower: new DOMRect(0, 250, 1000, 50),
    });
    expect(tall.at).toEqual(["above", "above"]);
    cleanup();
    // As short as above, but side by side in a row: their tabs are apart
    // across, so neither moves although each is shorter than a tab.
    const row = await tabsOfBlocksAt({
      left: new DOMRect(0, 200, 400, 12),
      right: new DOMRect(600, 200, 400, 12),
    });
    expect(row.at).toEqual(["above", "above"]);
    expect(row.inset).toEqual(["0px", "0px"]);
  });

  it("steps a block's tabs left past another's when every edge it may use is taken", async () => {
    // Three blocks 8px tall, stacked: the first's tabs go above it and the
    // second's below it, and for the third, above, below and inside its top
    // all meet one of those. Its tabs keep the top edge and step left past
    // the first block's, by their estimated width ("Conditional", 77px of
    // words, 12px of padding and 16px for the icon: 105px) and the 2px gap.
    const stack = await tabsOfBlocksAt({
      first: new DOMRect(0, 200, 1000, 8),
      second: new DOMRect(0, 208, 1000, 8),
      third: new DOMRect(0, 216, 1000, 8),
    });
    expect(stack.at).toEqual(["above", "below", "above"]);
    expect(stack.inset).toEqual(["0px", "0px", "107px"]);
  });

  /*
   * The blocks drawn at `boxes` (by id, in page order) on a screen 1000px
   * wide and 500px tall, with both layers that draw tabs on a block's edge:
   * the `conditioned` blocks' at-rest tabs, and the "Visitors won't see this"
   * badges of the `unreadable` ones, each 22px tall and drawn leftwards from
   * near its block's right edge. Where each at-rest mark's tabs sit, and each
   * badge's top.
   */
  const bothLayersAt = async (
    boxes: Readonly<Record<string, DOMRect>>,
    marks: { conditioned: readonly string[]; unreadable: readonly string[] }
  ): Promise<{ tabsAt: (string | null)[]; badgeTops: string[] }> => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function boxOf(this: Element) {
        if (this.hasAttribute("data-scroller")) {
          return new DOMRect(0, 0, 1000, 500);
        }
        if (this.classList.contains("nx-visitor-unreadable__badge")) {
          return new DOMRect(0, 0, 150, 22);
        }
        const id = this.getAttribute(NODE_ID_ATTRIBUTE);
        return (
          (id === null ? undefined : boxes[id]) ?? new DOMRect(0, 0, 1000, 2000)
        );
      }
    );
    const marked = new Map(
      marks.unreadable.map(id => [
        id,
        [{ prop: "text", path: "internalNote" }] as const,
      ])
    );
    const { container } = render(
      <div data-scroller="" style={{ overflowY: "auto" }}>
        <Canvas
          document={{
            formatVersion: 1,
            kind: "page",
            nodes: Object.keys(boxes).map(id => ({
              id,
              type: "acme/leaf",
              version: 1,
              props: {},
              ...(marks.conditioned.includes(id)
                ? {
                    visibility: {
                      conditions: [
                        [{ field: "tier", op: "equals", value: "vip" }],
                      ],
                    },
                  }
                : {}),
            })) as never,
          }}
          siteStyles={{ breakpoints: { viewport: [], container: [] } }}
          overlay={
            // As the host draws them: the marks, then the badges' layer.
            <>
              <CanvasMarks />
              <VisitorUnreadableBadges marked={marked} />
            </>
          }
        />
      </div>
    );
    await act(async () => undefined);
    const tabs = () =>
      Array.from(
        container.querySelectorAll('.nx-canvas-mark[data-mark="at-rest"]')
      );
    const badges = () =>
      Array.from(
        container.querySelectorAll<HTMLElement>(".nx-visitor-unreadable__badge")
      );
    await waitFor(() => {
      expect(tabs()).toHaveLength(marks.conditioned.length);
      expect(badges()).toHaveLength(marks.unreadable.length);
    });
    return {
      tabsAt: tabs().map(tab => tab.getAttribute("data-tab-at")),
      badgeTops: badges().map(badge => badge.style.top),
    };
  };

  it("keeps the visitor badges of two short blocks stacked one on another apart: the lower one's goes on its bottom edge", async () => {
    // Each block 12px tall, its outline 16px, shorter than a 22px badge, the
    // second right under the first: above each outline, the second's badge
    // (189px to 211px) would sit over the first's (177px to 199px). Below
    // its outline (210px + 16px, less the 1px foot), it is clear.
    const short = await bothLayersAt(
      {
        upper: new DOMRect(0, 200, 1000, 12),
        lower: new DOMRect(0, 212, 1000, 12),
      },
      { conditioned: [], unreadable: ["upper", "lower"] }
    );
    expect(short.badgeTops).toEqual(["177px", "225px"]);
  });

  it("keeps a block's visitor badge off its own conditional tab: the badge goes on its bottom edge", async () => {
    // One 50px block, both conditional and read by a field visitors can't
    // read. Its tab above it runs 180px to 200px, from 895px to its right
    // edge; the badge above its outline would run 177px to 199px, from about
    // 150px left of the same edge.
    // The tab is placed first, so the badge takes its outline's bottom edge:
    // 198px + 54px, less the 1px foot.
    const both = await bothLayersAt(
      { both: new DOMRect(0, 200, 1000, 50) },
      { conditioned: ["both"], unreadable: ["both"] }
    );
    expect(both.tabsAt).toEqual(["above"]);
    expect(both.badgeTops).toEqual(["251px"]);
  });

  it("keeps a block's visitor badge, or its conditional tab, on its top edge when it carries only the one", async () => {
    // CONTROLS: nothing else is drawn on the block, so each goes where it
    // goes alone, on top.
    const tab = await bothLayersAt(
      { only: new DOMRect(0, 200, 1000, 50) },
      { conditioned: ["only"], unreadable: [] }
    );
    expect(tab.tabsAt).toEqual(["above"]);
    cleanup();
    const badge = await bothLayersAt(
      { only: new DOMRect(0, 200, 1000, 50) },
      { conditioned: [], unreadable: ["only"] }
    );
    expect(badge.badgeTops).toEqual(["177px"]);
  });

  it("keeps a short block's visitor badge off the conditional tab of the block above it", async () => {
    // The upper block's tab above it runs 180px to 200px; the lower block's
    // badge above its outline would run 189px to 211px, over it, and takes
    // its outline's bottom edge instead.
    const stacked = await bothLayersAt(
      {
        upper: new DOMRect(0, 200, 1000, 12),
        lower: new DOMRect(0, 212, 1000, 12),
      },
      { conditioned: ["upper"], unreadable: ["lower"] }
    );
    expect(stacked.tabsAt).toEqual(["above"]);
    expect(stacked.badgeTops).toEqual(["225px"]);
  });

  it("draws a dashed reach mark on each block a look edit reaches, and clears it", async () => {
    const { container } = render(
      <Canvas
        document={leaves}
        siteStyles={{ breakpoints: { viewport: [], container: [] } }}
        selectedId={null}
        overlay={<CanvasMarks />}
      />
    );
    await act(async () => undefined);
    const reachIn = () =>
      container.querySelectorAll('.nx-canvas-mark[data-mark="look-reach"]');
    // What the inspector writes while a look is edited on its own.
    act(() => markLookReach(container, new Set(["a", "b"])));
    await waitFor(() => expect(reachIn()).toHaveLength(2));
    act(() => markLookReach(container, null));
    await waitFor(() => expect(reachIn()).toHaveLength(0));
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
    expect(frame.getAttribute("data-placement-label")).toBe("◇ Promo card");
    // Room above it on the page, so the tag sits outside the frame.
    expect(frame.hasAttribute("data-placement-tag-inside")).toBe(false);
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

  it("rings the exposed part being edited, and dims the placement's other ones", async () => {
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
    const part = (id: string) =>
      container.querySelector(`[${NODE_ID_ATTRIBUTE}="${id}"]`);
    const exposedMarks = () =>
      Array.from(
        container.querySelectorAll<HTMLElement>(
          '.nx-canvas-mark[data-mark="exposed"]'
        )
      );
    act(() => {
      part("part-1")?.setAttribute(EXPOSED_ATTRIBUTE, "");
      part("part-2")?.setAttribute(EXPOSED_ATTRIBUTE, "");
    });
    await waitFor(() => expect(exposedMarks()).toHaveLength(2));
    expect(exposedMarks().some(mark => mark.hasAttribute("data-dimmed"))).toBe(
      false
    );
    // What the canvas writes on the element it is editing.
    act(() => {
      part("part-2")?.setAttribute("data-nx-editing", "content");
    });
    await waitFor(() =>
      expect(
        exposedMarks().map(mark => [
          mark.hasAttribute("data-editing"),
          mark.hasAttribute("data-dimmed"),
        ])
      ).toEqual([
        [false, true],
        [true, false],
      ])
    );
  });

  it("puts a placement's tag inside its frame at the top of what is on screen, wherever that is in the page", async () => {
    // Scrolled 600px down: the screen shows the page from 600 on, and the
    // placement sits just below the screen's top, far down the page.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function boxOf(this: Element) {
        if (this.hasAttribute("data-scroller")) {
          return new DOMRect(0, 0, 1000, 500);
        }
        if (this.classList.contains("nx-canvas")) {
          return new DOMRect(0, -600, 1000, 2000);
        }
        const id = this.getAttribute(NODE_ID_ATTRIBUTE);
        if (id === "part-1") return new DOMRect(100, 10, 200, 50);
        if (id === "part-2") return new DOMRect(100, 70, 200, 50);
        return new DOMRect(0, -600, 1000, 2000);
      }
    );
    const { container } = render(
      <div data-scroller="" style={{ overflowY: "auto" }}>
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
      </div>
    );
    await act(async () => undefined);
    await waitFor(() => expect(halosIn(container)).toHaveLength(1));
    // A tag above the frame would be above the screen, cut off.
    expect(
      halosIn(container)[0]?.hasAttribute("data-placement-tag-inside")
    ).toBe(true);
  });

  it("draws each copy of a placement a block repeats in a frame of its own", async () => {
    // One frame around both copies would ring whatever lies between them.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function boxOf(this: Element) {
        const id = this.getAttribute(NODE_ID_ATTRIBUTE) ?? "";
        if (id.startsWith("first")) return new DOMRect(100, 100, 200, 50);
        if (id.startsWith("second")) return new DOMRect(100, 600, 200, 50);
        return new DOMRect(0, 0, 1000, 1000);
      }
    );
    const { container } = render(
      <Canvas
        document={{
          formatVersion: 1,
          kind: "page",
          nodes: [
            { id: "host", type: "acme/placed-twice", version: 1, props: {} },
          ],
        }}
        siteStyles={{ breakpoints: { viewport: [], container: [] } }}
        selectedId="place"
        overlay={<CanvasMarks />}
      />
    );
    await act(async () => undefined);
    await waitFor(() => expect(halosIn(container)).toHaveLength(2));
    expect(
      halosIn(container).map(mark => (mark as HTMLElement).style.top)
    ).toEqual(["96px", "596px"]);
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
    expect(halosIn(container)[0]?.getAttribute("data-placement-label")).toBe(
      "◇ Component"
    );
    // At the top of the page, where a tag above would leave it.
    expect(
      halosIn(container)[0]?.hasAttribute("data-placement-tag-inside")
    ).toBe(true);
  });

  it("draws the ring outside the block, at the page's edge too", async () => {
    /*
     * Drawn inside, the ring covered the first glyph of a heading set flush
     * with its box. Outside, for a block flush with the page's edge, it runs
     * past the page, into the room the layer keeps past the frame for it.
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
      { left: "-4px", top: "-4px", width: "108px", height: "58px" },
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

  it("draws no halo band for a block shaped by its own clip-path", async () => {
    /*
     * A circle cut from a square box leaves its corners showing the page
     * behind. A halo band painted inside the ring would cover those corners,
     * over content that is not the block's, so the ring is drawn without it,
     * as for a block an ancestor clips.
     */
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      () => new DOMRect(0, 0, 100, 100)
    );
    // The computed `clip-path` a browser reports for the shaped block.
    const computed = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (element, pseudo) => {
        const style = computed(element, pseudo);
        if (!element.hasAttribute("data-shaped")) return style;
        return new Proxy(style, {
          get(target, key) {
            if (key === "clipPath") return "circle(50%)";
            const value: unknown = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      }
    );
    const { container } = render(
      <Canvas
        document={{
          formatVersion: 1,
          kind: "page",
          nodes: [
            { id: "round", type: "acme/shaped", version: 1, props: {} },
            { id: "plain", type: "acme/leaf", version: 1, props: {} },
          ],
        }}
        siteStyles={{ breakpoints: { viewport: [], container: [] } }}
        selectedId="round"
        overlay={<CanvasMarks />}
      />
    );
    await act(async () => undefined);
    const mark = await waitFor(() => {
      const [found] = halosIn(container);
      if (found === undefined) throw new Error("no mark yet");
      return found as HTMLElement;
    });
    expect(mark.hasAttribute("data-shaped")).toBe(true);
    // The ring stays OUTSIDE the box, unlike a clipped one: the block's own
    // shape does not cut the overlay, and inside it would cover the circle.
    expect(mark.hasAttribute("data-clipped")).toBe(false);
    expect({
      left: mark.style.left,
      top: mark.style.top,
      width: mark.style.width,
    }).toEqual({ left: "-4px", top: "-4px", width: "108px" });
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

describe("the hovered block's mark", () => {
  /** Points at a block, as a Layers row does under the pointer. */
  function PointAt({ id }: { id: string | null }): null {
    const point = useHoveredBlockSetter();
    useEffect(() => {
      point(id);
    }, [point, id]);
    return null;
  }

  const hoveredIn = (container: HTMLElement) =>
    Array.from(
      container.querySelectorAll('.nx-canvas-mark[data-mark="hovered"]')
    );

  it("is drawn over the block a row points at, and goes when it stops", async () => {
    const drawn = (id: string | null) => (
      <HoveredBlockProvider>
        <PointAt id={id} />
        <Canvas
          document={leaves}
          siteStyles={{ breakpoints: { viewport: [], container: [] } }}
          overlay={<CanvasMarks />}
        />
      </HoveredBlockProvider>
    );
    const { container, rerender } = render(drawn("b"));
    await act(async () => undefined);
    await waitFor(() => expect(hoveredIn(container)).toHaveLength(1));
    rerender(drawn(null));
    await waitFor(() => expect(hoveredIn(container)).toHaveLength(0));
  });

  it("is tagged with the block's name, as its Layers row reads", async () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function boxOf(this: Element) {
        if (this.getAttribute(NODE_ID_ATTRIBUTE) === "b") {
          return new DOMRect(100, 100, 200, 50);
        }
        return new DOMRect(0, 0, 1000, 1000);
      }
    );
    const { container } = render(
      <HoveredBlockProvider>
        <PointAt id="b" />
        <Canvas
          document={leaves}
          siteStyles={{ breakpoints: { viewport: [], container: [] } }}
          overlay={
            <CanvasMarks
              nameOf={id => (id === "b" ? "Intro text" : undefined)}
            />
          }
        />
      </HoveredBlockProvider>
    );
    await act(async () => undefined);
    await waitFor(() => expect(hoveredIn(container)).toHaveLength(1));
    const mark = hoveredIn(container)[0];
    expect(mark?.getAttribute("data-hover-label")).toBe("Intro text");
    // Room above it on the page, so the tag sits outside, over its corner.
    expect(mark?.hasAttribute("data-hover-tag-inside")).toBe(false);
  });

  it("moves its tag in from the screen's left edge on a block that starts left of it", async () => {
    // The canvas scrolled sideways: the block starts 300px left of what the
    // scroller shows, and its tag moves in by as much, onto the screen.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function boxOf(this: Element) {
        if (this.hasAttribute("data-scroller")) {
          return new DOMRect(0, 0, 1000, 500);
        }
        if (this.getAttribute(NODE_ID_ATTRIBUTE) === "b") {
          return new DOMRect(-300, 100, 800, 50);
        }
        return new DOMRect(-300, 0, 1500, 2000);
      }
    );
    const { container } = render(
      <div data-scroller="" style={{ overflowY: "auto" }}>
        <HoveredBlockProvider>
          <PointAt id="b" />
          <Canvas
            document={leaves}
            siteStyles={{ breakpoints: { viewport: [], container: [] } }}
            overlay={<CanvasMarks nameOf={() => "Intro text"} />}
          />
        </HoveredBlockProvider>
      </div>
    );
    await act(async () => undefined);
    await waitFor(() => expect(hoveredIn(container)).toHaveLength(1));
    const mark = hoveredIn(container)[0] as HTMLElement;
    expect(mark.style.getPropertyValue("--nx-tag-inset-side")).toBe("300px");
  });

  it("leaves the tag of a block wholly left of the screen where it is", async () => {
    // Nothing of the outline is on screen, so there is nothing to tag there:
    // moved in, the tag would be drawn at the screen's edge, cut to nothing.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function boxOf(this: Element) {
        if (this.hasAttribute("data-scroller")) {
          return new DOMRect(0, 0, 1000, 500);
        }
        if (this.getAttribute(NODE_ID_ATTRIBUTE) === "b") {
          return new DOMRect(-900, 100, 500, 50);
        }
        return new DOMRect(-900, 0, 2000, 2000);
      }
    );
    const { container } = render(
      <div data-scroller="" style={{ overflowY: "auto" }}>
        <HoveredBlockProvider>
          <PointAt id="b" />
          <Canvas
            document={leaves}
            siteStyles={{ breakpoints: { viewport: [], container: [] } }}
            overlay={<CanvasMarks nameOf={() => "Intro text"} />}
          />
        </HoveredBlockProvider>
      </div>
    );
    await act(async () => undefined);
    await waitFor(() => expect(hoveredIn(container)).toHaveLength(1));
    const mark = hoveredIn(container)[0] as HTMLElement;
    expect(mark.style.getPropertyValue("--nx-tag-inset-side")).toBe("0px");
  });

  it("is left to the ring on a block already selected", async () => {
    const { container } = render(
      <HoveredBlockProvider>
        <PointAt id="b" />
        <Canvas
          document={leaves}
          siteStyles={{ breakpoints: { viewport: [], container: [] } }}
          selectedId="b"
          overlay={<CanvasMarks />}
        />
      </HoveredBlockProvider>
    );
    await act(async () => undefined);
    await waitFor(() => expect(halosIn(container)).toHaveLength(1));
    expect(hoveredIn(container)).toHaveLength(0);
  });
});

describe("a selected block shown although the page hides it", () => {
  it("is hatched and tagged with the device it is hidden on", async () => {
    const { container } = render(
      <Canvas
        document={leaves}
        siteStyles={{ breakpoints: { viewport: [], container: [] } }}
        selectedId="a"
        selectedIds={["a", "b"]}
        overlay={
          <CanvasMarks
            revealed={["a"]}
            device={{
              breakpoints: {
                viewport: [{ id: "mobile", label: "Mobile", maxWidth: 640 }],
                container: [],
              },
              id: "mobile",
            }}
          />
        }
      />
    );
    await act(async () => undefined);
    await waitFor(() => expect(halosIn(container)).toHaveLength(2));
    const hidden = halosIn(container).filter(mark =>
      mark.hasAttribute("data-hidden")
    );
    expect(hidden).toHaveLength(1);
    expect(hidden[0]?.getAttribute("data-label")).toBe("Hidden on Mobile");
  });

  it("puts its tag above the ring when the block ends at the bottom of the page", async () => {
    // The page 1000px tall; "a" at its top, "c" ending at its bottom, where a
    // tag below would be drawn past the page and cut off.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function boxOf(this: Element) {
        const id = this.getAttribute(NODE_ID_ATTRIBUTE);
        if (id === "a") return new DOMRect(0, 0, 1000, 50);
        if (id === "c") return new DOMRect(0, 950, 1000, 50);
        return new DOMRect(0, 0, 1000, 1000);
      }
    );
    const { container } = render(
      <Canvas
        document={leaves}
        siteStyles={{ breakpoints: { viewport: [], container: [] } }}
        selectedId="a"
        selectedIds={["a", "c"]}
        overlay={<CanvasMarks revealed={["a", "c"]} />}
      />
    );
    await act(async () => undefined);
    await waitFor(() => expect(halosIn(container)).toHaveLength(2));
    const tags = halosIn(container).map(mark => mark.getAttribute("data-tag"));
    expect(tags.sort()).toEqual(["above", "below"]);
  });

  /**
   * A 2000px page shown through a 500px scroller: "a" at the top, "c" ending
   * at the bottom of what is on screen though far from the page's bottom, and
   * "b" a narrow block flush with the left edge.
   */
  function onScreenGeometry(): void {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function boxOf(this: Element) {
        if (this.hasAttribute("data-scroller")) {
          return new DOMRect(0, 0, 1000, 500);
        }
        const id = this.getAttribute(NODE_ID_ATTRIBUTE);
        if (id === "a") return new DOMRect(0, 0, 1000, 50);
        if (id === "b") return new DOMRect(0, 100, 40, 50);
        if (id === "c") return new DOMRect(0, 450, 1000, 50);
        return new DOMRect(0, 0, 1000, 2000);
      }
    );
  }

  function tagsOf(container: HTMLElement): string[] {
    return halosIn(container)
      .map(
        mark =>
          `${mark.getAttribute("data-tag")}:${mark.getAttribute("data-tag-edge")}`
      )
      .sort();
  }

  it("puts its tag above a ring that ends at the bottom of what is on screen, not only of the page", async () => {
    onScreenGeometry();
    const { container } = render(
      <div data-scroller="" style={{ overflowY: "auto" }}>
        <Canvas
          document={leaves}
          siteStyles={{ breakpoints: { viewport: [], container: [] } }}
          selectedId="a"
          selectedIds={["a", "c"]}
          overlay={<CanvasMarks revealed={["a", "c"]} />}
        />
      </div>
    );
    await act(async () => undefined);
    await waitFor(() => expect(halosIn(container)).toHaveLength(2));
    expect(tagsOf(container)).toEqual(["above:right", "below:right"]);
  });

  it("puts its tag inside the ring, at the screen's corner, when neither side has room", async () => {
    // A hero that fills the 500px screen ("a") and one that runs 300px past
    // it ("c"): no room above or below either, so the tag goes inside, moved
    // up by as much as the ring runs past the screen.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function boxOf(this: Element) {
        if (this.hasAttribute("data-scroller")) {
          return new DOMRect(0, 0, 1000, 500);
        }
        const id = this.getAttribute(NODE_ID_ATTRIBUTE);
        if (id === "a") return new DOMRect(0, 0, 1000, 500);
        if (id === "c") return new DOMRect(0, 0, 1000, 800);
        return new DOMRect(0, 0, 1000, 2000);
      }
    );
    const { container } = render(
      <div data-scroller="" style={{ overflowY: "auto" }}>
        <Canvas
          document={leaves}
          siteStyles={{ breakpoints: { viewport: [], container: [] } }}
          selectedId="a"
          selectedIds={["a", "c"]}
          overlay={<CanvasMarks revealed={["a", "c"]} />}
        />
      </div>
    );
    await act(async () => undefined);
    await waitFor(() => expect(halosIn(container)).toHaveLength(2));
    const insets = halosIn(container)
      .map(
        mark =>
          `${mark.getAttribute("data-tag")}:${(mark as HTMLElement).style.getPropertyValue("--nx-tag-inset-bottom")}`
      )
      .sort();
    // The ring stands 4px outside the block, so it runs 4px further past the
    // screen, and the tag moves in by as much to stay on it.
    expect(insets).toEqual(["inside:308px", "inside:8px"]);
  });

  it("moves an outside tag in from the screen's right edge when the ring runs past it", async () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function boxOf(this: Element) {
        if (this.hasAttribute("data-scroller")) {
          return new DOMRect(0, 0, 1000, 500);
        }
        if (this.getAttribute(NODE_ID_ATTRIBUTE) === "a") {
          // 1500px wide on a 1000px screen: its right edge is 500px off it.
          return new DOMRect(0, 100, 1500, 50);
        }
        return new DOMRect(0, 0, 1500, 2000);
      }
    );
    const { container } = render(
      <div data-scroller="" style={{ overflowY: "auto" }}>
        <Canvas
          document={leaves}
          siteStyles={{ breakpoints: { viewport: [], container: [] } }}
          selectedId="a"
          overlay={<CanvasMarks revealed={["a"]} />}
        />
      </div>
    );
    await act(async () => undefined);
    await waitFor(() => expect(halosIn(container)).toHaveLength(1));
    const mark = halosIn(container)[0] as HTMLElement;
    expect(mark.getAttribute("data-tag")).toBe("below");
    expect(mark.getAttribute("data-tag-edge")).toBe("right");
    // The ring stands 4px outside the 1500px block, so it runs 504px past
    // the 1000px screen, and the tag moves in by as much.
    expect(mark.style.getPropertyValue("--nx-tag-inset-side")).toBe("504px");
  });

  it("does not put the primary block's tag above it where the block toolbar sits", async () => {
    // "c" ends at the bottom of the 500px screen, with room above it, where
    // the toolbar is drawn for the primary block.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function boxOf(this: Element) {
        if (this.hasAttribute("data-scroller")) {
          return new DOMRect(0, 0, 1000, 500);
        }
        if (this.classList.contains("nx-block-toolbar")) {
          return new DOMRect(0, 0, 200, 30);
        }
        if (this.getAttribute(NODE_ID_ATTRIBUTE) === "c") {
          return new DOMRect(0, 450, 1000, 50);
        }
        return new DOMRect(0, 0, 1000, 2000);
      }
    );
    const drawn = (toolbar: boolean) => (
      <div data-scroller="" style={{ overflowY: "auto" }}>
        <Canvas
          document={leaves}
          siteStyles={{ breakpoints: { viewport: [], container: [] } }}
          selectedId="c"
          overlay={
            <>
              <CanvasMarks revealed={["c"]} />
              {toolbar ? <div className="nx-block-toolbar" /> : null}
            </>
          }
        />
      </div>
    );
    const first = render(drawn(false));
    await act(async () => undefined);
    await waitFor(() => expect(halosIn(first.container)).toHaveLength(1));
    expect(halosIn(first.container)[0]?.getAttribute("data-tag")).toBe("above");
    cleanup();
    const second = render(drawn(true));
    await act(async () => undefined);
    await waitFor(() => expect(halosIn(second.container)).toHaveLength(1));
    expect(halosIn(second.container)[0]?.getAttribute("data-tag")).toBe(
      "inside"
    );
  });

  it("lines its tag up with the left edge of a narrow block at the left of the screen", async () => {
    onScreenGeometry();
    const { container } = render(
      <div data-scroller="" style={{ overflowY: "auto" }}>
        <Canvas
          document={leaves}
          siteStyles={{ breakpoints: { viewport: [], container: [] } }}
          selectedId="a"
          selectedIds={["a", "b"]}
          overlay={<CanvasMarks revealed={["a", "b"]} />}
        />
      </div>
    );
    await act(async () => undefined);
    await waitFor(() => expect(halosIn(container)).toHaveLength(2));
    expect(tagsOf(container)).toEqual(["below:left", "below:right"]);
  });
});

describe("an Entry content block's at-rest mark", () => {
  beforeAll(() => {
    registerBlocks([
      {
        // A stand-in drawing one element, as the real block draws its root.
        name: "core/entry-content",
        version: 1,
        description: "The entry's own content.",
        example: { props: {} },
        render: ({ className }: { className: string }) =>
          createElement("div", { className }),
      },
    ] as never);
  });

  const template = {
    formatVersion: 1,
    kind: "template",
    nodes: [
      { id: "plain", type: "acme/leaf", version: 1, props: {} },
      {
        id: "ec",
        type: "core/entry-content",
        version: 1,
        props: { field: "body" },
      },
    ],
  } as never;

  const tabsOf = (container: HTMLElement) =>
    Array.from(
      container.querySelectorAll('.nx-canvas-mark[data-mark="at-rest"]')
    ).map(mark =>
      Array.from(mark.querySelectorAll(".nx-canvas-mark__tab")).map(
        tab => tab.textContent
      )
    );

  it("marks it at rest, named by the field as the collection names it, and nothing else", async () => {
    const { container } = render(
      <PreviewedEntryProvider
        value={{ kind: "none", reason: "empty" }}
        collection={{
          slug: "posts",
          singular: "post",
          plural: "Posts",
          blocksFields: [{ name: "body", label: "Body" }],
          // Its label where it has one, else the host's words for a key: here a
          // stand-in that says which it took.
          fieldLabel: name =>
            (({ body: "Body", sidebar: "Sidebar" }) as Record<string, string>)[
              name
            ] ?? `Words for ${name}`,
          entryHref: id => `/admin/collections/posts/${id}`,
        }}
      >
        <Canvas
          document={template}
          siteStyles={{ breakpoints: { viewport: [], container: [] } }}
          overlay={<CanvasMarks />}
        />
      </PreviewedEntryProvider>
    );
    await act(async () => undefined);
    // One mark, for the Entry content block; the plain block beside it is
    // the control, which carries none.
    await waitFor(() =>
      expect(tabsOf(container)).toEqual([["Entry content · Body"]])
    );
  });

  it("names the field by its name where the collection's fields are not known", async () => {
    const { container } = render(
      <Canvas
        document={template}
        siteStyles={{ breakpoints: { viewport: [], container: [] } }}
        overlay={<CanvasMarks />}
      />
    );
    await act(async () => undefined);
    await waitFor(() =>
      expect(tabsOf(container)).toEqual([["Entry content · body"]])
    );
  });

  it("draws one outline with both tabs on a block that is conditioned too", async () => {
    const { container } = render(
      <div className={CANVAS_ROOT_CLASS}>
        {createElement("div", {
          [NODE_ID_ATTRIBUTE]: "ec",
          [CONDITIONED_ATTRIBUTE]: "conditional",
          [ENTRY_CONTENT_ATTRIBUTE]: "Entry content · Body",
        })}
        <CanvasMarks />
      </div>
    );
    await act(async () => undefined);
    await waitFor(() =>
      expect(tabsOf(container)).toEqual([
        ["Entry content · Body", "Conditional"],
      ])
    );
  });

  it("says a conditioned Entry content block is shown for the entry, beside its own tab", async () => {
    // The Entry content block carries conditions the previewed entry meets,
    // and conditions are applied: one outline, the field's tab and the
    // shown tab together, as the canvas marks it.
    const conditioned = {
      formatVersion: 1,
      kind: "template",
      nodes: [
        {
          id: "ec",
          type: "core/entry-content",
          version: 1,
          props: { field: "body" },
          visibility: {
            conditions: [[{ field: "tier", op: "equals", value: "vip" }]],
          },
        },
      ],
    } as BlockDocument;
    const fields = [{ name: "tier", type: "text" }] as const;
    const applied = appliedConditionsOf(
      conditioned,
      {
        subject: {
          fields: { declared: new Set(["tier"]), readable: fields },
          values: { tier: "vip" },
        },
        noun: "post",
        fields: conditionFieldsOfShapes(fields),
      },
      node => node.id
    );
    const { container } = render(
      <Canvas
        document={conditioned}
        siteStyles={{ breakpoints: { viewport: [], container: [] } }}
        conditionsApplied={applied}
        overlay={<CanvasMarks shownLabel="Shown for this post" />}
      />
    );
    await act(async () => undefined);
    await waitFor(() =>
      expect(tabsOf(container)).toEqual([
        ["Entry content · body", "Shown for this post"],
      ])
    );
    const mark = container.querySelector(
      '.nx-canvas-mark[data-mark="at-rest"]'
    );
    expect(mark?.getAttribute("data-condition")).toBe("shown");
    expect(
      mark?.querySelector('.nx-canvas-mark__tab[data-tab="shown"] > svg')
    ).not.toBeNull();
  });
});
