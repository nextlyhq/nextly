// @vitest-environment jsdom

/**
 * Dragging a Layers row, through the panel and a real editor.
 *
 * jsdom lays nothing out, so every row is given the rectangle the tree would
 * draw it at: 28px each, stacked from the top, in a tree 300px wide that
 * reaches well past them. Where the rows go and whether they may is `layers-drop`'s, asserted
 * there; what is only true HERE is the gesture — when a press becomes a drag,
 * when one may start at all, what a release commits, how Escape ends one, and
 * the wait before a collapsed row opens.
 *
 * @module layers-drag.test
 */
import {
  clearBlocks,
  COMPONENT_INSTANCE_TYPE,
  registerBlocks,
  type ComponentLookup,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
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

import { useEditorState, type EditorState } from "./editor-state";

/*
 * The engine's `locateNode`, counted and passed through, so a test can see how
 * often a pointer move walks the document to place a block. Everything else
 * in the engine is the real thing.
 */
const located = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@nextlyhq/blocks-engine", async importOriginal => {
  const engine =
    await importOriginal<typeof import("@nextlyhq/blocks-engine")>();
  return {
    ...engine,
    locateNode: (...args: Parameters<typeof engine.locateNode>) => {
      located.calls += 1;
      return engine.locateNode(...args);
    },
  };
});
import {
  LAYERS_OPEN_DELAY_MS,
  LAYERS_TOUCH_HOLD_MS,
  LAYERS_TOUCH_TOLERANCE_PX,
} from "./layers-drag";
import { HoveredBlockProvider, useHoveredBlock } from "./hovered-block";
import { LayersPanel } from "./layers-panel";

const ROW = 28;
/** Where a top-level row is pressed, across. */
const X = 40;

/** Pointer ids the panel has taken capture of, newest last. */
let captured: number[] = [];
let realRect: () => DOMRect;

beforeAll(() => {
  const element = window.Element.prototype as unknown as Record<
    string,
    unknown
  >;
  element.scrollIntoView = function scrollIntoView(): void {};
  element.setPointerCapture = function setPointerCapture(id: number): void {
    captured.push(id);
  };
  element.releasePointerCapture = function releasePointerCapture(): void {};
  element.hasPointerCapture = function hasPointerCapture(): boolean {
    return false;
  };
  (window as unknown as Record<string, unknown>).ResizeObserver =
    class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  // A virtualizer told its viewport is zero pixels tall draws no rows.
  Object.defineProperty(window.HTMLElement.prototype, "clientHeight", {
    configurable: true,
    value: 800,
  });
  Object.defineProperty(window.HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    value: 800,
  });
  // Each row where the tree would draw it, by its index; the tree and the
  // element around it span the panel.
  realRect = window.Element.prototype.getBoundingClientRect;
  window.Element.prototype.getBoundingClientRect =
    function getBoundingClientRect(this: Element): DOMRect {
      const box = (top: number, height: number) =>
        ({
          x: 0,
          y: top,
          top,
          left: 0,
          width: 300,
          right: 300,
          height,
          bottom: top + height,
        }) as DOMRect;
      const index = this.getAttribute("data-tree-index");
      if (this.getAttribute("role") === "treeitem" && index !== null) {
        // Moved up by however far the tree has scrolled, as a real one is.
        const scrolled = this.closest(".nx-layers-panel__tree")?.scrollTop ?? 0;
        return box(Number(index) * ROW - scrolled, ROW);
      }
      if (
        this.classList.contains("nx-layers-panel__tree") ||
        this.classList.contains("nx-layers-panel__body")
      ) {
        // Reaching well past the rows at both ends, so no row sits in the
        // bands near an edge where a held drag scrolls the tree. As tall as
        // the laid-out height the panel reports, so nothing reads as scaled.
        return box(-200, 800);
      }
      return box(0, 0);
    };
});

afterAll(() => {
  window.Element.prototype.getBoundingClientRect = realRect;
});

const base = {
  version: 1,
  description: "A block.",
  example: { props: {} },
  render: () => null,
};

