/**
 * A block a PLUGIN contributed gets its nesting rules enforced, like a built-in one.
 *
 * The rules are declared to `@nextlyhq/blocks-engine` and enforced by this package, which resolves
 * blocks through a different registry — so every assertion here fails by ALLOWING something, never
 * by throwing. That is the shape worth stating: the broken version of this code is permissive, and
 * a test that only checked the happy path would pass on it.
 */
import { clearBlocks, registerBlocks } from "@nextlyhq/blocks-engine";
import { defineBlock } from "@nextlyhq/plugin-sdk/blocks";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { canDrop } from "../../admin/logic/dropRules";
import { declaredParentsOf, slotsOf } from "../block-structure";
import { createNode, createBlockRegistry } from "../registry";

/**
 * A container whose only slot is NAMED, and named something other than `default`.
 *
 * Both halves matter: the named slot is what catches a constructor that invents `default`, and the
 * `allow` list is written as a namespace wildcard because that is the syntax the engine's own
 * `SlotSpec.allow` documents and the one an exact-match test silently empties.
 */
const shell = defineBlock({
  name: "acme/shell",
  version: 1,
  description: "A container with one named slot.",
  example: { props: {} },
  slots: { sidebar: { allow: ["acme/*"] } },
  render: () => null,
});

/**
 * A block that may only sit inside `acme/shell`.
 *
 * `parent` here is also the compile-time half of the assertion: `defineBlock` types its argument
 * against the stable SDK contract, so this file would not typecheck if `parent` were absent from
 * it. That check is evaluated by `tsc`, not asserted by a directive.
 */
const shellItem = defineBlock({
  name: "acme/shell-item",
  version: 1,
  description: "Only meaningful inside a shell.",
  example: { props: {} },
  parent: ["acme/shell"],
  render: () => null,
});

/** A block with no restriction, to separate "refuses this one" from "refuses everything". */
const loose = defineBlock({
  name: "acme/loose",
  version: 1,
  description: "Sits anywhere.",
  example: { props: {} },
  render: () => null,
});

/** Empty on purpose: these blocks are known to the ENGINE, and to this registry never. */
const registry = createBlockRegistry();

describe("a contributed block's nesting rules reach the editor", () => {
  beforeEach(() => {
    clearBlocks();
    registerBlocks([shell, shellItem, loose], { source: "@acme/blocks" });
  });
  afterEach(() => {
    clearBlocks();
  });

  it("reads the contributed structure at all", () => {
    // The precondition every assertion below rests on. Without it a bridge that resolved nothing
    // would refuse each drop for "unknown-parent" and the refusals would still read as correct.
    expect(slotsOf("acme/shell", registry)).toEqual([
      { name: "sidebar", allowedBlocks: ["acme/*"] },
    ]);
    expect(declaredParentsOf("acme/shell-item")).toEqual(["acme/shell"]);
  });

  it("accepts a child in the slot the contributed container declares", () => {
    expect(
      canDrop("acme/shell", "sidebar", "acme/shell-item", registry)
    ).toEqual({
      ok: true,
    });
  });

  it("refuses the slot name the container did NOT declare", () => {
    expect(
      canDrop("acme/shell", "default", "acme/loose", registry).reason
    ).toBe("unknown-slot");
  });

  it("refuses a block the child's own parent list excludes", () => {
    // `core/container` is a perfectly good container that accepts anything; what refuses the drop
    // is the CHILD's declaration, which is the half no parent can express.
    expect(
      canDrop("core/container", "default", "acme/shell-item", registry).reason
    ).toBe("wrong-parent");
  });

  it("still accepts an unrestricted contributed block in the same place", () => {
    // The separating control: without it, a bridge that refused every contributed block would pass
    // the assertion above for the wrong reason.
    expect(
      canDrop("core/container", "default", "acme/loose", registry).ok
    ).toBe(true);
  });

  it("honours a namespace wildcard rather than matching it literally", () => {
    // `acme/*` admits `acme/loose`. An exact-match membership test finds no block of that name and
    // refuses, which is the failure this wildcard support exists to prevent.
    expect(canDrop("acme/shell", "sidebar", "acme/loose", registry).ok).toBe(
      true
    );
    // And it binds to the separator: a namespace that merely starts with the same letters is not
    // admitted by it.
    expect(
      canDrop("acme/shell", "sidebar", "acmeevil/banner", registry).reason
    ).toBe("not-allowed-in-slot");
  });

  it("creates a contributed container with the slot it declares and no other", () => {
    expect(createNode("acme/shell", registry).slots).toEqual({ sidebar: [] });
  });

  it("creates a contributed leaf with no slots at all", () => {
    expect(createNode("acme/loose", registry).slots).toBeUndefined();
  });

  it("stops answering once the block is unregistered", () => {
    // The lifetime property. Structure is read THROUGH the engine registry rather than copied, so
    // a boot that drops a plugin drops its rules in the same act — a mirrored copy is what would
    // keep refusing drops for blocks that no longer exist.
    clearBlocks();
    expect(declaredParentsOf("acme/shell-item")).toBeUndefined();
    expect(slotsOf("acme/shell", registry)).toBeUndefined();
  });
});
