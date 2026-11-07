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
  waitFor,
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
  COMPONENT_INSTANCE_TYPE,
  PAGE_ROOT_CLASS,
  previewStateClass,
  registerBlocks,
  STYLE_STATES,
  type BlockDocument,
  type DefinitionsById,
  type SiteSheetInput,
  type StyleState,
} from "@nextlyhq/blocks-engine";

import {
  INSTANCE_ATTRIBUTE,
  LIST_ACTION_ATTRIBUTE,
  NODE_ID_ATTRIBUTE,
} from "@nextlyhq/blocks-react";

import { markedElementOf } from "./style-subject";

import {
  CANVAS_ROOT_CLASS,
  CHROME_ATTRIBUTE,
  Canvas,
  DRAG_SOURCE_ATTRIBUTE,
  DROP_PARENT_ATTRIBUTE,
  DROP_REFUSED_ATTRIBUTE,
  CONDITIONED_ATTRIBUTE,
  LOCKED_ATTRIBUTE,
  lockMarksOf,
  SELECTED_ATTRIBUTE,
  contextMenuTargetOf,
  DropRefusal,
  isOutermostForAddress,
  nodeElement,
  nodeIdFromEvent,
  outermostElementsOf,
} from "./canvas";
import type { CanvasDragState } from "./canvas-drag";

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

/**
 * A node the RENDERER inlined from a component definition.
 *
 * Its own id is re-minted during composition, so the page's document does not
 * contain it — which is why an editor must answer with the host instance
 * instead. Both markers are present exactly as `blocks-react` emits them.
 */
function definitionOwned(
  id: string,
  instanceId: string,
  label: string,
  children?: React.ReactNode
) {
  return (
    <section {...{ [NODE_ID_ATTRIBUTE]: id, [INSTANCE_ATTRIBUTE]: instanceId }}>
      <h2>
        <span data-testid={`leaf-${id}`}>{label}</span>
      </h2>
      {children}
    </section>
  );
}

describe("resolving a click inside a component instance", () => {
  it("answers with the HOST INSTANCE for a node the definition supplied", () => {
    // The definition's node ids are re-minted at composition, so `cx-remade` is
    // an address the stored page does not contain. Answering with it hands the
    // editor something it cannot select, edit or delete.
    render(canvas(definitionOwned("cx-remade", "i1", "From the definition")));

    expect(nodeIdFromEvent(screen.getByTestId("leaf-cx-remade"))).toBe("i1");
  });

  it("answers with its OWN id for slot content the page supplied", () => {
    // THE case this whole design exists for, and the one `closest()` gets
    // wrong. `page-own` belongs to the page and is deliberately unmarked, but
    // it renders NESTED INSIDE the definition's marked box — so a walk upwards
    // finds that box and hands back the component for a node the author can and
    // should select directly. It is exactly what a marketer opened the editor
    // to change.
    render(
      canvas(
        definitionOwned(
          "cx-remade",
          "i1",
          "From the definition",
          block("page-own", "The page's own, in the slot")
        )
      )
    );

    expect(nodeIdFromEvent(screen.getByTestId("leaf-page-own"))).toBe(
      "page-own"
    );
  });

  it("reads an EMPTY instance marker as page-owned", () => {
    // An address of "" is not selectable. The renderer never emits one — it
    // treats an empty id as no provenance — but reading it as page-owned is the
    // answer that leaves the element addressable by its own id rather than by
    // nothing.
    render(
      canvas(
        <section {...{ [NODE_ID_ATTRIBUTE]: "own", [INSTANCE_ATTRIBUTE]: "" }}>
          <span data-testid="leaf-own">x</span>
        </section>
      )
    );

    expect(nodeIdFromEvent(screen.getByTestId("leaf-own"))).toBe("own");
  });
});

describe("addressing a definition-owned element from every reader", () => {
  it("gives the CONTEXT MENU the instance, not the re-minted id", () => {
    // The menu's verbs act on the selection, and `applySelection` ignores an id
    // the stored document does not contain — so a right-click inside a
    // component left the PREVIOUS selection in place and Delete acted on a
    // block nobody pointed at.
    const { container } = render(
      canvas(definitionOwned("cx-remade", "i1", "From the definition"))
    );
    const root = container.firstElementChild as Element;

    expect(
      contextMenuTargetOf(screen.getByTestId("leaf-cx-remade"), root)
    ).toBe("i1");
  });

  it("still gives the menu a page-owned node its own id", () => {
    // The control: an implementation that always answered with an instance
    // would satisfy the case above and break every ordinary right-click.
    const { container } = render(canvas(block("plain", "Ordinary")));
    const root = container.firstElementChild as Element;

    expect(contextMenuTargetOf(screen.getByTestId("leaf-plain"), root)).toBe(
      "plain"
    );
  });

  it("treats sibling copies of one node as each outermost", () => {
    // A block that renders its child twice puts one id on two SIBLING elements,
    // and both are renderings of that node. Marking or measuring only one
    // outlines a single row of ten. Neither encloses the other, so enclosure is
    // what separates this from a component's nested elements.
    const { container } = render(
      canvas(
        <>
          {block("twin", "First")}
          {block("twin", "Second")}
        </>
      )
    );
    const root = container.querySelector(
      `.${CANVAS_ROOT_CLASS}`
    ) as HTMLElement;
    const copies = container.querySelectorAll(`[${NODE_ID_ATTRIBUTE}="twin"]`);

    expect(copies).toHaveLength(2);
    copies.forEach(copy => {
      expect(isOutermostForAddress(copy, "twin", root)).toBe(true);
    });
  });

  it("treats an instance's inner elements as NOT outermost", () => {
    // The other half. Every element the definition contributed shares one
    // address, nested — so marking all of them outlines everything inside the
    // component, and measuring all of them keys the drag rectangle to whichever
    // was visited last.
    const { container } = render(
      canvas(
        definitionOwned(
          "cx-outer",
          "i1",
          "Outer",
          definitionOwned("cx-inner", "i1", "Inner")
        )
      )
    );
    const outer = container.querySelector(
      `[${NODE_ID_ATTRIBUTE}="cx-outer"]`
    ) as Element;
    const inner = container.querySelector(
      `[${NODE_ID_ATTRIBUTE}="cx-inner"]`
    ) as Element;

    const root = container.querySelector(
      `.${CANVAS_ROOT_CLASS}`
    ) as HTMLElement;

    expect({
      outer: isOutermostForAddress(outer, "i1", root),
      inner: isOutermostForAddress(inner, "i1", root),
    }).toEqual({ outer: true, inner: false });
  });

  it("does not let an enclosing canvas's marker reach into a nested canvas", () => {
    // A canvas can render INSIDE a definition-owned element — component edit
    // mode does — and ids are scoped per document, so the inner document may
    // reuse the enclosing instance's address. An unbounded ancestor search
    // finds the OUTER document's marker, calls the inner component nested
    // inside itself, and leaves it with no outline and no drag rectangle.
    const { container } = render(
      canvas(
        definitionOwned(
          "cx-outer",
          "i1",
          "Outer",
          canvas(definitionOwned("cx-inner", "i1", "Inner"))
        )
      )
    );
    const roots = container.querySelectorAll(`.${CANVAS_ROOT_CLASS}`);
    const innerRoot = roots[1] as HTMLElement;
    const inner = container.querySelector(
      `[${NODE_ID_ATTRIBUTE}="cx-inner"]`
    ) as Element;

    expect(roots).toHaveLength(2);
    expect(isOutermostForAddress(inner, "i1", innerRoot)).toBe(true);
  });
});

