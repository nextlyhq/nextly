/**
 * Provenance on a copied subtree.
 *
 * The field is INERT — nothing renders it and no document needs one — so the
 * tests here are about the two things that can still go wrong with an inert
 * field: that the op layer carries it faithfully, and that it refuses a
 * half-formed one rather than storing a record a later reader would trust.
 */
import { describe, expect, it } from "vitest";

import type { BlockDocument, BlockNode, BlockOrigin } from "./document";
import { applyOps } from "./ops";

const page = (nodes: BlockNode[]): BlockDocument => ({
  formatVersion: 1,
  kind: "page",
  nodes,
});

const node = (id: string, origin?: BlockOrigin): BlockNode => ({
  id,
  type: "core/box",
  version: 1,
  props: {},
  ...(origin === undefined ? {} : { origin }),
});

const fromPattern: BlockOrigin = {
  from: "pattern",
  id: "hero-pattern",
  digest: "abc123",
};

describe("a provenance record survives the op layer", () => {
  it("is carried through an insert", () => {
    const applied = applyOps(page([]), [
      { kind: "insert", node: node("a", fromPattern), at: { index: 0 } },
    ]);

    expect(applied.document.nodes[0]!.origin).toEqual(fromPattern);
  });

  it("carries the component arm, which has no digest", () => {
    const detached: BlockOrigin = { from: "component", id: "hero-component" };

    const applied = applyOps(page([]), [
      { kind: "insert", node: node("a", detached), at: { index: 0 } },
    ]);

    expect(applied.document.nodes[0]!.origin).toEqual(detached);
  });

  it("can be REMOVED by an update, so severing a link is an ordinary edit", () => {
    // Patchable rather than sealed. A field an update can never address is one
    // that can only be removed by deleting the node it sits on.
    const applied = applyOps(page([node("a", fromPattern)]), [
      { kind: "update", id: "a", patch: {}, unset: ["origin"] },
    ]);

    expect(applied.document.nodes[0]!.origin).toBeUndefined();
  });
});

describe("a half-formed record is refused, not stored", () => {
  const refuse = (origin: unknown): (() => unknown) => {
    const bad = {
      id: "a",
      type: "core/box",
      version: 1,
      props: {},
      origin,
    } as unknown as BlockNode;
    return () =>
      applyOps(page([]), [{ kind: "insert", node: bad, at: { index: 0 } }]);
  };

  it("refuses a pattern origin with no digest", () => {
    // The digest is the whole point of the pattern arm: without it the record
    // cannot answer whether the upstream moved, which is what it exists for.
    expect(refuse({ from: "pattern", id: "hero" })).toThrow();
  });

  it("refuses an empty id", () => {
    expect(refuse({ from: "pattern", id: "", digest: "abc" })).toThrow();
  });

  it("refuses a source nobody declared", () => {
    expect(refuse({ from: "somewhere-else", id: "hero" })).toThrow();
  });

  it("refuses a record that is not one", () => {
    expect(refuse("hero-pattern")).toThrow();
  });

  it("ACCEPTS the shapes that are whole", () => {
    // The control: the refusals above must be about the malformation and not
    // about the field being rejected outright.
    expect(
      refuse({ from: "pattern", id: "hero", digest: "abc" })
    ).not.toThrow();
    expect(refuse({ from: "component", id: "hero" })).not.toThrow();
  });
});
