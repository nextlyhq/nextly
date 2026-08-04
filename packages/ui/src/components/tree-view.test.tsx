// @vitest-environment jsdom
/**
 * A virtualized tree is the one control where the accessibility attributes are load-bearing rather
 * than descriptive: only a window of rows exists, so depth and position cannot be read from the
 * markup and a screen reader has nothing but `aria-level`, `aria-setsize` and `aria-posinset` to
 * go on. These measure what the rendered DOM actually carries.
 *
 * jsdom reports every element as zero-sized, so a virtualizer left to measure would render an
 * empty window and every assertion below would pass against nothing. The rect is stubbed for that
 * reason, and one test asserts the window is genuinely narrower than the tree.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { TreeNode } from "./tree-view";
import { TreeView } from "./tree-view";

beforeAll(() => {
  // The virtualizer sizes its window from a ResizeObserver, and jsdom has none. A stub that only
  // records the call is not enough: with no callback the observed rect stays 0x0, the window is
  // empty, and every assertion below passes against a tree that rendered nothing. So it reports
  // once on observe, the way a real one does.
  globalThis.ResizeObserver = class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      this.callback(
        [
          {
            target,
            contentRect: target.getBoundingClientRect(),
          } as ResizeObserverEntry,
        ],
        this as unknown as ResizeObserver
      );
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;

  // A viewport tall enough to hold a window but not the whole tree.
  //
  // `offsetHeight`, not `getBoundingClientRect`: the virtualizer measures its scroll element with
  // the former, and jsdom reports zero for it. Stubbing the rect instead leaves the window empty
  // and every assertion here passing against nothing — which is what happened first.
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      return 200;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get() {
      return 240;
    },
  });
  globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  };
});

afterEach(cleanup);

// Real focus, flushed. `element.focus()` on its own dispatches the event outside React's
// batching, so the row that takes the tab stop has not been recorded by the time a key is pressed
// and every arrow lands on the wrong row.
const focusRow = (name: string): void => {
  act(() => {
    screen.getByRole("treeitem", { name }).focus();
  });
};

const tree: TreeNode[] = [
  {
    id: "page",
    label: "Page",
    children: [
      { id: "header", label: "Header" },
      {
        id: "main",
        label: "Main",
        children: [
          { id: "hero", label: "Hero" },
          { id: "cards", label: "Cards" },
        ],
      },
    ],
  },
  { id: "footer", label: "Footer" },
];

const renderTree = (
  props: Partial<React.ComponentProps<typeof TreeView>> = {}
) =>
  render(
    <TreeView
      nodes={tree}
      aria-label="Layers"
      defaultExpandedIds={["page", "main"]}
      {...props}
    />
  );

describe("what a screen reader is told", () => {
  it("describes depth and position, which the markup cannot show", () => {
    renderTree();

    const hero = screen.getByRole("treeitem", { name: "Hero" });
    expect(hero.getAttribute("aria-level")).toBe("3");
    expect(hero.getAttribute("aria-posinset")).toBe("1");
    expect(hero.getAttribute("aria-setsize")).toBe("2");
  });

  it("marks a branch expanded and a leaf as neither", () => {
    renderTree();

    expect(
      screen
        .getByRole("treeitem", { name: "Main" })
        .getAttribute("aria-expanded")
    ).toBe("true");
    expect(
      screen
        .getByRole("treeitem", { name: "Footer" })
        .hasAttribute("aria-expanded")
    ).toBe(false);
  });

  it("keeps exactly one row in the tab order", () => {
    renderTree();

    const tabbable = screen
      .getAllByRole("treeitem")
      .filter(item => item.getAttribute("tabindex") === "0");
    expect(tabbable).toHaveLength(1);
  });
});

describe("moving through it with the keyboard", () => {
  it("expands a closed branch on Right, then descends into it", () => {
    renderTree({ defaultExpandedIds: ["page"] });
    const tree = screen.getByRole("tree");

    focusRow("Main");
    fireEvent.keyDown(tree, { key: "ArrowRight" });

    expect(
      screen
        .getByRole("treeitem", { name: "Main" })
        .getAttribute("aria-expanded")
    ).toBe("true");

    fireEvent.keyDown(tree, { key: "ArrowRight" });
    expect(document.activeElement?.textContent).toContain("Hero");
  });

  it("collapses on Left, then climbs to the parent", () => {
    renderTree();
    const tree = screen.getByRole("tree");

    focusRow("Main");
    fireEvent.keyDown(tree, { key: "ArrowLeft" });
    expect(
      screen
        .getByRole("treeitem", { name: "Main" })
        .getAttribute("aria-expanded")
    ).toBe("false");

    fireEvent.keyDown(tree, { key: "ArrowLeft" });
    expect(document.activeElement?.textContent).toContain("Page");
  });

  it("selects on Enter rather than on mere focus", () => {
    const onSelectedChange = vi.fn();
    renderTree({ onSelectedChange });
    const tree = screen.getByRole("tree");

    focusRow("Header");
    expect(onSelectedChange).not.toHaveBeenCalled();

    fireEvent.keyDown(tree, { key: "Enter" });
    expect(onSelectedChange).toHaveBeenCalledWith("header");
  });

  it("types ahead to a row further down", () => {
    renderTree();
    const tree = screen.getByRole("tree");

    focusRow("Page");
    fireEvent.keyDown(tree, { key: "f" });

    expect(document.activeElement?.textContent).toContain("Footer");
  });

  it("skips a disabled row instead of landing on it", () => {
    render(
      <TreeView
        aria-label="Layers"
        nodes={[
          { id: "a", label: "A" },
          { id: "b", label: "B", disabled: true },
          { id: "c", label: "C" },
        ]}
      />
    );
    const tree = screen.getByRole("tree");

    focusRow("A");
    fireEvent.keyDown(tree, { key: "ArrowDown" });

    expect(document.activeElement?.textContent).toContain("C");
  });
});

describe("virtualization", () => {
  it("renders a window rather than the whole tree", () => {
    // The point of the control. Asserted because every accessibility test above would pass
    // vacuously against a tree that rendered nothing, and trivially against one that rendered
    // everything — this is what says the virtualizer is actually engaged.
    const many: TreeNode[] = Array.from({ length: 500 }, (_unused, index) => ({
      id: `n${index}`,
      label: `Node ${index}`,
    }));
    render(<TreeView nodes={many} aria-label="Layers" />);

    const rendered = screen.getAllByRole("treeitem");
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.length).toBeLessThan(many.length);
  });

  it("sizes the tree for every row, so the scrollbar tells the truth", () => {
    const many: TreeNode[] = Array.from({ length: 500 }, (_unused, index) => ({
      id: `n${index}`,
      label: `Node ${index}`,
    }));
    render(<TreeView nodes={many} aria-label="Layers" />);

    // 500 rows at 28px. A height of only the rendered window would make the scrollbar claim the
    // tree is a fraction of its real length.
    expect(screen.getByRole("tree").style.height).toBe("14000px");
  });
});