describe("the element a style reading is taken from", () => {
  it("finds the element an INSTANCE renders as, not only a node's own", () => {
    // An instance renders no element carrying its own id — it is replaced by
    // the definition's tree — so a lookup over the node-id attribute alone
    // finds nothing, and the style inspector reads the selected component's
    // tag and orientation as unknown for as long as it is selected. The
    // reverse lookup goes through the same rule the selection uses.
    const { container } = render(
      canvas(definitionOwned("cx-outer", "i1", "Outer"))
    );
    const root = container.querySelector(
      `.${CANVAS_ROOT_CLASS}`
    ) as HTMLElement;

    expect(markedElementOf(root, "i1")?.getAttribute(NODE_ID_ATTRIBUTE)).toBe(
      "cx-outer"
    );
    // And nothing for no root or no selection, which is what every caller of
    // this adapter may hold.
    expect(markedElementOf(null, "i1")).toBeUndefined();
    expect(markedElementOf(root, null)).toBeUndefined();
  });
});

describe("finding the element a selected node was rendered as", () => {
  it("finds the instance's rendered box, which carries no node id of its own", () => {
    // The inverse of the hit-test, and it has to answer the same addresses.
    // Selecting inside a component yields an INSTANCE id — a real page node
    // that renders no element of its own, because it was replaced by the
    // definition's tree. Chrome measuring that selection would otherwise find
    // nothing and draw nowhere.
    const { container } = render(
      canvas(definitionOwned("cx-remade", "i1", "From the definition"))
    );
    const root = container.firstElementChild as HTMLElement;

    expect(nodeElement(root, "i1")?.getAttribute(NODE_ID_ATTRIBUTE)).toBe(
      "cx-remade"
    );
  });

  it("prefers a node's OWN element over one merely hosted by it", () => {
    // Precedence stated rather than left to iteration order. The two cannot
    // collide today — an instance is replaced rather than rendered — so without
    // this the rule would be whichever the walk happened to reach first.
    const { container } = render(
      canvas(
        <>
          {definitionOwned("cx-remade", "shared", "Hosted")}
          {block("shared", "The node's own")}
        </>
      )
    );
    const root = container.firstElementChild as HTMLElement;

    expect(nodeElement(root, "shared")?.getAttribute(NODE_ID_ATTRIBUTE)).toBe(
      "shared"
    );
  });

  it("still finds an ordinary page node by its own id", () => {
    // The control: without it, an implementation that only ever answered via
    // the instance marker would satisfy the cases above.
    const { container } = render(canvas(block("plain", "Ordinary")));
    const root = container.firstElementChild as HTMLElement;

    expect(nodeElement(root, "plain")?.getAttribute(NODE_ID_ATTRIBUTE)).toBe(
      "plain"
    );
  });
});

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
     * `PageRenderer` draws `.nx-pb-page` as a CHILD of the wrapper and the page
     * tier's selector names that child, so asserting the wrapper would go green
     * without touching the element the compiler targets.
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

