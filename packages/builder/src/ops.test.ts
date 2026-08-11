import { describe, expect, it } from "vitest";

import { applyOp, OpError, type BuilderOp, type NodePatch } from "./ops";

import { updateNode, type BlockNode } from "@nextlyhq/blocks-engine";

function node(id: string, slots?: Record<string, BlockNode[]>): BlockNode {
  return {
    id,
    type: "core/box",
    version: 1,
    props: {},
    ...(slots === undefined ? {} : { slots }),
  };
}

/**
 * Two top-level nodes, one of them a container holding three children.
 *
 * Three children rather than two so an index can be restored to the MIDDLE:
 * moving from an end and moving from the middle are the same assertion when
 * there is nowhere in between, and the middle is where an off-by-one shows.
 */
function forest(): BlockNode[] {
  return [
    node("outer", { main: [node("a"), node("b"), node("c")] }),
    node("sibling"),
  ];
}

/**
 * A document's identity is its SERIALIZED form.
 *
 * These documents live in a `json()` column, so what round-trips is what
 * `JSON.stringify` produces. Comparing object identity instead would fail on a
 * key restored to `undefined` — which serializes away and is the same stored
 * document — and would be asserting a property the storage does not have.
 */
function serialized(nodes: BlockNode[]): string {
  return JSON.stringify(nodes);
}

/**
 * Apply an op as the author, then its inverse as undo, and hand back both.
 *
 * The inverse goes back in as `"undo"` because that is what it is. Applying it
 * as a fresh author edit would ask the author-facing checks about an op the
 * store derived itself, which is how an inverse becomes inapplicable.
 */
function roundTrip(nodes: BlockNode[], op: BuilderOp) {
  const applied = applyOp(nodes, op);
  const undone = applyOp(applied.nodes, applied.inverse);
  return { applied, undone };
}

describe("an op and its inverse", () => {
  it.each<[string, BuilderOp]>([
    [
      "insert at the top level",
      { kind: "insert", node: node("new"), at: { index: 1 } },
    ],
    [
      "insert into a slot",
      {
        kind: "insert",
        node: node("new"),
        at: { parentId: "outer", slot: "main", index: 1 },
      },
    ],
    ["remove a top-level node", { kind: "remove", id: "sibling" }],
    [
      "remove a container, and its whole subtree",
      { kind: "remove", id: "outer" },
    ],
    ["remove the middle child of a slot", { kind: "remove", id: "b" }],
    [
      "move a child out of its slot to the top level",
      { kind: "move", id: "b", to: { index: 0 } },
    ],
    [
      "move a top-level node into a slot",
      {
        kind: "move",
        id: "sibling",
        to: { parentId: "outer", slot: "main", index: 0 },
      },
    ],
    [
      "move within one slot, from the middle to the front",
      {
        kind: "move",
        id: "b",
        to: { parentId: "outer", slot: "main", index: 0 },
      },
    ],
    [
      "move within one slot, from the front to the end",
      {
        kind: "move",
        id: "a",
        to: { parentId: "outer", slot: "main", index: 2 },
      },
    ],
    [
      "update a field the node already has",
      { kind: "update", id: "a", patch: { version: 2 } },
    ],
    [
      "update a field the node does NOT have",
      { kind: "update", id: "a", patch: { customCss: ".x { color: red }" } },
    ],
  ])("restores the document exactly: %s", (_label, op) => {
    const before = forest();
    const { applied, undone } = roundTrip(before, op);

    // The op did something. Without this the round trip is satisfied by an op
    // that no-ops and an inverse that no-ops with it.
    expect(serialized(applied.nodes)).not.toBe(serialized(before));
    expect(serialized(undone.nodes)).toBe(serialized(before));
  });
});

