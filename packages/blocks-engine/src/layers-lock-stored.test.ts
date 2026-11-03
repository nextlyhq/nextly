/**
 * A write judged against the Layers locks of the document it replaces.
 *
 * The property that separates the rule from plausible halves of it: the lock
 * is read from the STORED document, it covers what is inside the locked node
 * and where the node sits, and the same write lifting the lock is the only way
 * past. A rule reading the written lock, or the node's own fields alone, or
 * its index, each passes some of these and fails others.
 *
 * @module layers-lock-stored.test
 */
import { describe, expect, it } from "vitest";

import type { BlockNode } from "./document";
import { DOCUMENT_FORMAT_VERSION } from "./document";
import { layersLockChanges } from "./layers-lock-stored";

function node(
  id: string,
  extra: Partial<BlockNode> = {},
  children?: BlockNode[]
): BlockNode {
  return {
    id,
    type: "core/box",
    version: 1,
    props: {},
    ...(children === undefined ? {} : { slots: { children } }),
    ...extra,
  };
}

const pageOf = (nodes: BlockNode[]) => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes,
});

/**
 * A section holding a locked hero (with a caption inside it) and a free
 * block; a second section; a loose block.
 */
function stored(extraHero: Partial<BlockNode> = {}): BlockNode[] {
  return [
    node("section", {}, [
      node(
        "hero",
        { locked: true, name: "Hero", props: { tone: "dark" }, ...extraHero },
        [node("caption", { props: { text: "Hello" } })]
      ),
      node("free"),
    ]),
    node("other", {}, []),
    node("loose"),
  ];
}

/** The stored page with `edit` applied to a deep copy. */
function written(
  edit: (nodes: BlockNode[]) => void
): ReturnType<typeof pageOf> {
  const nodes = structuredClone(stored());
  edit(nodes);
  return pageOf(nodes);
}

const section = (nodes: BlockNode[]) => nodes[0]!;
const hero = (nodes: BlockNode[]) => section(nodes).slots!.children![0]!;

describe("a write that keeps the lock", () => {
  it("is accepted unchanged, and with its keys in another order", () => {
    expect(layersLockChanges(pageOf(stored()), pageOf(stored()))).toEqual([]);
    // A JSON column on PostgreSQL or MySQL hands keys back in its own order.
    const reordered = written(nodes => {
      const { id, type, version, props, slots, locked, name } = hero(nodes);
      section(nodes).slots!.children![0] = {
        slots,
        name,
        locked,
        props,
        version,
        type,
        id,
      } as BlockNode;
    });
    expect(layersLockChanges(reordered, pageOf(stored()))).toEqual([]);
  });

  it("accepts a change around the locked block, and an index shift", () => {
    // A block added before the hero moves its index and not its place.
    const shifted = written(nodes => {
      section(nodes).slots!.children!.unshift(node("added"));
      section(nodes).props = { tone: "light" };
      nodes.push(node("tail"));
    });
    expect(layersLockChanges(shifted, pageOf(stored()))).toEqual([]);
  });

  it("accepts a lock change inside the locked block, which is no change to it", () => {
    const relocked = written(nodes => {
      hero(nodes).slots!.children![0]!.locked = true;
    });
    expect(layersLockChanges(relocked, pageOf(stored()))).toEqual([]);
  });
});