describe("forcing a state onto a tree React commits over time", () => {
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
          /*
           * A block that draws a CANVAS INSIDE itself — the shape component edit
           * mode produces — holding an instance whose address the outer document
           * could also select. Ids are scoped per document, so that address
           * belongs to the inner document, and only the inner canvas may mark it.
           */
          name: "acme/nests-a-canvas",
          version: 1,
          description: "A block holding a nested canvas.",
          example: { props: {} },
          render: ({ className }: { className: string }) =>
            createElement(
              "div",
              { className, [NODE_ID_ATTRIBUTE]: "host" },
              createElement(
                "div",
                { className: CANVAS_ROOT_CLASS },
                createElement("div", {
                  [NODE_ID_ATTRIBUTE]: "cx-inner",
                  [INSTANCE_ATTRIBUTE]: "i1",
                })
              )
            ),
        },
        {
          /*
           * A block that draws ITS OWN CHILD TWICE, which is what makes one
           * node id many elements. `core/collection-loop` renders its children
           * slot once per entry, so this is the shape of a shipping block
           * rather than an invented one — and it is built here rather than
           * inserted after the fact so that this case separates "reaches every
           * copy" from "re-reads when the tree changes". A test that injected
           * the second copy late would pass on either fix alone.
           */
          name: "acme/twice",
          version: 1,
          description: "A block that repeats its child.",
          example: { props: {} },
          render: ({ className }: { className: string }) =>
            createElement(
              "div",
              { className },
              createElement("div", {
                key: "one",
                [NODE_ID_ATTRIBUTE]: "child",
              }),
              createElement("div", {
                key: "two",
                [NODE_ID_ATTRIBUTE]: "child",
              })
            ),
        },
      ] as never,
      { source: "canvas-late-state-test" }
    );
  });
  afterAll(clearBlocks);

  const copiesOf = (id: string) =>
    Array.from(document.querySelectorAll(`[${NODE_ID_ATTRIBUTE}="${id}"]`));

  it("marks EVERY rendering of the selected node, not the first one found", async () => {
    /*
     * A node id is unique in a document and not in the tree drawn from it. The
     * selection walk already marks every copy primary, so a forced state that
     * stopped at the first would outline ten rows and preview the hover
     * appearance on one — which reads as the state being broken.
     *
     * Asserted over the whole set rather than on copy two alone, so the case
     * still separates if the order the copies are found in changes.
     */
    render(
      <Canvas
        document={
          {
            formatVersion: 1,
            kind: "page",
            nodes: [{ id: "loop", type: "acme/twice", version: 1, props: {} }],
          } as never
        }
        siteStyles={{ css: "", classes: {} } as never}
        selectedId="child"
        forcedState="hover"
      />
    );
    await act(async () => undefined);

    const copies = copiesOf("child");
    expect(copies).toHaveLength(2);
    for (const copy of copies) {
      expect(copy.getAttribute(SELECTED_ATTRIBUTE)).toBe("primary");
      expect(copy.className).toContain(previewStateClass("hover"));
    }
  });

  it("leaves a NESTED canvas's elements alone, whatever address it selects", async () => {
    /*
     * The outer canvas selects "i1". The only element carrying that address is
     * inside a nested canvas root — another document's, since ids are scoped
     * per document. Marking it would outline a block this selection is not in,
     * and clearing it on a later pass would strip a mark the inner canvas set.
     * The drag pass already leaves foreign canvases alone; this is the same
     * rule on the selection pass.
     */
    render(
      <Canvas
        document={
          {
            formatVersion: 1,
            kind: "page",
            nodes: [
              {
                id: "nest",
                type: "acme/nests-a-canvas",
                version: 1,
                props: {},
              },
            ],
          } as never
        }
        siteStyles={{ css: "", classes: {} } as never}
        selectedId="i1"
      />
    );
    await act(async () => undefined);

    const inner = document.querySelector(`[${NODE_ID_ATTRIBUTE}="cx-inner"]`);
    expect(inner).not.toBeNull();
    expect(inner?.hasAttribute(SELECTED_ATTRIBUTE)).toBe(false);
  });

  it("marks a node that arrives AFTER the commit the effect ran on", async () => {
    /*
     * The Suspense case, driven at the DOM rather than through a real promise:
     * what the effect can observe is an element carrying the node id being
     * inserted, and a resolving block is one way that happens. Nothing in the
     * dependency list moves — same document, same selection, same forced state
     * — so an effect that ran once and stopped leaves this element unmarked
     * until an unrelated change happens to run it again.
     *
     * The block selected here is the one that does NOT exist at first render,
     * which is what makes the assertion about arrival rather than about
     * marking in general.
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
        selectedId="late"
        forcedState="hover"
      />
    );
    await act(async () => undefined);
    expect(copiesOf("late")).toHaveLength(0);

    const host = document.querySelector(`.${PAGE_ROOT_CLASS}`);
    expect(host).not.toBeNull();
    await act(async () => {
      const arrived = document.createElement("div");
      arrived.setAttribute(NODE_ID_ATTRIBUTE, "late");
      host?.appendChild(arrived);
    });

    const [late] = copiesOf("late");
    expect(late?.getAttribute(SELECTED_ATTRIBUTE)).toBe("primary");
    expect(late?.className).toContain(previewStateClass("hover"));
  });

  it("clears an element that LOSES the node id it was marked for", async () => {
    /*
     * A render can move a node id between two elements that both already exist,
     * changing no child list — which is the attribute-only case this effect
     * subscribes to, and the one where the element left behind is reachable by
     * neither the node-id selector nor the page root.
     *
     * Asserted on the OLD element rather than on the new one: marking the
     * arrival is what the case above already covers, and a walk that marks the
     * arrival while leaving the departure dressed draws two outlines and forces
     * hover on a block nothing is editing.
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
        selectedId="movable"
        forcedState="hover"
      />
    );

    const host = document.querySelector(`.${PAGE_ROOT_CLASS}`);
    const first = document.createElement("div");
    const second = document.createElement("div");
    first.setAttribute(NODE_ID_ATTRIBUTE, "movable");
    await act(async () => {
      host?.appendChild(first);
      host?.appendChild(second);
    });
    expect(first.getAttribute(SELECTED_ATTRIBUTE)).toBe("primary");
    expect(first.className).toContain(previewStateClass("hover"));

    await act(async () => {
      first.removeAttribute(NODE_ID_ATTRIBUTE);
      second.setAttribute(NODE_ID_ATTRIBUTE, "movable");
    });

    expect(second.getAttribute(SELECTED_ATTRIBUTE)).toBe("primary");
    expect(first.getAttribute(SELECTED_ATTRIBUTE)).toBeNull();
    expect(first.className).not.toContain(previewStateClass("hover"));
  });
});

describe("the drag in flight is drawn on the canvas", () => {
  /*
   * A container plus the repeating block, because the two marks answer
   * different questions and one fixture cannot exercise both: the source mark
   * is about one node drawn many times, and the region marks are about a
   * container node named by a drop.
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
        {
          // Draws its own child twice, which is what makes one node id many
          // elements — the shape `core/collection-loop` has in the library.
          name: "acme/twice",
          version: 1,
          description: "A block that repeats its child.",
          example: { props: {} },
          render: ({ className }: { className: string }) =>
            createElement(
              "div",
              { className },
              createElement("div", {
                key: "one",
                [NODE_ID_ATTRIBUTE]: "child",
              }),
              createElement("div", { key: "two", [NODE_ID_ATTRIBUTE]: "child" })
            ),
        },
        {
          name: "acme/box",
          version: 1,
          description: "A container.",
          example: { props: {} },
          render: ({ className }: { className: string }) =>
            createElement("div", { className }),
        },
        {
          // Draws a part the way a component placement's definition does: a
          // re-minted node id the page does not hold, carrying the
          // placement's address as its instance.
          name: "acme/placement",
          version: 1,
          description: "A block drawn from a definition.",
          example: { props: {} },
          render: ({ className }: { className: string }) =>
            createElement(
              "div",
              { className },
              createElement("div", {
                [NODE_ID_ATTRIBUTE]: "minted-part",
                [INSTANCE_ATTRIBUTE]: "card",
              })
            ),
        },
      ] as never,
      { source: "canvas-drag-marks-test" }
    );
  });
  afterAll(clearBlocks);

  const PAGE = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      { id: "box", type: "acme/box", version: 1, props: {} },
      { id: "leaf", type: "acme/leaf", version: 1, props: {} },
    ],
  };

  const LOOP = {
    formatVersion: 1,
    kind: "page",
    nodes: [{ id: "loop", type: "acme/twice", version: 1, props: {} }],
  };

  function draw(drag: CanvasDragState | undefined, page: unknown = PAGE) {
    return render(
      <Canvas
        document={page as never}
        siteStyles={{ css: "", classes: {} } as never}
        drag={drag}
        // The refusal is chrome, drawn wherever the canvas's chrome is: here,
        // a canvas in this document, inside its root.
        overlay={<DropRefusal drag={drag} document={page as never} />}
      />
    );
  }

  const dragging = (over: Partial<CanvasDragState>): CanvasDragState => ({
    draggingId: null,
    draggingBlockName: "acme/leaf",
    target: null,
    refusal: null,
    ...over,
  });

  it("marks EVERY rendering of the node in flight, not the first one found", async () => {
    // A node id is unique in a document and not in the tree drawn from it, so a
    // walk stopping at the first match dims one copy of a repeated block and
    // leaves the rest at full opacity.
    const { container } = draw(dragging({ draggingId: "child" }), LOOP);
    await act(async () => undefined);

    expect(
      container.querySelectorAll(`[${DRAG_SOURCE_ATTRIBUTE}]`)
    ).toHaveLength(2);
  });

  it("marks the container a drop would land in", async () => {
    const { container } = draw(
      dragging({
        draggingId: "leaf",
        target: {
          id: "t",
          regionId: "box::children",
          at: { parentId: "box", slot: "children", index: 0 },
        } as never,
      })
    );
    await act(async () => undefined);

    const parent = container.querySelector(`[${DROP_PARENT_ATTRIBUTE}]`);
    expect(parent?.getAttribute(NODE_ID_ATTRIBUTE)).toBe("box");
    // The two region marks are mutually exclusive: `DropResolution` is a union,
    // so a canvas showing both at once is drawing a state the engine cannot be in.
    expect(container.querySelector(`[${DROP_REFUSED_ATTRIBUTE}]`)).toBeNull();
  });

  it("marks the container that refuses, and says why and what it takes", async () => {
    const { container, getByText } = draw(
      dragging({
        draggingId: "leaf",
        refusal: {
          regionId: "box::children",
          parentId: "box",
          reason: "wrong-parent",
          permitted: ["acme/twice"],
        } as never,
      })
    );
    await act(async () => undefined);

    const refused = container.querySelector(`[${DROP_REFUSED_ATTRIBUTE}]`);
    expect(refused?.getAttribute(NODE_ID_ATTRIBUTE)).toBe("box");
    expect(container.querySelector(`[${DROP_PARENT_ATTRIBUTE}]`)).toBeNull();

    // The whole point of the row: the reason the engine computed reaches the
    // author, in words, naming the container and what it would accept.
    expect(getByText("A Leaf can't go inside this Box.")).toBeTruthy();
    // `wrong-parent` carries the MOVING block's valid parents, so the remedy
    // says where the leaf can go — never that the box accepts a Twice.
    expect(getByText("A Leaf goes inside a Twice.")).toBeTruthy();
  });

  it("draws no refusal while a target is still committed", async () => {
    /*
     * `useCanvasDrag` holds the committed target across a short crossing while
     * setting the refusal from the region under the pointer immediately, so
     * both are non-null for the width of the switch threshold.
     *
     * Drawing the refusal there contradicts two things at once: the indicator
     * still points at the held target, and releasing commits it. The chrome
     * would say the block cannot land while letting go moves it.
     */
    const { container, queryByText } = draw(
      dragging({
        draggingId: "leaf",
        target: {
          id: "t",
          regionId: "box::children",
          at: { parentId: "box", slot: "children", index: 0 },
        } as never,
        refusal: {
          regionId: "box::children",
          parentId: "box",
          reason: "wrong-parent",
          permitted: ["acme/twice"],
        } as never,
      })
    );
    await act(async () => undefined);

    // Control: the target half IS drawn, so the absences below are about the
    // refusal being withheld rather than about nothing having rendered.
    expect(
      container.querySelector(`[${DROP_PARENT_ATTRIBUTE}]`)
    ).not.toBeNull();
    expect(container.querySelector(`[${DROP_REFUSED_ATTRIBUTE}]`)).toBeNull();
    expect(queryByText(/can't go/)).toBeNull();
  });

  it("draws no drag marks at all when no drag is supplied", async () => {
    // The back-compat control: every host that has not been wired yet omits
    // this prop, and must get exactly the canvas it had before.
    const { container } = draw(undefined);
    await act(async () => undefined);

    expect(container.querySelector(`[${DRAG_SOURCE_ATTRIBUTE}]`)).toBeNull();
    expect(container.querySelector(`[${DROP_PARENT_ATTRIBUTE}]`)).toBeNull();
    expect(container.querySelector(`[${DROP_REFUSED_ATTRIBUTE}]`)).toBeNull();
  });

  it("does not rewrite a mark whose value has not changed", async () => {
    /*
     * The spacing overlay observes this subtree with a MutationObserver, and
     * `setAttribute` queues a record even when the value written is the value
     * already there. Unguarded, a mark rewritten on every pointermove is a
     * re-measure per frame — which reads as jank rather than as a defect, so
     * nothing else in the suite would catch it.
     */
    const state = dragging({ draggingId: "child" });
    const { container, rerender } = draw(state, LOOP);
    await act(async () => undefined);

    const seen: MutationRecord[] = [];
    const observer = new MutationObserver(records => seen.push(...records));
    observer.observe(container, { attributes: true, subtree: true });

    rerender(
      <Canvas
        document={LOOP as never}
        siteStyles={{ css: "", classes: {} } as never}
        drag={state}
      />
    );
    await act(async () => undefined);
    observer.disconnect();

    expect(
      seen.filter(record => record.attributeName === DRAG_SOURCE_ATTRIBUTE)
    ).toHaveLength(0);
  });

  it("does not announce the refusal, because the keyboard move already does", async () => {
    /*
     * The drop indicator is `aria-hidden` for a stated reason: the equivalent
     * keyboard move reports its own outcome through the editor's single live
     * region, so a second element describing the same pointer gesture is read
     * alongside the first. This message is the same kind of chrome and has to
     * make the same choice, or one author's move is announced twice.
     *
     * Asserted on the absence of a live region rather than on the attribute
     * alone, so swapping `aria-hidden` for `role="status"` — or for any other
     * implicit live role — fails here rather than passing on a technicality.
     */
    const { container } = draw(
      dragging({
        draggingId: "leaf",
        refusal: {
          regionId: "box::children",
          parentId: "box",
          reason: "wrong-parent",
          permitted: ["acme/twice"],
        } as never,
      })
    );
    await act(async () => undefined);

    const notice = container.querySelector(".nx-drop-refusal");
    // Control: the element must be FOUND, or the assertions below are
    // satisfied by a selector that matches nothing.
    expect(notice).not.toBeNull();
    expect(notice?.getAttribute("aria-hidden")).toBe("true");
    expect(notice?.getAttribute("role")).toBeNull();
    expect(notice?.getAttribute("aria-live")).toBeNull();
  });

  it("marks a locked node, so the grab cursor can be withheld from it", async () => {
    /*
     * `useCanvasDrag` returns before creating a gesture for a locked node, and
     * with no drag handle the cursor is the only thing advertising a block as
     * movable. Offering it on a node the engine has already refused leaves an
     * author pressing repeatedly at something that will never move.
     *
     * Both halves asserted: marking every node would withhold the affordance
     * from the whole page, which is the same defect pointing the other way.
     */
    const { container } = draw(undefined, {
      formatVersion: 1,
      kind: "page",
      nodes: [
        { id: "box", type: "acme/box", version: 1, props: {}, locked: true },
        { id: "leaf", type: "acme/leaf", version: 1, props: {} },
      ],
    });
    await act(async () => undefined);

    const locked = container.querySelectorAll(`[${LOCKED_ATTRIBUTE}]`);
    expect(locked).toHaveLength(1);
    expect(locked[0]?.getAttribute(NODE_ID_ATTRIBUTE)).toBe("box");
  });

  it("draws a conditioned block, marked, whoever the page would show it to", async () => {
    // The published page leaves a block whose conditions fail out; the
    // canvas draws it so the author can see and select it, and the mark
    // says it isn't shown to everyone.
    const vip = [[{ field: "tier", op: "equals", value: "vip" }]];
    const { container } = render(
      <Canvas
        document={
          {
            formatVersion: 1,
            kind: "page",
            nodes: [
              {
                id: "gated",
                type: "acme/leaf",
                version: 1,
                props: {},
                visibility: { conditions: vip },
              },
              {
                id: "broken",
                type: "acme/leaf",
                version: 1,
                props: {},
                visibility: { conditions: vip },
              },
              { id: "plain", type: "acme/leaf", version: 1, props: {} },
            ],
          } as never
        }
        siteStyles={{ css: "", classes: {} } as never}
        conditionsUnchecked={new Set(["broken"])}
      />
    );
    await act(async () => undefined);

    const markOf = (id: string) =>
      container
        .querySelector(`[${NODE_ID_ATTRIBUTE}="${id}"]`)
        ?.getAttribute(CONDITIONED_ATTRIBUTE);
    expect(markOf("gated")).toBe("conditional");
    expect(markOf("broken")).toBe("unchecked");
    // CONTROL: drawn, and an ordinary block beside them is not marked.
    expect(
      container.querySelector(`[${NODE_ID_ATTRIBUTE}="plain"]`)
    ).not.toBeNull();
    expect(markOf("plain")).toBeNull();
  });

  it("draws a conditioned block of a component an override places, marked", async () => {
    // The page places "frame", whose nested placement stores "plain" but is
    // exposed; the page's override repoints it to "gated", the component the
    // renderer then draws, whose own block has conditions.
    const vip = [[{ field: "tier", op: "equals", value: "vip" }]];
    const definitions: DefinitionsById = new Map([
      [
        "frame",
        {
          formatVersion: 1,
          kind: "component",
          nodes: [
            {
              id: "nested",
              type: COMPONENT_INSTANCE_TYPE,
              version: 1,
              props: { componentId: "plain" },
            },
          ],
          exposed: [
            {
              id: "swap",
              label: "Which",
              nodeId: "nested",
              propPath: "componentId",
              type: "select",
            },
          ],
        } as unknown as BlockDocument,
      ],
      [
        "plain",
        {
          formatVersion: 1,
          kind: "component",
          nodes: [{ id: "stored", type: "acme/leaf", version: 1, props: {} }],
        } as unknown as BlockDocument,
      ],
      [
        "gated",
        {
          formatVersion: 1,
          kind: "component",
          nodes: [
            {
              id: "inner",
              type: "acme/leaf",
              version: 1,
              props: {},
              visibility: { conditions: vip },
            },
          ],
        } as unknown as BlockDocument,
      ],
    ]);
    const { container } = render(
      <Canvas
        document={
          {
            formatVersion: 1,
            kind: "page",
            nodes: [
              {
                id: "card",
                type: COMPONENT_INSTANCE_TYPE,
                version: 1,
                props: { componentId: "frame", overrides: { swap: "gated" } },
              },
            ],
          } as never
        }
        siteStyles={{ css: "", classes: {} } as never}
        render={{ definitions }}
      />
    );
    await act(async () => undefined);

    // Drawn, though the page would leave it out, and marked as conditioned.
    const marked = container.querySelectorAll(`[${CONDITIONED_ATTRIBUTE}]`);
    expect(marked).toHaveLength(1);
    expect(marked[0]?.getAttribute(CONDITIONED_ATTRIBUTE)).toBe("conditional");
  });

  it("marks a locked placement's parts by its address, so their ring is the locked one", async () => {
    /*
     * A placement's parts carry a re-minted node id plus the placement's
     * address. Read by the raw id, the lock finds nothing for them and the
     * selection ring the marks draw from a part is solid, as for an unlocked
     * block; read by the address, as the selection is, they are locked.
     */
    const { container } = draw(undefined, {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "card",
          type: "acme/placement",
          version: 1,
          props: {},
          locked: true,
        },
        { id: "leaf", type: "acme/leaf", version: 1, props: {} },
      ],
    });
    await act(async () => undefined);

    const part = container.querySelector(
      `[${NODE_ID_ATTRIBUTE}="minted-part"]`
    );
    expect(part?.getAttribute(LOCKED_ATTRIBUTE)).toBe("own");
    // The control: an unlocked block beside it is not marked.
    expect(
      container
        .querySelector(`[${NODE_ID_ATTRIBUTE}="leaf"]`)
        ?.hasAttribute(LOCKED_ATTRIBUTE)
    ).toBe(false);
  });

  it("marks a block's own lock and a lock it is held by from around it apart", async () => {
    // A block inside a locked one is locked too: it is marked `inherited`,
    // so the canvas can say so without claiming a lock of its own. The marks
    // come from one walk of the document; the element carries the value.
    const page = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "box",
          type: "acme/box",
          version: 1,
          props: {},
          locked: true,
          slots: {
            children: [
              {
                id: "inner",
                type: "acme/box",
                version: 1,
                props: {},
                slots: {
                  children: [
                    { id: "leaf", type: "acme/leaf", version: 1, props: {} },
                  ],
                },
              },
            ],
          },
        },
        { id: "free", type: "acme/leaf", version: 1, props: {} },
      ],
    };
    expect([...lockMarksOf(page as never)]).toEqual([
      ["box", "own"],
      ["inner", "inherited"],
      ["leaf", "inherited"],
    ]);

    const { container } = draw(undefined, page);
    await act(async () => undefined);
    expect(
      container
        .querySelector(`[${NODE_ID_ATTRIBUTE}="box"]`)
        ?.getAttribute(LOCKED_ATTRIBUTE)
    ).toBe("own");
  });

  it("clears a drag mark from an element that has LOST its node id", async () => {
    /*
     * The stale-mark case, driven at the DOM the way its selection neighbour is.
     * A render can move a node id from one existing element to another without
     * touching the child list — an async block committing its resolved root
     * mid-drag is one way — and the element left behind then matches nothing
     * selected by node id.
     *
     * If the walk only ever visits elements carrying an id, that element keeps
     * whatever it was last given: a block dimmed to 0.4 with nothing left that
     * will ever clear it. The selection attribute is in the walk's selector list
     * for exactly this reason; these have to be too.
     */
    draw(dragging({ draggingId: "child" }), LOOP);
    await act(async () => undefined);

    // `Array.from` rather than a spread: a `NodeList` is only iterable under a
    // lib that declares its iterator, and this package compiles without one.
    const marked = Array.from(
      document.querySelectorAll(`[${DRAG_SOURCE_ATTRIBUTE}]`)
    );
    // Control: two copies must be found first, or the assertion below is
    // satisfied by there having been nothing to strand.
    expect(marked).toHaveLength(2);

    const orphan = marked[0];
    await act(async () => {
      orphan?.removeAttribute(NODE_ID_ATTRIBUTE);
    });

    expect(orphan?.hasAttribute(DRAG_SOURCE_ATTRIBUTE)).toBe(false);
    // The copy that kept its id keeps its mark, so this separates "cleared the
    // orphan" from "cleared everything".
    expect(
      document.querySelectorAll(`[${DRAG_SOURCE_ATTRIBUTE}]`)
    ).toHaveLength(1);
  });
});

