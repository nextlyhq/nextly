/**
 * The document as a structure an author can see.
 *
 * Driven through the real registry, because what a block is CALLED comes from
 * it — a stub would restate the label rule and keep agreeing after the registry
 * changed what a definition means.
 *
 * @module layers.test
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearBlocks,
  hasBlock,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import {
  ancestorIds,
  blockNameOf,
  componentTitles,
  filterLayers,
  layerLabel,
  layersOf,
  pathTo,
  regionsTo,
  slotRowsIn,
} from "./layers";

const base = {
  version: 1,
  description: "A block.",
  example: { props: {} },
  render: () => null,
};

afterEach(clearBlocks);

/**
 * Registers the fixture blocks, and may be called more than once in a test.
 *
 * Registration refuses a redefinition, so a helper that builds a document by
 * calling this would throw the second time a test needed one.
 */
function register() {
  if (hasBlock("core/heading")) return;
  registerBlocks(
    [
      { ...base, name: "core/heading", editor: { label: "Heading" } },
      { ...base, name: "core/text", editor: { label: "Text" } },
      {
        ...base,
        name: "core/box",
        editor: { label: "Box" },
        slots: { children: {} },
      },
      // No `editor.label`, so its name has to be humanised rather than shown
      // raw. This is the block that separates the shared label rule from the
      // weaker `?? node.type` one.
      { ...base, name: "acme/collection-loop", slots: { children: {} } },
    ] as never,
    { source: "layers-test" }
  );
}

function node(
  id: string,
  type: string,
  extra: Partial<BlockNode> = {}
): BlockNode {
  return { id, type, version: 1, props: {}, ...extra } as BlockNode;
}

function documentOf(nodes: BlockNode[]): BlockDocument {
  return { formatVersion: 1, kind: "page", nodes } as BlockDocument;
}

describe("layerLabel", () => {
  it("prefers the instance name the author wrote", () => {
    register();
    expect(layerLabel(node("a", "core/heading", { name: "Page title" }))).toBe(
      "Page title"
    );
  });

  it("falls back to the block's name, humanised", () => {
    // THE case for sharing one label rule. `editor.label ?? node.type` would
    // put `acme/collection-loop` on the row while the palette offered
    // "Collection loop" — the same block under two names in one editor.
    register();
    expect(layerLabel(node("a", "acme/collection-loop"))).toBe(
      "Collection loop"
    );
    expect(layerLabel(node("b", "core/heading"))).toBe("Heading");
  });

  it("ignores a name that is only whitespace", () => {
    // A blank row cannot be told from its neighbours and cannot be typed to,
    // so an empty name is not a name.
    register();
    expect(layerLabel(node("a", "core/heading", { name: "   " }))).toBe(
      "Heading"
    );
  });

  it("reads the label from the lookup a caller names, not the registry", () => {
    // A surface that registers nothing resolves blocks through its own
    // resolver. Asked of the registry there, a block labelled "Hero" would be
    // humanised from its type and named differently than the editor names it.
    const hero = { name: "acme/hero-banner", editor: { label: "Hero" } };
    const lookup = (type: string) =>
      type === hero.name ? (hero as never) : undefined;

    expect(layerLabel(node("a", "acme/hero-banner"), lookup)).toBe("Hero");
    expect(
      layerLabel(node("b", "acme/hero-banner", { name: "Top" }), lookup)
    ).toBe("Top");
  });
});