describe("a write that breaks the lock", () => {
  it("is refused for changing the locked block, naming it", () => {
    const changed = written(nodes => {
      hero(nodes).props = { tone: "light" };
    });
    expect(layersLockChanges(changed, pageOf(stored()))).toEqual([
      {
        kind: "changed",
        id: "hero",
        label: "Hero",
        path: "/nodes/0/slots/children/0",
      },
    ]);
  });

  it("is refused for a change inside it, reported once at the locked block", () => {
    const changed = written(nodes => {
      hero(nodes).slots!.children![0]!.props = { text: "Bye" };
    });
    expect(
      layersLockChanges(changed, pageOf(stored())).map(change => change.kind)
    ).toEqual(["changed"]);
  });

  it("names only the outermost of two nested locks a change breaks", () => {
    const nested = pageOf(stored());
    hero(nested.nodes).slots!.children![0]!.locked = true;
    const write = structuredClone(nested);
    hero(write.nodes).slots!.children![0]!.props = { text: "Bye" };
    expect(layersLockChanges(write, nested)).toEqual([
      expect.objectContaining({ kind: "changed", id: "hero" }),
    ]);
  });

  it("is refused for removing it, or the unlocked block holding it", () => {
    const heroGone = written(nodes => {
      section(nodes).slots!.children!.shift();
    });
    const sectionGone = written(nodes => {
      nodes.shift();
    });
    for (const write of [heroGone, sectionGone]) {
      expect(layersLockChanges(write, pageOf(stored()))).toEqual([
        expect.objectContaining({ kind: "removed", id: "hero" }),
      ]);
    }
  });

  it("is refused for moving it, or moving the unlocked block holding it", () => {
    const heroMoved = written(nodes => {
      const [moved] = section(nodes).slots!.children!.splice(0, 1);
      nodes[1]!.slots!.children!.push(moved!);
    });
    const sectionMoved = written(nodes => {
      // Into "other", which is first once the section has left the top level.
      const [moved] = nodes.splice(0, 1);
      nodes[0]!.slots!.children!.push(moved!);
    });
    for (const write of [heroMoved, sectionMoved]) {
      expect(layersLockChanges(write, pageOf(stored()))).toEqual([
        expect.objectContaining({ kind: "moved", id: "hero" }),
      ]);
    }
  });

  it("judges the STORED lock: a block locked only by this write may change", () => {
    // The loose block is unlocked in what is stored, so changing it while
    // also locking it is a change nothing protected. A rule reading the lock
    // the write sends would refuse it.
    const lockedAndChanged = written(nodes => {
      nodes[2] = node("loose", { locked: true, props: { a: 1 } });
    });
    expect(layersLockChanges(lockedAndChanged, pageOf(stored()))).toEqual([]);
  });

  it("names a block by its type when the author gave it no name", () => {
    const changed = written(nodes => {
      hero(nodes).props = {};
    });
    const unnamed = pageOf(stored({ name: undefined }));
    delete hero(unnamed.nodes).name;
    expect(layersLockChanges(changed, unnamed)[0]?.label).toBe("core/box");
  });
});

describe("a write that unlocks the block in the same write", () => {
  it("may change it, move it and change what is inside it", () => {
    const unlockedAndChanged = written(nodes => {
      const [moved] = section(nodes).slots!.children!.splice(0, 1);
      delete moved!.locked;
      moved!.props = { tone: "light" };
      moved!.slots!.children![0]!.props = { text: "Bye" };
      nodes[1]!.slots!.children!.push(moved!);
    });
    expect(layersLockChanges(unlockedAndChanged, pageOf(stored()))).toEqual([]);
  });

  it("still keeps a lock held further inside unless that is lifted too", () => {
    const nested = pageOf(stored());
    hero(nested.nodes).slots!.children![0]!.locked = true;
    const write = structuredClone(nested);
    delete hero(write.nodes).locked;
    hero(write.nodes).slots!.children![0]!.props = { text: "Bye" };
    expect(layersLockChanges(write, nested)).toEqual([
      expect.objectContaining({ kind: "changed", id: "caption" }),
    ]);
  });
});

