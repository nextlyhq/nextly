/**
 * Inserting a saved pattern as a copy that keeps no link back.
 *
 * Most of these are about what the planner REFUSES. A plan that reports success
 * and then throws when it is applied defeats the reason planning is separate
 * from doing, so every refusal the op layer will make and this can foresee is
 * asserted here — with `applyOps` run afterwards as the oracle, so a refusal
 * that stopped being necessary shows up as a test that cannot fail.
 */
import { describe, expect, it } from "vitest";

import { applyOps } from "./ops";
import { planInsertPattern, type StoredPattern } from "./composition-planners";
import { DOCUMENT_FORMAT_VERSION } from "./document";
import type { BlockDocument, BlockNode } from "./document";
import { walkNodes } from "./tree";

function node(
  id: string,
  extra: Partial<BlockNode> = {},
  slots?: Record<string, BlockNode[]>
): BlockNode {
  return {
    id,
    type: "core/box",
    version: 1,
    props: {},
    ...extra,
    ...(slots === undefined ? {} : { slots }),
  };
}

const page = (
  nodes: BlockNode[],
  settings?: BlockDocument["settings"]
): BlockDocument => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes,
  ...(settings === undefined ? {} : { settings }),
});

/** A stored pattern: a document plus the identity the store gave it. */
const pattern = (nodes: BlockNode[], id = "hero-pattern"): StoredPattern => ({
  id,
  document: {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "pattern",
    nodes,
  },
});

/** The same, for a document this planner should refuse outright. */
const stored = (document: BlockDocument): StoredPattern => ({
  id: "hero-pattern",
  document,
});

const anyParent = { parentsOf: () => undefined };

/** A node the renderer prunes: an author restricted it to a segment. */
const gated = {
  conditions: [[{ field: "tier", op: "eq", value: "pro" }]],
} as unknown as BlockNode["visibility"];

/** Every id in a forest. */
function idsIn(nodes: BlockNode[]): string[] {
  const out: string[] = [];
  walkNodes(nodes, n => out.push(n.id));
  return out;
}

/** The marks of the roots, after applying a plan's ops. */
function rootMarks(doc: BlockDocument, ops: readonly unknown[]): unknown[] {
  const applied = applyOps(doc, ops as never);
  return applied.document.nodes.map(n => n.props?.mark);
}

describe("a pattern arrives as a copy", () => {
  it("inserts its roots at the position, in the order they were saved", () => {
    const doc = page([
      node("a", { props: { mark: "a" } }),
      node("b", { props: { mark: "b" } }),
    ]);
    const saved = pattern([
      node("p1", { props: { mark: "p1" } }),
      node("p2", { props: { mark: "p2" } }),
    ]);

    const plan = planInsertPattern(doc, saved, { index: 1 }, anyParent);

    expect(plan.problem).toBeUndefined();
    expect(rootMarks(doc, plan.pageOps ?? [])).toEqual(["a", "p1", "p2", "b"]);
  });

  it("SHARES NO ID with the pattern it came from", () => {
    const doc = page([node("a")]);
    const saved = pattern([node("p1", {}, { body: [node("p1-child")] })]);

    const plan = planInsertPattern(doc, saved, { index: 1 }, anyParent);
    const applied = applyOps(doc, (plan.pageOps ?? []) as never);

    const placed = idsIn(applied.document.nodes);
    for (const original of ["p1", "p1-child"]) {
      expect(placed).not.toContain(original);
    }
  });

  it("inserted twice, the two copies collide on nothing", () => {
    const doc = page([node("a")]);
    const saved = pattern([node("p1", { cssId: "hero" })]);

    const first = planInsertPattern(doc, saved, { index: 1 }, anyParent);
    const once = applyOps(doc, (first.pageOps ?? []) as never).document;
    const second = planInsertPattern(once, saved, { index: 2 }, anyParent);
    const twice = applyOps(once, (second.pageOps ?? []) as never).document;

    const ids = idsIn(twice.nodes);
    expect(new Set(ids).size).toBe(ids.length);
    const cssIds = twice.nodes.map(n => n.cssId).filter(Boolean);
    expect(new Set(cssIds).size).toBe(cssIds.length);
  });
});