describe("a component placement's name", () => {
  // A placement is one node of the engine's own type, so the type says only
  // that it IS a placement. What the author placed is the component, which
  // only the library can name.
  const placement = (
    id: string,
    componentId: unknown,
    extra: Partial<BlockNode> = {}
  ) =>
    node(id, "nextly/component-instance", { props: { componentId }, ...extra });
  const titles = componentTitles([
    { id: "cmp-hero", title: "Hero banner" },
    { id: "cmp-blank", title: "   " },
  ]);

  it("is the component's title", () => {
    expect(layerLabel(placement("a", "cmp-hero"), undefined, titles)).toBe(
      "Hero banner"
    );
  });

  it("is the name the author gave the placement, over the title", () => {
    expect(
      layerLabel(
        placement("a", "cmp-hero", { name: "Top banner" }),
        undefined,
        titles
      )
    ).toBe("Top banner");
  });

  it('is "Component" when nothing names the component', () => {
    // Not the type humanised: "Component instance" names the engine's
    // mechanism, which is not a word an author used for anything.
    expect(layerLabel(placement("a", "cmp-gone"), undefined, titles)).toBe(
      "Component"
    );
    expect(layerLabel(placement("b", "cmp-blank"), undefined, titles)).toBe(
      "Component"
    );
    expect(layerLabel(placement("c", "cmp-hero"))).toBe("Component");
    // A stored id that is not a string reaches no lookup.
    expect(layerLabel(placement("d", 42), undefined, titles)).toBe("Component");
  });

  it("reads the same in the tree and the trail", () => {
    register();
    const document = documentOf([
      node("box", "core/box", {
        slots: { children: [placement("a", "cmp-hero")] },
      }),
    ]);

    expect(layersOf(document, titles)[0].children[0].label).toBe("Hero banner");
    expect(pathTo(document, "a", titles).map(row => row.label)).toEqual([
      "Box",
      "Hero banner",
    ]);
  });

  it("reads the same on the canvas's tag, found by address anywhere in the page", () => {
    register();
    const document = documentOf([
      node("box", "core/box", {
        slots: { children: [placement("a", "cmp-hero")] },
      }),
    ]);

    expect(blockNameOf(document, "a", titles)).toBe("Hero banner");
    expect(blockNameOf(document, "box", titles)).toBe("Box");
    // An address the page no longer holds names nothing.
    expect(blockNameOf(document, "gone", titles)).toBeUndefined();
  });

  it("reads the page once for every name the canvas asks, and again only for a new page", () => {
    register();
    const document = documentOf([
      node("box", "core/box", {
        slots: {
          children: [placement("a", "cmp-hero"), placement("b", "cmp-hero")],
        },
      }),
    ]);
    const asked = vi.fn(titles);
    // The canvas asks for a placement's name every time it draws its frame.
    for (let draw = 0; draw < 3; draw += 1) {
      expect(blockNameOf(document, "a", asked)).toBe("Hero banner");
    }
    expect(blockNameOf(document, "b", asked)).toBe("Hero banner");
    expect(blockNameOf(document, "box", asked)).toBe("Box");
    // One read of the page named every placement on it, once each, however
    // often a name was asked.
    expect(asked).toHaveBeenCalledTimes(2);
    // An edit is a new page, read afresh.
    const edited = documentOf([placement("a", "cmp-blank")]);
    expect(blockNameOf(edited, "a", asked)).toBe("Component");
  });

  it("names the placement holding a lock by its title", () => {
    register();
    const document = documentOf([
      placement("a", "cmp-hero", {
        locked: true,
        slots: { children: [node("t", "core/text")] },
      }),
    ]);

    expect(layersOf(document, titles)[0].children[0].lockedBy).toBe(
      "Hero banner"
    );
  });
});

describe("layersOf", () => {
  it("nests children under the block that holds them", () => {
    register();
    const tree = layersOf(
      documentOf([
        node("box", "core/box", {
          slots: { children: [node("h", "core/heading")] },
        }),
      ])
    );

    expect(tree).toHaveLength(1);
    expect(tree[0]?.id).toBe("box");
    expect(tree[0]?.children.map(c => c.id)).toEqual(["h"]);
  });

  it("reports the badges as three separate facts", () => {
    // Not one "hidden" flag. A block hidden on mobile is fully present on
    // desktop, and a conditional block's presence depends on an entry the
    // editor cannot evaluate — so collapsing these into an eye would state an
    // answer nothing here knows.
    register();
    const tree = layersOf(
      documentOf([
        node("a", "core/heading", { locked: true }),
        node("b", "core/heading", {
          visibility: { devices: { mobile: false, desktop: true } },
        }),
        node("c", "core/heading", {
          visibility: { conditions: [[{ field: "status", op: "eq" }]] },
        }),
      ])
    );

    expect(
      tree.map(n => [n.locked, n.breakpointHidden, n.conditional])
    ).toEqual([
      [true, false, false],
      [false, true, false],
      [false, false, true],
    ]);
  });

  it("does not call a node breakpoint-hidden when every breakpoint shows it", () => {
    // The control for the case above: `devices` being PRESENT is not the same
    // as a breakpoint being off, and an assertion satisfied by the key existing
    // would pass on a node that is visible everywhere.
    register();
    const tree = layersOf(
      documentOf([
        node("a", "core/heading", {
          visibility: { devices: { mobile: true, desktop: true } },
        }),
      ])
    );

    expect(tree[0]?.breakpointHidden).toBe(false);
  });

  it("treats an empty condition group as no condition", () => {
    register();
    const tree = layersOf(
      documentOf([
        node("a", "core/heading", { visibility: { conditions: [] } }),
      ])
    );

    expect(tree[0]?.conditional).toBe(false);
  });

  it("marks exactly the blocks the page's conditions decide, as the engine judges them", () => {
    register();
    const condition = { field: "tier", op: "exists" };
    const tree = layersOf(
      documentOf([
        // A group with no conditions lets everyone through.
        node("open", "core/heading", {
          visibility: { conditions: [[], [condition]] },
        }),
        // Conditions nothing can read still decide: the page leaves it out.
        node("unreadable", "core/heading", {
          visibility: { conditions: "tier" as never },
        }),
        // CONTROL: an ordinary condition.
        node("gated", "core/heading", {
          visibility: { conditions: [[condition]] },
        }),
      ])
    );
    expect(tree.map(each => each.conditional)).toEqual([false, true, true]);
  });

  it("flattens children across slots in document order", () => {
    // Every container in the catalogue declares exactly one slot today, so this
    // pins the behaviour for the block that will eventually declare two: the
    // run is flat and follows the order the document was written in, rather
    // than an alphabetical rearrangement of the region names.
    register();
    const tree = layersOf(
      documentOf([
        node("box", "core/box", {
          slots: {
            zebra: [node("z", "core/heading")],
            alpha: [node("a", "core/text")],
          },
        }),
      ])
    );

    expect(tree[0]?.children.map(c => c.id)).toEqual(["z", "a"]);
  });
});