describe("a link drawn on the canvas", () => {
  /*
   * The canvas draws a block's link as a real anchor, so the browser's own
   * default for a click on it is to follow it — out of the editor, away from
   * unsaved work. The click must still select the block.
   */
  beforeAll(() => {
    clearBlocks();
    registerBlocks(
      [
        {
          name: "acme/link",
          version: 1,
          description: "A linked block.",
          example: { props: {} },
          render: ({ className }: { className: string }) =>
            createElement("a", { className, href: "/signup" }, "Sign up"),
        },
      ] as never,
      { source: "canvas-link-test" }
    );
  });

  afterAll(clearBlocks);

  it("selects the block and does not follow the link", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <Canvas
        document={
          {
            formatVersion: 1,
            kind: "page",
            nodes: [{ id: "cta", type: "acme/link", version: 1, props: {} }],
          } as never
        }
        siteStyles={{ css: "", classes: {} } as never}
        onSelect={onSelect as never}
      />
    );
    const link = container.querySelector("a[href]");
    if (link === null) throw new Error("expected the block's link");

    // `fireEvent` answers false when a listener cancelled the default.
    const followed = fireEvent.click(link);

    expect(followed).toBe(false);
    expect(onSelect).toHaveBeenCalledWith("cta", "replace");
  });

  it("leaves a link in the editor's chrome over the canvas working", () => {
    const { container } = render(
      <Canvas
        document={{ formatVersion: 1, kind: "page", nodes: [] } as never}
        siteStyles={{ css: "", classes: {} } as never}
        overlay={
          <div {...{ [CHROME_ATTRIBUTE]: "" }}>
            <a href="/help">Help</a>
          </div>
        }
      />
    );
    const help = container.querySelector('a[href="/help"]');
    if (help === null) throw new Error("expected the overlay's link");

    expect(fireEvent.click(help)).toBe(true);
  });
});

