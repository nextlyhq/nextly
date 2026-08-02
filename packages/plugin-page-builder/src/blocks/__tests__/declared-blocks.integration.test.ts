/**
 * A plugin can declare its blocks instead of registering them.
 *
 * The imperative call registers from inside `init`, so what a plugin
 * contributes is knowable only after that plugin has booted. Generation never
 * boots anything, so a block registered that way cannot reach an import map, a
 * manifest, or generated types. A declared block is plain data on the plugin
 * definition, which both readers can see.
 *
 * These assert the runtime half: the page builder registers what was declared,
 * attributes it to the plugin that declared it, and does so for a plugin with
 * no `init` of its own at all.
 */
import { getBlock, getBlockSource, clearBlocks } from "@nextlyhq/blocks-engine";
import { defineBlock } from "@nextlyhq/plugin-sdk/blocks";
import { createTestNextly, type TestNextly } from "nextly/testing";
import { definePlugin } from "@nextlyhq/plugin-sdk";
import { afterEach, describe, expect, it } from "vitest";

import { PAGE_BUILDER_PLUGIN } from "../registration-service";
import { pageBuilder } from "../../plugin";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  clearBlocks();
});

const pricingTable = defineBlock({
  name: "acme/declared-pricing",
  version: 1,
  description: "A declared pricing table.",
  example: { props: {} },
  props: {},
  render: () => null,
});

/** A plugin that declares a block and defines no `init` at all. */
function declaring(
  name = "@acme/declared-blocks",
  blocks: unknown = [pricingTable]
) {
  return definePlugin({
    name,
    version: "1.0.0",
    nextly: ">=0.0.0",
    contributes: { declarations: { [PAGE_BUILDER_PLUGIN]: { blocks } } },
  } as never);
}

describe("a plugin declares blocks statically", () => {
  it("registers them at boot with no init of its own", async () => {
    current = await createTestNextly({
      plugins: [pageBuilder(), declaring()],
    });

    expect(getBlock("acme/declared-pricing")).toBeDefined();
  });

  it("attributes the block to the plugin that declared it", async () => {
    // Registered on the declarer's behalf by the page builder, so the naive
    // attribution would be the page builder itself and a collision would send
    // a reader to the wrong package.
    current = await createTestNextly({
      plugins: [pageBuilder(), declaring()],
    });

    expect(getBlockSource("acme/declared-pricing")).toBe(
      "@acme/declared-blocks"
    );
  });

  it("registers whichever order the plugins are listed in", async () => {
    current = await createTestNextly({
      plugins: [declaring(), pageBuilder()],
    });

    expect(getBlock("acme/declared-pricing")).toBeDefined();
  });

  it("refuses a declaration whose blocks are not an array", async () => {
    // Addressed to this reader by name, so the author meant it to take effect;
    // skipping it would leave the plugin looking installed and contributing
    // nothing.
    await expect(
      createTestNextly({
        plugins: [pageBuilder(), declaring("@acme/bad", { nope: true })],
      })
    ).rejects.toThrow(/@acme\/bad/);
  });
});

describe("a declared support is registered before the blocks that use it", () => {
  it("registers a block opting into a support the same plugin declared", async () => {
    // The contributing plugin's own `init` runs AFTER the page builder's, which
    // is where declared blocks are registered, so calling `registerSupport()`
    // there is always too late: registration refuses a block naming a support
    // nothing knows yet, and no plugin ordering fixes it because the two happen
    // in different passes.
    const contributor = definePlugin({
      name: "@acme/animated-blocks",
      version: "1.0.0",
      nextly: ">=0.0.0",
      contributes: {
        declarations: {
          [PAGE_BUILDER_PLUGIN]: {
            supports: [{ key: "animation", label: "Animation" }],
            blocks: [
              {
                name: "acme/animated",
                version: 1,
                description: "Opts into a support its own plugin declared.",
                example: { props: {} },
                supports: { animation: true },
                render: () => null,
              },
            ],
          },
        },
      },
    } as never);

    current = await createTestNextly({
      plugins: [pageBuilder(), contributor],
    });

    expect(getBlock("acme/animated")?.supports).toEqual({ animation: true });
  });
});