describe("the document target", () => {
  it("replaces the root forest and KEEPS the page's own settings", () => {
    const doc = page(
      [
        node("a", { props: { mark: "a" } }),
        node("b", { props: { mark: "b" } }),
      ],
      { customCss: ".page{}" }
    );
    const saved = pattern([node("p1", { props: { mark: "p1" } })]);

    const plan = planInsertPattern(doc, saved, "document", anyParent);
    const applied = applyOps(doc, (plan.pageOps ?? []) as never);

    expect(applied.document.nodes.map(n => n.props?.mark)).toEqual(["p1"]);
    expect(applied.document.settings?.customCss).toBe(".page{}");
  });

  it("starts an empty document from a pattern", () => {
    const doc = page([]);
    const saved = pattern([
      node("p1", { props: { mark: "p1" } }),
      node("p2", { props: { mark: "p2" } }),
    ]);

    const plan = planInsertPattern(doc, saved, "document", anyParent);

    expect(rootMarks(doc, plan.pageOps ?? [])).toEqual(["p1", "p2"]);
  });
});

describe("into a container", () => {
  it("inserts into the parent's slot", () => {
    const doc = page([
      node("card", {}, { body: [node("x", { props: { mark: "x" } })] }),
    ]);
    const saved = pattern([node("p1", { props: { mark: "p1" } })]);

    const plan = planInsertPattern(
      doc,
      saved,
      { parentId: "card", slot: "body", index: 1 },
      anyParent
    );
    const applied = applyOps(doc, (plan.pageOps ?? []) as never);

    expect(
      applied.document.nodes[0]!.slots!.body!.map(n => n.props?.mark)
    ).toEqual(["x", "p1"]);
  });

  it("REPORTS A MISSING PARENT AS UNKNOWN, not as a duplicate", () => {
    // Opposite remedies. None means the container is gone — a stale target, and
    // the author aims somewhere that exists. More than one means the document
    // is malformed, which no aiming fixes. Counting "not exactly one" collapsed
    // them and sent a common stale target to the wrong sentence.
    const doc = page([node("card", {}, { body: [] })]);

    const plan = planInsertPattern(
      doc,
      pattern([node("p1")]),
      { parentId: "ghost", slot: "body", index: 0 },
      anyParent
    );

    expect(plan.problem).toBe("unknown");
  });

  it("REFUSES A POSITION THE OP LAYER WOULD REFUSE", () => {
    // Asked of the op layer's own rule, not a second copy of it.
    const doc = page([node("a")]);

    expect(
      planInsertPattern(doc, pattern([node("p1")]), { index: -1 }, anyParent)
        .problem
    ).toBe("invalid-position");

    // A parent named without its slot — a shape a JavaScript caller can pass
    // even though the published type forbids it.
    const noSlot = { parentId: "a", index: 0 } as unknown as { index: number };
    expect(
      planInsertPattern(doc, pattern([node("p1")]), noSlot, anyParent).problem
    ).toBe("invalid-position");
  });

  it("refuses a destination id the document holds twice", () => {
    // `applyOp` refuses this outright: the incoming node would be placed under
    // both. Foreseeing it here is the difference between a refusal an author
    // can read and an exception from the op layer.
    const doc = page([
      node("dup", {}, { body: [] }),
      node("dup", {}, { body: [] }),
    ]);

    const plan = planInsertPattern(
      doc,
      pattern([node("p1")]),
      { parentId: "dup", slot: "body", index: 0 },
      anyParent
    );

    expect(plan.problem).toBe("duplicate-destination");
  });
});

