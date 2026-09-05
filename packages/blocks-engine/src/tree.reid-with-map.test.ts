/**
 * Re-identifying a subtree while keeping its internal references usable.
 *
 * The failure this exists to prevent is silent and only visible on a rendered
 * page: `reidSubtree` DROPS a copy's DOM ids, so a saved pattern whose button
 * links to `#pricing` inside itself is inserted with the link intact and the
 * target gone — and the fragment then resolves to whatever `#pricing` the
 * destination page happens to own, or to nothing. Every assertion here is about
 * that pair: the ids must change, and the subtree must still be able to point
 * at itself.
 */
import { describe, expect, it } from "vitest";

import type { BlockNode } from "./document";
import {
  reidForestWithMap,
  reidSubtree,
  reidSubtreeWithMap,
  walkNodes,
} from "./tree";

/** A node with an optional DOM id, and children. */
function node(
  id: string,
  extra: Partial<BlockNode> = {},
  children: BlockNode[] = []
): BlockNode {
  return {
    id,
    type: "core/box",
    version: 1,
    props: {},
    ...(children.length > 0 ? { slots: { children } } : {}),
    ...extra,
  };
}

/** Every node in a subtree, flattened. */
function allNodes(root: BlockNode): BlockNode[] {
  const out: BlockNode[] = [];
  walkNodes([root], n => out.push(n));
  return out;
}

describe("a re-identified subtree is a different subtree", () => {
  it("gives every node a fresh id and records the mapping", () => {
    const tree = node("root", {}, [node("a"), node("b")]);
    const result = reidSubtreeWithMap(tree);

    const ids = allNodes(result.node).map(n => n.id);
    // The control: three nodes in, three out — so the assertions below are
    // about re-identification rather than about a walk that lost the subtree.
    expect(ids).toHaveLength(3);
    expect(ids).not.toContain("root");

    // Every original is addressable in the map, which is what lets a caller
    // rewrite a reference it holds elsewhere.
    expect([...result.nodeIds.keys()].sort()).toEqual(["a", "b", "root"]);
    expect(result.nodeIds.get("root")).toBe(result.node.id);
  });
});

describe("a DOM id is remapped rather than dropped", () => {
  it("keeps an id, changes it, and reports the replacement", () => {
    const result = reidSubtreeWithMap(node("root", { cssId: "pricing" }));

    // Three separate claims, and the middle one is the point. Dropping would
    // satisfy "not the original"; keeping would satisfy "still has one".
    expect(result.node.cssId).toBeDefined();
    expect(result.node.cssId).not.toBe("pricing");
    expect(result.domIds.get("pricing")).toBe(result.node.cssId);
  });

  it("derives the replacement from the original", () => {
    // An author reads and writes this value: it appears in a URL fragment, in a
    // stylesheet and in the attribute panel. A UUID would be unique and
    // unusable.
    const result = reidSubtreeWithMap(node("root", { cssId: "pricing" }));

    expect(result.node.cssId).toMatch(/^pricing-/);
  });

  it("remaps the attributes escape hatch too, case-insensitively", () => {
    // A DOM id reaches a page two ways, and a remap that covered one would
    // leave the other emitting a duplicate.
    const result = reidSubtreeWithMap(
      node("root", { attributes: { ID: "pricing", "data-keep": "yes" } })
    );

    expect(result.node.attributes?.ID).toBe(result.domIds.get("pricing"));
    // The control: an unrelated attribute is untouched, so this is a remap
    // rather than a rewrite of everything.
    expect(result.node.attributes?.["data-keep"]).toBe("yes");
  });

  it("gives two copies of one subtree different DOM ids", () => {
    // The collision the remap exists to avoid: two inserts of one pattern on
    // one page must not emit the same HTML id.
    const tree = node("root", { cssId: "pricing" });

    expect(reidSubtreeWithMap(tree).node.cssId).not.toBe(
      reidSubtreeWithMap(tree).node.cssId
    );
  });

  it("still drops the id through the plain reidSubtree", () => {
    // The control for the whole file. `reidSubtree` is unchanged and is still
    // right where the copy is all anyone will look at — if it had started
    // remapping, every assertion above would pass for the wrong reason.
    expect(
      reidSubtree(node("root", { cssId: "pricing" })).cssId
    ).toBeUndefined();
  });
});

