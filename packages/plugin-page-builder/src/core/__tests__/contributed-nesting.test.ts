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
import { makeNode } from "../tree";
import { validateDocument } from "../validate";

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

  it("is NOT offered as an insertion parent, because the canvas cannot draw it", () => {
    // Deliberately changed. This case previously asserted acceptance, and acceptance was wrong:
    // `CanvasNode` draws a definition this package does not hold as an unknown-block placeholder
    // that renders no slots, so a child authorized into it is written to the document and then
    // disappears from the canvas. Refusing the drop is the better failure.
    //
    // Enforcing where a block may NOT go and granting where it MAY are different powers. The
    // first still works for contributed blocks — that is what the rest of this file covers.
    expect(
      canDrop("acme/shell", "sidebar", "acme/shell-item", registry).reason
    ).toBe("unknown-parent");
  });

  it("refuses a block the child's own parent list excludes", () => {
    // The half that still applies to a contributed block, and the one no parent can express:
    // `core/container` accepts anything, and the CHILD says it may only sit in `acme/shell`.
    expect(
      canDrop("core/container", "default", "acme/shell-item", registry).reason
    ).toBe("wrong-parent");
  });

  it("still accepts an unrestricted contributed block in a container this build draws", () => {
    // The separating control: a bridge that refused every contributed block would pass the
    // assertion above for the wrong reason.
    expect(
      canDrop("core/container", "default", "acme/loose", registry).ok
    ).toBe(true);
  });

  it("reads a contributed slot's namespace wildcard where the rule is ENFORCED", () => {
    // `canDrop` no longer reaches a contributed container, so the wildcard is exercised where it
    // still decides something: the write path, which judges a stored document rather than granting
    // an insertion. `acme/*` must admit `acme/loose` and refuse a namespace that merely starts
    // with the same letters.
    const admits = validateDocument(
      {
        version: 1,
        root: makeNode("acme/shell", {}, undefined, {
          sidebar: [makeNode("acme/loose")],
        }),
      },
      registry,
      // The TYPE is unknown to this package's registry by construction — that is what makes these
      // blocks contributed. What is under test is the slot rule structure supplies, so the unknown
      // type is tolerated exactly as the write path tolerates an unloaded plugin's block.
      { allowUnknown: true }
    );
    expect(admits).toBe(true);

    const refuses = validateDocument(
      {
        version: 1,
        root: makeNode("acme/shell", {}, undefined, {
          sidebar: [makeNode("acmeevil/banner")],
        }),
      },
      registry,
      { allowUnknown: true }
    );
    expect(refuses).not.toBe(true);
    expect(String(refuses)).toContain("acmeevil/banner");
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
