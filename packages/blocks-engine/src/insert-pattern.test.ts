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
import { planInsertPattern } from "./composition-planners";
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

const pattern = (nodes: BlockNode[]): BlockDocument => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "pattern",
  nodes,
});

const anyParent = { parentsOf: () => undefined };

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

  it("REFUSES A LOCKED SUBTREE, which the op layer will not insert", () => {
    // Not a rule of this planner's own: `applyOp` refuses it because the
    // inverse of an insert is a remove and a remove refuses a locked subtree,
    // so the insert could never be undone.
    const doc = page([node("a")]);
    const saved = pattern([
      node("p1", {}, { body: [node("deep", { locked: true })] }),
    ]);

    const plan = planInsertPattern(doc, saved, { index: 1 }, anyParent);

    expect(plan.problem).toBe("locked");
  });

  it("REFUSES REPLACING A PAGE THAT HOLDS A LOCKED BLOCK", () => {
    // The `"document"` target deletes what is there, and a remove refuses a
    // locked subtree exactly as an insert does. Found by asking what the ops
    // this planner emits would do, not by review — the planner reported success
    // and `applyOps` threw.
    const doc = page([node("keep", { locked: true }), node("b")]);

    const plan = planInsertPattern(
      doc,
      pattern([node("p1")]),
      "document",
      anyParent
    );

    expect(plan.problem).toBe("destination-locked");
  });

  it("tells the page's locked block apart from the pattern's", () => {
    // Different blocks, and only one of them is in front of the author here.
    const lockedPattern = pattern([node("p1", { locked: true })]);

    expect(
      planInsertPattern(page([node("a")]), lockedPattern, "document", anyParent)
        .problem
    ).toBe("locked");
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

  it("refuses a document that is not a pattern", () => {
    const notAPattern: BlockDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [node("p1")],
    };

    expect(
      planInsertPattern(page([]), notAPattern, "document", anyParent).problem
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

  it("the LOCKED refusal is real: applying that insert throws", () => {
    const doc = page([node("a")]);
    const locked = node("p1", {}, { body: [node("deep", { locked: true })] });

    expect(() =>
      applyOps(doc, [
        { kind: "insert", node: locked, at: { index: 1 } },
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