describe("the site's dark-mode strategy on the canvas root", () => {
  /*
   * The stylesheet darkens the canvas page's scheme with the system only for a
   * site on the `media` strategy, and only the token set says which strategy
   * that is. So the root carries it — on `data-nx-site-dark-ground`, beside
   * the dark ground the default token set gives every site here — and carries
   * the DEFAULT when a site states none: an absent strategy is `attribute`,
   * which the system's scheme never reaches.
   */
  const page: BlockDocument = { formatVersion: 1, kind: "page", nodes: [] };
  const breakpoints = { viewport: [], container: [] };

  function strategyOf(siteStyles: SiteSheetInput | false): string | null {
    const { container } = render(
      <Canvas document={page} siteStyles={siteStyles} />
    );
    return (
      container
        .querySelector(`.${CANVAS_ROOT_CLASS}`)
        ?.getAttribute("data-nx-site-dark-ground") ?? null
    );
  }

  it("marks a dark ground whatever the deprecated darkMode says", () => {
    // The site sheet applies dark values with the device whatever a stored
    // `darkMode` names, so the canvas marks the dark ground the same way.
    for (const darkMode of ["media", "attribute", undefined] as const) {
      expect(
        strategyOf({
          breakpoints,
          tokens: {
            tokens: [],
            ...(darkMode === undefined ? {} : { darkMode }),
          },
        }),
        String(darkMode)
      ).toBe("");
    }
    expect(strategyOf({ breakpoints })).toBe("");
  });

  it("states nothing when the host serves no site sheet", () => {
    expect(strategyOf(false)).toBeNull();
  });
});

