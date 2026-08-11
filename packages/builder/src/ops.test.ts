import { describe, expect, it } from "vitest";

import { applyOp, OpError, type BuilderOp } from "./ops";

import type { BlockNode } from "@nextlyhq/blocks-engine";

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

/** Apply an op, then its inverse, and hand back both forests. */
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

  it("names the keys a patch touched, and only those", () => {
    const { applied } = roundTrip(forest(), {
      kind: "update",
      id: "a",
      patch: { customCss: ".x { color: red }" },
    });

    // `undefined` rather than an omitted key: undoing an addition has to REMOVE
    // the value, and a patch that omits the key would leave it in place.
    expect(applied.inverse).toEqual({
      kind: "update",
      id: "a",
      patch: { customCss: undefined },
    });
    expect(
      Object.keys(
        (applied.inverse as Extract<BuilderOp, { kind: "update" }>).patch
      )
    ).toEqual(["customCss"]);
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

  it("refuses to insert an id the document already holds", () => {
    // Two nodes with one id makes every later op ambiguous about which it
    // addresses, and the ambiguity surfaces as the wrong node moving.
    expect(() =>
      applyOp(forest(), { kind: "insert", node: node("b"), at: { index: 0 } })
    ).toThrow(OpError);
  });
});
