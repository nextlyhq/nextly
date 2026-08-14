/**
 * A definition's defaults must be copyable, and registration is where that is decided.
 *
 * Every instance is built by cloning them, so a value `structuredClone` refuses does not fail at
 * registration — it fails later, inside `createNode`, as a `DataCloneError` raised while an author
 * was inserting a block or taking a repair. That error names neither the block nor the prop, and
 * it surfaces a long way from the definition that caused it.
 */
import { describe, expect, it } from "vitest";

import {
  createBlockRegistry,
  createNode,
  type BlockRegistry,
} from "../registry";
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
    //
    // Reached through a registry that HOLDS the invalid definition rather than by calling
    // `structuredClone` on a bare object. That would assert a property of the platform — functions
    // are not cloneable — which is true whether or not `createNode` clones anything, so it stayed
    // green on the very implementation it exists to describe.
    const holding: BlockRegistry = {
      register: () => {},
      get: () => defWith({ defaultProps: { onPick: () => null } }),
      has: () => true,
      all: () => [],
    };
    expect(() => createNode("acme/thing", holding)).toThrow();
  });
});

describe("parent metadata on the legacy registry", () => {
  // The package root still exports `defineBlock`, so this registry is a SEPARATE door from the
  // engine's gate — a JavaScript consumer reaches it without passing the engine at all.
  it("accepts a non-empty array of namespaced names", () => {
    const registry = createBlockRegistry();
    expect(() =>
      registry.register(defWith({ parent: ["core/columns"] }))
    ).not.toThrow();
  });

  it("refuses a bare string, which validate would call .join() on and throw", () => {
    const registry = createBlockRegistry();
    expect(() =>
      registry.register(defWith({ parent: "core/columns" as never }))
    ).toThrow(/non-empty array/);
  });

  it("refuses a name the engine's grammar rejects, not merely one without a slash", () => {
    // `core/columns/` contains a slash and is not a block name any registration accepts, so a
    // parent naming it matches nothing — every instance unsaveable, with the declaration looking
    // right. The gate now asks the canonical predicate rather than its own weaker one.
    const registry = createBlockRegistry();
    expect(() =>
      registry.register(defWith({ parent: ["core/columns/"] }))
    ).toThrow(/non-empty array/);
  });

  it("refuses an empty array, which permits no placement at all", () => {
    const registry = createBlockRegistry();
    expect(() => registry.register(defWith({ parent: [] }))).toThrow(
      /non-empty array/
    );
  });
});
