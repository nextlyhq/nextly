/**
 * A node's own fields are written in one order, so an inverse restores the
 * DOCUMENT rather than only its values.
 *
 * A document is compared, stored and hashed as JSON, where key order is part of
 * the bytes. An inverse that restores every value at a different key position
 * has produced a different document, and the round-trip promise `applyOp` makes
 * is about the document.
 *
 * These are examples; `ops.property.test.ts` is where the same property is
 * asserted over generated input. Both exist because the generator's nodes carry
 * no optional fields today, so nothing it produces can reach this mechanism —
 * a fixture that never reaches the mechanism passes for the wrong reason.
 */
import { DOCUMENT_FORMAT_VERSION } from "@nextlyhq/blocks-engine";
import type { BlockDocument, BlockNode } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { applyOp, type BuilderOp } from "./ops";

function doc(nodes: BlockNode[]): BlockDocument {
  return { formatVersion: DOCUMENT_FORMAT_VERSION, kind: "page", nodes };
}

/** The key sequence of the single root node, which is what these tests are about. */
function rootKeys(document: BlockDocument): string[] {
  const [first] = document.nodes;
  if (first === undefined) throw new Error("fixture has no root node");
  return Object.keys(first);
}

describe("a node's own fields are written in the declared order", () => {
  it("restores an unset field to its original position, not to the end", () => {
    // `locked` precedes `name` in the node's declared shape, so this fixture is
    // already canonical and the ONLY thing that can disturb the sequence is the
    // op. Unsetting the LAST field would round trip on a broken implementation
    // too, because appending it lands where it started.
    const before = doc([
      {
        id: "a",
        type: "core/box",
        version: 1,
        props: {},
        locked: true,
        name: "hello",
      },
    ]);
    const op: BuilderOp = {
      kind: "update",
      id: "a",
      patch: {},
      unset: ["locked"],
    };

    const applied = applyOp(before, op);
    const undone = applyOp(applied.document, applied.inverse);

    expect(rootKeys(undone.document)).toEqual(rootKeys(before));
    // The document, not the values. Restoring every value at a different key
    // position is what this exists to catch, and only a whole-document
    // comparison sees it.
    expect(JSON.stringify(undone.document)).toBe(JSON.stringify(before));
  });

  it("writes a node's fields in declared order even when the input is not", () => {
    // Author input arrives in whatever order it was written in. The first edit
    // normalises the node it touches, which is the stated cost of ordering by
    // declaration rather than recording each original sequence on its inverse.
    const before = doc([
      {
        id: "a",
        type: "core/box",
        version: 1,
        props: {},
        name: "hello",
        locked: true,
      },
    ]);

    const applied = applyOp(before, {
      kind: "update",
      id: "a",
      patch: { name: "renamed" },
    });

    expect(rootKeys(applied.document)).toEqual([
      "id",
      "type",
      "version",
      "props",
      "locked",
      "name",
    ]);
  });

  it("appends a field the declared shape does not know, keeping its order", () => {
    // A document written by a NEWER editor carries fields this one has never
    // heard of. Dropping them would silently discard an author's work on the
    // first edit made in an older tab; ordering them ahead of the known fields
    // would let a future field name decide where `id` goes.
    const forward = {
      id: "a",
      type: "core/box",
      version: 1,
      props: {},
      locked: true,
      futureOne: 1,
      futureTwo: 2,
    } as unknown as BlockNode;

    const applied = applyOp(doc([forward]), {
      kind: "update",
      id: "a",
      patch: { name: "renamed" },
    });

    expect(rootKeys(applied.document)).toEqual([
      "id",
      "type",
      "version",
      "props",
      "locked",
      "name",
      "futureOne",
      "futureTwo",
    ]);
  });

  it("keeps a field named __proto__ as an own property", () => {
    // Plain assignment to `__proto__` sets the prototype instead of creating an
    // own property, so a forward-compatible field with that name would vanish
    // from what is stored while every check upstream still saw it.
    //
    // This one separates on a DIFFERENT break from the cases above: removing
    // the canonicalisation call leaves it green, because an untouched node is
    // never rebuilt. Verified against the break it does detect — replacing
    // `defineProperty` with `out[field] = ...` fails it and nothing else.
    const hostile = {
      id: "a",
      type: "core/box",
      version: 1,
      props: {},
      locked: true,
    } as unknown as BlockNode;
    Object.defineProperty(hostile, "__proto__", {
      value: "carried",
      writable: true,
      enumerable: true,
      configurable: true,
    });

    const applied = applyOp(doc([hostile]), {
      kind: "update",
      id: "a",
      patch: { name: "renamed" },
    });

    const [root] = applied.document.nodes;
    if (root === undefined) throw new Error("the update dropped the node");
    expect(Object.hasOwn(root, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(root)).toBe(Object.prototype);
  });

  it("leaves the order INSIDE props alone", () => {
    // `props` is author data and its key order is observable through
    // `Object.entries`, so canonicalising it would rewrite content rather than
    // structure.
    //
    // Stated plainly because it matters to whoever reads this next: this case
    // passes with AND without the canonicalisation, so it is not coverage of
    // the current implementation. It guards the boundary of the change — a
    // later attempt to sort props, which is the obvious next step for someone
    // who reads "canonical order" and applies it one level deeper.
    const before = doc([
      {
        id: "a",
        type: "core/box",
        version: 1,
        props: { zebra: 1, apple: 2 },
      },
    ]);

    const applied = applyOp(before, {
      kind: "update",
      id: "a",
      patch: { name: "renamed" },
    });

    const [root] = applied.document.nodes;
    if (root === undefined) throw new Error("the update dropped the node");
    expect(Object.keys(root.props)).toEqual(["zebra", "apple"]);
  });
});