describe("the elements standing for an address", () => {
  it("leaves out a nested canvas's elements, whose ids are its own document's", () => {
    // Component edit mode draws a canvas inside a block. Ids are scoped per
    // document, so the inner one may hold the same address as a block out
    // here; it is not this canvas's to measure.
    const root = document.createElement("div");
    root.className = CANVAS_ROOT_CLASS;
    root.innerHTML = `
      <div data-nx-node="a" id="outer"></div>
      <div data-nx-node="host">
        <div class="${CANVAS_ROOT_CLASS}">
          <div data-nx-node="a" id="inner"></div>
        </div>
      </div>`;
    document.body.append(root);
    try {
      const found = outermostElementsOf(root, new Set(["a"])).get("a") ?? [];
      expect(found.map(element => element.id)).toEqual(["outer"]);
    } finally {
      root.remove();
    }
  });
});

describe("the nearest theme marker above the canvas", () => {
  /*
   * The site's token values resolve to the NEAREST `data-nx-theme` marker,
   * because the sheet declares them on each marker and custom properties
   * inherit. The canvas states the same nearest marker, read from the DOM, so
   * its scheme cannot disagree with its values at any depth of nesting.
   */
  const page: BlockDocument = { formatVersion: 1, kind: "page", nodes: [] };
  const breakpoints = { viewport: [], container: [] };

  function mountUnder(markers: readonly ("light" | "dark")[]): {
    root: () => Element | null;
    chain: HTMLElement[];
  } {
    const chain: HTMLElement[] = [];
    let parent: HTMLElement = document.body;
    for (const mode of markers) {
      const wrapper = document.createElement("div");
      wrapper.setAttribute("data-nx-theme", mode);
      parent.append(wrapper);
      chain.push(wrapper);
      parent = wrapper;
    }
    const mount = document.createElement("div");
    parent.append(mount);
    render(<Canvas document={page} siteStyles={{ breakpoints }} />, {
      container: mount,
    });
    return {
      root: () => mount.querySelector(`.${CANVAS_ROOT_CLASS}`),
      chain,
    };
  }

  it("states the nearest marker through three alternations", async () => {
    const { root, chain } = mountUnder(["light", "dark", "light"]);
    await waitFor(() =>
      expect(root()?.getAttribute("data-nx-site-theme")).toBe("light")
    );
    chain[2]?.setAttribute("data-nx-theme", "dark");
    await waitFor(() =>
      expect(root()?.getAttribute("data-nx-site-theme")).toBe("dark")
    );
    chain[2]?.removeAttribute("data-nx-theme");
    // With the nearest gone, the next one out decides.
    await waitFor(() =>
      expect(root()?.getAttribute("data-nx-site-theme")).toBe("dark")
    );
  });

  it("states the marker in the commit that mounts the canvas, before paint", () => {
    // A parent's layout effect runs after its children's in the same commit
    // and before any passive effect, so it sees what the first paint shows.
    const marker = document.createElement("div");
    marker.setAttribute("data-nx-theme", "dark");
    document.body.append(marker);
    const mount = document.createElement("div");
    marker.append(mount);
    let atCommit: string | null | undefined;
    function Probe(): React.JSX.Element {
      const holder = React.useRef<HTMLDivElement>(null);
      React.useLayoutEffect(() => {
        atCommit = holder.current
          ?.querySelector(`.${CANVAS_ROOT_CLASS}`)
          ?.getAttribute("data-nx-site-theme");
      }, []);
      return (
        <div ref={holder}>
          <Canvas document={page} siteStyles={{ breakpoints }} />
        </div>
      );
    }
    render(<Probe />, { container: mount });
    expect(atCommit).toBe("dark");
  });

  it("states nothing when no marker is above it, so the device decides", async () => {
    const { root } = mountUnder([]);
    await waitFor(() => expect(root()).not.toBeNull());
    expect(root()?.hasAttribute("data-nx-site-theme")).toBe(false);
  });
});

