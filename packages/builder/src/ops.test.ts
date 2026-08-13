import { describe, expect, it } from "vitest";

import { applyOp, OpError, type BuilderOp, type NodePatch } from "./ops";

import {
  countNodes,
  DEFAULT_LIMITS,
  DEFAULT_MAX_DOCUMENT_BYTES,
  documentBytes,
  DOCUMENT_FORMAT_VERSION,
  MAX_DEPTH,
  MAX_NODES,
  updateNode,
  type BlockDocument,
  type DocumentLimits,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

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
 * A forest in the envelope `applyOp` takes.
 *
 * The op layer works on documents rather than bare forests because the byte cap
 * is a property of the DOCUMENT: a synthetic envelope omits `settings` and
 * `assets`, and a cap measured without them passes edits the engine then
 * refuses to store.
 */
function doc(nodes: BlockNode[] = forest()): BlockDocument {
  return { formatVersion: DOCUMENT_FORMAT_VERSION, kind: "page", nodes };
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
 * Apply an op, then its inverse, and hand back both.
 *
 * The inverse goes back through the SAME entry point with no exemption, which
 * is the property being exercised: an op arrives from storage, so nothing could
 * distinguish the store's own inverse from a forged one anyway. The lock rules
 * are shaped so an inverse stays applicable without needing to be told it is
 * one — an insert carrying a locked node is refused at the door precisely so
 * its remove can never be blocked later.
 */
function roundTrip(nodes: BlockNode[], op: BuilderOp) {
  const applied = applyOp(doc(nodes), op);
  const undone = applyOp(applied.document, applied.inverse);
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
    expect(serialized(applied.document.nodes)).not.toBe(serialized(before));
    expect(serialized(undone.document.nodes)).toBe(serialized(before));
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
    const undone = applyOp(applied.document, persisted);

    expect(JSON.stringify(undone.document.nodes)).toBe(JSON.stringify(before));
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
    expect(() => applyOp(doc(), op)).toThrow(OpError);
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
    expect(() => applyOp(doc(), op)).toThrow(OpError);
  });

  it("refuses to insert an id the document already holds", () => {
    // Two nodes with one id makes every later op ambiguous about which it
    // addresses, and the ambiguity surfaces as the wrong node moving.
    expect(() =>
      applyOp(doc(), { kind: "insert", node: node("b"), at: { index: 0 } })
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
    expect(() => applyOp(doc(), op)).toThrow(OpError);
  });

  // Positions the VOCABULARY no longer expresses. `OpPosition` requires a slot
  // wherever a parent is named, so these two cannot be written by a caller with
  // a compiler — which is the point of the type. They still arrive from
  // storage, where nothing checked them, so the runtime refusal is what stands
  // between a replayed history and a node placed in no region at all.
  it.each<[string, unknown]>([
    [
      "insert into a parent without naming the slot",
      {
        kind: "insert",
        node: node("new"),
        at: { parentId: "outer", index: 0 },
      },
    ],
    [
      "move into a parent without naming the slot",
      { kind: "move", id: "b", to: { parentId: "outer", index: 0 } },
    ],
  ])("refuses a persisted op that names a parent and no slot: %s", (_l, op) => {
    expect(() => applyOp(doc(), op as BuilderOp)).toThrow(OpError);
  });

  // The other half of the same rule, and the one the engine does not enforce:
  // handed a slot with no parent it ignores the slot and places the node at the
  // document root. A replayed history carrying this becomes an edit the author
  // never made, somewhere else in the document, with an inverse addressing
  // where it landed rather than where it said.
  it.each<[string, unknown]>([
    [
      "insert naming a slot with no parent",
      { kind: "insert", node: node("new"), at: { slot: "main", index: 0 } },
    ],
    [
      "move naming a slot with no parent",
      { kind: "move", id: "b", to: { slot: "main", index: 0 } },
    ],
  ])("refuses a persisted op that names a slot and no parent: %s", (_l, op) => {
    expect(() => applyOp(doc(), op as BuilderOp)).toThrow(
      /must also name the parent/
    );
  });

  it("refuses an oversized edit without serializing it first", () => {
    // The refusal has to be reachable without building the thing being refused.
    // Deciding this with `documentBytes` produces a JSON string of the whole
    // result and then a UTF-8 buffer of that string, so an op carrying a value
    // far past the cap allocates two copies of itself on the way to being
    // called too large.
    //
    // The assertion is the OpError rather than a timing: a byte counter that
    // stops early and one that does not both refuse this, and only the refusal
    // is a promise. What the bounded counter buys is that the refusal arrives
    // without the allocation, which the budget below makes observable.
    const huge = "x".repeat(12_000_000);
    const limits = { maxDepth: 10, maxNodes: 100, maxBytes: 1_000 };

    expect(() =>
      applyOp(
        doc(),
        { kind: "update", id: "a", patch: { customCss: huge } },
        limits
      )
    ).toThrow(OpError);
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
        doc(),
        persisted('{"kind":"update","id":"a","patch":{"__proto__":{"x":1}}}')
      )
    ).toThrow(OpError);
  });

  it("cannot strip a node's identity through unset", () => {
    // The inverse still addresses the old id, so a removal of `id` produces an
    // undo that cannot find what it is meant to restore.
    expect(() =>
      applyOp(
        doc(),
        persisted('{"kind":"update","id":"a","patch":{},"unset":["id"]}')
      )
    ).toThrow(OpError);
  });

  it("cannot remove a field every node must have", () => {
    // `version` and `props` are patchable but not removable: a node without
    // them is not a node, and no inverse could put one back.
    expect(() =>
      applyOp(
        doc(),
        persisted('{"kind":"update","id":"a","patch":{},"unset":["version"]}')
      )
    ).toThrow(OpError);
  });

  it("cannot say removal with a value that does not survive storage", () => {
    // `{ customCss: undefined }` removes the field when applied and then
    // serializes to `{}`, so the same op replayed after a crash does nothing.
    // Removal has a spelling that survives; this insists on it.
    expect(() =>
      applyOp(doc(), {
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
      applyOp(doc(), { kind: "update", id: "a", patch: { version: 1 } })
    ).toThrow(OpError);
  });

  it("refuses an unset of a field the node does not have", () => {
    expect(() =>
      applyOp(doc(), {
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
      expect(() => applyOp(doc(), persisted(text))).toThrow(OpError);
    }
  );

  it("refuses an update whose value only LOOKS new", () => {
    // A persisted patch is freshly parsed, so `{ props: {} }` is never the same
    // object as the node's `{}`. A reference test calls every replayed op a
    // change and the no-op guard stops guarding anything.
    expect(() =>
      applyOp(
        doc(),
        persisted('{"kind":"update","id":"a","patch":{"props":{}}}')
      )
    ).toThrow(OpError);
  });

  it("still accepts an ordinary persisted update", () => {
    // The control. Every refusal above is narrow, and a guard that rejected
    // real ops too would pass all of them while breaking the product.
    const { document } = applyOp(
      doc(),
      persisted('{"kind":"update","id":"a","patch":{"name":"Hero"}}')
    );

    expect(JSON.stringify(document.nodes)).toContain("Hero");
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
    expect(() => applyOp(doc(withLocked()), op)).toThrow(OpError);
  });

  it("cannot be inserted, because that insert could not be undone", () => {
    // The lock's own words are "move or delete", and an insert is neither — but
    // the inverse of an insert is a REMOVE, and a locked node cannot be
    // removed. Accepting the insert would put the document one edit from a
    // state its own undo could not leave, so the door is the place to refuse.
    expect(() =>
      applyOp(doc(), {
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
      applyOp(doc(), {
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
      applyOp(doc(nested), { kind: "move", id: "outer", to: { index: 1 } })
    ).toThrow(OpError);
  });

  it("cannot be deleted by deleting the container it sits in", () => {
    // Removing an unlocked container removes its whole subtree, so a check
    // reading only the addressed node honours the lock at that node and
    // defeats it one level up.
    const nested: BlockNode[] = [
      node("outer", { main: [{ ...node("b"), locked: true }] }),
    ];

    expect(() => applyOp(doc(nested), { kind: "remove", id: "outer" })).toThrow(
      OpError
    );
  });

  it("can still be restyled", () => {
    // The control, and the scope of the lock: it is against being moved and
    // deleted, not against being edited. A lock that also froze styling would
    // be a different feature, and asserting only the refusals above would not
    // notice it had become one.
    const { document } = applyOp(doc(withLocked()), {
      kind: "update",
      id: "b",
      patch: { customCss: ".x { color: red }" },
    });

    expect(JSON.stringify(document.nodes)).toContain("color: red");
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

    const applied = applyOp(doc(), {
      kind: "insert",
      node: complete,
      at: { index: 0 },
    });
    expect(applied.document.nodes[0]?.id).toBe("complete");
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
    expect(() => applyOp(doc(), persisted(json))).toThrow(OpError);
  });

  it.each<[string, string]>([
    ["a null position", '{"kind":"insert","node":null,"at":null}'],
    ["an op that is null", "null"],
  ])("refuses %s as an OpError rather than crashing", (_label, json) => {
    let thrown: unknown;
    try {
      applyOp(doc(), persisted(json));
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

  it("says a position that is not a record is not a record", () => {
    // Asserting `OpError` alone proves nothing here: a string's `.index` is
    // `undefined`, so the INDEX branch refuses it too and the test passes with
    // the container guard removed. The message is what separates which branch
    // spoke, and the container branch is the one that stops a property access
    // on a non-object.
    expect(() =>
      applyOp(doc(), persisted('{"kind":"move","id":"a","to":"end"}'))
    ).toThrow(/names nowhere/);
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
    expect(() => applyOp(doc(), persisted(json))).toThrow(/addresses no node/);
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
      applyOp(doc(), op);
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
      applyOp(doc(), { kind: "update", id: "a", patch: { classes: sparse } })
    ).toThrow(OpError);
  });

  it("still accepts an ordinary slot name and an ordinary class list", () => {
    // The control for both guards above. A check that refused every slot name,
    // or every array, would satisfy them while making the editor unusable.
    const inserted = applyOp(doc(), {
      kind: "insert",
      node: node("kid"),
      at: { parentId: "outer", slot: "main", index: 0 },
    });
    expect(inserted.document.nodes[0]?.slots?.main?.[0]?.id).toBe("kid");

    const updated = applyOp(doc(), {
      kind: "update",
      id: "a",
      patch: { classes: ["one", "two"] },
    });
    expect(updated.document.nodes).toBeDefined();
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
      applyOp(doc(), {
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
      applyOp(doc(), {
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
      applyOp(doc(), {
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

  it.each<[string, () => Record<string, unknown>]>([
    [
      "a symbol-named own property",
      () => {
        const props: Record<string, unknown> = { changed: "yes" };
        (props as Record<string | symbol, unknown>)[Symbol("lost")] = "x";
        return props;
      },
    ],
    [
      "a non-enumerable own property",
      () => {
        const props: Record<string, unknown> = { changed: "yes" };
        Object.defineProperty(props, "hidden", {
          value: "x",
          enumerable: false,
        });
        return props;
      },
    ],
  ])("refuses a patch value JSON cannot see: %s", (_label, build) => {
    // Invisible to `Object.values`, which is how the value check missed them:
    // both stay in the live document and `JSON.stringify` drops them from the
    // stored op, so a replay rebuilds a document the author never saw. Same
    // divergence as a function value, reached through the KEY rather than the
    // value.
    expect(() =>
      applyOp(doc(), {
        kind: "update",
        id: "a",
        patch: { props: build() },
      })
    ).toThrow(OpError);
  });

  it("refuses a patch carrying a symbol-named field", () => {
    // `Object.entries` reports only string keys, but the spread that applies
    // the patch copies symbols onto the node — so the field reaches the live
    // document and JSON omits it from the stored op. The patch OBJECT is now
    // held to the same key rule as the values inside it.
    const patch: Record<string, unknown> = { name: "changed" };
    (patch as Record<string | symbol, unknown>)[Symbol("lost")] = "x";
    expect(() =>
      applyOp(doc(), {
        kind: "update",
        id: "a",
        patch: patch as NodePatch,
      })
    ).toThrow(OpError);
  });

  it("refuses an array carrying a named property", () => {
    // JSON writes an array's elements and nothing else, so `list.note` stays in
    // the live document and vanishes from the stored op — the same divergence
    // as a symbol key, through the one container the key check did not cover.
    const list: string[] = ["a", "b"];
    (list as unknown as Record<string, unknown>).note = "secret";
    expect(() =>
      applyOp(doc(), {
        kind: "update",
        id: "a",
        patch: { classes: list },
      })
    ).toThrow(OpError);
  });

  it("still accepts an ordinary array and an ordinary patch", () => {
    // The control for both. A key rule that rejected every array, or every
    // patch, would satisfy the two assertions above while refusing all real
    // edits — and `length` is an own property of every array, so a rule that
    // forgot to expect it would do exactly that.
    const applied = applyOp(doc(), {
      kind: "update",
      id: "a",
      patch: { classes: ["one", "two"], name: "fine" },
    });
    expect(applied.inverse.kind).toBe("update");
  });

  it("refuses an insert that would pass the document's byte cap", () => {
    // A single large string passes the node count and still puts the document
    // past what the engine stores, with the same outcome: the edit applies,
    // enters history, and every save afterwards is refused.
    const heavy = node("heavy");
    heavy.props = { text: "x".repeat(DEFAULT_MAX_DOCUMENT_BYTES) };
    expect(() =>
      applyOp(doc(), { kind: "insert", node: heavy, at: { index: 0 } })
    ).toThrow(OpError);
  });

  it("refuses an insert that would pass the document's node cap", () => {
    // `insertNode` places whatever it is handed, so without this the edit
    // enters history and the engine's validator then refuses every save.
    const wide = node("wide");
    wide.slots = {
      main: Array.from({ length: MAX_NODES }, (_unused, index) =>
        node(`bulk-${String(index)}`)
      ),
    };
    expect(() =>
      applyOp(doc(), { kind: "insert", node: wide, at: { index: 0 } })
    ).toThrow(OpError);
  });

  it("still accepts an insert that fits", () => {
    // The control. A cap computed wrongly — counting the whole forest twice,
    // say — would refuse ordinary inserts while satisfying the test above.
    const applied = applyOp(doc(), {
      kind: "insert",
      node: node("modest"),
      at: { index: 0 },
    });
    expect(applied.document.nodes[0]?.id).toBe("modest");
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
      applyOp(doc(), { kind: "insert", node: parent, at: { index: 0 } })
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
      applyOp(doc(), { kind: "insert", node: deep, at: { index: 0 } });
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
    const applied = applyOp(doc(), {
      kind: "insert",
      node: deep,
      at: { index: 0 },
    });
    expect(applied.document.nodes[0]?.id).toBe(`deep-${MAX_DEPTH - 1}`);
  });

  it("refuses a hole in an inserted slot array", () => {
    // `forEach` skips holes, so a sparse child list would be walked as though
    // the missing entries were not there. They serialize as `null`, and a
    // `null` in a child list is not a node.
    const parent = node("holder");
    parent.slots = { main: Array<BlockNode>(1) };
    expect(() =>
      applyOp(doc(), { kind: "insert", node: parent, at: { index: 0 } })
    ).toThrow(OpError);
  });

  it("refuses a subtree that contains itself", () => {
    // JSON cannot express this, but an in-process caller can, and the walk
    // would not return.
    const cyclic = node("loop");
    cyclic.slots = { main: [cyclic] };
    expect(() =>
      applyOp(doc(), { kind: "insert", node: cyclic, at: { index: 0 } })
    ).toThrow(OpError);
  });
});

describe("an edit measured against what it would actually produce", () => {
  it("refuses an update that would pass the document's byte cap", () => {
    // The count-based caps cannot see this: an update changes no node count,
    // and one large string in `props` is a document the engine refuses to
    // store. Without the check the edit applies, enters history, and every
    // save afterwards fails on a document the author cannot repair by undoing.
    expect(() =>
      applyOp(doc(), {
        kind: "update",
        id: "a",
        patch: { props: { text: "x".repeat(DEFAULT_MAX_DOCUMENT_BYTES) } },
      })
    ).toThrow(OpError);
  });

  it("refuses an insert whose SLOT carries the result past the byte cap", () => {
    // A slot name is unbounded and is stored as a key, so a subtree that fits
    // as a root can fail to fit where it is actually placed.
    const slot = "s".repeat(8192);
    const base = forest();
    const incoming = node("heavy");
    const asRoots = (text: string): number =>
      documentBytes({
        formatVersion: DOCUMENT_FORMAT_VERSION,
        kind: "page",
        nodes: [...base, { ...incoming, props: { text } }],
      });
    // Sized so the subtree fits comfortably as a root and only its placement
    // crosses the cap, which is the whole separating property.
    const slack = DEFAULT_MAX_DOCUMENT_BYTES - asRoots("") - 4096;
    const text = "x".repeat(slack);
    incoming.props = { text };

    // Precondition, not decoration. If the payload were simply oversized this
    // would throw for the ordinary reason and pass whether or not placement is
    // measured, which is a test that cannot fail for its stated cause.
    expect(
      asRoots(text),
      "the subtree must fit as a root, or this tests the wrong thing"
    ).toBeLessThanOrEqual(DEFAULT_MAX_DOCUMENT_BYTES);

    expect(() =>
      applyOp(doc(base), {
        kind: "insert",
        node: incoming,
        at: { parentId: "outer", slot, index: 0 },
      })
    ).toThrow(OpError);
  });
});

describe("a value that computes itself", () => {
  /** A record whose one key runs code instead of holding a value. */
  function withAccessor(get: () => unknown): Record<string, unknown> {
    const held: Record<string, unknown> = {};
    Object.defineProperty(held, "text", { get, enumerable: true });
    return held;
  }

  it("refuses a patch whose value is an accessor", () => {
    // What JSON writes is whatever the getter returned at serialization time,
    // so the accessor stays in the live document and comes back from storage as
    // a plain data property. The document and its own persisted form disagree
    // about what that key even is, and nothing reports it.
    expect(() =>
      applyOp(doc(), {
        kind: "update",
        id: "a",
        patch: { props: withAccessor(() => "computed") },
      })
    ).toThrow(OpError);
  });

  it("refuses an accessor without running it", () => {
    // The separating property: a getter that throws must not be the thing that
    // rejects the op. Reading it would leave this module as a RangeError, which
    // a caller cannot tell from the editor having a bug — the refusal has to
    // come from the shape check, before any caller code runs.
    let reads = 0;
    const patch = {
      props: withAccessor(() => {
        reads += 1;
        throw new RangeError("the getter ran");
      }),
    };

    expect(() => applyOp(doc(), { kind: "update", id: "a", patch })).toThrow(
      OpError
    );
    expect(reads, "the getter must never be invoked").toBe(0);
  });

  it("refuses an accessor sitting at an array index", () => {
    // The same hole through the other container. An array is walked by
    // position, so an accessor at index 0 is read exactly like a value.
    const classes: unknown[] = [];
    Object.defineProperty(classes, "0", { get: () => "x", enumerable: true });

    expect(() =>
      applyOp(doc(), {
        kind: "update",
        id: "a",
        patch: { props: { classes } },
      })
    ).toThrow(OpError);
  });
});

describe("the document envelope an edit is measured inside", () => {
  /** A document carrying enough media ids to sit just under the byte cap. */
  function heavyEnvelope(): BlockDocument {
    const base = doc();
    const spare = DEFAULT_MAX_DOCUMENT_BYTES - documentBytes(base) - 2048;
    const id = "m".repeat(64);
    return {
      ...base,
      assets: { mediaIds: Array(Math.floor(spare / 68)).fill(id) },
    };
  }

  it("counts assets and settings toward the byte cap", () => {
    const heavy = heavyEnvelope();
    // Sized against the space the ENVELOPE leaves, so the result is over the
    // cap by construction rather than by a guess about encoding overhead.
    const remaining = DEFAULT_MAX_DOCUMENT_BYTES - documentBytes(heavy);
    const filler = node("filler");
    filler.props = { text: "x".repeat(remaining + 1024) };
    const insert: BuilderOp = {
      kind: "insert",
      node: filler,
      at: { index: 0 },
    };

    expect(() => applyOp(heavy, insert)).toThrow(OpError);

    // The separating property, stated as a comparison rather than as a size.
    // The SAME insert into the SAME forest without that envelope is accepted,
    // so what refuses it is the envelope and nothing else — which is exactly
    // what a cap measured on a synthesized `{ nodes }` document cannot see.
    expect(() => applyOp(doc(), insert)).not.toThrow();
  });

  it("carries settings and assets through an edit", () => {
    // An envelope rebuilt field by field drops whatever it was not taught
    // about, and the loss is invisible until something reads the missing field.
    const withAssets: BlockDocument = {
      ...doc(),
      assets: { mediaIds: ["kept-through-the-edit"] },
    };
    const applied = applyOp(withAssets, {
      kind: "update",
      id: "a",
      patch: { name: "Hero" },
    });

    expect(applied.document.assets).toEqual({
      mediaIds: ["kept-through-the-edit"],
    });
    expect(applied.document.kind).toBe(withAssets.kind);
    expect(applied.document.formatVersion).toBe(withAssets.formatVersion);
  });

  it("refuses a value that is not a document", () => {
    // An op arrives beside a document from storage, so neither is more
    // trustworthy than the other.
    expect(() =>
      applyOp({ formatVersion: 1, kind: "page" } as unknown as BlockDocument, {
        kind: "remove",
        id: "a",
      })
    ).toThrow(/holds no forest/);
  });
});

describe("a value read before it is known to be data", () => {
  it("refuses an accessor inside a shallow-checked field without running it", () => {
    // `isStringArray` enumerates what it is handed, so ordering is the fix: the
    // JSON domain has to be established before any shape predicate reads the
    // value, or a throwing getter leaves this module as a RangeError.
    let reads = 0;
    const classes: string[] = [];
    Object.defineProperty(classes, "0", {
      get: (): string => {
        reads += 1;
        throw new RangeError("the getter ran");
      },
      enumerable: true,
    });

    expect(() =>
      applyOp(doc(), { kind: "update", id: "a", patch: { classes } })
    ).toThrow(OpError);
    expect(reads, "the getter must never be invoked").toBe(0);
  });

  it("refuses an accessor inside attributes without running it", () => {
    // The record-shaped counterpart, through `isStringRecord`.
    let reads = 0;
    const attributes: Record<string, string> = {};
    Object.defineProperty(attributes, "title", {
      get: (): string => {
        reads += 1;
        return "computed";
      },
      enumerable: true,
    });

    expect(() =>
      applyOp(doc(), { kind: "update", id: "a", patch: { attributes } })
    ).toThrow(OpError);
    expect(reads, "the getter must never be invoked").toBe(0);
  });

  it("refuses negative zero, which JSON replays as positive zero", () => {
    expect(() =>
      applyOp(doc(), {
        kind: "update",
        id: "a",
        patch: { props: { offset: -0 } },
      })
    ).toThrow(OpError);
    // The separating property: positive zero is ordinary data and stays
    // accepted, so this is not a blanket refusal of zero.
    expect(() =>
      applyOp(doc(), {
        kind: "update",
        id: "a",
        patch: { props: { offset: 0 } },
      })
    ).not.toThrow();
  });

  it("refuses a numeric key past the largest array index", () => {
    // `length` stays 0, so the key is an ordinary property JSON writes nowhere:
    // the live document keeps it and replay drops it.
    const list: unknown[] = [];
    Object.defineProperty(list, "4294967295", {
      value: "lost",
      enumerable: true,
      writable: true,
      configurable: true,
    });
    expect(list.length, "the fixture must not become a real index").toBe(0);

    expect(() =>
      applyOp(doc(), {
        kind: "update",
        id: "a",
        patch: { props: { list } },
      })
    ).toThrow(OpError);
  });
});

describe("the limits an edit is judged against", () => {
  it("honours a site's configured caps rather than the defaults", () => {
    // The engine validates with `ctx.limits ?? DEFAULT_LIMITS`, so a site that
    // renders with custom limits gets a different verdict from a hardcoded one.
    // Both directions are wrong: a stricter default refuses an edit the site's
    // validator accepts, and a looser one admits an edit it then refuses.
    const tall: DocumentLimits = { ...DEFAULT_LIMITS, maxNodes: 3 };
    const extra = node("one-too-many");

    expect(() =>
      applyOp(doc(), { kind: "insert", node: extra, at: { index: 0 } }, tall)
    ).toThrow(/past the 3 a document may hold/);

    // The separating property: the SAME edit under the defaults is accepted, so
    // what refuses it is the configured limit and not the edit.
    expect(() =>
      applyOp(doc(), { kind: "insert", node: extra, at: { index: 0 } })
    ).not.toThrow();
  });

  it("judges depth by the configured limit too", () => {
    const shallow: DocumentLimits = { ...DEFAULT_LIMITS, maxDepth: 1 };
    const parent = node("parent", { main: [node("child")] });

    expect(() =>
      applyOp(
        doc(),
        { kind: "insert", node: parent, at: { index: 0 } },
        shallow
      )
    ).toThrow(/nested deeper than 1 levels/);
  });
});

describe("a node container JSON cannot write whole", () => {
  it("refuses a node whose required field is non-enumerable", () => {
    // The loop reads it and accepts the node, then `JSON.stringify` omits it:
    // the live document holds a node the stored one does not, and replay
    // rebuilds something malformed with no error anywhere.
    const hidden = node("hidden");
    Object.defineProperty(hidden, "props", {
      value: {},
      enumerable: false,
      writable: true,
      configurable: true,
    });
    expect(
      JSON.stringify(hidden),
      "the fixture must actually lose the field, or this tests nothing"
    ).not.toContain("props");

    expect(() =>
      applyOp(doc(), { kind: "insert", node: hidden, at: { index: 0 } })
    ).toThrow(OpError);
  });

  it("refuses an unset entry that computes itself", () => {
    // `isStringArray` enumerates, so an accessor here ran during validation.
    //
    // Typed as untrusted rather than as the vocabulary: `unset` names only the
    // fields an update may remove, and no caller with a compiler could write an
    // array of accessors into it. This op is the shape that arrives from
    // `JSON.parse` — a crash buffer, a queued agent edit, a replayed history —
    // which is the only way such a value reaches `applyOp` at all.
    let reads = 0;
    const unset: string[] = [];
    Object.defineProperty(unset, "0", {
      get: (): string => {
        reads += 1;
        throw new RangeError("the getter ran");
      },
      enumerable: true,
    });

    const persisted = {
      kind: "update",
      id: "a",
      patch: { name: "x" },
      unset,
    } as unknown as BuilderOp;

    expect(() => applyOp(doc(), persisted)).toThrow(OpError);
    expect(reads, "the getter must never be invoked").toBe(0);
  });
});

describe("an id the document holds twice", () => {
  /** A forest carrying the same id at the top level and inside a slot. */
  function duplicated(): BlockNode[] {
    return [
      node("outer", { main: [node("dupe"), node("keep")] }),
      node("dupe"),
    ];
  }

  it("refuses a remove that would delete more than its inverse restores", () => {
    // `removeNode` filters EVERY match, while the inverse captures one node and
    // one location — so the second subtree is deleted and the undo cannot bring
    // it back. Verified below rather than argued.
    const before = applyOp(doc(duplicated()), { kind: "remove", id: "keep" });
    expect(
      countNodes(before.document.nodes),
      "the fixture must be a working document apart from the duplicate"
    ).toBe(3);

    expect(() =>
      applyOp(doc(duplicated()), { kind: "remove", id: "dupe" })
    ).toThrow(/addresses 2 nodes/);
  });

  it("refuses a move for the same reason", () => {
    // `move` delegates through the same filter, so it destroys the duplicate
    // exactly as `remove` does.
    expect(() =>
      applyOp(doc(duplicated()), {
        kind: "move",
        id: "dupe",
        to: { parentId: "outer", slot: "main", index: 0 },
      })
    ).toThrow(/addresses 2 nodes/);
  });

  it("still accepts an id the document holds once", () => {
    // The separating property. A guard that refused every remove would satisfy
    // both assertions above while breaking the editor.
    expect(() =>
      applyOp(doc(duplicated()), { kind: "remove", id: "keep" })
    ).not.toThrow();
  });
});

describe("a duplicate id reached through update", () => {
  it("refuses an update whose inverse cannot restore both nodes", () => {
    // `updateNode` patches every match while `priorValues` records the first,
    // so the undo writes one node's values onto both and the other's are lost.
    const forest: BlockNode[] = [
      { ...node("dupe"), name: "first" },
      { ...node("dupe"), name: "second" },
    ];
    expect(() =>
      applyOp(doc(forest), { kind: "update", id: "dupe", patch: { name: "x" } })
    ).toThrow(/addresses 2 nodes/);
  });
});

describe("containers JSON cannot carry whole", () => {
  it("refuses an op whose kind is non-enumerable", () => {
    // The switch reads `kind` and applies the op, then persistence drops the
    // key: the stored op replays as nothing at all.
    const op = { id: "a", patch: { name: "x" } };
    Object.defineProperty(op, "kind", { value: "update", enumerable: false });
    expect(JSON.stringify(op)).not.toContain("update");

    expect(() => applyOp(doc(), op as unknown as BuilderOp)).toThrow(OpError);
  });

  it("refuses a position whose index is non-enumerable", () => {
    // Applied here with the index honoured, stored without it, so replay places
    // the node somewhere else or refuses the op outright.
    const at = { parentId: "outer", slot: "main" };
    Object.defineProperty(at, "index", { value: 0, enumerable: false });

    expect(() =>
      applyOp(doc(), {
        kind: "insert",
        node: node("fresh"),
        at: at as unknown as { parentId: string; slot: string; index: number },
      })
    ).toThrow(/JSON can carry/);
  });

  it("refuses a forest holding something that is not a node", () => {
    // Without this the entry reaches helpers that read `.id` off it, and the
    // failure arrives as a TypeError from inside the engine rather than as a
    // refusal naming the malformed document.
    const forest = [node("a"), null] as unknown as BlockNode[];
    expect(() => applyOp(doc(forest), { kind: "remove", id: "a" })).toThrow(
      /is malformed/
    );
  });

  it("refuses an insert under a parent id the document holds twice", () => {
    // `insertNode` places the incoming node beneath EVERY matching parent,
    // minting duplicate ids the inverse cannot unpick — the destination side of
    // the identity defect the addressed id already refuses.
    const twins: BlockNode[] = [
      node("twin", { main: [] }),
      node("twin", { main: [] }),
    ];
    expect(() =>
      applyOp(doc(twins), {
        kind: "insert",
        node: node("fresh"),
        at: { parentId: "twin", slot: "main", index: 0 },
      })
    ).toThrow(/addresses 2 nodes/);
  });
});

describe("a document already past its limits", () => {
  it("still allows an edit to a document that is already over", () => {
    // A site that lowers its caps leaves existing documents over them. A check
    // reading only the RESULT refuses every edit to such a document, so the
    // author is locked out of the surface that could repair it.
    //
    // `update` is the case that separates the two rules: it leaves the node
    // count untouched, so the document stays over the cap without the edit
    // having made it worse. A `remove` would pass either way — the remove
    // branch does not measure caps at all — and would prove nothing.
    const tight: DocumentLimits = { ...DEFAULT_LIMITS, maxNodes: 1 };
    const over = doc([node("a"), node("b")]);

    const applied = applyOp(
      over,
      { kind: "update", id: "a", patch: { name: "repaired" } },
      tight
    );
    expect(countNodes(applied.document.nodes)).toBe(2);
  });

  it("still refuses an edit that makes the overage worse", () => {
    // The separating property. Allowing shrinkage must not become allowing
    // anything: a document over its cap may be repaired, not grown.
    const tight: DocumentLimits = { ...DEFAULT_LIMITS, maxNodes: 1 };
    const over = doc([node("a"), node("b")]);

    expect(() =>
      applyOp(
        over,
        { kind: "insert", node: node("c"), at: { index: 0 } },
        tight
      )
    ).toThrow(OpError);
  });
});

describe("what the boundary checks before editing at all", () => {
  it("refuses a document written in a newer format", () => {
    // A newer version may carry fields whose meaning this code does not have,
    // and editing with current semantics silently rewrites them. An editor that
    // cannot read a document should say so rather than save over it.
    const future: BlockDocument = {
      ...doc(),
      formatVersion: (DOCUMENT_FORMAT_VERSION + 1) as never,
    };
    expect(() => applyOp(future, { kind: "remove", id: "a" })).toThrow(
      /cannot be edited by this version/
    );
  });

  it("refuses a malformed node nested inside a slot", () => {
    // A top-level-only pass leaves this: a valid root whose slot holds a null,
    // which reaches helpers reading `.id` off it.
    const rotten = [node("outer", { main: [null as unknown as BlockNode] })];
    expect(() => applyOp(doc(rotten), { kind: "remove", id: "outer" })).toThrow(
      /at every depth/
    );
  });

  it("refuses a placement that would nest the result too deep", () => {
    // Depth checked on the RESULT, not only the incoming subtree: a shallow
    // subtree dropped into a deep slot produces a forest deeper than either.
    // The incoming subtree is 2 deep and the fixture is 2 deep, so neither
    // breaches the cap alone — only the PLACEMENT does, which is the whole
    // point. Inserting a childless node here would sit at the existing depth
    // and be correctly allowed.
    const shallow: DocumentLimits = { ...DEFAULT_LIMITS, maxDepth: 2 };
    expect(() =>
      applyOp(
        doc(),
        {
          kind: "insert",
          node: node("fresh", { main: [node("deeper")] }),
          at: { parentId: "outer", slot: "main", index: 0 },
        },
        shallow
      )
    ).toThrow(/levels deep/);
  });
});

describe("a guard that must not crash on the input it refuses", () => {
  it("refuses a deeply nested value without exhausting the stack", () => {
    // A recursive walk leaked a native RangeError here, so the document broke
    // the guard that exists to refuse it and the byte cap never ran.
    let deep: Record<string, unknown> = {};
    const root = deep;
    for (let level = 0; level < 15_000; level += 1) {
      const next: Record<string, unknown> = {};
      deep.child = next;
      deep = next;
    }

    let thrown: unknown;
    try {
      applyOp(doc(), { kind: "update", id: "a", patch: { props: root } });
    } catch (error) {
      thrown = error;
    }
    // The op may be accepted or refused — what must NOT happen is a native
    // stack overflow escaping instead of an OpError.
    expect(thrown).not.toBeInstanceOf(RangeError);
  });

  it("refuses a very wide slot without exceeding the call-argument limit", () => {
    // `push(...children)` passes each child as a call ARGUMENT, and V8 caps
    // those — so a wide enough slot threw before the walk could refuse it.
    const wide = node("wide", {
      main: Array.from({ length: 150_000 }, (_unused, index) =>
        node(`w-${String(index)}`)
      ),
    });

    let thrown: unknown;
    try {
      applyOp(doc([wide]), { kind: "remove", id: "wide" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).not.toBeInstanceOf(RangeError);
  });

  it("counts a very wide slot without exceeding the call-argument limit", () => {
    // An UPDATE, because a remove never reaches the cap check: only an edit
    // that could make the document larger is measured against the node and byte
    // caps, and the counter is where the remaining spread was. A remove walks
    // the forest and stops, so the case above leaves this path untouched.
    const wide = node("wide", {
      main: Array.from({ length: 150_000 }, (_unused, index) =>
        node(`w-${String(index)}`)
      ),
    });

    let thrown: unknown;
    try {
      applyOp(doc([wide]), {
        kind: "update",
        id: "wide",
        patch: { name: "renamed" },
      });
    } catch (error) {
      thrown = error;
    }
    // Refused or applied, either is a legitimate answer to a document this
    // large. A native RangeError is not: it means the count that decides which
    // one broke before it could decide.
    expect(thrown).not.toBeInstanceOf(RangeError);
  });
});

describe("the document's own identity fields", () => {
  it("refuses a document whose kind is not one the engine knows", () => {
    // Accepted by every structural check and then refused by `validate()` with
    // `invalid-kind`, so the edit enters history and every save afterwards
    // fails on a document the author cannot repair by undoing.
    const odd = { ...doc(), kind: "not-a-kind" } as unknown as BlockDocument;
    expect(() => applyOp(odd, { kind: "remove", id: "a" })).toThrow(
      /is not one this editor knows/
    );
  });

  it("refuses a document too deep to walk, by name rather than by crashing", () => {
    // The machine cap, on the document rather than on an incoming subtree. Past
    // it the engine's recursive helpers exhaust the call stack, so the refusal
    // has to come from the guard: a native RangeError names no document and
    // tells the author nothing about which edit to try instead.
    //
    // This is the case the uniqueness scan used to be tested through, which it
    // could not be. `assertWalkable` rejects a document this deep before any
    // scan runs, so no input the uniqueness check can ever see is deep enough
    // to overflow a recursive one, and the assertion passed whichever
    // implementation was underneath. Uniqueness has its own cases below, on
    // documents that actually hold a duplicate.
    let leaf = node("deep-0");
    const root = leaf;
    for (let level = 1; level < 15_000; level += 1) {
      const next = node(`deep-${String(level)}`);
      leaf.slots = { main: [next] };
      leaf = next;
    }

    let thrown: unknown;
    try {
      applyOp(doc([root]), { kind: "remove", id: "deep-0" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(OpError);
    expect((thrown as OpError).message).toMatch(/levels deep and cannot be/);
  });

  it("refuses a document whose kind a spread would drop", () => {
    // A non-enumerable `kind` is READ by every check here and copied by none of
    // them: `withNodes` builds the result by spreading, and a spread takes
    // enumerable own properties only. So the document passes validation and the
    // one it returns has no kind at all — recorded in history, and refused by
    // the next read of a field nothing downstream is watching for.
    const hidden = doc();
    Object.defineProperty(hidden, "kind", {
      value: hidden.kind,
      enumerable: false,
      configurable: true,
      writable: true,
    });
    expect(
      JSON.stringify(hidden),
      "the fixture must actually lose the field, or this tests nothing"
    ).not.toContain("kind");

    expect(() => applyOp(hidden, { kind: "remove", id: "a" })).toThrow(OpError);
  });

  it("refuses a document carrying a value JSON cannot write", () => {
    // Keys and descriptors say a field is HELD rather than computed; they say
    // nothing about what is held. Without a value check this document is
    // accepted, and `documentBytes` then leaks a native TypeError from inside
    // an insert, a move or an update — while a remove, which never measures
    // bytes, succeeds and returns a document that cannot be saved at all.
    const carrying = { ...doc(), metadata: 1n } as unknown as BlockDocument;

    expect(() => applyOp(carrying, { kind: "remove", id: "a" })).toThrow(
      OpError
    );
    // The remove specifically, because it is the one that used to SUCCEED. An
    // insert or an update fails either way, so a case built on one of those
    // passes without the check and proves nothing.
    expect(() => applyOp(carrying, { kind: "remove", id: "a" })).toThrow(
      /JSON cannot write that value/
    );
  });

  it("refuses a document whose format version is computed", () => {
    // An accessor runs code to answer, so a guard that reads it is executing
    // the document's own getter while deciding whether to trust the document.
    const computed = doc();
    Object.defineProperty(computed, "formatVersion", {
      get: () => DOCUMENT_FORMAT_VERSION,
      enumerable: true,
      configurable: true,
    });

    expect(() => applyOp(computed, { kind: "remove", id: "a" })).toThrow(
      OpError
    );
  });

  it("refuses a document that holds a node inside its own slots", () => {
    // A forest is a tree by intent, not by construction. An in-process document
    // can be handed in with a node placed inside itself, and a walk with no
    // memory of where it has been pops and re-enqueues that node forever — a
    // synchronous hang, with no error and no way for the caller to recover,
    // where the contract promises an OpError.
    const self = node("ouroboros");
    self.slots = { main: [self] };

    expect(() => applyOp(doc([self]), { kind: "remove", id: "a" })).toThrow(
      /nodes contain themselves/
    );
  });
});

describe("an inverse that names a parent held twice", () => {
  it("refuses a remove whose ORIGINAL parent is duplicated", () => {
    // The removed node is unique; its parent is not. The inverse restores by
    // naming that parent, so an undo would place the node under whichever
    // match is found first rather than where it came from.
    const twins: BlockNode[] = [
      node("twin", { main: [node("only-child")] }),
      node("twin", { main: [] }),
    ];
    expect(() =>
      applyOp(doc(twins), { kind: "remove", id: "only-child" })
    ).toThrow(/addresses 2 nodes/);
  });

  it("refuses an insert whose subtree is deeper than the helpers can walk", () => {
    // The machine cap covered the existing document but not the INCOMING
    // subtree, so a caller raising limits.maxDepth could hand in a tree the
    // engine's recursive helpers cannot walk and the overflow landed after the
    // document had been checked.
    let leaf = node("in-0");
    const root = leaf;
    for (let level = 1; level < 1_200; level += 1) {
      const next = node(`in-${String(level)}`);
      leaf.slots = { main: [next] };
      leaf = next;
    }
    const deep: DocumentLimits = { ...DEFAULT_LIMITS, maxDepth: 100_000 };

    expect(() =>
      applyOp(doc(), { kind: "insert", node: root, at: { index: 0 } }, deep)
    ).toThrow(/cannot be edited/);
  });
});
