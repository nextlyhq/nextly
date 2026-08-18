/**
 * The document as a structure an author can see.
 *
 * Driven through the real registry, because what a block is CALLED comes from
 * it — a stub would restate the label rule and keep agreeing after the registry
 * changed what a definition means.
 *
 * @module layers.test
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  clearBlocks,
  hasBlock,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import {
  ancestorIds,
  filterLayers,
  layerLabel,
  layersOf,
  pathTo,
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