describe("what it refuses before the op layer would", () => {
  it("refuses a block that may not sit in that parent, naming where it can", () => {
    const columnsOnly = {
      parentsOf: (type: string) =>
        type === "core/column" ? ["core/columns"] : undefined,
    };
    const doc = page([node("card", {}, { body: [] })]);

    const plan = planInsertPattern(
      doc,
      pattern([node("c", { type: "core/column" })]),
      { parentId: "card", slot: "body", index: 0 },
      columnsOnly
    );

    expect(plan.problem).toBe("wrong-parent");
    expect(plan.permitted).toEqual(["core/columns"]);
  });

  it("refuses a block the destination SLOT does not admit", () => {
    const headerTakesText = {
      parentsOf: () => undefined,
      slotAllowOf: (parentType: string, slot: string) =>
        parentType === "core/box" && slot === "header"
          ? ["core/text"]
          : undefined,
    };
    const doc = page([node("card", {}, { header: [] })]);

    const plan = planInsertPattern(
      doc,
      pattern([node("img", { type: "core/image" })]),
      { parentId: "card", slot: "header", index: 0 },
      headerTakesText
    );

    expect(plan.problem).toBe("not-allowed-in-slot");
    expect(plan.permitted).toEqual(["core/text"]);
  });

  it("refuses a restricted block at the document root", () => {
    const columnsOnly = {
      parentsOf: (type: string) =>
        type === "core/column" ? ["core/columns"] : undefined,
    };

    const plan = planInsertPattern(
      page([]),
      pattern([node("c", { type: "core/column" })]),
      "document",
      columnsOnly
    );

    expect(plan.problem).toBe("restricted-at-root");
  });

  it("PLACES A LOCKED BLOCK BY LOCKING IT AFTER IT LANDS", () => {
    // `applyOp` refuses an insert carrying a locked subtree, because its
    // inverse is a remove and a remove refuses one — so the insert could never
    // be undone. Saving a selection with a locked block succeeds, though, so
    // refusing here would build a library row nothing could ever place.
    const doc = page([node("a")]);
    const saved = pattern([
      node("p1", { locked: true }, { body: [node("deep", { locked: true })] }),
    ]);

    const plan = planInsertPattern(doc, saved, { index: 1 }, anyParent);
    expect(plan.problem).toBeUndefined();

    const applied = applyOps(doc, (plan.pageOps ?? []) as never);
    const locks: boolean[] = [];
    walkNodes(applied.document.nodes, n => {
      if (n.props?.mark !== undefined || n.id !== "a")
        locks.push(n.locked === true);
    });
    // Both nodes end LOCKED, which is the state the pattern described.
    expect(locks.filter(Boolean)).toHaveLength(2);
  });

  it("and the group is still undoable, which is why the lock is deferred", () => {
    // The whole reason the op layer refuses a locked insert. Inverses are
    // recorded in undo order, so the unlock runs before the remove and the
    // remove never meets a locked node.
    const doc = page([node("a")]);
    const saved = pattern([node("p1", { locked: true })]);

    const plan = planInsertPattern(doc, saved, { index: 1 }, anyParent);
    const applied = applyOps(doc, (plan.pageOps ?? []) as never);

    expect(() =>
      applyOps(applied.document, applied.inverses as never)
    ).not.toThrow();
    const undone = applyOps(applied.document, applied.inverses as never);
    expect(undone.document.nodes.map(n => n.id)).toEqual(["a"]);
  });

  it("a positional insert does NOT mind a locked block on the page", () => {
    // Only the replacing target deletes anything; adding beside a locked block
    // is fine, and refusing it would be this planner inventing a rule.
    const doc = page([node("keep", { locked: true })]);

    const plan = planInsertPattern(
      doc,
      pattern([node("p1")]),
      { index: 1 },
      anyParent
    );

    expect(plan.problem).toBeUndefined();
    expect(() => applyOps(doc, (plan.pageOps ?? []) as never)).not.toThrow();
  });

  it("REFUSES REPLACING A DOCUMENT WHOSE IDS ARE NOT UNIQUE", () => {
    // The replacing target removes every root, and a remove refuses an id the
    // document holds twice — its own and any in the subtree it takes with it.
    // A positional insert only cares about the container it aims at, so this
    // check belongs to this target alone.
    const doc = page([node("dup"), node("dup")]);

    const plan = planInsertPattern(
      doc,
      pattern([node("p1")]),
      "document",
      anyParent
    );

    expect(plan.problem).toBe("duplicate-destination");
  });

  it("a positional insert does not mind a duplicate id elsewhere", () => {
    // It removes nothing, so the rule that refuses one does not reach it.
    const doc = page([
      node("dup"),
      node("dup"),
      node("card", {}, { body: [] }),
    ]);

    const plan = planInsertPattern(
      doc,
      pattern([node("p1")]),
      { parentId: "card", slot: "body", index: 0 },
      anyParent
    );

    expect(plan.problem).toBeUndefined();
    expect(() => applyOps(doc, (plan.pageOps ?? []) as never)).not.toThrow();
  });

  it("REFUSES A STORED NODE THE OP LAYER WILL NOT CARRY", () => {
    // A pattern is stored, so it can hold a node that type-checks and is still
    // structurally invalid. `version: 0` is the cheap example, and the insert
    // throws on it — asked of the op layer's own shape rule, not a copy of it.
    const malformed: BlockDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "pattern",
      nodes: [
        { id: "p1", type: "core/box", version: 0, props: {} } as BlockNode,
      ],
    };

    const plan = planInsertPattern(
      page([node("a")]),
      stored(malformed),
      { index: 1 },
      anyParent
    );

    expect(plan.problem).toBe("invalid-node");
  });

  it("REFUSES A PATTERN THAT SPELLS ONE RENDERED ID TWICE", () => {
    // Re-identifying does not repair this: two nodes sharing an id map to ONE
    // replacement on purpose, so the copy carries the duplicate into the page
    // where an anchor resolves to whichever element the browser reaches first.
    const broken = pattern([
      node("p1", { cssId: "hero" }),
      node("p2", { attributes: { ID: "hero" } }),
    ]);

    expect(
      planInsertPattern(page([node("a")]), broken, { index: 1 }, anyParent)
        .problem
    ).toBe("duplicate-dom-id");
  });

  it("REFUSES REPLACING A PAGE THAT HOLDS A MALFORMED NODE", () => {
    // The replacing target removes every root, and a remove asks the same
    // shape question an insert does.
    const doc = page([
      { id: "bad", type: "core/box", version: 0, props: {} } as BlockNode,
    ]);

    expect(
      planInsertPattern(doc, pattern([node("p1")]), "document", anyParent)
        .problem
    ).toBe("invalid-node");
  });

  it("DOES NOT refuse a deep pattern the caller's own limits would accept", () => {
    // The shape check judges structure, not caps. Depth and size belong to
    // whoever applies: a host that raises `maxDepth` must not have a plan
    // refuse a document its own apply accepts.
    let deep: BlockNode = node("leaf");
    for (let i = 0; i < 12; i += 1) {
      deep = node(`w${i}`, {}, { body: [deep] });
    }

    const plan = planInsertPattern(
      page([node("a")]),
      pattern([deep]),
      { index: 1 },
      anyParent
    );

    expect(plan.problem).toBeUndefined();
  });

  it("REFUSES A DESTINATION THE APPLY COULD NOT EDIT AT ALL", () => {
    // `applyOp` refuses to edit such a document before it looks at anything
    // else, so a plan built against one is a plan that cannot apply.
    const old = {
      ...page([node("a")]),
      formatVersion: 99,
    } as unknown as BlockDocument;

    expect(
      planInsertPattern(old, pattern([node("p1")]), { index: 1 }, anyParent)
        .problem
    ).toBe("unusable-document");
  });

  it("refuses a destination with a kind this editor does not know", () => {
    // Checking the format version alone closed the case that is easy to
    // imagine and left the ones that are not. The apply asks about the whole
    // envelope before it looks at an op, so the plan asks the same thing.
    const odd = {
      ...page([node("a")]),
      kind: "spreadsheet",
    } as unknown as BlockDocument;

    expect(
      planInsertPattern(odd, pattern([node("p1")]), { index: 1 }, anyParent)
        .problem
    ).toBe("unusable-document");
  });

  it("refuses a destination carrying a value JSON cannot hold", () => {
    const odd = {
      ...page([node("a")]),
      metadata: 1n,
    } as unknown as BlockDocument;

    expect(
      planInsertPattern(odd, pattern([node("p1")]), { index: 1 }, anyParent)
        .problem
    ).toBe("unusable-document");
  });

  it("REFUSES A PLACEMENT INSIDE THE PATTERN THAT THE RULES NOW FORBID", () => {
    // A pattern is stored, so its internal placements were legal when saved and
    // the rules can have moved since. Checking only the roots would leave such
    // a pattern insertable and the page unpublishable.
    const columnsOnly = {
      parentsOf: (type: string) =>
        type === "core/column" ? ["core/columns"] : undefined,
    };
    const saved = pattern([
      node(
        "wrap",
        { type: "core/box" },
        {
          body: [node("c", { type: "core/column" })],
        }
      ),
    ]);

    const plan = planInsertPattern(page([]), saved, "document", columnsOnly);

    expect(plan.problem).toBe("wrong-parent");
  });

  it("refuses a document that is not a pattern", () => {
    const notAPattern: BlockDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [node("p1")],
    };

    expect(
      planInsertPattern(page([]), stored(notAPattern), "document", anyParent)
        .problem
    ).toBe("not-a-pattern");
  });

  it("refuses a pattern with nothing in it", () => {
    expect(
      planInsertPattern(page([]), pattern([]), "document", anyParent).problem
    ).toBe("empty");
  });
});

