/**
 * Each registry is its own: two made in one process never see each other's
 * blocks or supports, and neither is the bundle's registry the module
 * functions read. Nothing is pinned on `globalThis`.
 */
import { beforeEach, describe, expect, it } from "vitest";

import type { BlockDefinition } from "./block";
import {
  clearBlocks,
  createBlockRegistry,
  getBlock,
  hasBlock,
  registerBlocks,
} from "./registry";

function block(
  overrides: Partial<BlockDefinition> & { name: string }
): BlockDefinition {
  return {
    version: 1,
    description: "A test block.",
    example: { props: {} },
    render: () => null,
    ...overrides,
  };
}

beforeEach(() => {
  clearBlocks();
});

describe("a block registry", () => {
  it("holds only what was registered in it, apart from another", () => {
    const siteA = createBlockRegistry();
    const siteB = createBlockRegistry();
    siteA.register([block({ name: "acme/pricing" })], { source: "site-a" });
    siteB.register([block({ name: "acme/banner" })], { source: "site-b" });

    expect(siteA.has("acme/pricing")).toBe(true);
    expect(siteA.get("acme/banner")).toBeUndefined();
    expect(siteB.has("acme/banner")).toBe(true);
    expect(siteB.get("acme/pricing")).toBeUndefined();
    expect(siteA.sourceOf("acme/pricing")).toBe("site-a");
    // The same name in two registries is two sites, not a collision.
    siteB.register([block({ name: "acme/pricing" })], { source: "site-b" });
    expect(siteB.sourceOf("acme/pricing")).toBe("site-b");
  });

  it("is not the bundle's registry, either way", () => {
    const site = createBlockRegistry();
    site.register([block({ name: "acme/pricing" })]);
    registerBlocks([block({ name: "acme/banner" })]);

    expect(hasBlock("acme/pricing")).toBe(false);
    expect(getBlock("acme/banner")).toBeDefined();
    expect(site.has("acme/banner")).toBe(false);
  });

  it("keeps its supports to itself, and a clear resets only its own", () => {
    const siteA = createBlockRegistry();
    const siteB = createBlockRegistry();
    siteA.registerSupport({ key: "parallax" });
    siteA.register([block({ name: "acme/hero", supports: { parallax: true } })]);

    expect(siteB.support("parallax")).toBeUndefined();
    expect(() =>
      siteB.register([
        block({ name: "acme/hero", supports: { parallax: true } }),
      ])
    ).toThrow(/NEXTLY_BLOCK_UNKNOWN_SUPPORT/);

    siteB.registerSupport({ key: "parallax" });
    siteA.clear();
    expect(siteA.all()).toEqual([]);
    expect(siteA.support("parallax")).toBeUndefined();
    // The built-ins come back with a clear.
    expect(siteA.support("customCss")).toBeDefined();
    expect(siteB.support("parallax")).toBeDefined();
  });

  it("hands out views that read through to its live contents", () => {
    const site = createBlockRegistry();
    const lookup = site.lookup();
    const nesting = site.nestingSource();
    const definitions = site.blockSource();
    const migrations = site.migrationSource();
    expect(lookup.has("acme/item")).toBe(false);

    site.register([
      block({ name: "acme/list", slots: { items: { allow: ["acme/item"] } } }),
      block({ name: "acme/item", parent: ["acme/list"] }),
    ]);
    expect(lookup.has("acme/item")).toBe(true);
    expect(nesting.parentsOf("acme/item")).toEqual(["acme/list"]);
    expect(nesting.slotAllowOf?.("acme/list", "items")).toEqual(["acme/item"]);
    expect(definitions.get("acme/item")?.version).toBe(1);
    expect(migrations.get("acme/item")?.version).toBe(1);

    site.clear();
    expect(lookup.has("acme/item")).toBe(false);
    expect(nesting.parentsOf("acme/item")).toBeUndefined();
  });

  it("pins nothing on globalThis", () => {
    registerBlocks([block({ name: "acme/banner" })]);
    const pinned = Object.keys(globalThis).filter(key =>
      key.startsWith("__nextly_block")
    );
    expect(pinned).toEqual([]);
  });
});