describe("what it reads", () => {
  it("finds nothing in a stored value with no lock or no forest", () => {
    expect(
      layersLockChanges(pageOf([]), pageOf([node("a"), node("b")]))
    ).toEqual([]);
    expect(layersLockChanges(pageOf([]), null)).toEqual([]);
    expect(layersLockChanges(pageOf([]), { nodes: "x" })).toEqual([]);
  });

  it("reports every stored lock removed when the write holds no forest", () => {
    expect(layersLockChanges(null, pageOf(stored()))).toEqual([
      expect.objectContaining({ kind: "removed", id: "hero" }),
    ]);
  });

  it("survives a written value that refers to itself", () => {
    const write = pageOf(stored());
    const loop = write.nodes[1]!;
    loop.slots = { children: [loop] };
    expect(layersLockChanges(write, pageOf(stored()))).toEqual([]);
  });
});

describe("the order of a locked block among its siblings", () => {
  /** A slot holding a lead block, the locked hero, and a tail block. */
  function row(children: BlockNode[]) {
    return pageOf([node("row", {}, children)]);
  }
  const lead = () => node("lead");
  const locked = () => node("hero", { locked: true, name: "Hero" });
  const tail = () => node("tail");
  const before = () => row([lead(), locked(), tail()]);

  it("accepts a sibling moved across it, however far, which is the sibling's move", () => {
    // What the editor allows: moving an unlocked block past the locked one.
    // Every other block keeps its order, so the hero has not moved.
    expect(
      layersLockChanges(row([locked(), lead(), tail()]), before())
    ).toEqual([]);
    expect(
      layersLockChanges(row([lead(), tail(), locked()]), before())
    ).toEqual([]);
    const wide = () =>
      row([lead(), node("mid"), locked(), tail(), node("end")]);
    expect(
      layersLockChanges(
        row([locked(), node("mid"), tail(), node("end"), lead()]),
        wide()
      )
    ).toEqual([]);
  });

  it("refuses the locked block moved past more siblings than would move round it", () => {
    // Keeping the hero still would take two blocks moved; moving it, one. The
    // fewest-moves reading moves the hero, so it is refused as a move.
    const wide = () => row([lead(), node("mid"), locked(), tail()]);
    expect(
      layersLockChanges(row([locked(), lead(), node("mid"), tail()]), wide())
    ).toEqual([expect.objectContaining({ kind: "moved", id: "hero" })]);
  });

  it("accepts a new sibling put before it, which only shifts its index", () => {
    expect(
      layersLockChanges(
        row([node("added"), lead(), locked(), tail()]),
        before()
      )
    ).toEqual([]);
  });

  it("accepts an unlocked sibling before it being deleted", () => {
    expect(layersLockChanges(row([locked(), tail()]), before())).toEqual([]);
  });

  it("accepts a new sibling put after it", () => {
    // Its own place is unchanged: the same existing blocks before it and after.
    expect(
      layersLockChanges(
        row([lead(), locked(), node("added"), tail()]),
        before()
      )
    ).toEqual([]);
  });
});

describe("the order of an unlocked block that holds a locked one", () => {
  /** A container holding the locked hero, then an aside, at the top level. */
  const container = () =>
    node("container", {}, [node("hero", { locked: true, name: "Hero" })]);
  const aside = () => node("aside");
  const before = () => pageOf([container(), aside()]);

  it("refuses the container moved past more siblings than would move round it", () => {
    // The hero keeps its parent and its slot; the container it sits in is
    // what moved, and the lock holds where its block sits on the page.
    const wide = () => pageOf([node("first"), node("second"), container()]);
    expect(
      layersLockChanges(
        pageOf([container(), node("first"), node("second")]),
        wide()
      )
    ).toEqual([expect.objectContaining({ kind: "moved", id: "hero" })]);
  });

  it("accepts a sibling moved across the container", () => {
    expect(layersLockChanges(pageOf([aside(), container()]), before())).toEqual(
      []
    );
  });

  it("accepts a new sibling put before the container", () => {
    expect(
      layersLockChanges(pageOf([node("added"), container(), aside()]), before())
    ).toEqual([]);
  });

  it("accepts the sibling beside the container being deleted", () => {
    expect(layersLockChanges(pageOf([container()]), before())).toEqual([]);
  });
});