beforeEach(() => {
  registerBlocks(
    [
      { ...base, name: "core/heading", editor: { label: "Heading" } },
      {
        ...base,
        name: "core/box",
        editor: { label: "Box" },
        slots: { children: {} },
      },
      {
        ...base,
        name: "t/card",
        editor: { label: "Card" },
        slots: { children: {} },
        contentModel: (props: { link?: string }) =>
          props.link
            ? {
                is: ["flow", "interactive"],
                accepts: { without: ["interactive"] },
              }
            : { is: ["flow"] },
      },
      {
        ...base,
        name: "t/button",
        editor: { label: "Button" },
        contentModel: () => ({ is: ["flow", "phrasing", "interactive"] }),
      },
      {
        ...base,
        name: "t/fixed-row",
        editor: { label: "Fixed row" },
        slots: {
          items: { defaultBlock: [{ type: "core/heading" }], lock: "all" },
        },
      },
    ] as never,
    { source: "layers-drag-test" }
  );
});

afterEach(() => {
  cleanup();
  clearBlocks();
  captured = [];
  vi.useRealTimers();
});

function node(id: string, type: string, extra: Partial<BlockNode> = {}) {
  return { id, type, version: 1, props: {}, ...extra } as BlockNode;
}

function page(nodes: BlockNode[]): BlockDocument {
  return { formatVersion: 1, kind: "page", nodes } as BlockDocument;
}

let editorRef: EditorState | null = null;

function Host({
  document,
  refuseApply = false,
  definitions,
}: {
  document: BlockDocument;
  /** An editor whose apply refuses every op, as one refusing a stale move. */
  refuseApply?: boolean;
  /** The component definitions the panel judges instances by. */
  definitions?: ComponentLookup;
}): React.JSX.Element {
  const editor = useEditorState({ initialDocument: document });
  editorRef = editor;
  return (
    <LayersPanel
      editor={refuseApply ? { ...editor, apply: () => null } : editor}
      {...(definitions === undefined ? {} : { definitions })}
    />
  );
}

function editor(): EditorState {
  if (editorRef === null) throw new Error("no editor rendered");
  return editorRef;
}

/** The page as ids: `parent>id` inside a container. */
function structure(): string[] {
  const out: string[] = [];
  const walk = (nodes: readonly BlockNode[], parent?: string): void => {
    for (const each of nodes) {
      out.push(parent === undefined ? each.id : `${parent}>${each.id}`);
      walk(Object.values(each.slots ?? {}).flat(), each.id);
    }
  };
  walk(editor().document.nodes);
  return out;
}

function body(container: HTMLElement): HTMLElement {
  const found = container.querySelector<HTMLElement>(".nx-layers-panel__body");
  if (found === null) throw new Error("no drag body rendered");
  return found;
}

function label(id: string): Element {
  const found = document.querySelector(`[data-nx-layer="${id}"]`);
  if (found === null) throw new Error(`no row for ${id}`);
  return found;
}

/** Press a row at a height inside it, at the top level's x. */
function press(id: string, y: number, x = X): void {
  fireEvent.pointerDown(label(id), {
    button: 0,
    pointerId: 1,
    clientX: x,
    clientY: y,
  });
}

function moveTo(container: HTMLElement, x: number, y: number): void {
  fireEvent.pointerMove(body(container), {
    pointerId: 1,
    clientX: x,
    clientY: y,
  });
}

function release(container: HTMLElement, x: number, y: number): void {
  fireEvent.pointerUp(body(container), {
    pointerId: 1,
    clientX: x,
    clientY: y,
  });
}

function line(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>(".nx-layers-drop-line");
}

function threeHeadings() {
  return render(
    <Host
      document={page([
        node("a", "core/heading"),
        node("b", "core/heading"),
        node("c", "core/heading"),
      ])}
    />
  );
}

