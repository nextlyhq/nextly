/**
 * A plugin adds blocks to the page builder by resolving its registry service,
 * not by importing the engine and registering directly.
 *
 * The distinction is a timing one. The engine's registry is cleared and rebuilt
 * on every boot, so a direct `registerBlocks` call can land before the rebuild
 * and vanish without an error. Resolving the service cannot: boot records every
 * plugin's services in pass 1 and runs `init` in pass 2, so a contributor
 * calling from `init` always reaches a live registry, whatever order the plugins
 * are listed in.
 */

import {
  allBlocks,
  clearBlocks,
  getBlock,
  getBlockSource,
  getSupport,
  registerSupport,
} from "@nextlyhq/blocks-engine";
import { definePlugin } from "@nextlyhq/plugin-sdk";
import { afterEach, describe, expect, it } from "vitest";

import { createTestNextly, type TestNextly } from "nextly/testing";

import { blockRegistry, defineBlock } from "../index";
import { pageBuilder } from "../../plugin";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.cleanup?.();
  current = undefined;
  // Cleared so each test starts from an empty registry. The boot path does its
  // own reset — proven by the second-boot test below, which deliberately boots
  // twice WITHOUT this hook running in between.
  clearBlocks();
});

const pricingTable = defineBlock({
  name: "acme/pricing-table",
  version: 1,
  description: "A pricing table.",
  example: { props: {} },
  props: {},
  // The engine requires a renderer on every definition; what it returns does
  // not matter here, only that registration accepts a complete block.
  render: () => null,
});

/** A plugin that contributes one block through the page builder's registry. */
function contributor(name = "@acme/pricing-blocks") {
  return definePlugin({
    name,
    version: "1.0.0",
    nextly: ">=0.0.0",
    init: ctx => {
      blockRegistry(ctx).register(pricingTable, name);
    },
  });
}

describe("a plugin contributes blocks through the page builder", () => {
  it("registers the block, whichever order the plugins are listed in", async () => {
    // The contributor listed FIRST: if registration depended on the page
    // builder having already initialized, this is the ordering that breaks.
    current = await createTestNextly({
      plugins: [contributor(), pageBuilder()],
    });

    expect(getBlock("acme/pricing-table")).toBeDefined();
  });

  it("records which plugin contributed the block", async () => {
    // A collision between two plugins' blocks has to name both culprits, which
    // it cannot do if every contribution is filed under one anonymous source.
    current = await createTestNextly({
      plugins: [pageBuilder(), contributor()],
    });

    expect(getBlockSource("acme/pricing-table")).toBe("@acme/pricing-blocks");
  });

  it("refuses to contribute when the page builder is absent", async () => {
    // The failure this design exists to prevent: registering into a registry
    // nothing drains, and finding out only when a page renders empty.
    await expect(
      createTestNextly({ plugins: [contributor()] })
    ).rejects.toThrow(/plugin-page-builder/);
  });

  it("accepts an empty contribution without registering anything", async () => {
    // A plugin whose block list depends on its own configuration may
    // legitimately contribute none; that is not an error.
    const empty = definePlugin({
      name: "@acme/empty-blocks",
      version: "1.0.0",
      nextly: ">=0.0.0",
      init: ctx => {
        blockRegistry(ctx).register([], "@acme/empty-blocks");
      },
    });

    current = await createTestNextly({ plugins: [pageBuilder(), empty] });

    expect(allBlocks().some(b => b.name.startsWith("acme/"))).toBe(false);
  });
});

describe("resetting blocks leaves the support vocabulary alone", () => {
  it("keeps a support registered in the same init as the blocks using it", async () => {
    // Supports are the vocabulary blocks are validated against, and a plugin
    // may register one immediately before the blocks that use it. Clearing both
    // together erased that support between the two calls, and the blocks were
    // then refused as using an unknown one.
    const withSupport = definePlugin({
      name: "@acme/support-blocks",
      version: "1.0.0",
      nextly: ">=0.0.0",
      init: ctx => {
        registerSupport({ key: "telepathy" });
        blockRegistry(ctx).register(pricingTable, "@acme/support-blocks");
      },
    });

    current = await createTestNextly({
      plugins: [pageBuilder(), withSupport],
    });

    expect(getSupport("telepathy")).toBeDefined();
    expect(getBlock("acme/pricing-table")).toBeDefined();
  });
});

describe("the registry survives a second boot", () => {
  it("re-registers the same block without a collision", async () => {
    // The registry is pinned to globalThis and outlives a config reload, while
    // every plugin's init runs again — so a boot that did not reset it would
    // refuse the second registration.
    current = await createTestNextly({
      plugins: [pageBuilder(), contributor()],
    });
    await current.cleanup?.();

    current = await createTestNextly({
      plugins: [pageBuilder(), contributor()],
    });

    expect(getBlock("acme/pricing-table")).toBeDefined();
  });
});