describe("the refusals are the op layer's, not invented", () => {
  it("a plan that succeeds APPLIES — no refusal is left to the apply", () => {
    // The oracle for every refusal above: if the planner passes it, `applyOps`
    // must not throw. A refusal that stopped being necessary would show up as a
    // planner that says no to something this proves is fine.
    const doc = page([node("a"), node("card", {}, { body: [node("x")] })]);
    const saved = pattern([node("p1", { cssId: "hero" }), node("p2")]);

    for (const target of [
      { index: 0 },
      { index: 2 },
      { parentId: "card", slot: "body", index: 1 },
      "document" as const,
    ]) {
      const plan = planInsertPattern(doc, saved, target, anyParent);
      expect(plan.problem).toBeUndefined();
      expect(() => applyOps(doc, (plan.pageOps ?? []) as never)).not.toThrow();
    }
  });

  it("a locked subtree really cannot be INSERTED, which is why it is deferred", () => {
    const doc = page([node("a")]);
    const locked = node("p1", {}, { body: [node("deep", { locked: true })] });

    expect(() =>
      applyOps(doc, [
        { kind: "insert", node: locked, at: { index: 1 } },
      ] as never)
    ).toThrow();
  });

  it("the INVALID-NODE refusal is real: applying that insert throws", () => {
    const doc = page([node("a")]);
    const malformed = {
      id: "p1",
      type: "core/box",
      version: 0,
      props: {},
    } as BlockNode;

    expect(() =>
      applyOps(doc, [
        { kind: "insert", node: malformed, at: { index: 1 } },
      ] as never)
    ).toThrow();
  });

  it("the DESTINATION-LOCKED refusal is real: applying those removes throws", () => {
    const doc = page([node("keep", { locked: true }), node("b")]);

    expect(() =>
      applyOps(doc, [{ kind: "remove", id: "keep" }] as never)
    ).toThrow();
  });

  it("the DUPLICATE-DESTINATION refusal is real: applying that insert throws", () => {
    const doc = page([
      node("dup", {}, { body: [] }),
      node("dup", {}, { body: [] }),
    ]);

    expect(() =>
      applyOps(doc, [
        {
          kind: "insert",
          node: node("p1"),
          at: { parentId: "dup", slot: "body", index: 0 },
        },
      ] as never)
    ).toThrow();
  });
});

