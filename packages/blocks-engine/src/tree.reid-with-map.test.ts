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
import { reidForestWithMap, reidSubtree, walkNodes } from "./tree";

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

/**
 * The forest rewrite for a SINGLE root, shaped like the assertions below expect.
 *
 * Local to the tests because the product has no singular form: everything that
 * re-identifies works on a run of siblings and reaches for `reidForestWithMap`.
 * These cases are about what a copy IS — new ids, remapped DOM ids, references
 * that round-trip — and one root is the smallest forest that shows it, so they
 * are kept and pointed at the function the product actually calls.
 */
function reidOne(root: BlockNode): {
  node: BlockNode;
  nodeIds: ReadonlyMap<string, string>;
  domIds: ReadonlyMap<string, string>;
} {
  const { nodes, nodeIds, domIds } = reidForestWithMap([root]);
  return { node: nodes[0] ?? root, nodeIds, domIds };
}

describe("a re-identified subtree is a different subtree", () => {
  it("gives every node a fresh id and records the mapping", () => {
    const tree = node("root", {}, [node("a"), node("b")]);
    const result = reidOne(tree);

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
    const result = reidOne(node("root", { cssId: "pricing" }));

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
    const result = reidOne(node("root", { cssId: "pricing" }));

    expect(result.node.cssId).toMatch(/^pricing-/);
  });

  it("remaps the attributes escape hatch too, case-insensitively", () => {
    // A DOM id reaches a page two ways, and a remap that covered one would
    // leave the other emitting a duplicate.
    const result = reidOne(
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

    expect(reidOne(tree).node.cssId).not.toBe(reidOne(tree).node.cssId);
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

    const result = reidOne(tree);
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
    const result = reidOne(tree);

    const seen = allNodes(result.node).map(n => n.cssId);
    expect(new Set(seen).size).toBe(1);
    expect(seen[0]).toBe(result.domIds.get("dup"));
  });

  it("leaves a subtree carrying no DOM ids with an empty map", () => {
    // The control for the map itself: it reports what was there, so a function
    // inventing entries would fail here while passing everything above.
    const result = reidOne(node("root", {}, [node("a")]));

    expect(result.domIds.size).toBe(0);
    expect(result.nodeIds.size).toBe(2);
  });
});

describe("a single root's id references", () => {
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

    const { node } = reidOne(original);
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

describe("a single root's malformed attributes", () => {
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

    expect(() => reidOne(original)).not.toThrow();
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

  it("LEAVES DISPLAY TEXT ALONE even when it names a minted id", () => {
    // The narrowing that stops this rule reaching content. A heading may
    // legitimately read "#pricing" while a sibling in the same run carries
    // `cssId: "pricing"` — matching a minted id does not make a string a
    // reference. Rewriting on the value alone turned the heading into
    // "#pricing-<suffix>" and changed what the page says, silently, in every
    // insertion of the pattern afterwards.
    const forest = [
      node("target", { cssId: "pricing" }),
      node("heading", {
        props: { text: "#pricing", href: "#pricing" },
      } as Partial<BlockNode>),
    ];

    const { nodes, domIds } = reidForestWithMap(forest);

    expect(nodes[1]!.props.text).toBe("#pricing");
    // The field that HOLDS a target still moves, in the same node.
    expect(nodes[1]!.props.href).toBe(`#${domIds.get("pricing")}`);
  });

  it("reaches a rich-text link far deeper than any authored nesting", () => {
    // props → content → root → children → list → children → listitem →
    // children → link → url. Ten values down, which a depth cap of eight cut
    // off — so an ordinary link in a bulleted list was left dangling while its
    // target was re-minted.
    const link = {
      type: "link",
      url: "#pricing",
      children: [{ type: "text", text: "Plans" }],
    };
    const richText = {
      root: {
        type: "root",
        children: [
          { type: "list", children: [{ type: "listitem", children: [link] }] },
        ],
      },
    };
    const forest = [
      node("target", { cssId: "pricing" }),
      node("body", { props: { content: richText } } as Partial<BlockNode>),
    ];

    const { nodes, domIds } = reidForestWithMap(forest);

    const content = nodes[1]!.props.content as {
      root: { children: { children: { children: { url: string }[] }[] }[] };
    };
    expect(content.root.children[0]!.children[0]!.children[0]!.url).toBe(
      `#${domIds.get("pricing")}`
    );
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

describe("the prop scan is bounded by the document, not by a number", () => {
  it("reaches a link past far more content than any cap allowed", () => {
    // A budget of twenty thousand visits was reachable by a rich-text value of
    // a few hundred kilobytes — inside the document size limit — so a link
    // after enough ordinary content was silently left dangling. How large a
    // document may be is already decided once, by the document limits.
    const filler = Array.from({ length: 10_000 }, (_, i) => ({
      type: "text",
      text: `paragraph ${i}`,
    }));
    const forest = [
      node("target", { cssId: "x" }),
      node("body", {
        props: {
          content: {
            root: {
              type: "root",
              children: [...filler, { type: "link", url: "#x" }],
            },
          },
        },
      } as Partial<BlockNode>),
    ];

    const { nodes, domIds } = reidForestWithMap(forest);

    const children = (
      nodes[1]!.props.content as { root: { children: { url?: string }[] } }
    ).root.children;
    expect(children[children.length - 1]!.url).toBe(`#${domIds.get("x")}`);
  });

  it("walks a record wider than any envelope budget", () => {
    // The component-envelope key budget was borrowed for opaque prop records,
    // which the format does not cap at all — so a record past it was returned
    // UNCHANGED and counted as done, leaving the link addressing an id that had
    // just been re-minted. A bound read as "refuse this document" in one place
    // and as "nothing to do" in the other.
    const wide: Record<string, unknown> = { href: "#x" };
    for (let i = 0; i < 1_200; i += 1) wide[`filler${i}`] = `value ${i}`;
    const forest = [
      node("target", { cssId: "x" }),
      node("wide", { props: { blob: wide } } as Partial<BlockNode>),
    ];

    const { nodes, domIds } = reidForestWithMap(forest);

    const blob = nodes[1]!.props.blob as { href: string };
    expect(blob.href).toBe(`#${domIds.get("x")}`);
  });

  it("CLOSES A CYCLE ON THE COPY, not back onto the original", () => {
    // A path-set guard terminates and still gets this wrong: the cycle-closing
    // edge returns the ORIGINAL record, so the rebuilt object holds an edge to
    // an object still carrying the id this pass just rewrote — one graph with
    // two versions of one node. One replacement per source object is what makes
    // a graph come out a graph.
    const cyclic: Record<string, unknown> = { href: "#x" };
    cyclic.self = cyclic;
    const forest = [
      node("target", { cssId: "x" }),
      node("looped", { props: { nested: cyclic } } as Partial<BlockNode>),
    ];

    const { nodes, domIds } = reidForestWithMap(forest);

    const copy = nodes[1]!.props.nested as Record<string, unknown>;
    expect(copy.href).toBe(`#${domIds.get("x")}`);
    // The edge closes on the rebuild itself...
    expect(copy.self).toBe(copy);
    // ...so there is no second version of it still holding the old id.
    expect((copy.self as Record<string, unknown>).href).toBe(
      `#${domIds.get("x")}`
    );
  });

  it("keeps shared structure shared instead of splitting it in two", () => {
    // The same map that closes a cycle preserves a diamond: one record reached
    // from two places is rebuilt once, so the copy has the aliasing the
    // original had rather than two copies that can drift apart.
    const shared: Record<string, unknown> = { href: "#x" };
    const forest = [
      node("target", { cssId: "x" }),
      node("both", { props: { a: shared, b: shared } } as Partial<BlockNode>),
    ];

    const { nodes } = reidForestWithMap(forest);

    expect(nodes[1]!.props.a).toBe(nodes[1]!.props.b);
  });

  it("terminates on a props object that refers to itself", () => {
    // `structuredClone` carries a cycle through, and these primitives are
    // documented as running on documents nothing validated. Before the path
    // set this recursed until the stack overflowed.
    const cyclic: Record<string, unknown> = { href: "#x" };
    cyclic.self = cyclic;
    const forest = [
      node("target", { cssId: "x" }),
      node("looped", { props: { nested: cyclic } } as Partial<BlockNode>),
    ];

    const { nodes, domIds } = reidForestWithMap(forest);

    const nested = nodes[1]!.props.nested as { href: string };
    expect(nested.href).toBe(`#${domIds.get("x")}`);
  });
});

describe("a bound link's fallback follows the copy", () => {
  it("remaps the fallback of a bound href", () => {
    // A bound `href` keeps its literal in `bindings.href.fallback`, and that is
    // what renders when the source is empty — so a fallback left behind makes
    // the link work until the data does not.
    const forest = [
      node("target", { cssId: "pricing" }),
      node("cta", {
        props: { href: "#pricing" },
        bindings: { href: { $bind: "cta", fallback: "#pricing" } },
      } as unknown as Partial<BlockNode>),
    ];

    const { nodes, domIds } = reidForestWithMap(forest);

    const bound = nodes[1]!.bindings as unknown as {
      href: { fallback: string };
    };
    expect(bound.href.fallback).toBe(`#${domIds.get("pricing")}`);
  });

  it("leaves a bound prop that is NOT a link target alone", () => {
    const forest = [
      node("target", { cssId: "pricing" }),
      node("heading", {
        bindings: { text: { $bind: "title", fallback: "#pricing" } },
      } as unknown as Partial<BlockNode>),
    ];

    const { nodes } = reidForestWithMap(forest);

    const bound = nodes[1]!.bindings as unknown as {
      text: { fallback: string };
    };
    expect(bound.text.fallback).toBe("#pricing");
  });
});

describe('the "keep" DOM id policy', () => {
  /**
   * Minting exists so a copy placed BESIDE its original does not emit a
   * duplicate HTML id. `"keep"` is for the caller that is not doing that: a run
   * lifted out of a page to become a document of its own. Nothing there is
   * placed next to anything, and an insert renames only what its own
   * destination already holds.
   */
  it("carries a cssId and an attributes.id across verbatim", () => {
    const [copy] = reidForestWithMap(
      [node("a", { cssId: "hero", attributes: { id: "hero-alt" } })],
      "keep"
    ).nodes;

    expect(copy.cssId).toBe("hero");
    expect(copy.attributes?.id).toBe("hero-alt");
  });

  it("still mints fresh NODE ids, which is the part a save does need", () => {
    // The two are separate questions and only one of them changes. A node id
    // is how every index in this system addresses a node, so two stored
    // documents claiming one cannot both be described; a DOM id is authored
    // content that means something to a reader.
    const { nodes, nodeIds } = reidForestWithMap(
      [node("a", { cssId: "hero" }, [node("kid")])],
      "keep"
    );

    const ids = allNodes(nodes[0]).map(n => n.id);
    expect(ids).not.toContain("a");
    expect(ids).not.toContain("kid");
    expect(nodeIds.get("a")).toBe(nodes[0].id);
  });

  it("records no DOM id as moved, because none did", () => {
    // An empty map is the honest record and it is load-bearing: a caller
    // checking this map against a destination would otherwise report a
    // collision on an id it is not introducing.
    const { domIds } = reidForestWithMap(
      [node("a", { cssId: "hero" })],
      "keep"
    );

    expect(domIds.size).toBe(0);
  });

  it("leaves a reference pointing at the id it still names", () => {
    const { nodes } = reidForestWithMap(
      [
        node("a", { cssId: "pricing" }),
        node("b", { attributes: { "aria-describedby": "pricing" } }),
      ],
      "keep"
    );

    // The property, not the mechanism: the pointer reaches the copy's own
    // target. Here it does so because neither string moved.
    expect(nodes[1].attributes?.["aria-describedby"]).toBe(nodes[0].cssId);
  });

  it("leaves a link in props pointing at the target it still names", () => {
    // The other half of a reference, and the half that is not markup: a link's
    // target lives in `props` as `href: "#pricing"`. The relink pass returns
    // early on an empty map, so `"keep"` must leave this exactly as it found
    // it — asserted rather than reasoned, because "the pass does nothing" is a
    // property of three separate remappers and any one of them could grow a
    // path that runs before the early return.
    const { nodes } = reidForestWithMap(
      [
        node("t", { cssId: "pricing" }),
        node("l", { props: { href: "#pricing" } }),
      ],
      "keep"
    );

    expect((nodes[1].props as { href: string }).href).toBe("#pricing");
    expect(nodes[0].cssId).toBe("pricing");
  });

  it("keeps re-minting the default, so a PLACING caller is unchanged", () => {
    // The default is the untested state unless it is asserted. Every caller
    // that inserts relies on it, and a flipped default would be a silent
    // duplicate-id bug on a rendered page rather than a failing call.
    const [copy] = reidForestWithMap([node("a", { cssId: "hero" })]).nodes;

    expect(copy.cssId).not.toBe("hero");
    expect(copy.cssId?.startsWith("hero-")).toBe(true);
  });
});

describe('the "avoid" DOM id policy', () => {
  it("mints an id the destination holds, and keeps one it does not", () => {
    // Both in ONE copy, so the test cannot pass by treating the policy as a
    // whole-forest switch: the decision is per id.
    const { nodes } = reidForestWithMap(
      [node("a", { cssId: "taken" }), node("b", { cssId: "free" })],
      { avoid: new Set(["taken"]) }
    );

    expect(nodes[0].cssId).not.toBe("taken");
    expect(nodes[0].cssId?.startsWith("taken-")).toBe(true);
    expect(nodes[1].cssId).toBe("free");
  });

  it("records only the id that moved", () => {
    const { domIds } = reidForestWithMap(
      [node("a", { cssId: "taken" }), node("b", { cssId: "free" })],
      { avoid: new Set(["taken"]) }
    );

    // `free` is absent because it did not move. A caller checking this map
    // against its destination is asking which ids this copy INTRODUCES, and an
    // identity entry would answer that wrongly.
    expect([...domIds.keys()]).toEqual(["taken"]);
  });

  it("follows a reference to the id it moved, and leaves the other alone", () => {
    const { nodes } = reidForestWithMap(
      [
        node("a", { cssId: "taken" }),
        node("b", { cssId: "free" }),
        node("p", {
          attributes: { "aria-describedby": "taken" },
          props: { href: "#free" },
        }),
      ],
      { avoid: new Set(["taken"]) }
    );

    expect(nodes[2].attributes?.["aria-describedby"]).toBe(nodes[0].cssId);
    expect((nodes[2].props as { href: string }).href).toBe("#free");
  });

  it("mints nothing when the destination holds none of them", () => {
    const { nodes, domIds } = reidForestWithMap(
      [node("a", { cssId: "hero", attributes: { id: "hero-alt" } })],
      { avoid: new Set<string>() }
    );

    expect(nodes[0].cssId).toBe("hero");
    expect(nodes[0].attributes?.id).toBe("hero-alt");
    expect(domIds.size).toBe(0);
  });
});

describe('the "restore" DOM id policy', () => {
  /*
   * The arm a SAVE uses. An insert renames an authored id only because the page
   * it landed on already held that name, so the new one is a fact about that
   * page; saving the copy back out has to put the authored one back or the
   * library grows another suffix on every insert-save cycle.
   */
  it("puts back the id the map names, and leaves the rest alone", () => {
    const { nodes } = reidForestWithMap(
      [node("a", { cssId: "hero-7f3" }), node("b", { cssId: "aside" })],
      { restore: new Map([["hero-7f3", "hero"]]) }
    );

    expect(nodes[0].cssId).toBe("hero");
    // Both in ONE copy, so this cannot pass by treating the policy as a
    // whole-forest switch: the decision is per id.
    expect(nodes[1].cssId).toBe("aside");
  });

  it("records only the id that moved", () => {
    const { domIds } = reidForestWithMap(
      [node("a", { cssId: "hero-7f3" }), node("b", { cssId: "aside" })],
      { restore: new Map([["hero-7f3", "hero"]]) }
    );

    expect([...domIds.entries()]).toEqual([["hero-7f3", "hero"]]);
  });

  it("follows a reference to the id it put back", () => {
    const { nodes } = reidForestWithMap(
      [
        node("a", { cssId: "hero-7f3" }),
        node("p", {
          attributes: { "aria-describedby": "hero-7f3" },
          props: { href: "#hero-7f3" },
        }),
      ],
      { restore: new Map([["hero-7f3", "hero"]]) }
    );

    expect(nodes[1].attributes?.["aria-describedby"]).toBe("hero");
    expect((nodes[1].props as { href: string }).href).toBe("#hero");
  });

  it("leaves everything alone when the map is empty", () => {
    const { nodes, domIds } = reidForestWithMap(
      [node("a", { cssId: "hero" })],
      { restore: new Map<string, string>() }
    );

    expect(nodes[0].cssId).toBe("hero");
    expect(domIds.size).toBe(0);
  });

  /*
   * A shadowed spelling is not the rendered id, so it does not move even when
   * the map names it — the same rule the other policies follow, asserted here
   * because a restore reaches for the map first and could answer before asking.
   */
  it("leaves a shadowed attribute id alone", () => {
    const { nodes } = reidForestWithMap(
      [node("a", { cssId: "actual", attributes: { id: "hero-7f3" } })],
      { restore: new Map([["hero-7f3", "hero"]]) }
    );

    expect(nodes[0].cssId).toBe("actual");
    expect(nodes[0].attributes?.id).toBe("hero-7f3");
  });

  /*
   * A REFERENCE WITHOUT THE NODE IT NAMES, which is the case the whole map is
   * seeded for.
   *
   * A save works on a selection, and a selection may hold the node carrying
   * `aria-describedby` while the node rendering that id stays behind. Nothing
   * in this forest renders `hero-7f3`, so nothing asks what it should become —
   * and without the map already in the memo the reference keeps a page-specific
   * id, putting a pattern in the library that names an id existing on exactly
   * one page.
   *
   * It is also the only assertion here that DISCRIMINATES. Where a node renders
   * the id, two paths answer independently — the seeded memo and the copier's
   * own lookup — so removing either leaves the other giving the right answer.
   */
  it("rewrites a reference whose target is not in the selection", () => {
    const { nodes } = reidForestWithMap(
      [
        node("p", {
          attributes: { "aria-describedby": "hero-7f3" },
          props: { href: "#hero-7f3" },
        }),
      ],
      { restore: new Map([["hero-7f3", "hero"]]) }
    );

    expect(nodes[0].attributes?.["aria-describedby"]).toBe("hero");
    expect((nodes[0].props as { href: string }).href).toBe("#hero");
  });

  /*
   * THE LIMIT OF A FLAT MAP, characterised rather than fixed here.
   *
   * A rename record belongs to the expansion that made it, and the map carries
   * no note of which. A node that reached this forest by another route and
   * happens to render the same id is restored with the rest — it is asked only
   * whether the map holds the value, never whether the record governs it.
   */
  it("restores ANY node rendering a named id, whatever its origin", () => {
    const { nodes } = reidForestWithMap(
      [
        node("from-the-expansion", { cssId: "hero-7f3" }),
        node("from-somewhere-else", { cssId: "hero-7f3" }),
      ],
      { restore: new Map([["hero-7f3", "hero"]]) }
    );

    expect(nodes[0].cssId).toBe("hero");
    expect(nodes[1].cssId).toBe("hero");
  });
});

describe('the "restoreEach" DOM id policy', () => {
  /*
   * The arm a save uses when the ids to put back differ by node. It is asked
   * with the ORIGINAL node and the id in question, and answers the source name
   * or nothing. Rendered ids are decided per node; a reference follows its
   * target where the forest renders one, and otherwise its holder decides.
   */
  const answers =
    (table: Record<string, Record<string, string>>) =>
    (held: BlockNode, value: string): string | undefined =>
      table[held.id]?.[value];

  it("decides a rendered id per node, where a flat map moves every carrier", () => {
    const { nodes } = reidForestWithMap(
      [
        node("governed", { cssId: "hero-7f3" }),
        node("namesake", { cssId: "hero-7f3" }),
      ],
      { restoreEach: answers({ governed: { "hero-7f3": "hero" } }) }
    );

    expect(nodes[0].cssId).toBe("hero");
    expect(nodes[1].cssId).toBe("hero-7f3");
  });

  it("asks about the node it was given, not the copy", () => {
    const originals = [node("a", { cssId: "hero-7f3" }), node("b")];
    const asked = new Set<BlockNode>();
    reidForestWithMap(originals, {
      restoreEach: (held, value) => {
        asked.add(held);
        return value === "hero-7f3" ? "hero" : undefined;
      },
    });

    expect(asked.has(originals[0]!)).toBe(true);
  });

  it("moves a reference with the one target the forest renders", () => {
    // The holder answers nothing of its own, so only following the target can
    // put this reference back.
    const { nodes } = reidForestWithMap(
      [
        node("target", { cssId: "hero-7f3" }),
        node("holder", {
          attributes: { "aria-describedby": "hero-7f3" },
          props: { href: "#hero-7f3" },
        }),
      ],
      { restoreEach: answers({ target: { "hero-7f3": "hero" } }) }
    );

    expect(nodes[1].attributes?.["aria-describedby"]).toBe("hero");
    expect((nodes[1].props as { href: string }).href).toBe("#hero");
  });

  it("restores a reference from its holder's answer even when its target keeps its id", () => {
    // The holder knows where its reference pointed, so its answer decides; the
    // target is followed only for a reference the holder has no answer for.
    const { nodes } = reidForestWithMap(
      [
        node("target", { cssId: "hero-7f3" }),
        node("holder", { attributes: { "aria-describedby": "hero-7f3" } }),
      ],
      { restoreEach: answers({ holder: { "hero-7f3": "hero" } }) }
    );

    expect(nodes[0].cssId).toBe("hero-7f3");
    expect(nodes[1].attributes?.["aria-describedby"]).toBe("hero");
  });

  it("follows a target placed both open and gated as an open one", () => {
    // One node object sits in an open slot and inside a gated container. It
    // renders wherever its open placement does, so an unrelated reference
    // follows it past a gated namesake — reading it as gated made the two look
    // like competing gated targets and left the reference behind.
    const sharedTarget = node("shared", { cssId: "shared-1" });
    const { nodes } = reidForestWithMap(
      [
        sharedTarget,
        node("wrapper", { visibility: gate }, [sharedTarget]),
        node("namesake", { cssId: "shared-1", visibility: gate }),
        node("holder", { attributes: { "aria-describedby": "shared-1" } }),
      ],
      { restoreEach: answers({ shared: { "shared-1": "shared" } }) }
    );

    expect(nodes[0].cssId).toBe("shared");
    expect(nodes[3].attributes?.["aria-describedby"]).toBe("shared");
  });

  it("lets each holder decide a reference nothing in the forest renders", () => {
    const { nodes } = reidForestWithMap(
      [
        node("governed", { attributes: { "aria-describedby": "shared-1" } }),
        node("other", { attributes: { "aria-describedby": "shared-1" } }),
      ],
      { restoreEach: answers({ governed: { "shared-1": "alpha" } }) }
    );

    expect(nodes[0].attributes?.["aria-describedby"]).toBe("alpha");
    expect(nodes[1].attributes?.["aria-describedby"]).toBe("shared-1");
  });

  it("lets the holder decide when two targets of one id become different ids", () => {
    const { nodes } = reidForestWithMap(
      [
        node("listed", { cssId: "hero-7f3" }),
        node("namesake", { cssId: "hero-7f3" }),
        node("holder", { attributes: { "aria-describedby": "hero-7f3" } }),
        node("stranger", { attributes: { "aria-describedby": "hero-7f3" } }),
      ],
      {
        restoreEach: answers({
          listed: { "hero-7f3": "hero" },
          holder: { "hero-7f3": "hero" },
        }),
      }
    );

    expect(nodes[0].cssId).toBe("hero");
    expect(nodes[1].cssId).toBe("hero-7f3");
    expect(nodes[2].attributes?.["aria-describedby"]).toBe("hero");
    expect(nodes[3].attributes?.["aria-describedby"]).toBe("hero-7f3");
  });

  it("moves both spellings of one node's id together", () => {
    const { nodes } = reidForestWithMap(
      [node("a", { cssId: "hero-7f3", attributes: { id: "hero-7f3" } })],
      { restoreEach: answers({ a: { "hero-7f3": "hero" } }) }
    );

    expect(nodes[0].cssId).toBe("hero");
    expect(nodes[0].attributes?.id).toBe("hero");
  });

  it("moves the rendered id and leaves a shadowed attribute id alone", () => {
    // The callback has an answer for BOTH spellings, so this fails if either the
    // rendered id stays put or the shadowed one moves with it.
    const { nodes } = reidForestWithMap(
      [node("a", { cssId: "actual", attributes: { id: "hero-7f3" } })],
      {
        restoreEach: answers({ a: { actual: "real", "hero-7f3": "hero" } }),
      }
    );

    expect(nodes[0].cssId).toBe("real");
    expect(nodes[0].attributes?.id).toBe("hero-7f3");
  });

  it("puts back an id on a gated node", () => {
    const { nodes } = reidForestWithMap(
      [
        node("gated", {
          cssId: "hero-7f3",
          visibility: {
            conditions: [[{ field: "tier", op: "eq", value: "pro" }]],
          },
        }),
      ],
      { restoreEach: answers({ gated: { "hero-7f3": "hero" } }) }
    );

    expect(nodes[0].cssId).toBe("hero");
  });

  it("records a rendered id that moved to one answer, and nothing else", () => {
    const { domIds } = reidForestWithMap(
      [
        node("a", { cssId: "hero-7f3" }),
        node("b", { cssId: "aside" }),
        node("p", { attributes: { "aria-describedby": "gone-1" } }),
      ],
      {
        restoreEach: answers({
          a: { "hero-7f3": "hero" },
          p: { "gone-1": "gone" },
        }),
      }
    );

    expect([...domIds.entries()]).toEqual([["hero-7f3", "hero"]]);
  });
  /** A condition gate the renderer prunes for a viewer who does not match. */
  const gate = {
    conditions: [[{ field: "tier", op: "eq", value: "pro" }]],
  } as BlockNode["visibility"];

  it("follows the visible target past a gated namesake", () => {
    // The gated namesake renders nothing, so the reference resolves to the
    // visible node on the page. Counting both as targets made the id look
    // contested and left the reference on an id nothing renders.
    const { nodes } = reidForestWithMap(
      [
        node("visible", { cssId: "shared-1" }),
        node("hidden", { cssId: "shared-1", visibility: gate }),
        node("holder", { attributes: { "aria-describedby": "shared-1" } }),
      ],
      { restoreEach: answers({ visible: { "shared-1": "shared" } }) }
    );

    expect(nodes[0].cssId).toBe("shared");
    expect(nodes[1].cssId).toBe("shared-1");
    expect(nodes[2].attributes?.["aria-describedby"]).toBe("shared");
  });

  it("follows a gated target when nothing visible carries the id", () => {
    // Excluding gated nodes outright would hand this reference to its holder,
    // which answers nothing — storing a link to an id its target no longer
    // carries once the gate opens.
    const { nodes } = reidForestWithMap(
      [
        node("hidden", { cssId: "shared-1", visibility: gate }),
        node("holder", { attributes: { "aria-describedby": "shared-1" } }),
      ],
      { restoreEach: answers({ hidden: { "shared-1": "shared" } }) }
    );

    expect(nodes[0].cssId).toBe("shared");
    expect(nodes[1].attributes?.["aria-describedby"]).toBe("shared");
  });

  it("treats a node inside a gated subtree as gated", () => {
    // Gating is inherited: the renderer prunes the whole subtree, so a
    // namesake under a gated parent renders nothing either.
    const { nodes } = reidForestWithMap(
      [
        node("visible", { cssId: "shared-1" }),
        node("wrapper", { visibility: gate }, [
          node("nested", { cssId: "shared-1" }),
        ]),
        node("holder", { attributes: { "aria-describedby": "shared-1" } }),
      ],
      { restoreEach: answers({ visible: { "shared-1": "shared" } }) }
    );

    expect(nodes[0].cssId).toBe("shared");
    expect(nodes[2].attributes?.["aria-describedby"]).toBe("shared");
  });
  it("restores a link inside a gated subtree from its own answer past a visible namesake", () => {
    // The link's holder has an answer, so it decides: the link must not be
    // handed to an unrelated visible namesake just because that one always
    // renders.
    const { nodes } = reidForestWithMap(
      [
        node("unrelated", { cssId: "shared-1" }),
        node("wrapper", { visibility: gate }, [
          node("target", { cssId: "shared-1" }),
          node("link", { attributes: { "aria-describedby": "shared-1" } }),
        ]),
      ],
      {
        restoreEach: answers({
          target: { "shared-1": "shared" },
          link: { "shared-1": "shared" },
        }),
      }
    );
    const inside = nodes[1].slots?.children ?? [];

    expect(nodes[0].cssId).toBe("shared-1");
    expect(inside[0]?.cssId).toBe("shared");
    expect(inside[1]?.attributes?.["aria-describedby"]).toBe("shared");
  });

  it("restores a gated link from its own answer beside a namesake that keeps its id", () => {
    // The only node rendering the id inside the gate keeps it, and nothing
    // visible carries it. The link's holder knows where it pointed, so its
    // answer decides rather than whichever node happens to share the id.
    const { nodes } = reidForestWithMap(
      [
        node("wrapper", { visibility: gate }, [
          node("namesake", { cssId: "shared-1" }),
          node("link", { attributes: { "aria-describedby": "shared-1" } }),
        ]),
      ],
      { restoreEach: answers({ link: { "shared-1": "shared" } }) }
    );
    const inside = nodes[0].slots?.children ?? [];

    expect(inside[0]?.cssId).toBe("shared-1");
    expect(inside[1]?.attributes?.["aria-describedby"]).toBe("shared");
  });

  it("restores a link under nested gates from its own answer past a visible namesake", () => {
    // However many gates sit above the link, its holder's answer decides; a
    // visible namesake that always renders does not.
    const { nodes } = reidForestWithMap(
      [
        node("unrelated", { cssId: "shared-1" }),
        node("outer", { visibility: gate }, [
          node("target", { cssId: "shared-1" }),
          node("inner", { visibility: gate }, [
            node("link", { attributes: { "aria-describedby": "shared-1" } }),
          ]),
        ]),
      ],
      {
        restoreEach: answers({
          target: { "shared-1": "shared" },
          link: { "shared-1": "shared" },
        }),
      }
    );
    const outer = nodes[1].slots?.children ?? [];
    const inner = outer[1]?.slots?.children ?? [];

    expect(outer[0]?.cssId).toBe("shared");
    expect(inner[0]?.attributes?.["aria-describedby"]).toBe("shared");
  });
});

describe("only the id a node RENDERS may be reminted", () => {
  it("leaves a shadowed attribute id alone, and the references to it", () => {
    // The node renders `actual`; its `attributes.id: "hero"` is overwritten and
    // never reaches the page. Minting it would be worse than pointless — the
    // relink pass rewrites every reference to it, so a link deliberately
    // reaching an element in the DESTINATION ends up naming a minted id that
    // nothing renders at all.
    const { nodes, domIds } = reidForestWithMap(
      [
        node("a", {
          cssId: "actual",
          attributes: { id: "hero", "aria-describedby": "hero" },
        }),
      ],
      { avoid: new Set(["hero", "actual"]) }
    );

    expect(nodes[0].attributes?.id).toBe("hero");
    expect(nodes[0].attributes?.["aria-describedby"]).toBe("hero");
    expect([...domIds.keys()]).toEqual(["actual"]);
    // The rendered one DID move, which is the control: "never remap anything"
    // passes every assertion above.
    expect(nodes[0].cssId).not.toBe("actual");
  });

  it("moves both spellings together when they carry the same value", () => {
    // One original maps to one replacement, so a node spelling one id through
    // both fields still spells a single id after the copy — rather than half of
    // it moving and the node rendering one id while its bag names another.
    const { nodes } = reidForestWithMap(
      [node("a", { cssId: "hero", attributes: { id: "hero" } })],
      { avoid: new Set(["hero"]) }
    );

    expect(nodes[0].cssId).not.toBe("hero");
    expect(nodes[0].attributes?.id).toBe(nodes[0].cssId);
  });
});
