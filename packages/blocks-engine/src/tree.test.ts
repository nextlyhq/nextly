import { describe, expect, it } from "vitest";

import type { BlockNode } from "./document";
import { countNodes, treeDepth } from "./limits";
import { measureBytes } from "./measure-bytes";
import {
  duplicateNode,
  findNode,
  insertNode,
  locateNode,
  makeNode,
  moveNode,
  removeNode,
  reidSubtree,
  updateNode,
  walkNodes,
} from "./tree";

/** A small fixed forest: two sections, the first containing two children. */
function fixture(): {
  nodes: BlockNode[];
  section: BlockNode;
  heading: BlockNode;
  text: BlockNode;
  footer: BlockNode;
} {
  const heading = makeNode("core/heading", 1, { text: "Hello" });
  const text = makeNode("core/text", 1, { text: "World" });
  const section = makeNode(
    "core/section",
    1,
    {},
    { children: [heading, text] }
  );
  const footer = makeNode("core/section", 1, {}, { children: [] });
  return { nodes: [section, footer], section, heading, text, footer };
}

describe("walkNodes / findNode / locateNode", () => {
  it("walks depth-first with the correct parent", () => {
    const { nodes, section, heading, text, footer } = fixture();
    const visited: Array<[string, string | undefined]> = [];
    walkNodes(nodes, (n, parent) => visited.push([n.id, parent?.id]));
    expect(visited).toEqual([
      [section.id, undefined],
      [heading.id, section.id],
      [text.id, section.id],
      [footer.id, undefined],
    ]);
  });

  it("finishes on a forest nested deeper than the call stack allows", () => {
    // `MAX_DEPTH` is a validation rule, and this walk runs on documents whether
    // or not validation ever passed on them. A recursive walk exited a chain of
    // this size with `RangeError: Maximum call stack size exceeded` — no cycle
    // involved, just depth — and every caller of the shared walk failed with it.
    //
    // Sized well past the measured limit rather than just over it, so the test
    // does not go quiet if a future engine gives the walk a larger stack.
    const DEEP = 50_000;
    let root: BlockNode = { id: "leaf", type: "t", version: 1, props: {} };
    for (let i = 0; i < DEEP; i++) {
      root = {
        id: `n${i}`,
        type: "t",
        version: 1,
        props: {},
        slots: { main: [root] },
      };
    }

    let visited = 0;
    expect(() => walkNodes([root], () => visited++)).not.toThrow();
    expect(visited).toBe(DEEP + 1);
  });

  it("finishes when a slot holds one of its own ancestors", () => {
    // A cycle reachable through `slots` is the shape the walk actually
    // descends. Recursion overflowed on it; an iterative walk without a visited
    // set would spin forever instead, which is why terminating is asserted by a
    // VISIT COUNT rather than by the absence of a throw.
    const cyclic: BlockNode = {
      id: "a",
      type: "t",
      version: 1,
      props: {},
      slots: { main: [] },
    };
    cyclic.slots!.main.push(cyclic);

    const visited: string[] = [];
    walkNodes([cyclic], n => visited.push(n.id));

    expect(visited).toEqual(["a"]);
  });

  it("does not hand an ARRAY to the callback as though it were a node", () => {
    // `typeof [] === "object"`, so a guard written as a type test alone lets an
    // array through. Nothing then throws, which is the difficulty: every caller
    // reads its fields as `undefined` and carries on. The id-uniqueness check
    // behind this compares `undefined` against `undefined` and reports a
    // collision between two malformed entries, or none at all.
    const visited: unknown[] = [];
    walkNodes(
      [
        [{ id: "buried" }],
        { id: "real", type: "t", version: 1, props: {} },
      ] as unknown as BlockNode[],
      n => visited.push(n)
    );

    expect(visited.some(n => Array.isArray(n))).toBe(false);
    expect(visited.map(n => (n as BlockNode).id)).toEqual(["real"]);
  });

  it("visits one node object placed in TWO slots twice", () => {
    // The boundary of the cycle guard, and the reason it tracks the ancestor
    // path rather than every node seen. Reusing one object in two slots is not
    // a cycle — nothing recurses — so both placements are real.
    //
    // Load-bearing rather than cosmetic: `insertionIsUnsafe` asks
    // this walk whether an incoming subtree already contains a duplicate id. A
    // walk that visited the shared object once would report no duplicate, and
    // `insertNode` would build a forest where one id addresses two positions.
    const shared: BlockNode = { id: "dup", type: "t", version: 1, props: {} };
    const host: BlockNode = {
      id: "host",
      type: "t",
      version: 1,
      props: {},
      slots: { left: [shared], right: [shared] },
    };

    const visited: string[] = [];
    walkNodes([host], n => visited.push(n.id));

    expect(visited).toEqual(["host", "dup", "dup"]);
  });

  it("stops TRAVERSING once the node budget is spent, not just working", () => {
    // A budget applied inside the callback bounds the work per node and nothing
    // else: the walk has still reached every remaining node, so a corrupt
    // document costs time proportional to the whole stored tree. That is
    // invisible to an assertion on the result, which looks identical either way.
    //
    // The tripwire is on the ROOT ARRAY rather than on descendants, and that
    // distinction is the whole test. A walk that seeds one stack entry per
    // top-level node reads the entire array before any bound applies, so a
    // budget is powerless against the cheapest oversized document there is — a
    // very wide root array — while a test watching only descendants reports it
    // as bounded.
    let readsPastTheBudget = 0;
    const roots: unknown[] = Array.from({ length: 200 }, (_, i) => ({
      id: `n${i}`,
      type: "t",
      version: 1,
      props: {},
    }));
    const watched = new Proxy(roots, {
      get(target, key, receiver) {
        if (typeof key === "string" && /^\d+$/.test(key) && Number(key) >= 10) {
          readsPastTheBudget += 1;
        }
        return Reflect.get(target, key, receiver);
      },
    }) as unknown as BlockNode[];

    let visited = 0;
    walkNodes(watched, () => visited++, { maxNodes: 10 });

    expect(visited).toBe(10);
    expect(readsPastTheBudget).toBe(0);
  });

  it("spends the budget on MALFORMED entries too, not only on nodes visited", () => {
    // A forest can begin with a long run of nulls or primitives that never
    // reach the callback. A bound counting callbacks cannot see them, so the
    // whole array is read while the budget sits untouched — and the previous
    // test cannot distinguish that, because its roots are all valid objects.
    let readsPastTheBudget = 0;
    const roots: unknown[] = Array.from({ length: 200 }, () => null);
    const watched = new Proxy(roots, {
      get(target, key, receiver) {
        if (typeof key === "string" && /^\d+$/.test(key) && Number(key) >= 10) {
          readsPastTheBudget += 1;
        }
        return Reflect.get(target, key, receiver);
      },
    }) as unknown as BlockNode[];

    let visited = 0;
    walkNodes(watched, () => visited++, { maxNodes: 10 });

    // Nothing was walkable, so the callback never ran — and the walk still
    // stopped, which is the property a callback count cannot express.
    expect(visited).toBe(0);
    expect(readsPastTheBudget).toBe(0);
  });

  it("still accepts a bare parent NODE as its third argument", () => {
    // The shape this function published before it took options. A caller
    // compiled against it passes a node, and nothing at runtime would reject
    // one: the option lookup would simply miss and every top-level callback
    // would receive `undefined` as its parent — a wrong answer rather than an
    // error, which is the failure worth keeping a compatibility path for.
    const parent = makeNode("core/section", 1);
    const seen: (string | undefined)[] = [];

    walkNodes(
      [makeNode("core/text", 1)],
      (_node, got) => seen.push(got?.id),
      parent
    );

    expect(seen).toEqual([parent.id]);
  });

  it("reports a cycle it skipped, so a writer can refuse what a reader tolerates", () => {
    // The reader keeps walking; the report is how the insertion guard learns of
    // a repeat the walk deliberately hid from it.
    const cyclic = makeNode("core/section", 1, {}, { children: [] });
    cyclic.slots!.children.push(cyclic);
    const reported: string[] = [];

    walkNodes([cyclic], () => undefined, {
      onCycle: node => reported.push(node.id),
    });

    expect(reported).toEqual([cyclic.id]);
  });

  it("still visits a repeated ID that is a DISTINCT object", () => {
    // The control for the cycle guard, and the boundary of what it costs. It
    // skips a node OBJECT already visited, not an id already seen — two sibling
    // nodes that happen to share an id are different nodes and both are walked.
    // A guard keyed on id would silently drop the second, which is how a
    // duplicate-id document would stop being measurable at all.
    const twin = (): BlockNode => ({
      id: "same",
      type: "t",
      version: 1,
      props: {},
    });

    const visited: string[] = [];
    walkNodes([twin(), twin()], n => visited.push(n.id));

    expect(visited).toEqual(["same", "same"]);
  });

  it("finds nested nodes and returns undefined for unknown ids", () => {
    const { nodes, heading } = fixture();
    expect(findNode(nodes, heading.id)?.props).toEqual({ text: "Hello" });
    expect(findNode(nodes, "missing")).toBeUndefined();
  });

  it("locates top-level and nested nodes", () => {
    const { nodes, section, text, footer } = fixture();
    expect(locateNode(nodes, footer.id)).toEqual({ index: 1 });
    const nested = locateNode(nodes, text.id);
    expect(nested?.parent?.id).toBe(section.id);
    expect(nested?.slot).toBe("children");
    expect(nested?.index).toBe(1);
    expect(locateNode(nodes, "missing")).toBeUndefined();
  });
});