describe("pathTo and ancestorIds", () => {
  function nested() {
    register();
    return documentOf([
      node("outer", "core/box", {
        slots: {
          children: [
            node("inner", "core/box", {
              slots: { children: [node("leaf", "core/heading")] },
            }),
          ],
        },
      }),
    ]);
  }

  it("reads outermost first and ends with the node itself", () => {
    expect(pathTo(nested(), "leaf").map(n => n.id)).toEqual([
      "outer",
      "inner",
      "leaf",
    ]);
  });

  it("reports nothing for no selection or a node the document lost", () => {
    // Routine rather than exotic: an undo can remove the selected node while
    // the selection stands, and a breadcrumb drawing a broken trail there is
    // worse than one drawing nothing.
    expect(pathTo(nested(), null)).toEqual([]);
    expect(pathTo(nested(), "gone")).toEqual([]);
  });

  it("gives the ancestors WITHOUT the node, which is what has to open", () => {
    // Expanding the node itself would open a branch the author did not ask for
    // — selecting a container should reveal where it sits, not its contents.
    expect(ancestorIds(nested(), "leaf")).toEqual(["outer", "inner"]);
    expect(ancestorIds(nested(), "outer")).toEqual([]);
  });
});

describe("filterLayers", () => {
  function tree() {
    register();
    return layersOf(
      documentOf([
        node("box", "core/box", {
          slots: {
            children: [
              node("h", "core/heading", { name: "Welcome" }),
              node("t", "core/text"),
            ],
          },
        }),
        node("other", "core/heading", { name: "Footer" }),
      ])
    );
  }

  it("returns the tree unchanged for an empty query", () => {
    // The panel renders with no query, and treating that as "match nothing"
    // would show an empty panel on open.
    const roots = tree();
    expect(filterLayers(roots, "  ").roots).toBe(roots);
  });

  it("keeps a match's ancestors even when they do not match", () => {
    // THE case. Dropping them would present "Welcome" as a top-level block and
    // lose the nesting this panel exists to show.
    const result = filterLayers(tree(), "welcome");

    expect(result.roots.map(n => n.id)).toEqual(["box"]);
    expect(result.roots[0]?.children.map(n => n.id)).toEqual(["h"]);
  });

  it("names the ancestors that have to open, and not the matches", () => {
    // A node kept because of a descendant is collapsed and hides the match; a
    // node that matched is already visible where it stands.
    expect(filterLayers(tree(), "welcome").expand).toEqual(["box"]);
  });

  it("keeps a matching container's whole subtree", () => {
    // Searching for a container asks what is inside it. Pruning its children
    // would answer a narrower question than the one typed.
    const result = filterLayers(tree(), "box");

    expect(result.roots.map(n => n.id)).toEqual(["box"]);
    expect(result.roots[0]?.children.map(n => n.id)).toEqual(["h", "t"]);
    expect(result.expand).toEqual([]);
  });

  it("matches the block type as well as the label", () => {
    // An author who knows a block as `core/text` — from the docs, or from an
    // agent's output — should not have to guess the panel's wording.
    const result = filterLayers(tree(), "core/text");

    expect(result.roots[0]?.children.map(n => n.id)).toEqual(["t"]);
  });

  it("returns nothing when nothing matches", () => {
    expect(filterLayers(tree(), "zzz").roots).toEqual([]);
  });
});