describe("dragging a Layers row", () => {
  it("leaves a press that travels less than the activation distance a click", () => {
    const { container } = threeHeadings();
    press("a", 10);
    moveTo(container, X + 2, 12);
    expect(captured).toEqual([]);
    expect(body(container).hasAttribute("data-nx-dragging")).toBe(false);
    release(container, X + 2, 12);
    expect(structure()).toEqual(["a", "b", "c"]);
  });

  it("marks the row in hand while it is dragged, and only then", () => {
    const { container } = threeHeadings();
    const source = () =>
      label("a").closest(".nx-layer-row")?.hasAttribute("data-nx-drag-source");
    press("a", 10);
    expect(source()).toBe(false);
    moveTo(container, X, 20);
    expect(source()).toBe(true);
    // Only the row in hand.
    expect(
      label("b").closest(".nx-layer-row")?.hasAttribute("data-nx-drag-source")
    ).toBe(false);
    release(container, X, 20);
    expect(source()).toBe(false);
  });

  it("lets the hover outline go as a drag starts, though no other row was entered", () => {
    function Probe(): React.JSX.Element {
      return <output data-testid="hovered">{useHoveredBlock() ?? ""}</output>;
    }
    const { container } = render(
      <HoveredBlockProvider>
        <Host
          document={page([
            node("a", "core/heading"),
            node("b", "core/heading"),
            node("c", "core/heading"),
          ])}
        />
        <Probe />
      </HoveredBlockProvider>
    );
    fireEvent.pointerOver(label("a"));
    expect(screen.getByTestId("hovered").textContent).toBe("a");
    press("a", 10);
    moveTo(container, X, 20);
    expect(screen.getByTestId("hovered").textContent).toBe("");
    release(container, X, 20);
  });

  it("moves a row dragged down past another, as ONE undo step", () => {
    const { container } = threeHeadings();
    const before = editor().undoDepth;
    press("a", 10);
    moveTo(container, X, 20);
    expect(captured).toEqual([1]);
    // The lower half of the last row: after it.
    moveTo(container, X, 3 * ROW - 4);
    expect(line(container)).not.toBeNull();
    release(container, X, 3 * ROW - 4);

    expect(structure()).toEqual(["b", "c", "a"]);
    expect(editor().undoDepth).toBe(before + 1);
    act(() => editor().undo());
    expect(structure()).toEqual(["a", "b", "c"]);
  });

  it("keeps the depth on a drag straight down past a container", () => {
    const { container } = render(
      <Host
        document={page([
          node("a", "core/heading"),
          node("box", "core/box"),
          node("c", "core/heading"),
        ])}
      />
    );
    press("a", 10);
    moveTo(container, X, 20);
    // The lower half of the box, at the x the press began: after the box at
    // the top level, not inside it.
    moveTo(container, X, 2 * ROW - 4);
    release(container, X, 2 * ROW - 4);
    expect(structure()).toEqual(["box", "a", "c"]);
  });

  it("nests a row dragged to the right inside the row above it", () => {
    const { container } = render(
      <Host
        document={page([node("box", "core/box"), node("h", "core/heading")])}
      />
    );
    press("h", ROW + 14);
    moveTo(container, X, ROW + 8);
    // One level right, over the top of its own row: the gap under the box.
    moveTo(container, X + 20, ROW + 4);
    release(container, X + 20, ROW + 4);
    expect(structure()).toEqual(["box", "box>h"]);
  });

  it("refuses a drop the placement rule forbids, says why, and leaves the block", () => {
    const { container } = render(
      <Host
        document={page([
          node("card", "t/card", { props: { link: "/go" } }),
          node("button", "t/button"),
        ])}
      />
    );
    const before = editor().undoDepth;
    press("button", ROW + 14);
    moveTo(container, X, ROW + 8);
    moveTo(container, X + 20, ROW + 4);

    const drawn = line(container);
    expect(drawn?.hasAttribute("data-refused")).toBe(true);
    // The cursor says no, as it does over a refused place on the canvas.
    expect(body(container).getAttribute("data-nx-dragging")).toBe("refused");
    const sentence = "A Button can't go inside this Card.";
    const notice = container.querySelector(".nx-layers-drop-refusal");
    expect(notice?.textContent).toContain(sentence);
    // On the notice surface with a warning mark, not the canvas's red fill.
    expect(notice?.classList.contains("nx-drop-refusal")).toBe(false);
    expect(notice?.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByRole("status").textContent).toContain(sentence);

    release(container, X + 20, ROW + 4);
    expect(structure()).toEqual(["card", "button"]);
    expect(editor().undoDepth).toBe(before);
  });

  it("draws the reason outside the tree, so every row stays readable", () => {
    const { container } = render(
      <Host
        document={page([
          node("card", "t/card", { props: { link: "/go" } }),
          node("button", "t/button"),
        ])}
      />
    );
    press("button", ROW + 14);
    moveTo(container, X, ROW + 8);
    moveTo(container, X + 20, ROW + 4);
    const notice = container.querySelector<HTMLElement>(
      ".nx-layers-drop-refusal"
    );
    if (notice === null) throw new Error("no refusal drawn");
    // Placed in the window, past the right edge of the tree's rows (the tree
    // spans 0 to 300 here), and level with the line it explains.
    expect(notice.style.position).toBe("fixed");
    expect(Number.parseFloat(notice.style.left)).toBeGreaterThanOrEqual(300);
    expect(Number.parseFloat(notice.style.top)).toBeGreaterThanOrEqual(0);
    release(container, X + 20, ROW + 4);
  });

  it("judges the place again when the component definitions arrive mid-drag", () => {
    // A placement of a component whose root is a Button, aimed inside a linked
    // Card. Before the library loads, the placement cannot be read and nothing
    // refuses it; once it loads, its Button may not go inside a link.
    const doc = page([
      node("card", "t/card", { props: { link: "/go" } }),
      node("promo", COMPONENT_INSTANCE_TYPE, {
        props: { componentId: "promo-def" },
      }),
    ]);
    const loaded: ComponentLookup = new Map([
      [
        "promo-def",
        {
          formatVersion: 1,
          kind: "component",
          nodes: [node("inner-button", "t/button")],
          slots: {},
        } as unknown as BlockDocument,
      ],
    ]);
    const { container, rerender } = render(
      <Host document={doc} definitions={new Map()} />
    );
    press("promo", ROW + 14);
    moveTo(container, X, ROW + 8);
    moveTo(container, X + 20, ROW + 4);
    expect(line(container)?.hasAttribute("data-refused")).toBe(false);

    rerender(<Host document={doc} definitions={loaded} />);
    expect(line(container)?.hasAttribute("data-refused")).toBe(true);
    release(container, X + 20, ROW + 4);
    expect(structure()).toEqual(["card", "promo"]);
  });

  it("clears the spoken reason when the drag ends, and speaks it again on the next", () => {
    const { container } = render(
      <Host
        document={page([
          node("card", "t/card", { props: { link: "/go" } }),
          node("button", "t/button"),
        ])}
      />
    );
    const sentence = "A Button can't go inside this Card.";
    const refuse = (): void => {
      press("button", ROW + 14);
      moveTo(container, X, ROW + 8);
      moveTo(container, X + 20, ROW + 4);
    };

    refuse();
    expect(screen.getByRole("status").textContent).toContain(sentence);
    // Away to a gap that is not refused, and back: the region goes quiet and
    // then holds the reason again, a change it reads out a second time.
    moveTo(container, X, ROW + 4);
    expect(screen.getByRole("status").textContent).toBe("");
    moveTo(container, X + 20, ROW + 4);
    expect(screen.getByRole("status").textContent).toContain(sentence);
    release(container, X + 20, ROW + 4);
    // The region describes a drag that has ended no longer.
    expect(screen.getByRole("status").textContent).toBe("");

    refuse();
    expect(screen.getByRole("status").textContent).toContain(sentence);
    release(container, X + 20, ROW + 4);
  });

  it("refuses every drop for a block holding a locked block, in the lock's words", () => {
    const { container } = render(
      <Host
        document={page([
          node("box", "core/box", {
            slots: {
              children: [node("caption", "core/heading", { locked: true })],
            },
          }),
          node("h", "core/heading"),
        ])}
      />
    );
    const before = editor().undoDepth;
    press("box", 14);
    moveTo(container, X, 20);
    // After the last row, where nothing else would refuse it.
    moveTo(container, X, 2 * ROW - 4);
    expect(line(container)?.hasAttribute("data-refused")).toBe(true);
    expect(screen.getByRole("status").textContent).toContain(
      "Heading inside this block is locked. Unlock Heading to move this block."
    );
    release(container, X, 2 * ROW - 4);
    expect(structure()).toEqual(["box", "box>caption", "h"]);
    expect(editor().undoDepth).toBe(before);
  });

  it("says so when the editor refuses a drop it drew as allowed", () => {
    const { container } = render(
      <Host
        refuseApply
        document={page([node("a", "core/heading"), node("b", "core/heading")])}
      />
    );
    press("a", 10);
    moveTo(container, X, 20);
    moveTo(container, X, 2 * ROW - 4);
    expect(line(container)?.hasAttribute("data-refused")).toBe(false);
    release(container, X, 2 * ROW - 4);
    expect(screen.getByRole("status").textContent).toBe(
      "Heading could not be moved."
    );
  });

  it("announces a second refused drop afresh, the region cleared in between", () => {
    const { container } = render(
      <Host
        refuseApply
        document={page([node("a", "core/heading"), node("b", "core/heading")])}
      />
    );
    const region = () => screen.getByRole("status").textContent;
    const attempt = (): void => {
      press("a", 10);
      moveTo(container, X, 20);
      moveTo(container, X, 2 * ROW - 4);
    };
    attempt();
    release(container, X, 2 * ROW - 4);
    expect(region()).toBe("Heading could not be moved.");
    // A new drag starts quiet: the region no longer reports the last one, so
    // the same sentence after this drag is a change it reads out again.
    attempt();
    expect(region()).toBe("");
    release(container, X, 2 * ROW - 4);
    expect(region()).toBe("Heading could not be moved.");
  });

  it("starts no drag while a search filters the rows", () => {
    const { container } = threeHeadings();
    fireEvent.change(screen.getByLabelText("Search layers"), {
      target: { value: "heading" },
    });
    press("a", 10);
    moveTo(container, X, 20);
    moveTo(container, X, 3 * ROW - 4);
    release(container, X, 3 * ROW - 4);
    expect(captured).toEqual([]);
    expect(structure()).toEqual(["a", "b", "c"]);
  });

  it("refuses every drop for a locked block, saying it is locked", () => {
    // The drag starts so that it can say why it lands nowhere: a block that
    // simply would not lift would leave the author guessing.
    const { container } = render(
      <Host
        document={page([
          node("a", "core/heading", { locked: true }),
          node("b", "core/heading"),
        ])}
      />
    );
    press("a", 10);
    moveTo(container, X, 20);
    moveTo(container, X, 2 * ROW - 4);
    expect(line(container)?.hasAttribute("data-refused")).toBe(true);
    expect(screen.getByRole("status").textContent).toContain(
      "Heading is locked. Unlock it to move it."
    );
    release(container, X, 2 * ROW - 4);
    expect(structure()).toEqual(["a", "b"]);
  });

  it("starts no drag on a block its locked area holds in place", () => {
    const { container } = render(
      <Host
        document={page([
          node("row", "t/fixed-row", {
            slots: { items: [node("fixed", "core/heading")] },
          }),
          node("loose", "core/heading"),
        ])}
      />
    );
    // Selecting it opens the row, so its own row is on screen to press.
    act(() => editor().select("fixed"));
    press("fixed", ROW + 14);
    moveTo(container, X, ROW + 20);
    moveTo(container, X, 3 * ROW - 4);
    release(container, X, 3 * ROW - 4);
    expect(captured).toEqual([]);
    expect(structure()).toEqual(["row", "row>fixed", "loose"]);
  });

  it("refuses a drop into a locked area, in the lock's own words", () => {
    const { container } = render(
      <Host
        document={page([
          node("row", "t/fixed-row", {
            slots: { items: [node("fixed", "core/heading")] },
          }),
          node("loose", "core/heading"),
        ])}
      />
    );
    act(() => editor().select("fixed"));
    // The last row, dragged to the gap under the locked area's block, one
    // level in: inside the area.
    press("loose", 2 * ROW + 14);
    moveTo(container, X, 2 * ROW + 8);
    moveTo(container, X + 20, 2 * ROW + 4);
    expect(line(container)?.hasAttribute("data-refused")).toBe(true);
    expect(screen.getByRole("status").textContent).toContain(
      "This area of Fixed row is locked."
    );
    release(container, X + 20, 2 * ROW + 4);
    expect(structure()).toEqual(["row", "row>fixed", "loose"]);
  });

  it("aims nowhere once the pointer leaves the tree, so a release there moves nothing", () => {
    const { container } = threeHeadings();
    press("a", 10);
    moveTo(container, X, 20);
    moveTo(container, X, 3 * ROW - 4);
    expect(line(container)).not.toBeNull();
    // Past the tree's right edge, at a height that is still a row's.
    moveTo(container, 400, 3 * ROW - 4);
    expect(line(container)).toBeNull();
    release(container, 400, 3 * ROW - 4);
    expect(structure()).toEqual(["a", "b", "c"]);
  });

  it("abandons the drag on Escape, so the release moves nothing", () => {
    const { container } = threeHeadings();
    press("a", 10);
    moveTo(container, X, 20);
    moveTo(container, X, 3 * ROW - 4);
    expect(line(container)).not.toBeNull();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(line(container)).toBeNull();
    release(container, X, 3 * ROW - 4);
    expect(structure()).toEqual(["a", "b", "c"]);
  });

  it("opens a collapsed row the pointer rests on, after the delay and not before", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { container } = render(
      <Host
        document={page([
          node("box", "core/box", {
            slots: { children: [node("inner", "core/heading")] },
          }),
          node("h", "core/heading"),
        ])}
      />
    );
    const boxRow = () => label("box").closest('[role="treeitem"]');
    expect(boxRow()?.getAttribute("aria-expanded")).toBe("false");

    press("h", ROW + 14);
    moveTo(container, X, ROW + 8);
    moveTo(container, X, 10);
    act(() => {
      vi.advanceTimersByTime(LAYERS_OPEN_DELAY_MS - 1);
    });
    expect(boxRow()?.getAttribute("aria-expanded")).toBe("false");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(boxRow()?.getAttribute("aria-expanded")).toBe("true");
  });

  it("reads the aim again once a rested row opens, so the release lands at the line", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { container } = render(
      <Host
        document={page([
          node("box", "core/box", {
            slots: { children: [node("inner", "core/heading")] },
          }),
          node("h", "core/heading"),
        ])}
      />
    );
    press("h", ROW + 14);
    moveTo(container, X, ROW + 8);
    // The lower half of the closed box, one level in: inside it, at the end.
    moveTo(container, X + 20, ROW - 4);
    act(() => {
      vi.advanceTimersByTime(LAYERS_OPEN_DELAY_MS);
    });
    // Open now, with its first block drawn under the same pointer: the gap is
    // before that block. A frame passes with no pointer move at all.
    await act(
      () => new Promise<void>(done => requestAnimationFrame(() => done()))
    );
    release(container, X + 20, ROW - 4);
    expect(structure()).toEqual(["box", "box>h", "box>inner"]);
  });

  it("aims again when the tree is scrolled under a still pointer", async () => {
    const { container } = threeHeadings();
    const tree = container.querySelector<HTMLElement>(".nx-layers-panel__tree");
    if (tree === null) throw new Error("no tree rendered");
    // c over the lower half of a: the gap after a.
    press("c", 2 * ROW + 14);
    moveTo(container, X, 2 * ROW + 8);
    moveTo(container, X, ROW - 4);
    // A wheel scroll of one row, away from the edges: no pointer event, and
    // the pointer is now over the lower half of b, the gap c already sits in.
    tree.scrollTop = ROW;
    await act(
      () => new Promise<void>(done => requestAnimationFrame(() => done()))
    );
    await act(
      () => new Promise<void>(done => requestAnimationFrame(() => done()))
    );
    release(container, X, ROW - 4);
    expect(structure()).toEqual(["a", "b", "c"]);
  });

  it("scrolls the tree while the pointer rests near its bottom edge", async () => {
    const { container } = threeHeadings();
    const tree = container.querySelector<HTMLElement>(".nx-layers-panel__tree");
    if (tree === null) throw new Error("no tree rendered");
    press("a", 10);
    moveTo(container, X, 20);
    // Inside the band at the tree's bottom edge, and then held still.
    moveTo(container, X, 595);
    const before = tree.scrollTop;
    await act(
      () => new Promise<void>(done => requestAnimationFrame(() => done()))
    );
    await act(
      () => new Promise<void>(done => requestAnimationFrame(() => done()))
    );
    expect(tree.scrollTop).toBeGreaterThan(before);
    release(container, X, 595);
  });

  it("places the rows without walking the document once per row on each move", () => {
    // Twenty blocks inside a box, and one after it. The same pointer move is
    // made with the box closed (two rows drawn) and open (twenty-two): what a
    // move costs in document walks must not grow with the rows on screen.
    const inside = Array.from({ length: 20 }, (_, i) =>
      node(`in${String(i)}`, "core/heading")
    );
    const doc = page([
      node("box", "core/box", { slots: { children: inside } }),
      node("h", "core/heading"),
    ]);
    const walksPerMove = (open: boolean): number => {
      const { container, unmount } = render(<Host document={doc} />);
      if (open) act(() => editor().select("in0"));
      const last = open ? 21 : 1;
      press("h", last * ROW + 14);
      moveTo(container, X, last * ROW + 8);
      located.calls = 0;
      moveTo(container, X, last * ROW + 4);
      const calls = located.calls;
      release(container, X, last * ROW + 4);
      unmount();
      return calls;
    };
    const closed = walksPerMove(false);
    const opened = walksPerMove(true);
    expect(opened - closed).toBeLessThan(5);
  });
});