describe("the destination's whole forest, not only its envelope", () => {
  it("refuses a destination holding a malformed node anywhere", () => {
    // Nowhere near the insertion point, and still fatal: the apply walks every
    // node before it applies anything, so a plan that checked only the envelope
    // reported success and threw.
    const odd = {
      ...page([node("a")]),
      nodes: [node("a"), null],
    } as unknown as BlockDocument;

    expect(
      planInsertPattern(odd, pattern([node("p1")]), { index: 1 }, anyParent)
        .problem
    ).toBe("unusable-document");
  });

  it("still accepts a well-formed destination", () => {
    // The over-exclusion control: a forest check that refuses everything
    // satisfies the test above and breaks every insert.
    expect(
      planInsertPattern(
        page([node("a")]),
        pattern([node("p1")]),
        { index: 1 },
        anyParent
      ).problem
    ).toBeUndefined();
  });
});

describe("which DOM ids an insert steers around", () => {
  it("keeps an id the destination does not hold", () => {
    // A DOM id is authored content — it appears in a URL fragment, a
    // stylesheet and the attribute panel — so it is rewritten only when
    // keeping it would put two elements on one page answering to one id.
    const plan = planInsertPattern(
      page([node("a")]),
      pattern([node("p1", { cssId: "hero" })]),
      { index: 1 },
      anyParent
    );

    const placed = (plan.pageOps ?? []).flatMap(op =>
      op.kind === "insert" ? [op.node] : []
    );
    expect(placed).toHaveLength(1);
    expect(placed[0].cssId).toBe("hero");
  });

  it("mints one the destination DOES hold", () => {
    const plan = planInsertPattern(
      page([node("a", { cssId: "hero" })]),
      pattern([node("p1", { cssId: "hero" })]),
      { index: 1 },
      anyParent
    );

    const placed = (plan.pageOps ?? []).flatMap(op =>
      op.kind === "insert" ? [op.node] : []
    );
    expect(placed).toHaveLength(1);
    expect(placed[0].cssId).not.toBe("hero");
    expect(placed[0].cssId?.startsWith("hero-")).toBe(true);
  });

  it("does not steer around an id the destination SHADOWS", () => {
    // The destination node carries `cssId: "actual"` beside
    // `attributes.id: "hero"`, and the renderer emits only `actual` — the
    // modelled field overwrites the bag. Treating `hero` as taken renamed the
    // incoming pattern to avoid a string the page never puts on screen.
    const plan = planInsertPattern(
      page([node("x", { cssId: "actual", attributes: { id: "hero" } })]),
      pattern([node("p1", { cssId: "hero" })]),
      { index: 1 },
      anyParent
    );

    const placed = (plan.pageOps ?? []).flatMap(op =>
      op.kind === "insert" ? [op.node] : []
    );
    expect(placed).toHaveLength(1);
    expect(placed[0].cssId).toBe("hero");
  });

  it("treats an EMPTY cssId as shadowing the bag, because the renderer does", () => {
    // The renderer's guard is `cssId !== undefined`, not "non-empty" — so a
    // node carrying `cssId: ""` beside `attributes.id: "hero"` emits `id=""`
    // and never `hero`. The destination therefore does not hold `hero`, and
    // steering around it would rename authored content for nothing.
    //
    // This case is the whole difference between reading `cssId` as "wins when
    // non-empty" and as "wins when present". A rule written the first way
    // passes every other test in this file.
    const plan = planInsertPattern(
      page([node("x", { cssId: "", attributes: { id: "hero" } })]),
      pattern([node("p1", { cssId: "hero" })]),
      { index: 1 },
      anyParent
    );

    const placed = (plan.pageOps ?? []).flatMap(op =>
      op.kind === "insert" ? [op.node] : []
    );
    expect(placed).toHaveLength(1);
    expect(placed[0].cssId).toBe("hero");
  });

  it("steers around a bag id whose non-string cssId does NOT shadow it", () => {
    // The renderer normalises a non-string `cssId` to undefined and only then
    // decides whether to overwrite, so this destination node renders `hero`.
    // Reading any present `cssId` as shadowing left `hero` out of the avoided
    // set and put two elements answering to it on the page.
    const destination = page([
      {
        ...node("x"),
        cssId: null,
        attributes: { id: "hero" },
      } as unknown as BlockNode,
    ]);

    const plan = planInsertPattern(
      destination,
      pattern([node("p1", { cssId: "hero" })]),
      { index: 1 },
      anyParent
    );

    const placed = (plan.pageOps ?? []).flatMap(op =>
      op.kind === "insert" ? [op.node] : []
    );
    expect(placed).toHaveLength(1);
    expect(placed[0].cssId).not.toBe("hero");
  });

  it("DOES steer around an attribute id nothing shadows", () => {
    // The control. Without it, "ignore the attribute bag entirely" passes the
    // test above and reintroduces the duplicate-id bug the bag can cause.
    const plan = planInsertPattern(
      page([node("x", { attributes: { id: "hero" } })]),
      pattern([node("p1", { cssId: "hero" })]),
      { index: 1 },
      anyParent
    );

    const placed = (plan.pageOps ?? []).flatMap(op =>
      op.kind === "insert" ? [op.node] : []
    );
    expect(placed).toHaveLength(1);
    expect(placed[0].cssId).not.toBe("hero");
  });

  it("does not steer around an id only a CONDITION-GATED node carries", () => {
    // The renderer prunes a gated node before markup, so its id reaches nobody.
    // Gating exists for personalised variants of one section, each carrying the
    // same anchor with exactly one served — counting them all renames an
    // incoming pattern to avoid every variant of an id only one of which is
    // ever on the page.
    const plan = planInsertPattern(
      page([node("g", { visibility: gated, cssId: "hero" })]),
      pattern([node("p1", { cssId: "hero" })]),
      { index: 1 },
      anyParent
    );

    const placed = (plan.pageOps ?? []).flatMap(op =>
      op.kind === "insert" ? [op.node] : []
    );
    expect(placed).toHaveLength(1);
    expect(placed[0].cssId).toBe("hero");
  });

  it("prunes the gated node's DESCENDANTS too", () => {
    // Gating removes a whole subtree, so a child's id does not reach the page
    // either. Asking `isConditionGated` of each node alone would see an
    // ungated child and count it.
    const plan = planInsertPattern(
      page([
        node(
          "g",
          { visibility: gated },
          { main: [node("kid", { cssId: "hero" })] }
        ),
      ]),
      pattern([node("p1", { cssId: "hero" })]),
      { index: 1 },
      anyParent
    );

    const placed = (plan.pageOps ?? []).flatMap(op =>
      op.kind === "insert" ? [op.node] : []
    );
    expect(placed).toHaveLength(1);
    expect(placed[0].cssId).toBe("hero");
  });

  it("still steers around an id on an UNGATED node", () => {
    // The control. "Skip every node" satisfies both tests above and puts two
    // elements answering to one id on the page.
    const plan = planInsertPattern(
      page([node("plain", { cssId: "hero" })]),
      pattern([node("p1", { cssId: "hero" })]),
      { index: 1 },
      anyParent
    );

    const placed = (plan.pageOps ?? []).flatMap(op =>
      op.kind === "insert" ? [op.node] : []
    );
    expect(placed[0].cssId).not.toBe("hero");
  });

  it("does not mint against ids the document target is about to DELETE", () => {
    // The `"document"` target replaces the root forest, so the page's own ids
    // are not ids the copy lands among. Steering around them would rename a
    // full-page pattern's blocks to avoid content being removed in the same
    // group — and this is "start from a pattern", the flow where an author is
    // most likely to have named things and least likely to expect them
    // renamed.
    const plan = planInsertPattern(
      page([node("old", { cssId: "hero" })]),
      pattern([node("p1", { cssId: "hero" })]),
      "document",
      anyParent
    );

    const placed = (plan.pageOps ?? []).flatMap(op =>
      op.kind === "insert" ? [op.node] : []
    );
    expect(placed).toHaveLength(1);
    expect(placed[0].cssId).toBe("hero");
  });
});