describe("every internal reference round-trips", () => {
  it("maps each DOM id in the subtree exactly once, whole", () => {
    // The property the design asks for, stated over a tree rather than a case:
    // for every id the subtree carried, the map holds an entry, and the
    // rebuilt tree carries the mapped value. A remap that missed a nested node,
    // or minted a second replacement for an id it had already seen, breaks one
    // of the two.
    const tree = node("root", { cssId: "top" }, [
      node("a", { cssId: "middle" }, [node("a1", { cssId: "deep" })]),
      node("b", { attributes: { id: "sidebar" } }),
    ]);

    const result = reidSubtreeWithMap(tree);
    const before = ["top", "middle", "deep", "sidebar"];

    expect([...result.domIds.keys()].sort()).toEqual([...before].sort());

    const after = allNodes(result.node).flatMap(n => {
      const attr = n.attributes?.id;
      return [
        ...(typeof n.cssId === "string" ? [n.cssId] : []),
        ...(typeof attr === "string" ? [attr] : []),
      ];
    });
    expect(after.sort()).toEqual(
      before.map(id => result.domIds.get(id)!).sort()
    );
  });

  it("maps a repeated id to one replacement", () => {
    // Already malformed — validation reports the duplicate — but the copy must
    // not make it worse. The pair pointed at one target before, so a reference
    // to it still reaches one target after.
    const tree = node("root", { cssId: "dup" }, [node("a", { cssId: "dup" })]);
    const result = reidSubtreeWithMap(tree);

    const seen = allNodes(result.node).map(n => n.cssId);
    expect(new Set(seen).size).toBe(1);
    expect(seen[0]).toBe(result.domIds.get("dup"));
  });

  it("leaves a subtree carrying no DOM ids with an empty map", () => {
    // The control for the map itself: it reports what was there, so a function
    // inventing entries would fail here while passing everything above.
    const result = reidSubtreeWithMap(node("root", {}, [node("a")]));

    expect(result.domIds.size).toBe(0);
    expect(result.nodeIds.size).toBe(2);
  });
});

describe("reidSubtreeWithMap id references", () => {
  it("points a copied reference at the copy's own target", () => {
    const original: BlockNode = {
      id: "root",
      type: "core/box",
      version: 1,
      props: {},
      slots: {
        children: [
          { id: "a", type: "core/text", version: 1, props: {}, cssId: "help" },
          {
            id: "b",
            type: "core/text",
            version: 1,
            props: {},
            attributes: { "aria-describedby": "help" },
          },
        ],
      },
    };

    const { node } = reidSubtreeWithMap(original);
    const children = node.slots!.children!;

    // Without the second pass the copy still says "help", which resolves to
    // the ORIGINAL node — so the duplicate loses its description to whichever
    // element the browser finds first.
    expect(children[1]!.attributes!["aria-describedby"]).toBe(
      children[0]!.cssId
    );
    expect(children[1]!.attributes!["aria-describedby"]).not.toBe("help");
  });
});

describe("reidSubtreeWithMap malformed attributes", () => {
  it("survives a stored attributes: null beside a node with a DOM id", () => {
    const original = {
      id: "root",
      type: "core/box",
      version: 1,
      props: {},
      slots: {
        children: [
          { id: "a", type: "core/text", version: 1, props: {}, cssId: "x" },
          {
            id: "b",
            type: "core/text",
            version: 1,
            props: {},
            attributes: null,
          },
        ],
      },
    } as unknown as BlockNode;

    expect(() => reidSubtreeWithMap(original)).not.toThrow();
  });
});

/**
 * A run of siblings, which is what a saved selection is.
 *
 * The singular function cannot answer for this shape. Given one root it builds
 * its `domIds` from that root's subtree, so a caller looping over N roots hands
 * each pass a map that knows nothing about the others — and a reference from
 * the second root to a DOM id in the first is left addressing the ORIGINAL
 * element. The whole point of the second pass is that no reference is left
 * behind, and a per-root loop reinstates exactly the gap it closes.
 */