describe("a Layers drag whose ground goes from under it", () => {
  const FRAMES = [
    "setTimeout",
    "clearTimeout",
    "requestAnimationFrame",
    "cancelAnimationFrame",
  ] as const;

  /** A drag of `a`, active and aimed past `b`. */
  function dragging(container: HTMLElement): void {
    press("a", 10);
    moveTo(container, X, 20);
    moveTo(container, X, 2 * ROW - 4);
    expect(body(container).hasAttribute("data-nx-dragging")).toBe(true);
  }

  it("ends when the dragged block is deleted mid-drag, and schedules nothing more", () => {
    vi.useFakeTimers({ toFake: [...FRAMES] });
    const { container } = render(
      <Host
        document={page([node("a", "core/heading"), node("b", "core/heading")])}
      />
    );
    dragging(container);
    act(() => {
      editor().apply({ kind: "remove", id: "a" });
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(container.querySelector("[data-nx-dragging]")).toBeNull();
    expect(line(container)).toBeNull();
    // No frame loop left running against a gesture that has ended.
    expect(vi.getTimerCount()).toBe(0);
    fireEvent.pointerUp(
      container.querySelector(".nx-layers-panel__body") ?? document.body,
      {
        pointerId: 1,
        clientX: X,
        clientY: 2 * ROW - 4,
      }
    );
    expect(structure()).toEqual(["b"]);
  });

  it("ends when the tree it is on leaves the page, with the document unchanged", () => {
    vi.useFakeTimers({ toFake: [...FRAMES] });
    const { container } = threeHeadings();
    dragging(container);
    // A search typed mid-drag that matches nothing: the panel swaps its tree
    // for the no-match note, and the element the drag is on is gone.
    fireEvent.change(screen.getByLabelText("Search layers"), {
      target: { value: "nothing matches this" },
    });
    expect(container.querySelector(".nx-layers-panel__body")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ends when the browser takes the pointer away", () => {
    vi.useFakeTimers({ toFake: [...FRAMES] });
    const { container } = threeHeadings();
    dragging(container);
    fireEvent.lostPointerCapture(body(container), { pointerId: 1 });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(body(container).hasAttribute("data-nx-dragging")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    release(container, X, 2 * ROW - 4);
    expect(structure()).toEqual(["a", "b", "c"]);
  });
});

describe("dragging a Layers row by touch", () => {
  /** A finger on a row: a touch pointer, which picks up only after a hold. */
  function touch(id: string, y: number): void {
    fireEvent.pointerDown(label(id), {
      button: 0,
      pointerId: 1,
      pointerType: "touch",
      clientX: X,
      clientY: y,
    });
  }

  /** A touchmove the browser could still turn into a pan, as it reaches the tree. */
  function touchMove(container: HTMLElement): Event {
    const event = new Event("touchmove", { bubbles: true, cancelable: true });
    label("a").dispatchEvent(event);
    void container;
    return event;
  }

  it("picks a row up after the hold, and not before", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { container } = threeHeadings();
    touch("a", 10);
    act(() => {
      vi.advanceTimersByTime(LAYERS_TOUCH_HOLD_MS - 1);
    });
    expect(body(container).hasAttribute("data-nx-dragging")).toBe(false);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(body(container).hasAttribute("data-nx-dragging")).toBe(true);
    expect(
      label("a").closest(".nx-layer-row")?.hasAttribute("data-nx-drag-source")
    ).toBe(true);

    // Once picked up it drags as a mouse does: down past the last row.
    moveTo(container, X, 3 * ROW - 4);
    release(container, X, 3 * ROW - 4);
    expect(structure()).toEqual(["b", "c", "a"]);
  });

  it("leaves a finger that moves before the hold to scroll the list", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { container } = threeHeadings();
    touch("a", 10);
    moveTo(container, X, 10 + LAYERS_TOUCH_TOLERANCE_PX + 1);
    act(() => {
      vi.advanceTimersByTime(LAYERS_TOUCH_HOLD_MS);
    });
    expect(captured).toEqual([]);
    expect(body(container).hasAttribute("data-nx-dragging")).toBe(false);
    // Nothing holds the page, so the browser may pan it.
    expect(touchMove(container).defaultPrevented).toBe(false);
  });

  it("survives the pointer's capture moving from the row to the tree", () => {
    // A touch is captured by the row it lands on; picking the row up moves
    // the capture to the tree, and the browser reports the row losing it.
    // That is the drag taking hold, not the browser taking the pointer away.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { container } = threeHeadings();
    touch("a", 10);
    act(() => {
      vi.advanceTimersByTime(LAYERS_TOUCH_HOLD_MS);
    });
    fireEvent.lostPointerCapture(label("a"), { pointerId: 1 });
    expect(body(container).hasAttribute("data-nx-dragging")).toBe(true);
    moveTo(container, X, 3 * ROW - 4);
    release(container, X, 3 * ROW - 4);
    expect(structure()).toEqual(["b", "c", "a"]);
  });

  it("keeps the hold through a tremor within the tolerance", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { container } = threeHeadings();
    touch("a", 10);
    moveTo(container, X + 2, 10 + LAYERS_TOUCH_TOLERANCE_PX - 2);
    act(() => {
      vi.advanceTimersByTime(LAYERS_TOUCH_HOLD_MS);
    });
    expect(body(container).hasAttribute("data-nx-dragging")).toBe(true);
    release(container, X, 10);
  });

  it("stops the page panning only while a row is held", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { container } = threeHeadings();
    touch("a", 10);
    // During the hold the finger may still be a scroll.
    expect(touchMove(container).defaultPrevented).toBe(false);
    act(() => {
      vi.advanceTimersByTime(LAYERS_TOUCH_HOLD_MS);
    });
    expect(touchMove(container).defaultPrevented).toBe(true);
    release(container, X, 10);
    // And the list scrolls by touch again once the drag ends.
    expect(touchMove(container).defaultPrevented).toBe(false);
  });
});