describe("the site's body font on the canvas root", () => {
  /*
   * The stylesheet sets the page in `--nx-canvas-site-font`, and the root
   * states which token property that is. The property's name depends on the
   * prefix the site's tokens are emitted under, so a hard-coded `--site-` left
   * a site under another prefix in the fallback face.
   */
  const page: BlockDocument = { formatVersion: 1, kind: "page", nodes: [] };
  const breakpoints = { viewport: [], container: [] };

  function fontOf(
    siteStyles: SiteSheetInput | false,
    routePrefix?: string
  ): string {
    const { container } = render(
      <Canvas
        document={page}
        siteStyles={siteStyles}
        {...(routePrefix === undefined
          ? {}
          : {
              render: {
                styleContext: { breakpoints, tokenPrefix: routePrefix },
              },
            })}
      />
    );
    const root = container.querySelector<HTMLElement>(`.${CANVAS_ROOT_CLASS}`);
    return root?.style.getPropertyValue("--nx-canvas-site-font") ?? "";
  }

  it("names the body font under the token set's prefix", () => {
    expect(
      fontOf({ breakpoints, tokens: { tokens: [], prefix: "--brand-" } })
    ).toBe("var(--brand-font-body, system-ui)");
  });

  it("lets the sheet's own prefix win, as the sheet compiler does", () => {
    expect(
      fontOf({
        breakpoints,
        tokenPrefix: "--acme-",
        tokens: { tokens: [], prefix: "--brand-" },
      })
    ).toBe("var(--acme-font-body, system-ui)");
  });

  it("takes the route context's prefix when the site states none, as the renderer does", () => {
    /*
     * The renderer reconciles the route's prefix into the sheet it emits when
     * the site states none, so the body font is declared under it. Reading the
     * site input alone named `--site-font-body`, which nothing declared.
     */
    expect(fontOf({ breakpoints }, "--route-")).toBe(
      "var(--route-font-body, system-ui)"
    );
    // The site's own prefix still outranks the route's, as in the sheet.
    expect(
      fontOf(
        { breakpoints, tokens: { tokens: [], prefix: "--brand-" } },
        "--route-"
      )
    ).toBe("var(--brand-font-body, system-ui)");
  });

  it("uses the default prefix when the site states none", () => {
    expect(fontOf({ breakpoints })).toBe("var(--site-font-body, system-ui)");
  });

  it("states nothing when the host serves no site sheet", () => {
    expect(fontOf(false)).toBe("");
  });
});