describe("a forest is re-identified as one thing", () => {
  it("gives every node in every root a fresh id", () => {
    const forest = [node("one", {}, [node("one-child")]), node("two")];

    const { nodes, nodeIds } = reidForestWithMap(forest);

    const fresh = nodes.flatMap(root => allNodes(root)).map(n => n.id);
    expect(fresh).toHaveLength(3);
    for (const original of ["one", "one-child", "two"]) {
      expect(fresh).not.toContain(original);
      expect(nodeIds.get(original)).toBeDefined();
    }
  });

  it("keeps the roots in the order they were given", () => {
    const forest = [node("first"), node("second")];

    const { nodes, nodeIds } = reidForestWithMap(forest);

    expect(nodes[0]!.id).toBe(nodeIds.get("first"));
    expect(nodes[1]!.id).toBe(nodeIds.get("second"));
  });

  it("POINTS A REFERENCE THAT CROSSES ROOTS AT THE COPY", () => {
    const forest = [
      node("target", { cssId: "pricing" }),
      node("pointer", { attributes: { "aria-labelledby": "pricing" } }),
    ];

    const { nodes, domIds } = reidForestWithMap(forest);

    const copiedId = nodes[0]!.cssId;
    expect(copiedId).toBe(domIds.get("pricing"));
    expect(copiedId).not.toBe("pricing");
    expect(nodes[1]!.attributes!["aria-labelledby"]).toBe(copiedId);
  });

  it("leaves a token it did not mint alone, so a host page anchor survives", () => {
    const forest = [
      node("a", { cssId: "mine" }),
      node("b", { attributes: { "aria-controls": "mine theirs" } }),
    ];

    const { nodes, domIds } = reidForestWithMap(forest);

    expect(nodes[1]!.attributes!["aria-controls"]).toBe(
      `${domIds.get("mine")} theirs`
    );
  });

  it("answers an empty forest with an empty forest", () => {
    const { nodes, nodeIds, domIds } = reidForestWithMap([]);

    expect(nodes).toEqual([]);
    expect(nodeIds.size).toBe(0);
    expect(domIds.size).toBe(0);
  });
});

/**
 * A fragment link lives in PROPS, and the copy has to take it along.
 *
 * `cssId` is not referenced only by markup. `core/button` passes a bare `href`
 * of `#pricing` through to the DOM, so minting a new id for the target and
 * leaving the link behind produces a copy whose anchor resolves to nothing —
 * the same silent breakage as a dangling `aria-labelledby`, one prop over. The
 * rule is deliberately narrow: only a whole string of `#` plus an id THIS copy
 * minted is rewritten, because nothing else can spell that.
 */
describe("a fragment link in props follows the copy", () => {
  it("repoints an href at the copy's own target", () => {
    const forest = [
      node("target", { cssId: "pricing" }),
      node("link", { props: { href: "#pricing" } } as Partial<BlockNode>),
    ];

    const { nodes, domIds } = reidForestWithMap(forest);

    expect(nodes[1]!.props.href).toBe(`#${domIds.get("pricing")}`);
    expect(nodes[1]!.props.href).not.toBe("#pricing");
  });

  it("reaches a link nested inside an array-valued prop", () => {
    const forest = [
      node("target", { cssId: "pricing" }),
      node("nav", {
        props: { items: [{ label: "Plans", href: "#pricing" }] },
      } as Partial<BlockNode>),
    ];

    const { nodes, domIds } = reidForestWithMap(forest);

    const items = nodes[1]!.props.items as { href: string }[];
    expect(items[0]!.href).toBe(`#${domIds.get("pricing")}`);
  });

  it("leaves a string that only LOOKS like a fragment alone", () => {
    const forest = [
      node("target", { cssId: "pricing" }),
      node("copy", {
        props: { text: "#1 bestseller", href: "#somewhere-else" },
      } as Partial<BlockNode>),
    ];

    const { nodes } = reidForestWithMap(forest);

    // Content, not a reference: it names no minted id.
    expect(nodes[1]!.props.text).toBe("#1 bestseller");
    // A target OUTSIDE the copied run belongs to the page and still works.
    expect(nodes[1]!.props.href).toBe("#somewhere-else");
  });
});
