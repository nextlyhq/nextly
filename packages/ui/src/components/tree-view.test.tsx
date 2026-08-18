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
import * as React from "react";
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

describe("naming the tree", () => {
  it("puts aria-labelledby on the element that carries the role", () => {
    // Left on the scroll container, the label names a plain div and the tree itself is announced
    // with no accessible name — while the caller believes they supplied one.
    render(
      <>
        <h2 id="layers-heading">Layers</h2>
        <TreeView nodes={tree} aria-labelledby="layers-heading" />
      </>
    );

    expect(screen.getByRole("tree", { name: "Layers" })).toBeDefined();
  });
});

describe("a branch with nothing in it yet", () => {
  it("treats a declared but empty children array as expandable", () => {
    // An empty folder, or one whose contents have not loaded, is still something to open. The
    // exported contract says an empty array marks a parent, so reading its length would quietly
    // contradict the type.
    render(
      <TreeView
        aria-label="Layers"
        nodes={[{ id: "empty", label: "Empty", children: [] }]}
      />
    );

    expect(
      screen
        .getByRole("treeitem", { name: "Empty" })
        .getAttribute("aria-expanded")
    ).toBe("false");
  });
});

describe("where Tab lands", () => {
  it("keeps a tab stop when the selected row is outside the rendered window", () => {
    // The selection is real but its row does not exist yet at scrollTop 0. With the tab stop tied
    // to it, every rendered row is tabIndex -1 and the tree cannot be reached by Tab at all.
    const many: TreeNode[] = Array.from({ length: 500 }, (_unused, index) => ({
      id: `n${index}`,
      label: `Node ${index}`,
    }));
    render(
      <TreeView nodes={many} aria-label="Layers" defaultSelectedId="n400" />
    );

    const tabbable = screen
      .getAllByRole("treeitem")
      .filter(item => item.getAttribute("tabindex") === "0");
    expect(tabbable).toHaveLength(1);
  });

  it("does not put the tab stop on a disabled row", () => {
    // Pointer and every arrow key skip a disabled row, so Tab landing on one contradicts the rest
    // of the control.
    render(
      <TreeView
        aria-label="Layers"
        nodes={[
          { id: "a", label: "A", disabled: true },
          { id: "b", label: "B" },
        ]}
      />
    );

    expect(
      screen.getByRole("treeitem", { name: "A" }).getAttribute("tabindex")
    ).toBe("-1");
    expect(
      screen.getByRole("treeitem", { name: "B" }).getAttribute("tabindex")
    ).toBe("0");
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
    // The gesture travels with the id now; a plain Enter is a replace.
    expect(onSelectedChange).toHaveBeenCalledWith("header", "replace");
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

describe("Alt is left to the host", () => {
  it("does not move focus on alt+ArrowDown, and does not consume the event", () => {
    /*
     * A host binding `alt+ArrowDown` — reordering the selected block, in the
     * page editor — otherwise loses it exactly where an author is most likely
     * to press it. The switch reads `event.key`, and `ArrowDown` is
     * `ArrowDown` whatever modifiers are held, so the row took focus and
     * called `preventDefault` instead.
     */
    render(
      <TreeView
        aria-label="Layers"
        nodes={[
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ]}
      />
    );
    const tree = screen.getByRole("tree");

    focusRow("A");
    const handled = fireEvent.keyDown(tree, {
      key: "ArrowDown",
      altKey: true,
    });

    // Focus stays put: navigation did not happen.
    expect(document.activeElement?.textContent).toContain("A");
    // And the event was NOT cancelled, so it goes on bubbling to the host.
    // `fireEvent` returns false only when something called preventDefault.
    expect(handled).toBe(true);
  });

  it("still navigates on a BARE ArrowDown, which is the control", () => {
    // Without this, the assertion above passes on a tree that ignores every
    // arrow key — including the ones it is supposed to handle.
    render(
      <TreeView
        aria-label="Layers"
        nodes={[
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ]}
      />
    );
    const tree = screen.getByRole("tree");

    focusRow("A");
    const handled = fireEvent.keyDown(tree, { key: "ArrowDown" });

    expect(document.activeElement?.textContent).toContain("B");
    expect(handled).toBe(false);
  });

  it("leaves alt+ArrowRight alone rather than expanding a branch", () => {
    // The host binds all four directions; Right and Left are its indent and
    // outdent, and expanding here would answer a gesture meant for the editor.
    render(
      <TreeView
        aria-label="Layers"
        nodes={[
          {
            id: "section",
            label: "Section",
            children: [{ id: "kid", label: "Kid" }],
          },
        ]}
      />
    );
    const tree = screen.getByRole("tree");

    focusRow("Section");
    fireEvent.keyDown(tree, { key: "ArrowRight", altKey: true });

    expect(screen.queryByText("Kid")).toBeNull();
    // Control: the same key without Alt does expand, so the assertion above is
    // about the modifier rather than about the branch being unopenable.
    fireEvent.keyDown(tree, { key: "ArrowRight" });
    expect(screen.getByText("Kid")).toBeTruthy();
  });
});

describe("arrow keys stay inside the hierarchy", () => {
  it("does not leave the branch when an expanded one has nothing to enter", () => {
    // An empty array marks a branch, so Right on an already-open empty one has nowhere to go. A
    // move that searched the whole flattened tree would jump to whatever came next in the
    // document instead of doing nothing.
    render(
      <TreeView
        aria-label="Layers"
        nodes={[
          { id: "empty", label: "Empty", children: [] },
          { id: "footer", label: "Footer" },
        ]}
        defaultExpandedIds={["empty"]}
      />
    );
    const tree = screen.getByRole("tree");

    focusRow("Empty");
    fireEvent.keyDown(tree, { key: "ArrowRight" });

    expect(document.activeElement?.textContent).toContain("Empty");
  });

  it("climbs past a disabled parent rather than landing on it", () => {
    // A disabled branch can still be expanded and hold enabled children. Every other keyboard
    // move refuses to land on a disabled row, so stopping here would be the one way to focus one.
    render(
      <TreeView
        aria-label="Layers"
        nodes={[
          {
            id: "outer",
            label: "Outer",
            children: [
              {
                id: "locked",
                label: "Locked",
                disabled: true,
                children: [{ id: "leaf", label: "Leaf" }],
              },
            ],
          },
        ]}
        defaultExpandedIds={["outer", "locked"]}
      />
    );
    const tree = screen.getByRole("tree");

    focusRow("Leaf");
    fireEvent.keyDown(tree, { key: "ArrowLeft" });

    expect(document.activeElement?.textContent).toContain("Outer");
  });
});

describe("what the forwarded ref points at", () => {
  it("gives the caller the element that actually scrolls", () => {
    // The inner element is a sized spacer; calling `scrollTo` on it does nothing. A caller
    // bringing a row into view through the ref needs the scroll container.
    const ref = React.createRef<HTMLDivElement>();
    render(<TreeView ref={ref} nodes={tree} aria-label="Layers" />);

    expect(ref.current?.getAttribute("role")).toBeNull();
    expect(ref.current?.className).toContain("overflow-auto");
  });
});

describe("a hierarchy that is deep rather than broad", () => {
  it("flattens a long expanded chain without exhausting the stack", () => {
    // Virtualization does not help here: the rows have to be enumerated before any can be
    // windowed, so a recursive walk overflows before the virtualizer is ever consulted.
    let deepest: TreeNode = { id: "leaf", label: "Leaf" };
    const expanded: string[] = ["leaf"];
    for (let level = 0; level < 20000; level += 1) {
      const id = `level-${level}`;
      deepest = { id, label: id, children: [deepest] };
      expanded.push(id);
    }

    expect(() =>
      render(
        <TreeView
          aria-label="Layers"
          nodes={[deepest]}
          defaultExpandedIds={expanded}
        />
      )
    ).not.toThrow();
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

describe("a tree holding more than one selected row", () => {
  function multi(props: Partial<React.ComponentProps<typeof TreeView>>) {
    return render(
      <TreeView
        aria-label="Blocks"
        nodes={[
          { id: "a", label: "A" },
          { id: "b", label: "B" },
          { id: "c", label: "C" },
        ]}
        {...props}
      />
    );
  }

  it("marks every selected row, not only the primary", () => {
    const { container } = multi({ selectedId: "a", selectedIds: ["a", "c"] });

    expect(
      Array.from(container.querySelectorAll('[role="treeitem"]')).map(row => [
        row.textContent,
        row.getAttribute("aria-selected"),
      ])
    ).toEqual([
      ["A", "true"],
      ["B", "false"],
      ["C", "true"],
    ]);
  });

  it("announces itself as multi-selectable ONLY when a set is supplied", () => {
    /*
     * The control that matters most here. A single-select tree claiming to be
     * multi-selectable is wrong in a way a screen-reader user ACTS on — they
     * would look for a selection gesture the tree does not have — so it is
     * worse than the gap it would be closing.
     */
    const withSet = multi({ selectedId: "a", selectedIds: ["a"] });
    expect(
      withSet.container
        .querySelector('[role="tree"]')
        ?.getAttribute("aria-multiselectable")
    ).toBe("true");

    cleanup();

    const withoutSet = multi({ selectedId: "a" });
    expect(
      withoutSet.container
        .querySelector('[role="tree"]')
        ?.getAttribute("aria-multiselectable")
    ).toBeNull();
  });

  it("selects exactly the primary when no set is supplied, which is the control", () => {
    // Without this, "existing callers keep working" is a claim rather than a
    // check — every other case here passes a set.
    const { container } = multi({ selectedId: "b" });

    expect(
      Array.from(container.querySelectorAll('[role="treeitem"]')).map(row =>
        row.getAttribute("aria-selected")
      )
    ).toEqual(["false", "true", "false"]);
  });

  it("reports the gesture a click's modifiers meant", () => {
    const onSelectedChange = vi.fn();
    const { container } = multi({ selectedId: "a", onSelectedChange });
    const second = container.querySelectorAll('[role="treeitem"]')[1];
    if (second === undefined) throw new Error("expected a second row");

    fireEvent.click(second, { metaKey: true });
    expect(onSelectedChange).toHaveBeenCalledWith("b", "toggle");

    fireEvent.click(second, { shiftKey: true });
    expect(onSelectedChange).toHaveBeenCalledWith("b", "extend");

    fireEvent.click(second);
    expect(onSelectedChange).toHaveBeenCalledWith("b", "replace");
  });

  it("gives the KEYBOARD the same three gestures", () => {
    /*
     * WCAG 2.2 SC 2.1.1. A tree that could only build a multi-row selection by
     * clicking would make the one capability this change adds mouse-only.
     */
    const onSelectedChange = vi.fn();
    const { container } = multi({ selectedId: "a", onSelectedChange });
    const tree = container.querySelector('[role="tree"]');
    if (tree === null) throw new Error("expected a tree");

    fireEvent.keyDown(tree, { key: " ", ctrlKey: true });
    expect(onSelectedChange).toHaveBeenCalledWith("a", "toggle");

    fireEvent.keyDown(tree, { key: "Enter", shiftKey: true });
    expect(onSelectedChange).toHaveBeenCalledWith("a", "extend");
  });
});