describe("the inverse is derived from the document, not from the caller", () => {
  it("puts a removed node back in the slot and at the index it came from", () => {
    // The caller supplies an id and nothing else, so everything needed to undo
    // this — the node, its parent, its slot, its index — can only come from the
    // document as it stood when the op ran.
    const { applied } = roundTrip(forest(), { kind: "remove", id: "b" });

    expect(applied.inverse).toEqual({
      kind: "insert",
      node: expect.objectContaining({ id: "b" }),
      at: { parentId: "outer", slot: "main", index: 1 },
    });
  });

  it("carries the whole subtree of a removed container", () => {
    // A container's children are not recoverable from the forest once it is
    // gone, so the inverse has to hold them rather than name them.
    const { applied } = roundTrip(forest(), { kind: "remove", id: "outer" });
    const inverse = applied.inverse;

    expect(inverse.kind).toBe("insert");
    if (inverse.kind !== "insert") return;
    expect(inverse.node.slots?.main?.map(child => child.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("names a removal rather than setting it to undefined", () => {
    const { applied } = roundTrip(forest(), {
      kind: "update",
      id: "a",
      patch: { customCss: ".x { color: red }" },
    });

    // The node had no `customCss`, so undoing the addition means REMOVING it.
    // Said as a name in `unset` rather than as `{ customCss: undefined }`,
    // because an op is persisted and `JSON.stringify` drops an undefined value:
    // the inverse would arrive back from a crash buffer as an empty patch and
    // undo would leave the added value in place.
    expect(applied.inverse).toEqual({
      kind: "update",
      id: "a",
      patch: {},
      unset: ["customCss"],
    });
  });

  it("keeps a prior value in the patch when there was one", () => {
    // The other half: a field the node HELD is restored by value, and nothing
    // is named for removal. Without this, `unset` could swallow every key and
    // the assertion above would still pass.
    const { applied } = roundTrip(forest(), {
      kind: "update",
      id: "a",
      patch: { version: 2 },
    });

    expect(applied.inverse).toEqual({
      kind: "update",
      id: "a",
      patch: { version: 1 },
    });
  });

  it("survives being persisted, which is what an op has to do", () => {
    // The gap the document-level round trip could not see. It serialized the
    // resulting DOCUMENT; an op list is serialized too — a crash buffer, a
    // queued agent edit, a replayed history — and an inverse that does not
    // survive that is an undo that silently keeps part of what it undid.
    const before = forest();
    const { applied } = roundTrip(before, {
      kind: "update",
      id: "a",
      patch: { customCss: ".x { color: red }" },
    });

    const persisted = JSON.parse(JSON.stringify(applied.inverse)) as BuilderOp;
    const undone = applyOp(applied.nodes, persisted);

    expect(JSON.stringify(undone.nodes)).toBe(JSON.stringify(before));
  });
});

describe("an op that cannot apply", () => {
  it.each<[string, BuilderOp]>([
    ["remove", { kind: "remove", id: "absent" }],
    ["move", { kind: "move", id: "absent", to: { index: 0 } }],
    ["update", { kind: "update", id: "absent", patch: { version: 2 } }],
  ])("refuses rather than doing nothing: %s", (_label, op) => {
    // A silent no-op would still be recorded by the history, and its inverse
    // would then undo an edit that never happened.
    expect(() => applyOp(forest(), op)).toThrow(OpError);
  });

  it.each<[string, BuilderOp]>([
    [
      "a drop back into the same slot and index",
      {
        kind: "move",
        id: "b",
        to: { parentId: "outer", slot: "main", index: 1 },
      },
    ],
    [
      "a top-level node dropped on itself",
      { kind: "move", id: "sibling", to: { index: 1 } },
    ],
  ])("refuses a move that changes nothing: %s", (_label, op) => {
    // `moveNode` removes and reinserts, so it returns a NEW forest holding the
    // same tree — the reference changed and nothing else did. Accepting that
    // puts an entry in the history whose undo has no visible effect, and a user
    // pressing undo expects the last thing they SAW to come back.
    expect(() => applyOp(forest(), op)).toThrow(OpError);
  });

  it("refuses to insert an id the document already holds", () => {
    // Two nodes with one id makes every later op ambiguous about which it
    // addresses, and the ambiguity surfaces as the wrong node moving.
    expect(() =>
      applyOp(forest(), { kind: "insert", node: node("b"), at: { index: 0 } })
    ).toThrow(OpError);
  });

  it.each<[string, BuilderOp]>([
    [
      "insert naming a parent the document does not hold",
      {
        kind: "insert",
        node: node("new"),
        at: { parentId: "absent", slot: "main", index: 0 },
      },
    ],
    [
      "insert into a parent without naming the slot",
      {
        kind: "insert",
        node: node("new"),
        at: { parentId: "outer", index: 0 },
      },
    ],
    [
      "insert whose SUBTREE repeats an id the document holds",
      {
        kind: "insert",
        node: node("new", { main: [node("b")] }),
        at: { index: 0 },
      },
    ],
    [
      "move naming a parent the document does not hold",
      {
        kind: "move",
        id: "b",
        to: { parentId: "absent", slot: "main", index: 0 },
      },
    ],
    [
      "move into a parent without naming the slot",
      { kind: "move", id: "b", to: { parentId: "outer", index: 0 } },
    ],
    [
      "move into its own subtree",
      {
        kind: "move",
        id: "outer",
        to: { parentId: "a", slot: "main", index: 0 },
      },
    ],
  ])("refuses what the engine declined: %s", (_label, op) => {
    // The engine reports a refusal by handing back the forest it was given, and
    // it declines for more reasons than a caller can enumerate. Reading the
    // RESULT rather than restating those rules is what keeps the fifth reason
    // from being admitted silently — which for a history means an entry for an
    // edit that never happened, whose inverse throws when someone undoes it.
    expect(() => applyOp(forest(), op)).toThrow(OpError);
  });
});

describe("the patch type", () => {
  it("is the engine's, not a copy of it", () => {
    // A type-level pin, which is worth writing HERE because this package
    // typechecks its test files — in a package that does not, the assertion
    // below could never fail and would read as coverage anyway.
    //
    // It holds trivially while `NodePatch` is read off the signature. It earns
    // its place if someone writes the shape out by hand again: the two
    // assignments then stop compiling the moment the engine narrows, which is
    // the divergence that would otherwise let an op carry a field `updateNode`
    // had quietly stopped applying.
    const fromEngine: NodePatch = {} as Parameters<typeof updateNode>[2];
    const toEngine: Parameters<typeof updateNode>[2] = {} as NodePatch;

    expect(fromEngine).toEqual({});
    expect(toEngine).toEqual({});
  });
});

describe("an op that came back from storage", () => {
  /** What `JSON.parse` produces, which is where these op shapes come from. */
  function persisted(text: string): BuilderOp {
    return JSON.parse(text) as BuilderOp;
  }

  it("cannot reach an object's machinery through a field name", () => {
    // `Object.keys` never yields `__proto__`, but `JSON.parse` makes it an own
    // key. Recording a prior value under that name would rewrite the
    // accumulator's prototype instead of storing anything, and the entry would
    // vanish from the inverse without an error.
    expect(() =>
      applyOp(
        forest(),
        persisted('{"kind":"update","id":"a","patch":{"__proto__":{"x":1}}}')
      )
    ).toThrow(OpError);
  });

  it("cannot strip a node's identity through unset", () => {
    // The inverse still addresses the old id, so a removal of `id` produces an
    // undo that cannot find what it is meant to restore.
    expect(() =>
      applyOp(
        forest(),
        persisted('{"kind":"update","id":"a","patch":{},"unset":["id"]}')
      )
    ).toThrow(OpError);
  });

  it("cannot remove a field every node must have", () => {
    // `version` and `props` are patchable but not removable: a node without
    // them is not a node, and no inverse could put one back.
    expect(() =>
      applyOp(
        forest(),
        persisted('{"kind":"update","id":"a","patch":{},"unset":["version"]}')
      )
    ).toThrow(OpError);
  });

  it("cannot say removal with a value that does not survive storage", () => {
    // `{ customCss: undefined }` removes the field when applied and then
    // serializes to `{}`, so the same op replayed after a crash does nothing.
    // Removal has a spelling that survives; this insists on it.
    expect(() =>
      applyOp(forest(), {
        kind: "update",
        id: "a",
        patch: { customCss: undefined },
      })
    ).toThrow(OpError);
  });

  it("refuses an update that writes what is already there", () => {
    // Same invisible-history-entry problem the move branch refuses, but the
    // reference test cannot see it: `updateNode` allocates regardless, so the
    // values have to be compared.
    expect(() =>
      applyOp(forest(), { kind: "update", id: "a", patch: { version: 1 } })
    ).toThrow(OpError);
  });

  it("refuses an unset of a field the node does not have", () => {
    expect(() =>
      applyOp(forest(), {
        kind: "update",
        id: "a",
        unset: ["customCss"],
        patch: {},
      })
    ).toThrow(OpError);
  });

  it("still accepts an ordinary persisted update", () => {
    // The control. Every refusal above is narrow, and a guard that rejected
    // real ops too would pass all of them while breaking the product.
    const { nodes } = applyOp(
      forest(),
      persisted('{"kind":"update","id":"a","patch":{"name":"Hero"}}')
    );

    expect(JSON.stringify(nodes)).toContain("Hero");
  });
});

describe("a node its author locked", () => {
  /** The nested child, locked. The engine's primitives do not read this flag. */
  function withLocked(): BlockNode[] {
    return [
      node("outer", {
        main: [node("a"), { ...node("b"), locked: true }, node("c")],
      }),
      node("sibling"),
    ];
  }

  it.each<[string, BuilderOp]>([
    ["removed", { kind: "remove", id: "b" }],
    [
      "moved",
      {
        kind: "move",
        id: "b",
        to: { parentId: "outer", slot: "main", index: 0 },
      },
    ],
  ])("cannot be %s", (_label, op) => {
    // `BlockNode.locked` documents itself as an author-facing policy flag that
    // the pure tree primitives do not read, which makes this module the boundary
    // that enforces it. Nothing below here will.
    expect(() => applyOp(withLocked(), op)).toThrow(OpError);
  });

  it("cannot be inserted, because that insert could not be undone", () => {
    // The lock's own words are "move or delete", and an insert is neither — but
    // the inverse of an insert is a REMOVE, and a locked node cannot be
    // removed. Accepting the insert would put the document one edit from a
    // state its own undo could not leave, so the door is the place to refuse.
    expect(() =>
      applyOp(forest(), {
        kind: "insert",
        node: { ...node("pasted"), locked: true },
        at: { index: 0 },
      })
    ).toThrow(OpError);
  });

  it("cannot be smuggled in as a descendant either", () => {
    // The subtree, not the root. Refusing only a locked ROOT would let the same
    // un-undoable state arrive one level down, which is exactly how the remove
    // check was wrong before this.
    expect(() =>
      applyOp(forest(), {
        kind: "insert",
        node: node("wrapper", { main: [{ ...node("inner"), locked: true }] }),
        at: { index: 0 },
      })
    ).toThrow(OpError);
  });

  it("cannot be deleted by deleting the container it sits in", () => {
    // The finding this pairs with: removing an unlocked container removes its
    // whole subtree, so a check reading only the addressed node honours the
    // lock at the node and defeats it one level up.
    const nested: BlockNode[] = [
      node("outer", { main: [{ ...node("b"), locked: true }] }),
    ];

    expect(() => applyOp(nested, { kind: "remove", id: "outer" })).toThrow(
      OpError
    );
  });

  it("can still be restyled", () => {
    // The control, and the scope of the lock: it is against being moved and
    // deleted, not against being edited. A lock that also froze styling would
    // be a different feature, and asserting only the refusals above would not
    // notice it had become one.
    const { nodes } = applyOp(withLocked(), {
      kind: "update",
      id: "b",
      patch: { customCss: ".x { color: red }" },
    });

    expect(JSON.stringify(nodes)).toContain("color: red");
  });
});
