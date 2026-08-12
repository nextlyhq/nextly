import { describe, expect, it } from "vitest";

import { applyOp, OpError, type BuilderOp, type NodePatch } from "./ops";

import { MAX_DEPTH, updateNode, type BlockNode } from "@nextlyhq/blocks-engine";

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

  it.each<[string, string]>([
    [
      "a position with no index at all",
      '{"kind":"insert","node":{"id":"x","type":"core/box","version":1,"props":{}},"at":{}}',
    ],
    ["a non-numeric index", '{"kind":"move","id":"b","to":{"index":"first"}}'],
    [
      "a slot inside a parent that is not a string",
      '{"kind":"move","id":"b","to":{"parentId":"outer","slot":null,"index":0}}',
    ],
  ])(
    "refuses a position that cannot mean what it claims: %s",
    (_label, text) => {
      // The engine's primitives do not re-check a position, and each of these
      // still produces a NEW forest — so the acceptance check reads them as edits
      // that worked. `{}` splices at NaN and lands the node at the front; a null
      // slot creates a child region literally named "null".
      expect(() => applyOp(forest(), persisted(text))).toThrow(OpError);
    }
  );

  it("refuses an update whose value only LOOKS new", () => {
    // A persisted patch is freshly parsed, so `{ props: {} }` is never the same
    // object as the node's `{}`. A reference test calls every replayed op a
    // change and the no-op guard stops guarding anything.
    expect(() =>
      applyOp(
        forest(),
        persisted('{"kind":"update","id":"a","patch":{"props":{}}}')
      )
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

  it("cannot be moved by moving the container it sits in", () => {
    // The promise is easier to rely on when it means one thing: this node does
    // not move or disappear until you unlock it. Holding for the node and not
    // for the section around it is the version an author cannot predict.
    const nested: BlockNode[] = [
      node("outer", { main: [{ ...node("b"), locked: true }] }),
      node("sibling"),
    ];

    expect(() =>
      applyOp(nested, { kind: "move", id: "outer", to: { index: 1 } })
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

describe("an op whose own shape is wrong", () => {
  /** What `JSON.parse` produces. These shapes cannot come from the compiler. */
  function persisted(text: string): BuilderOp {
    return JSON.parse(text) as BuilderOp;
  }

  it("still applies a well-formed node carrying every optional field", () => {
    // The positive control, and it is the one that matters: a shape check that
    // refused everything would satisfy every assertion below while making the
    // editor unable to insert anything at all.
    const complete: BlockNode = {
      id: "complete",
      type: "core/box",
      version: 2,
      props: { text: "hi" },
      bindings: {},
      slots: { main: [node("child")] },
      styles: {},
      classes: ["a", "b"],
      visibility: {},
      locked: false,
      name: "Box",
      customCss: ".x{}",
      cssId: "box",
      attributes: { "data-x": "1" },
      migrationFailed: false,
    };

    const applied = applyOp(forest(), {
      kind: "insert",
      node: complete,
      at: { index: 0 },
    });
    expect(applied.nodes[0]?.id).toBe("complete");
  });

  it.each<[string, string]>([
    [
      "an inserted node missing everything but an id",
      '{"kind":"insert","node":{"id":"bad"},"at":{"index":0}}',
    ],
    [
      "an inserted node whose version is a string",
      '{"kind":"insert","node":{"id":"x","type":"core/box","version":"1","props":{}},"at":{"index":0}}',
    ],
    [
      "a malformed child inside an inserted subtree",
      '{"kind":"insert","node":{"id":"x","type":"core/box","version":1,"props":{},"slots":{"main":[{"id":"kid"}]}},"at":{"index":0}}',
    ],
    [
      "an inserted node that is not an object at all",
      '{"kind":"insert","node":"nope","at":{"index":0}}',
    ],
    [
      "an inserted node whose type is not namespaced",
      '{"kind":"insert","node":{"id":"x","type":"box","version":1,"props":{}},"at":{"index":0}}',
    ],
    [
      "an inserted node whose version is zero",
      '{"kind":"insert","node":{"id":"x","type":"core/box","version":0,"props":{}},"at":{"index":0}}',
    ],
    [
      "an inserted node whose version is fractional",
      '{"kind":"insert","node":{"id":"x","type":"core/box","version":-2.5,"props":{}},"at":{"index":0}}',
    ],
    [
      "a patch setting a version the engine would refuse",
      '{"kind":"update","id":"a","patch":{"version":0}}',
    ],
    [
      "a patch value of the wrong kind",
      '{"kind":"update","id":"a","patch":{"version":"bad"}}',
    ],
    [
      "a patch naming classes that are not strings",
      '{"kind":"update","id":"a","patch":{"classes":[1,2]}}',
    ],
    [
      "a patch naming attributes that are not strings",
      '{"kind":"update","id":"a","patch":{"attributes":{"data-x":5}}}',
    ],
    ["a patch that is not a record", '{"kind":"update","id":"a","patch":7}'],
    [
      "an unset that is not a list of names",
      '{"kind":"update","id":"a","patch":{"name":"x"},"unset":"cssId"}',
    ],
  ])("refuses %s", (_label, json) => {
    // Every one of these produces a NEW forest if it reaches the engine, so the
    // acceptance check reads it as an edit that worked and the document keeps
    // whatever arrived.
    expect(() => applyOp(forest(), persisted(json))).toThrow(OpError);
  });

  it.each<[string, string]>([
    ["a null position", '{"kind":"insert","node":null,"at":null}'],
    ["a position that is a string", '{"kind":"move","id":"a","at":"end"}'],
    ["an op that is null", "null"],
  ])("refuses %s as an OpError rather than crashing", (_label, json) => {
    let thrown: unknown;
    try {
      applyOp(forest(), persisted(json));
    } catch (error) {
      thrown = error;
    }

    // `toThrow(OpError)` alone would pass on a TypeError from reading a
    // property of `null`, because that is still a throw. The distinction is the
    // whole point: a refusal names the op that was wrong, and a TypeError
    // escaping this module reads to the caller as a bug in the editor.
    expect(thrown).toBeInstanceOf(OpError);
    expect(thrown).not.toBeInstanceOf(TypeError);
  });

  it.each<[string, string]>([
    ["a null id", '{"kind":"remove","id":null}'],
    ["an id that is a number", '{"kind":"update","id":7,"patch":{"name":"x"}}'],
    ["an empty id", '{"kind":"move","id":"","to":{"index":0}}'],
  ])("says %s is malformed rather than missing", (_label, json) => {
    // Asserting only `OpError` here would prove nothing, and this is the shape
    // that hides it: `findNode` answers `undefined` for a malformed id exactly
    // as it does for one the document does not hold, so the op is refused
    // either way and the test passes with the guard removed. What the guard
    // changes is the DIAGNOSIS — "addresses no node" sends the reader to the
    // op, "no node with id" sends them hunting for a deleted block — so the
    // diagnosis is what has to be asserted.
    expect(() => applyOp(forest(), persisted(json))).toThrow(
      /addresses no node/
    );
  });

  it.each<[string, string]>([
    ["__proto__", "__proto__"],
    ["constructor", "constructor"],
    // The name a hand-written list of the two above would miss, and it breaks
    // in exactly the same way.
    ["toString", "toString"],
  ])("refuses a slot named after an inherited member: %s", (_label, slot) => {
    const op = persisted(
      `{"kind":"insert","node":{"id":"x","type":"core/box","version":1,"props":{}},"at":{"parentId":"outer","slot":"${slot}","index":0}}`
    );
    let thrown: unknown;
    try {
      applyOp(forest(), op);
    } catch (error) {
      thrown = error;
    }
    // The distinction is the point: without the guard the engine reads an
    // inherited member as the child list and throws a TypeError, which escapes
    // this module as something the caller cannot tell from an editor bug.
    expect(thrown).toBeInstanceOf(OpError);
    expect(thrown).not.toBeInstanceOf(TypeError);
  });

  it("refuses a sparse array where every entry must be a string", () => {
    // `Array.prototype.every` SKIPS holes, so a sparse array reports that every
    // entry is a string when there is no entry at all. It then serializes as
    // `[null]`, which strict engine validation rejects — so the document would
    // hold something no read can accept.
    const sparse = Array<string>(1);
    expect(() =>
      applyOp(forest(), { kind: "update", id: "a", patch: { classes: sparse } })
    ).toThrow(OpError);
  });

  it("still accepts an ordinary slot name and an ordinary class list", () => {
    // The control for both guards above. A check that refused every slot name,
    // or every array, would satisfy them while making the editor unusable.
    const inserted = applyOp(forest(), {
      kind: "insert",
      node: node("kid"),
      at: { parentId: "outer", slot: "main", index: 0 },
    });
    expect(inserted.nodes[0]?.slots?.main?.[0]?.id).toBe("kid");

    const updated = applyOp(forest(), {
      kind: "update",
      id: "a",
      patch: { classes: ["one", "two"] },
    });
    expect(updated.nodes).toBeDefined();
  });

  it.each<[string, () => Record<string, unknown>]>([
    ["a bigint", () => ({ count: 1n })],
    [
      "a cycle",
      () => {
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        return cyclic;
      },
    ],
  ])("refuses a patch value with no JSON form: %s", (_label, build) => {
    // The type cannot stop this — `props` is `Record<string, unknown>`, so both
    // are statically legal. `JSON.stringify` throws a native TypeError on
    // either, which would leave this module as an editor crash rather than the
    // refusal it promises. The value would not survive storage anyway.
    let thrown: unknown;
    try {
      applyOp(forest(), {
        kind: "update",
        id: "a",
        patch: { props: build() },
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(OpError);
    expect(thrown).not.toBeInstanceOf(TypeError);
  });

  it.each<[string, () => Record<string, unknown>]>([
    ["a function", () => ({ changed: "yes", formatter: () => "x" })],
    ["a symbol", () => ({ changed: "yes", tag: Symbol("x") })],
    [
      "a nested undefined",
      () => ({ changed: "yes", nested: { gone: undefined } }),
    ],
    ["NaN", () => ({ changed: "yes", ratio: Number.NaN })],
  ])("refuses a patch value JSON silently erases: %s", (_label, build) => {
    // Each case carries a real change alongside the lossy value. Without one,
    // `{ tag: Symbol() }` serializes to `{}` — identical to this node's empty
    // props — and the op is refused as a no-op instead, so the assertion would
    // pass with the domain check removed. Measured, not assumed.
    // The half a try/catch around `stringify` cannot see. These do not throw —
    // they are DROPPED or rewritten, so the live document keeps the value and
    // the stored op does not, and a crash replay rebuilds a different document
    // than the author was looking at. Loud failures were already refused; this
    // is the quiet one.
    expect(() =>
      applyOp(forest(), {
        kind: "update",
        id: "a",
        patch: { props: build() },
      })
    ).toThrow(OpError);
  });

  it("builds its refusal without serializing the value it is rejecting", () => {
    // The rejection branch has to DESCRIBE the bad value, and a bigint makes
    // `JSON.stringify` throw — so the message about the bad op would itself
    // fail and the caller would meet a TypeError instead of the refusal.
    let thrown: unknown;
    try {
      applyOp(forest(), {
        kind: "update",
        id: "a",
        patch: { attributes: { x: 1n } as unknown as Record<string, string> },
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(OpError);
    expect(thrown).not.toBeInstanceOf(TypeError);
  });

  it("refuses a slot named after an inherited member inside a subtree", () => {
    // The same name `assertPosition` refuses at a destination. Accepting it
    // here let a subtree smuggle in what a position could not: the engine
    // rebuilds slot maps by assigning `slots[name]`, and for this name that
    // sets the prototype instead of creating an own key, so the whole child
    // list disappears during an unrelated later edit.
    const parent = node("holder");
    parent.slots = { ["__proto__"]: [node("kid")] } as Record<
      string,
      BlockNode[]
    >;
    expect(() =>
      applyOp(forest(), { kind: "insert", node: parent, at: { index: 0 } })
    ).toThrow(OpError);
  });

  it("refuses a subtree deeper than a document may hold", () => {
    // Recursion exhausted the stack on this and left a RangeError, which the
    // caller cannot tell from a broken editor. The walk is iterative and asks
    // the engine's own limit.
    let deep = node("leaf-0");
    for (let level = 1; level <= 10_000; level += 1) {
      const parent = node(`level-${level}`);
      parent.slots = { main: [deep] };
      deep = parent;
    }

    let thrown: unknown;
    try {
      applyOp(forest(), { kind: "insert", node: deep, at: { index: 0 } });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(OpError);
    expect(thrown).not.toBeInstanceOf(RangeError);
  });

  it("still accepts a subtree nested as deep as a document allows", () => {
    // The control. A bound set too tight would refuse documents the engine
    // itself accepts, and every assertion above would still pass.
    let deep = node("deep-leaf");
    for (let level = 1; level < MAX_DEPTH; level += 1) {
      const parent = node(`deep-${level}`);
      parent.slots = { main: [deep] };
      deep = parent;
    }
    const applied = applyOp(forest(), {
      kind: "insert",
      node: deep,
      at: { index: 0 },
    });
    expect(applied.nodes[0]?.id).toBe(`deep-${MAX_DEPTH - 1}`);
  });

  it("refuses a hole in an inserted slot array", () => {
    // `forEach` skips holes, so a sparse child list would be walked as though
    // the missing entries were not there. They serialize as `null`, and a
    // `null` in a child list is not a node.
    const parent = node("holder");
    parent.slots = { main: Array<BlockNode>(1) };
    expect(() =>
      applyOp(forest(), { kind: "insert", node: parent, at: { index: 0 } })
    ).toThrow(OpError);
  });

  it("refuses a subtree that contains itself", () => {
    // JSON cannot express this, but an in-process caller can, and the walk
    // would not return.
    const cyclic = node("loop");
    cyclic.slots = { main: [cyclic] };
    expect(() =>
      applyOp(forest(), { kind: "insert", node: cyclic, at: { index: 0 } })
    ).toThrow(OpError);
  });
});
