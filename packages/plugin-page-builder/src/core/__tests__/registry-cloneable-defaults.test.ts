/**
 * A definition's defaults must be copyable, and registration is where that is decided.
 *
 * Every instance is built by cloning them, so a value `structuredClone` refuses does not fail at
 * registration — it fails later, inside `createNode`, as a `DataCloneError` raised while an author
 * was inserting a block or taking a repair. That error names neither the block nor the prop, and
 * it surfaces a long way from the definition that caused it.
 */
import { describe, expect, it } from "vitest";

import { createBlockRegistry, createNode } from "../registry";
import type { BlockDefinition } from "../types";

const base = {
  version: 1,
  label: "Thing",
  icon: "square",
  category: "basic" as const,
  render: () => null,
};

const defWith = (extra: Partial<BlockDefinition>): BlockDefinition =>
  ({
    ...base,
    type: "acme/thing",
    defaultProps: {},
    ...extra,
  }) as BlockDefinition;

describe("defaults a block instance is cloned from", () => {
  it("are accepted when they hold JSON-like data", () => {
    // The positive control. Without it a gate refusing everything would satisfy the rejections
    // below while making the field unusable.
    const registry = createBlockRegistry();
    expect(() =>
      registry.register(
        defWith({ defaultProps: { text: "hi", nested: { n: 1 } } })
      )
    ).not.toThrow();
    expect(createNode("acme/thing", registry).props).toEqual({
      text: "hi",
      nested: { n: 1 },
    });
  });

  it("are refused at REGISTRATION when a prop cannot be copied", () => {
    const registry = createBlockRegistry();
    expect(() =>
      registry.register(defWith({ defaultProps: { onPick: () => null } }))
    ).toThrow(/cannot be copied/);
  });

  it("are refused when the default STYLE cannot be copied", () => {
    // The style is cloned by the same constructor and was the easier half to forget.
    const registry = createBlockRegistry();
    expect(() =>
      registry.register(
        defWith({
          defaultStyle: { base: { color: (() => null) as never } },
        })
      )
    ).toThrow(/cannot be copied/);
  });

  it("without the check, the failure lands at insertion instead", () => {
    // The reason the check is at registration rather than left to fail naturally: this is what an
    // author would have met, and it names neither the block nor the prop.
    const node = { type: "acme/thing", defaultProps: { fn: () => null } };
    expect(() => structuredClone(node.defaultProps)).toThrow();
  });
});