describe("a forest whose slots form a cycle", () => {
  // A cycle reaches these primitives the same way every other malformed shape
  // does: persisted documents are not required to have been validated, and an
  // in-process producer can build one directly. None of these crashed on a
  // document an author could make — they crashed on one the system admits.
  //
  // Measured before the fix, on the built package: `treeDepth` did not throw,
  // it SPUN, which is the failure nobody attributes correctly. The rest exited
  // with `RangeError: Maximum call stack size exceeded`.
  function cyclic(): BlockNode[] {
    const parent = makeNode("core/box", 1);
    const child = makeNode("core/box", 1, {}, { main: [parent] });
    parent.slots = { main: [child] };
    return [parent];
  }

  it("counts a cyclic forest instead of exhausting its own queue", () => {
    expect(countNodes(cyclic())).toBe(3);
  });

  it("measures depth instead of spinning forever", () => {
    expect(treeDepth(cyclic())).toBe(3);
  });

  it("returns undefined for an ABSENT id rather than overflowing", () => {
    // The half that hid this: a lookup for an id that is PRESENT returns before
    // it can loop, so only a miss fails — and a miss is the ordinary case for
    // any lookup that can have one.
    // One forest, not two: `cyclic()` mints fresh ids per call, so an id taken
    // from a second build is absent from the first by construction and would
    // pass this whatever `findNode` did.
    const nodes = cyclic();
    expect(findNode(nodes, "nope")).toBeUndefined();
    expect(findNode(nodes, nodes[0]!.id)).toBeDefined();
  });

  it("rebuilds through updateNode by breaking the back edge", () => {
    // An immutable rebuild of a cyclic forest is not a thing that exists: the
    // result would have to contain itself. Dropping the edge that closes the
    // cycle is the only outcome that terminates, and it is the repair a caller
    // wants — the operation succeeds on a finite forest.
    // `updateNode` takes a PATCH, not a mapper — it merges the given fields
    // onto the node whose id matches.
    const nodes = cyclic();
    const next = updateNode(nodes, nodes[0]!.id, { props: { touched: true } });

    expect(next[0]?.props).toEqual({ touched: true });

    // The entry that CLOSES the cycle is omitted, not kept as a childless copy.
    // Keeping it returned `[parent, child, parent]` — the same id twice, which
    // makes every id lookup ambiguous and fails the validation this repair
    // exists to satisfy. A node count alone cannot see that; the ids can.
    const ids: string[] = [];
    walkNodes(next, node => ids.push(node.id));
    expect(ids).toEqual([nodes[0]!.id, nodes[0]!.slots!.main![0]!.id]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("duplicates inside a cyclic forest, and the CLONE is acyclic", () => {
    // These primitives do not decline work because the document they were given
    // is already unstorable; storability is decided once, at the write. So the
    // duplicate happens, and what has to be true is about the CLONE: it is a
    // real second copy, and `reidSubtree` rebuilt it without the edge that
    // closed the cycle.
    //
    // Asserted as reachability from the clone rather than as "did not throw".
    // The absence of a throw is satisfied by a `duplicateNode` that returns its
    // argument, which is precisely the implementation this must separate from.
    const nodes = cyclic();
    const originalId = nodes[0]!.id;

    const next = duplicateNode(nodes, originalId);

    const topIds = next.map(node => node.id);
    expect(topIds).toHaveLength(2);
    expect(topIds[0]).toBe(originalId);
    expect(topIds[1]).not.toBe(originalId);

    // The clone's own subtree terminates without the walk reporting a cycle.
    // `walkNodes` is cycle-tolerant, so a cyclic clone would still finish here —
    // what distinguishes them is `onCycle` firing, not the walk completing.
    let cloneCycles = 0;
    walkNodes([next[1]!], () => undefined, {
      onCycle: () => {
        cloneCycles += 1;
      },
    });
    expect(cloneCycles).toBe(0);
  });

  it("duplicates a healthy node when a SIBLING branch carries the cycle", () => {
    // The selected node is fine; the damage is elsewhere in the forest. Under
    // the old whole-forest refusal this returned the forest untouched, so an
    // author could not copy a healthy block because some other block was
    // corrupt.
    //
    // This case is kept because it separates implementations the previous test
    // cannot: that one selects the cyclic node itself, so inspecting the
    // subtree and inspecting the forest give the same answer.
    const looped = makeNode("core/box", 1, {}, { main: [] });
    looped.slots!.main.push(looped);
    const target = makeNode("core/text", 1);
    const forest = [looped, target];

    const next = duplicateNode(forest, target.id);

    expect(next).not.toBe(forest);
    expect(next).toHaveLength(3);
    // The copy sits immediately after its original and carries a fresh id.
    expect(next[1]!.id).toBe(target.id);
    expect(next[2]!.id).not.toBe(target.id);
    expect(next[2]!.type).toBe("core/text");
  });

  it("leaves the cycle in place rather than repairing what the caller did not name", () => {
    // The other half of tolerating: the operation does not quietly rewrite the
    // damaged part of the document. An author asked to copy one node, and a
    // primitive that "helpfully" dropped the back edge would be editing content
    // nobody selected — and would report success for a repair no one can audit.
    const nodes = cyclic();

    const next = duplicateNode(nodes, nodes[0]!.id);

    // The duplicate has to have HAPPENED for the rest to mean anything —
    // returning the forest untouched leaves the cycle in place too, and would
    // satisfy the assertion below while doing no work at all.
    expect(next).toHaveLength(2);
    let cycles = 0;
    walkNodes(next, () => undefined, {
      onCycle: () => {
        cycles += 1;
      },
    });
    expect(cycles).toBeGreaterThan(0);
  });

  it("hands the unstorable verdict to the writer, which still refuses", () => {
    // The refusal MOVED; it did not disappear. This is the assertion that would
    // catch someone reading the tolerance rule as "cycles are fine now" — the
    // document still cannot be saved, and the check that says so is the one the
    // write path already calls.
    const source = cyclic();
    const nodes = duplicateNode(source, source[0]!.id);

    // Same reason as above: an implementation that refused would hand back an
    // unstorable forest as well, so the verdict alone does not separate them.
    expect(nodes).toHaveLength(2);
    const verdict = measureBytes({ nodes }, 1_000_000);

    // Matched as a whole rather than field by field: `reason` exists only on
    // the refusing arm of `ByteMeasurement`, so reading it after a separate
    // `exceeded` assertion does not narrow and does not compile.
    expect(verdict).toMatchObject({ exceeded: true, reason: "unwritable" });
  });

  it("still duplicates an ACYCLIC subtree, so the refusal is not blanket", () => {
    // The control. A `duplicateNode` that refused everything would satisfy the
    // case above while never duplicating anything for anyone.
    const child = makeNode("core/text", 1);
    const parent = makeNode("core/box", 1, {}, { main: [child] });

    const next = duplicateNode([parent], parent.id);

    expect(next).toHaveLength(2);
    expect(next[1]?.id).not.toBe(parent.id);
  });

  it("re-ids a cyclic subtree into a fresh, SERIALIZABLE one", () => {
    // "Does not throw" is satisfied by a fallback that returns the original
    // node untouched — no new ids, still cyclic, still unstorable. So the
    // assertions are the two things that separate a real rebuild from that:
    // the ids changed, and the result can actually be written.
    const source = cyclic()[0]!;

    const copy = reidSubtree(source);

    expect(copy.id).not.toBe(source.id);
    expect(copy.slots?.main?.[0]?.id).not.toBe(source.slots?.main?.[0]?.id);
    expect(() => JSON.stringify(copy)).not.toThrow();
  });

  it("keeps a malformed slots CONTAINER on an unrelated edit", () => {
    // `slots: null` is not the same as absent. It has no entries to enumerate,
    // so a rebuild that treated only `undefined` as absent replaced it with
    // `{}` — stored content rewritten by an edit naming a different node.
    const holder = makeNode("core/box", 1);
    holder.slots = null as unknown as Record<string, BlockNode[]>;
    const other = makeNode("core/text", 1);

    const next = updateNode([holder, other], other.id, { props: { x: 1 } });

    expect(next[0]?.slots).toBeNull();
  });

  it("terminates on a cycle LONGER than the call stack, not just a short one", () => {
    // The two-node fixture above cannot establish this. A recursive walk
    // notices a cycle only after descending to the repeated ancestor, so its
    // guard is unreachable for any cycle deeper than the machine allows — a
    // five-thousand-node chain closing on its root exited with a RangeError
    // while the check sat unreached. Machine depth was the real bound.
    //
    // Sized past the measured limit so the test does not go quiet if a future
    // engine grants a larger stack.
    const DEEP = 5_000;
    let root: BlockNode = makeNode("core/text", 1);
    const leaf = root;
    for (let i = 0; i < DEEP; i++) {
      root = makeNode("core/box", 1, {}, { main: [root] });
    }
    leaf.slots = { main: [root] };

    expect(findNode([root], "absent")).toBeUndefined();
    expect(() => countNodes([root])).not.toThrow();
    expect(() => treeDepth([root])).not.toThrow();
    expect(() =>
      updateNode([root], root.id, { props: { x: 1 } })
    ).not.toThrow();
    expect(() => reidSubtree(root)).not.toThrow();
  });

  it("rebuilds a forest nested deeper than the call stack allows", () => {
    // The other axis, and the one a cycle guard does nothing for. An immutable
    // rebuild recursed per level, so a deep ACYCLIC document — no cycle at all
    // — exhausted the stack on an ordinary edit.
    let root: BlockNode = makeNode("core/text", 1);
    for (let i = 0; i < 20_000; i++) {
      root = makeNode("core/box", 1, {}, { main: [root] });
    }

    const next = updateNode([root], root.id, { props: { deep: true } });

    expect(next[0]?.props).toEqual({ deep: true });
    expect(countNodes(next)).toBe(20_001);
  });

  it("keeps a malformed SLOT VALUE that an unrelated edit never named", () => {
    // Rebuilding used to throw on these, which lost nothing. Replacing them
    // with an empty array would be worse than the throw: an edit to a different
    // field would silently destroy stored content a caller may still need to
    // read or repair, and nothing would report it.
    const holder = makeNode("core/box", 1);
    holder.slots = { broken: { nope: true } as unknown as BlockNode[] };
    const other = makeNode("core/text", 1);

    const next = updateNode([holder, other], other.id, { props: { x: 1 } });

    expect(next[0]?.slots?.broken).toEqual({ nope: true });
  });

  it("keeps a malformed slot whose NAME collides with Object.prototype", () => {
    // Slot names come from unvalidated stored data. A plain object answers for
    // keys it never had — `built["constructor"]` resolves
    // `Object.prototype.constructor` — so a malformed slot deliberately left
    // out of the rebuilt set came back as a FUNCTION and was then dropped by
    // serialization. The stored value destroyed by an unrelated edit, which is
    // the exact loss preserving it was meant to prevent.
    const holder = makeNode("core/box", 1);
    holder.slots = { constructor: { nope: true } as unknown as BlockNode[] };
    const other = makeNode("core/text", 1);

    const next = updateNode([holder, other], other.id, { props: { x: 1 } });

    expect(next[0]?.slots?.constructor).toEqual({ nope: true });
  });

  it("keeps an own `__proto__` slot, which plain assignment would swallow", () => {
    // The write-side twin of the `constructor` case. Reading through a `Map`
    // fixed the lookup; the STORE was still `slots[name] = value`, and that is
    // not a plain write for `__proto__` — it invokes the legacy prototype
    // setter, so the stored value becomes the object's prototype and
    // serialization emits `{}`. The constructor test stays green throughout,
    // because it exercises the read and not the write.
    const holder = makeNode("core/box", 1);
    const slots: Record<string, BlockNode[]> = {};
    Object.defineProperty(slots, "__proto__", {
      value: { nope: true } as unknown as BlockNode[],
      enumerable: true,
      writable: true,
      configurable: true,
    });
    holder.slots = slots;
    const other = makeNode("core/text", 1);

    const next = updateNode([holder, other], other.id, { props: { x: 1 } });

    expect(JSON.stringify(next[0]?.slots)).toBe('{"__proto__":{"nope":true}}');
  });

  it("passes a malformed ENTRY through rather than mapping it", () => {
    // `fn` is written for nodes and reads `id` off what it is handed, so a
    // `null` neighbour would throw — failing an edit the caller made to a
    // different node entirely.
    const real = makeNode("core/text", 1);
    const forest = [null, real] as unknown as BlockNode[];

    const next = updateNode(forest, real.id, { props: { x: 1 } });

    expect(next[0]).toBeNull();
    expect(next[1]?.props).toEqual({ x: 1 });
  });

  it("still counts a REPEATED node that is not a cycle twice", () => {
    // The boundary. One node object placed in two slots is two elements of this
    // document and is not a cycle — a guard keyed on everything seen would
    // report half the real size and pass a cap the document exceeds.
    const shared = makeNode("core/text", 1);
    const host = makeNode(
      "core/box",
      1,
      {},
      { left: [shared], right: [shared] }
    );

    expect(countNodes([host])).toBe(3);
  });
});

describe("insertNode", () => {
  it("inserts at the top level with a clamped index", () => {
    const { nodes } = fixture();
    const extra = makeNode("core/section", 1);
    const next = insertNode(nodes, extra, { index: 99 });
    expect(next.map(n => n.id)).toEqual([...nodes.map(n => n.id), extra.id]);
    // Immutability: the original forest is untouched.
    expect(nodes).toHaveLength(2);
  });

  it("inserts into a parent slot", () => {
    const { nodes, section, heading } = fixture();
    const extra = makeNode("core/text", 1);
    const next = insertNode(nodes, extra, {
      parentId: section.id,
      slot: "children",
      index: 1,
    });
    const children = findNode(next, section.id)?.slots?.children ?? [];
    expect(children.map(n => n.id)[1]).toBe(extra.id);
    expect(children.map(n => n.id)[0]).toBe(heading.id);
  });

  it("creates the slot when inserting into an empty one", () => {
    const { nodes, footer } = fixture();
    const extra = makeNode("core/text", 1);
    const next = insertNode(nodes, extra, {
      parentId: footer.id,
      slot: "children",
      index: 0,
    });
    expect(findNode(next, footer.id)?.slots?.children).toHaveLength(1);
  });

  it("returns the forest unchanged for an unknown parent or missing slot", () => {
    const { nodes } = fixture();
    const extra = makeNode("core/text", 1);
    expect(
      insertNode(nodes, extra, {
        parentId: "missing",
        slot: "children",
        index: 0,
      })
    ).toBe(nodes);
    expect(insertNode(nodes, extra, { parentId: nodes[0]!.id, index: 0 })).toBe(
      nodes
    );
  });

  it("refuses a subtree containing a CYCLE, at the top level and in a slot", () => {
    // The walk this guard uses is cycle-TOLERANT, because a reader counting
    // classes or measuring a document has to answer rather than fail. That
    // makes the repeat invisible in what the walk visits, so the guard learns
    // of it from the walk's report rather than from the ids it saw.
    //
    // Both destinations are asserted because they fail differently and only one
    // of them fails loudly. A top-level insert would simply return a cyclic
    // forest; an insert into a parent reaches the recursive `mapForest`, which
    // has no tolerance for one and exits with a RangeError.
    const { nodes, section } = fixture();
    const cyclic = makeNode("core/section", 1, {}, { children: [] });
    cyclic.slots!.children.push(cyclic);

    expect(insertNode(nodes, cyclic, { index: 0 })).toBe(nodes);
    expect(
      insertNode(nodes, cyclic, {
        parentId: section.id,
        slot: "children",
        index: 0,
      })
    ).toBe(nodes);
  });

  it("still accepts a subtree that merely REPEATS a node object in two slots", () => {
    // The control, and the boundary of the refusal. Two slots holding the same
    // object is not a cycle, so the walk reports none — this must be refused
    // for carrying a duplicate ID, not for being cyclic. Without it, a guard
    // that refused everything the cycle path touches would pass the case above
    // while rejecting valid inserts nobody would trace back to here.
    const { nodes } = fixture();
    const shared = makeNode("core/text", 1);
    const host = makeNode("core/section", 1, {}, { children: [shared] });
    host.slots!.other = [shared];

    // Refused, and for the duplicate id: re-id the subtree and it is accepted,
    // which a cycle-based refusal would not allow.
    expect(insertNode(nodes, host, { index: 0 })).toBe(nodes);
    expect(insertNode(nodes, reidSubtree(host), { index: 0 })).not.toBe(nodes);
  });

  it("rejects re-inserting a node whose id already lives in the forest", () => {
    const { nodes, footer, heading } = fixture();
    // Same node object re-inserted, and a fresh node carrying an existing id:
    // both collide and must no-op rather than corrupt id-addressing.
    expect(insertNode(nodes, footer, { index: 0 })).toBe(nodes);
    const clash = { ...makeNode("core/text", 1), id: heading.id };
    expect(
      insertNode(nodes, clash, {
        parentId: footer.id,
        slot: "children",
        index: 0,
      })
    ).toBe(nodes);
  });

  it("rejects inserting a node into itself without overflowing", () => {
    const { nodes, section } = fixture();
    expect(
      insertNode(nodes, section, {
        parentId: section.id,
        slot: "children",
        index: 0,
      })
    ).toBe(nodes);
  });

  it("rejects a fresh subtree that carries an internal duplicate id", () => {
    const { nodes } = fixture();
    // A hand-built subtree whose two children share an id: it does not collide
    // with the forest, but inserting it would still break id uniqueness.
    const dupChild = makeNode("core/text", 1);
    const malformed = makeNode(
      "core/section",
      1,
      {},
      {
        children: [dupChild, { ...makeNode("core/text", 1), id: dupChild.id }],
      }
    );
    expect(insertNode(nodes, malformed, { index: 0 })).toBe(nodes);
  });
});

describe("removeNode", () => {
  it("removes a nested node", () => {
    const { nodes, section, heading } = fixture();
    const next = removeNode(nodes, heading.id);
    expect(findNode(next, heading.id)).toBeUndefined();
    expect(findNode(next, section.id)?.slots?.children).toHaveLength(1);
  });

  it("removes a top-level node with its whole subtree", () => {
    const { nodes, section, heading } = fixture();
    const next = removeNode(nodes, section.id);
    expect(next).toHaveLength(1);
    expect(findNode(next, heading.id)).toBeUndefined();
  });

  it("returns the original forest reference when the id is absent", () => {
    const { nodes } = fixture();
    expect(removeNode(nodes, "missing")).toBe(nodes);
  });
});

describe("moveNode", () => {
  it("moves a nested node to the top level", () => {
    const { nodes, heading } = fixture();
    const next = moveNode(nodes, heading.id, { index: 0 });
    expect(next[0]!.id).toBe(heading.id);
    expect(countNodes(next)).toBe(countNodes(nodes));
  });

  it("moves a top-level node into a slot", () => {
    const { nodes, footer, section } = fixture();
    const next = moveNode(nodes, footer.id, {
      parentId: section.id,
      slot: "children",
      index: 0,
    });
    expect(next).toHaveLength(1);
    expect(findNode(next, section.id)?.slots?.children?.[0]?.id).toBe(
      footer.id
    );
  });

  it("refuses cycles: a node cannot move into its own subtree", () => {
    const { nodes, section, heading } = fixture();
    expect(
      moveNode(nodes, section.id, {
        parentId: heading.id,
        slot: "children",
        index: 0,
      })
    ).toBe(nodes);
    expect(
      moveNode(nodes, section.id, {
        parentId: section.id,
        slot: "children",
        index: 0,
      })
    ).toBe(nodes);
  });

  it("returns the forest unchanged for unknown ids", () => {
    const { nodes } = fixture();
    expect(moveNode(nodes, "missing", { index: 0 })).toBe(nodes);
    expect(
      moveNode(nodes, nodes[0]!.id, {
        parentId: "missing",
        slot: "children",
        index: 0,
      })
    ).toBe(nodes);
  });

  it("never loses a node when a slot position omits its slot", () => {
    const { nodes, footer, section } = fixture();
    // parentId set without a slot: must no-op, not remove-then-fail-to-insert.
    const next = moveNode(nodes, footer.id, { parentId: section.id, index: 0 });
    expect(next).toBe(nodes);
    expect(findNode(next, footer.id)).toBeDefined();
    expect(countNodes(next)).toBe(countNodes(nodes));
  });

  it("leaves an already-malformed subtree in place rather than losing it on move", () => {
    // A document whose moving subtree carries an internal duplicate id: the
    // re-insert would refuse, so the move must be atomic and change nothing.
    const dup = makeNode("core/text", 1);
    const bad = makeNode(
      "core/section",
      1,
      {},
      {
        children: [dup, { ...makeNode("core/text", 1), id: dup.id }],
      }
    );
    const host = makeNode("core/section", 1, {}, { children: [] });
    const nodes = [bad, host];
    const next = moveNode(nodes, bad.id, {
      parentId: host.id,
      slot: "children",
      index: 0,
    });
    expect(next).toBe(nodes);
    expect(findNode(next, bad.id)).toBeDefined();
    expect(countNodes(next)).toBe(countNodes(nodes));
  });
});

describe("reidSubtree / duplicateNode", () => {
  it("re-ids every node in the copied subtree and detaches it from the source", () => {
    const { section, heading } = fixture();
    const copy = reidSubtree(section);
    expect(copy.id).not.toBe(section.id);
    expect(copy.slots?.children?.[0]?.id).not.toBe(heading.id);
    expect(copy.slots?.children?.[0]?.props).toEqual(heading.props);
    // structuredClone: mutating the copy's props must not touch the source.
    (copy.slots!.children![0]!.props as Record<string, unknown>).text =
      "changed";
    expect(heading.props.text).toBe("Hello");
  });

  it("duplicates a node immediately after the original", () => {
    const { nodes, section, heading } = fixture();
    const next = duplicateNode(nodes, heading.id);
    const children = findNode(next, section.id)?.slots?.children ?? [];
    expect(children).toHaveLength(3);
    expect(children[0]!.id).toBe(heading.id);
    expect(children[1]!.id).not.toBe(heading.id);
    expect(children[1]!.props).toEqual(heading.props);
  });

  it("duplicates a top-level node in place", () => {
    const { nodes, section } = fixture();
    const next = duplicateNode(nodes, section.id);
    expect(next).toHaveLength(3);
    expect(next[1]!.type).toBe("core/section");
    expect(next[1]!.id).not.toBe(section.id);
  });

  it("drops the DOM id (cssId) when re-iding so copies never collide on it", () => {
    const original = {
      ...makeNode("core/section", 1, {}, { children: [] }),
      cssId: "hero",
    };
    const copy = reidSubtree(original);
    expect(copy.cssId).toBeUndefined();
    // A nested cssId is dropped too.
    const withNested = {
      ...makeNode(
        "core/section",
        1,
        {},
        {
          children: [{ ...makeNode("core/text", 1), cssId: "cta" }],
        }
      ),
      cssId: "wrap",
    };
    const nestedCopy = reidSubtree(withNested);
    expect(nestedCopy.cssId).toBeUndefined();
    expect(nestedCopy.slots?.children?.[0]?.cssId).toBeUndefined();
  });

  it("strips an id from custom attributes (case-insensitively) when re-iding", () => {
    const original = {
      ...makeNode("core/section", 1),
      attributes: { id: "hero", "data-role": "banner" },
    };
    const copy = reidSubtree(original);
    expect(copy.attributes).toEqual({ "data-role": "banner" });

    // A capitalized "ID" is the same DOM-id vector and must also go; when it is
    // the only attribute, the now-empty attributes object is dropped entirely.
    const upper = { ...makeNode("core/text", 1), attributes: { ID: "x" } };
    expect(reidSubtree(upper).attributes).toBeUndefined();
  });
});

describe("updateNode", () => {
  it("patches a node's fields immutably", () => {
    const { nodes, heading } = fixture();
    const next = updateNode(nodes, heading.id, {
      props: { text: "Patched" },
      name: "Intro heading",
    });
    expect(findNode(next, heading.id)?.props).toEqual({ text: "Patched" });
    expect(findNode(next, heading.id)?.name).toBe("Intro heading");
    expect(findNode(nodes, heading.id)?.props).toEqual({ text: "Hello" });
  });

  it("returns the forest unchanged for unknown ids", () => {
    const { nodes } = fixture();
    expect(updateNode(nodes, "missing", { name: "x" })).toBe(nodes);
  });
});

describe("id uniqueness by construction", () => {
  it("makeNode mints a unique id every call", () => {
    const ids = new Set(
      Array.from({ length: 1000 }, () => makeNode("core/text", 1).id)
    );
    expect(ids.size).toBe(1000);
  });

  it("reidSubtree re-ids every node so a re-inserted copy cannot collide", () => {
    const { nodes, section } = fixture();
    const copy = reidSubtree(section);
    const copyIds = new Set<string>();
    walkNodes([copy], n => copyIds.add(n.id));
    const originalIds = new Set<string>();
    walkNodes(nodes, n => originalIds.add(n.id));
    // No id in the copy overlaps the original forest.
    for (const id of copyIds) expect(originalIds.has(id)).toBe(false);
  });
});

describe("counting helpers", () => {
  it("counts nodes and measures depth", () => {
    const { nodes } = fixture();
    expect(countNodes(nodes)).toBe(4);
    expect(treeDepth(nodes)).toBe(2);
    expect(countNodes([])).toBe(0);
    expect(treeDepth([])).toBe(0);
  });
});

describe("a record keyed by a stored `__proto__`", () => {
  // `JSON.parse` creates `__proto__` as an OWN property, which is what makes
  // this reachable at all: the key survives into `Object.entries`, so a rebuild
  // sees it and then loses it on the way out. A document literal written here
  // would NOT reproduce it — `{ __proto__: [...] }` in source sets the
  // prototype instead of creating a key — so these fixtures are parsed.
  function parsedSlots(): Record<string, BlockNode[]> {
    return JSON.parse(
      JSON.stringify({ main: [], other: [] }).replace('"main"', '"__proto__"')
    ) as Record<string, BlockNode[]>;
  }

  it("is a shape the fixture actually produces", () => {
    // The positive control. Without it, every assertion below could be passing
    // because the fixture never had a `__proto__` key in the first place, and a
    // rebuild that dropped it would look identical to one that kept it.
    const slots = parsedSlots();

    expect(Object.keys(slots)).toContain("__proto__");
    expect(Object.prototype.hasOwnProperty.call(slots, "__proto__")).toBe(true);
  });

  it("survives removeNode, which rebuilds every slot of every node", () => {
    const doomed = makeNode("core/text", 1);
    const slots = parsedSlots();
    slots.other = [doomed];
    const parent = makeNode("core/box", 1, {}, slots);

    const next = removeNode([parent], doomed.id);

    // The slot the caller never mentioned is still there, and still a slot —
    // not swallowed into the prototype, where `Object.keys` and
    // `JSON.stringify` would both report it gone.
    expect(Object.keys(next[0]!.slots!)).toContain("__proto__");
    expect(JSON.stringify(next[0]!.slots)).toContain("__proto__");
    expect(Object.getPrototypeOf(next[0]!.slots!)).toBe(Object.prototype);
    // And the edit that was actually requested happened.
    expect(next[0]!.slots!.other).toHaveLength(0);
  });

  it("survives insertNode targeting a different slot", () => {
    const slots = parsedSlots();
    const parent = makeNode("core/box", 1, {}, slots);
    const added = makeNode("core/text", 1);

    const next = insertNode([parent], added, {
      parentId: parent.id,
      slot: "other",
      index: 0,
    });

    expect(Object.keys(next[0]!.slots!)).toContain("__proto__");
    expect(next[0]!.slots!.other).toHaveLength(1);
  });

  it("can be the slot being written to, without becoming the prototype", () => {
    // The direction the spread does not cover: the destination record has no
    // own `__proto__` to shadow the inherited setter, so plain assignment here
    // creates no key at all and silently retargets the object's prototype.
    const parent = makeNode("core/box", 1, {}, { other: [] });
    const added = makeNode("core/text", 1);

    const next = insertNode([parent], added, {
      parentId: parent.id,
      slot: "__proto__",
      index: 0,
    });

    expect(Object.keys(next[0]!.slots!)).toContain("__proto__");
    expect(Object.getPrototypeOf(next[0]!.slots!)).toBe(Object.prototype);
    expect(next[0]!.slots!.__proto__).toHaveLength(1);
  });
});