describe("a lock in the tree", () => {
  it("marks the rows inside a locked block with the name of the block that holds it", () => {
    register();
    const rows = layersOf(
      documentOf([
        node("hero", "core/heading", {
          locked: true,
          name: "Hero",
          slots: {
            children: [
              node("inner", "core/heading", {
                locked: true,
                name: "Inner",
                slots: { children: [node("deep", "core/heading")] },
              }),
            ],
          },
        }),
        node("free", "core/heading"),
      ])
    );
    const [hero, free] = rows;
    const inner = hero?.children[0];
    // A row locked itself says so and is held by nothing; the nearest lock
    // above names a row that is not; a row nothing covers carries neither.
    expect(hero).toMatchObject({ locked: true });
    expect(hero?.lockedBy).toBeUndefined();
    expect(inner).toMatchObject({ locked: true });
    expect(inner?.lockedBy).toBeUndefined();
    expect(inner?.children[0]).toMatchObject({
      locked: false,
      lockedBy: "Inner",
    });
    expect(free?.lockedBy).toBeUndefined();
  });
});

describe("hiddenHere", () => {
  const site = {
    viewport: [
      { id: "tablet", label: "Tablet", maxWidth: 1024 },
      { id: "mobile", label: "Mobile", maxWidth: 640 },
    ],
    container: [],
  };
  const document = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "a",
        type: "core/heading",
        version: 1,
        props: {},
        // Hidden from Desktop down and shown again on Mobile: Tablet stores
        // nothing and is still hidden.
        visibility: { devices: { base: false, mobile: true } },
      },
    ],
  } as unknown as BlockDocument;

  it("is the block's state on the device asked for, through the cascade", () => {
    const on = (id: string) =>
      layersOf(document, undefined, { breakpoints: site, id })[0]?.hiddenHere;
    expect(on("base")).toBe(true);
    expect(on("tablet")).toBe(true);
    expect(on("mobile")).toBe(false);
  });

  it("is not said at all when no device is asked for", () => {
    expect(layersOf(document)[0]?.hiddenHere).toBeUndefined();
  });

  it("names the hidden block a row is hidden with", () => {
    const nested = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "box",
          type: "core/box",
          version: 1,
          name: "Hero",
          props: {},
          visibility: { devices: { tablet: false } },
          slots: {
            children: [
              { id: "in", type: "core/heading", version: 1, props: {} },
            ],
          },
        },
      ],
    } as unknown as BlockDocument;
    const [box] = layersOf(nested, undefined, {
      breakpoints: site,
      id: "tablet",
    });
    expect(box?.hiddenHere).toBe(true);
    expect(box?.children[0]?.hiddenHere).toBe(false);
    expect(box?.children[0]?.hiddenWith).toBe("Hero");
  });
});

describe("a collection list's regions", () => {
  const list = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "list",
        type: "core/collection-loop",
        version: 1,
        props: {},
        slots: {
          children: [
            { id: "card", type: "core/heading", version: 1, props: {} },
          ],
          empty: [
            {
              id: "none",
              type: "core/heading",
              version: 1,
              props: {},
              name: "No posts",
            },
          ],
        },
      },
    ],
  } as BlockDocument;

  it("names both regions on the list, and the one each child sits in", () => {
    const [row] = layersOf(list);
    expect(row?.slotRows?.map(each => each.label)).toEqual([
      "Each entry",
      "When empty",
    ]);
    expect(row?.children.map(child => [child.id, child.slot])).toEqual([
      ["card", "children"],
      ["none", "empty"],
    ]);
  });

  it("opens the region a match sits in, as it opens the list", () => {
    const tree = layersOf(list);
    const emptyRow = tree[0]?.slotRows?.[1]?.rowId;
    const found = filterLayers(tree, "No posts");
    expect(found.expand).toEqual(["list", emptyRow]);
    expect(regionsTo(list, "none")).toEqual([
      { parentId: "list", slot: "empty", rowId: emptyRow },
    ]);
    expect(slotRowsIn(tree).get(emptyRow ?? "")).toEqual({
      parentId: "list",
      slot: "empty",
    });
    expect(slotRowsIn(tree).has("list")).toBe(false);
  });

  it("gives each region row an id no block of the document has", () => {
    // A stored id may be any string, a row's own spelling too.
    const taken = {
      ...list,
      nodes: [
        ...list.nodes,
        {
          id: "nx-slot:empty:list",
          type: "core/heading",
          version: 1,
          props: {},
        },
      ],
    } as BlockDocument;
    const tree = layersOf(taken);
    const rowIds = tree[0]?.slotRows?.map(row => row.rowId) ?? [];
    expect(rowIds).toHaveLength(2);
    expect(rowIds).not.toContain("nx-slot:empty:list");
    expect(slotRowsIn(tree).has("nx-slot:empty:list")).toBe(false);
  });
});