describe("the site's ground and text on the canvas root", () => {
  /*
   * The page is drawn from the site's own background and text tokens, named
   * under the prefix the renderer emits them with, and its colour scheme goes
   * dark only where the site's dark values include a dark ground. The
   * strategy alone says when dark values apply, not that the page is dark.
   */
  const page: BlockDocument = { formatVersion: 1, kind: "page", nodes: [] };
  const breakpoints = { viewport: [], container: [] };

  function rootOf(siteStyles: SiteSheetInput | false): HTMLElement | null {
    const { container } = render(
      <Canvas document={page} siteStyles={siteStyles} />
    );
    return container.querySelector<HTMLElement>(`.${CANVAS_ROOT_CLASS}`);
  }

  it("names the background and text tokens under the site's prefix", () => {
    const root = rootOf({
      breakpoints,
      tokens: { tokens: [], prefix: "--brand-" },
    });
    expect(root?.style.getPropertyValue("--nx-canvas-site-ground")).toBe(
      "var(--brand-color-background, Canvas)"
    );
    expect(root?.style.getPropertyValue("--nx-canvas-site-ink")).toBe(
      "var(--brand-color-text, CanvasText)"
    );
  });

  it("marks a dark ground when the site's background has a dark value", () => {
    // The default token set gives the background a dark value of its own.
    expect(
      rootOf({ breakpoints })?.hasAttribute("data-nx-site-dark-ground")
    ).toBe(true);
  });

  it("marks no dark ground when the site's dark values keep it light", () => {
    const light = (dark?: string): SiteSheetInput => ({
      breakpoints,
      tokens: {
        darkMode: "media",
        tokens: [
          {
            name: "color.background",
            kind: "color",
            values:
              dark === undefined
                ? { light: "#ffffff" }
                : { light: "#ffffff", dark },
          },
        ],
      },
    });
    // A background with no dark value, and one whose dark value is light.
    expect(rootOf(light())?.hasAttribute("data-nx-site-dark-ground")).toBe(
      false
    );
    expect(
      rootOf(light("#f3f4f6"))?.hasAttribute("data-nx-site-dark-ground")
    ).toBe(false);
  });

  it("judges oklch and hsl grounds by their lightness", () => {
    // Tailwind themes write oklch, shadcn-style themes hsl; a dark ground in
    // either is dark, and a light one is not.
    const marked = (dark: string): boolean | undefined =>
      rootOf({
        breakpoints,
        tokens: {
          darkMode: "media",
          tokens: [
            {
              name: "color.background",
              kind: "color",
              values: { light: "#ffffff", dark },
            },
          ],
        },
      })?.hasAttribute("data-nx-site-dark-ground");
    expect(marked("oklch(0.145 0 0)")).toBe(true);
    expect(marked("oklch(14.5% 0 0)")).toBe(true);
    expect(marked("hsl(222 47% 11%)")).toBe(true);
    expect(marked("hsl(222, 47%, 11%)")).toBe(true);
    expect(marked("oklch(0.98 0 0)")).toBe(false);
    expect(marked("hsl(0 0% 98%)")).toBe(false);
  });

  it("marks no dark ground for a translucent dark value", () => {
    /*
     * A colour with alpha below 1 has no lightness of its own: what shows is
     * the surface behind it, which the canvas cannot see. So it is unknown,
     * not dark, in every syntax the ground is read in.
     */
    const marked = (dark: string): boolean | undefined =>
      rootOf({
        breakpoints,
        tokens: {
          darkMode: "media",
          tokens: [
            {
              name: "color.background",
              kind: "color",
              values: { light: "#ffffff", dark },
            },
          ],
        },
      })?.hasAttribute("data-nx-site-dark-ground");
    for (const dark of [
      "#0000",
      "#00000080",
      "rgba(0, 0, 0, 0)",
      "rgb(0 0 0 / 50%)",
      "oklch(0.145 0 0 / 0.5)",
      "oklch(14.5% 0 0 / 50%)",
      "hsl(222 47% 11% / 0.4)",
      "hsla(222, 47%, 11%, 0.4)",
      // Signed and exponent alphas, which CSS reads as numbers like any other.
      "oklch(0.145 0 0 / +0.5)",
      "oklch(0.145 0 0 / 5e-1)",
      "hsl(222 47% 11% / -0.5)",
      "hsla(222, 47%, 11%, 5e-1)",
    ]) {
      expect(marked(dark), dark).toBe(false);
    }
    // Fully opaque, in the same syntaxes, is still judged by its lightness.
    for (const dark of [
      "#000f",
      "rgba(0, 0, 0, 1)",
      "oklch(0.145 0 0 / 1)",
      "hsl(222 47% 11% / 100%)",
      "hsla(222, 47%, 11%, 1)",
      // The same grammar for every component, and an alpha above 1 clamps.
      "oklch(1.45e-1 0 0 / 1e0)",
      "oklch(0.145 0 0 / +2)",
      "hsl(222 47% 1.1e1%)",
      "hsl(222 47 11)",
    ]) {
      expect(marked(dark), dark).toBe(true);
    }
  });

  it("marks no dark ground when it cannot read the dark value", () => {
    // A valid colour this engine does not parse says nothing about luminance,
    // so the canvas keeps the page's light default rather than guessing dark.
    for (const dark of [
      "white",
      "color-mix(in srgb, white, black)",
      "var(--elsewhere)",
    ]) {
      const site: SiteSheetInput = {
        breakpoints,
        tokens: {
          darkMode: "media",
          tokens: [
            {
              name: "color.background",
              kind: "color",
              values: { light: "#ffffff", dark },
            },
          ],
        },
      };
      expect(rootOf(site)?.hasAttribute("data-nx-site-dark-ground")).toBe(
        false
      );
    }
  });

  it("marks the ground opaque only when every value of it is", () => {
    /*
     * The page root repeats an opaque ground so a blend inside the isolated
     * page mixes with it; a translucent one repeated would be composited
     * twice. So the canvas states which it has, from the same token set.
     */
    const opaque = (light: string, dark?: string): boolean | undefined =>
      rootOf({
        breakpoints,
        tokens: {
          tokens: [
            {
              name: "color.background",
              kind: "color",
              values: dark === undefined ? { light } : { light, dark },
            },
          ],
        },
      })?.hasAttribute("data-nx-site-ground-opaque");
    expect(opaque("#ffffff", "#0b0f19")).toBe(true);
    expect(opaque("white")).toBe(true);
    expect(opaque("oklch(0.98 0 0)", "hsl(222 47% 11% / 1)")).toBe(true);
    expect(opaque("rgb(0 0 0 / 50%)")).toBe(false);
    expect(opaque("#ffffff", "#0b0f1980")).toBe(false);
    expect(opaque("transparent")).toBe(false);
    // A value this cannot read is not called opaque.
    expect(opaque("var(--elsewhere)")).toBe(false);
  });

  it("judges the ground by the colour it resolves to, which host CSS can change", () => {
    /*
     * The tokens say opaque, but the host's own CSS sets the token's
     * property to a half-transparent colour. What the canvas paints is the
     * resolved value, so that is what decides whether the page repeats it.
     */
    const computed = window.getComputedStyle.bind(window);
    const spy = vi
      .spyOn(window, "getComputedStyle")
      .mockImplementation((element, pseudo) => {
        const style = computed(element, pseudo);
        if (!element.classList.contains(CANVAS_ROOT_CLASS)) return style;
        return new Proxy(style, {
          get(target, key) {
            if (key === "backgroundColor") return "rgba(0, 0, 0, 0.5)";
            const value: unknown = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      });
    try {
      const root = rootOf({
        breakpoints,
        tokens: {
          tokens: [
            {
              name: "color.background",
              kind: "color",
              values: { light: "#ffffff" },
            },
          ],
        },
      });
      expect(root?.hasAttribute("data-nx-site-ground-opaque")).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it("reads the alpha of a wide-gamut colour the ground resolves to", () => {
    // A browser can keep `color(display-p3 …)` in the computed value; a
    // half-transparent one must not be taken for the opaque token.
    const computed = window.getComputedStyle.bind(window);
    const spy = vi
      .spyOn(window, "getComputedStyle")
      .mockImplementation((element, pseudo) => {
        const style = computed(element, pseudo);
        if (!element.classList.contains(CANVAS_ROOT_CLASS)) return style;
        return new Proxy(style, {
          get(target, key) {
            if (key === "backgroundColor")
              return "color(display-p3 0 0 0 / 0.5)";
            const value: unknown = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      });
    try {
      const root = rootOf({
        breakpoints,
        tokens: {
          tokens: [
            {
              name: "color.background",
              kind: "color",
              values: { light: "#ffffff" },
            },
          ],
        },
      });
      expect(root?.hasAttribute("data-nx-site-ground-opaque")).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it("judges the ground again when the canvas frame resizes", () => {
    // A site can override the background token under a width or height
    // query, which a frame resized past it crosses with no render.
    let narrow = false;
    const computed = window.getComputedStyle.bind(window);
    const spy = vi
      .spyOn(window, "getComputedStyle")
      .mockImplementation((element, pseudo) => {
        const style = computed(element, pseudo);
        if (!element.classList.contains(CANVAS_ROOT_CLASS)) return style;
        return new Proxy(style, {
          get(target, key) {
            if (key === "backgroundColor") {
              return narrow ? "rgba(255, 255, 255, 0.5)" : "rgb(255, 255, 255)";
            }
            const value: unknown = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      });
    try {
      const root = rootOf({ breakpoints, tokens: { tokens: [] } });
      expect(root?.hasAttribute("data-nx-site-ground-opaque")).toBe(true);
      narrow = true;
      window.dispatchEvent(new Event("resize"));
      expect(root?.hasAttribute("data-nx-site-ground-opaque")).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it("judges the ground again when the site's theme changes, with no render", async () => {
    // The theme marker writes the root's theme without a render; a light
    // ground that is opaque and a dark one that is not must each be judged.
    const computed = window.getComputedStyle.bind(window);
    const spy = vi
      .spyOn(window, "getComputedStyle")
      .mockImplementation((element, pseudo) => {
        const style = computed(element, pseudo);
        if (!element.classList.contains(CANVAS_ROOT_CLASS)) return style;
        const dark = element.getAttribute("data-nx-site-theme") === "dark";
        return new Proxy(style, {
          get(target, key) {
            if (key === "backgroundColor") {
              return dark ? "rgba(11, 15, 25, 0.5)" : "rgb(255, 255, 255)";
            }
            const value: unknown = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      });
    try {
      const root = rootOf({ breakpoints, tokens: { tokens: [] } });
      expect(root?.hasAttribute("data-nx-site-ground-opaque")).toBe(true);
      root?.setAttribute("data-nx-site-theme", "dark");
      await act(async () => undefined);
      expect(root?.hasAttribute("data-nx-site-ground-opaque")).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it("names nothing when the host serves no site sheet", () => {
    const root = rootOf(false);
    expect(root?.style.getPropertyValue("--nx-canvas-site-ground")).toBe("");
    expect(root?.hasAttribute("data-nx-site-dark-ground")).toBe(false);
  });
});

describe("a list note's action", () => {
  beforeAll(() => {
    clearBlocks();
    registerBlocks(
      [
        {
          name: "acme/noted",
          version: 1,
          description: "A list with a note to its author.",
          example: { props: {} },
          render: ({ className }: { className: string }) =>
            createElement(
              "div",
              { className },
              createElement(
                "div",
                { "data-nx-list-diagnostic": "sort-fallback" },
                createElement("span", { "data-testid": "words" }, "Fell back."),
                createElement(
                  "button",
                  {
                    type: "button",
                    [LIST_ACTION_ATTRIBUTE]: "choose-sort-field",
                  },
                  "Choose a field"
                )
              )
            ),
        },
      ] as never,
      { source: "canvas-list-action-test" }
    );
  });

  afterAll(clearBlocks);

  it("asks the host to take the author to the list's sort, in place of a plain selection", () => {
    const onSelect = vi.fn();
    const onListSortField = vi.fn();
    render(
      <Canvas
        document={
          {
            formatVersion: 1,
            kind: "page",
            nodes: [{ id: "list", type: "acme/noted", version: 1, props: {} }],
          } as never
        }
        siteStyles={{ css: "", classes: {} } as never}
        onSelect={onSelect as never}
        onListSortField={onListSortField}
      />
    );
    // A button's Enter and Space arrive as this same click.
    fireEvent.click(screen.getByRole("button", { name: "Choose a field" }));
    expect(onListSortField).toHaveBeenCalledWith("list");
    expect(onSelect).not.toHaveBeenCalled();
    // Anywhere else in the note selects the list, as before.
    fireEvent.click(screen.getByTestId("words"));
    expect(onSelect).toHaveBeenCalledWith("list", "replace");
    expect(onListSortField).toHaveBeenCalledTimes(1);
  });
});
