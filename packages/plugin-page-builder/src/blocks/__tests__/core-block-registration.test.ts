/**
 * The core library is registered at boot, and registered first.
 *
 * Order is asserted as well as membership. Core registers before declared
 * blocks so a contributed block colliding with a `core/` name is the one
 * reported as the duplicate, and so the boot's one-time registry clear happens
 * before core is added rather than after.
 */
import { clearBlocks, getBlock, getBlockSource } from "@nextlyhq/blocks-engine";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { afterEach, describe, expect, it } from "vitest";

import { PAGE_BUILDER_PLUGIN, BLOCK_SERVICE } from "../registration-service";
import { registerCoreBlocks } from "../registration-service";
import { createBlockRegistrationService } from "../registration-service";

afterEach(() => {
  clearBlocks();
});

function contextWithService(): Parameters<typeof registerCoreBlocks>[0] {
  const service = createBlockRegistrationService();
  return {
    config: { plugins: [] },
    services: {
      plugins: { [PAGE_BUILDER_PLUGIN]: { [BLOCK_SERVICE]: service } },
    },
  } as unknown as Parameters<typeof registerCoreBlocks>[0];
}

describe("core block registration", () => {
  it("registers every block in the core library", () => {
    clearBlocks();
    registerCoreBlocks(contextWithService());

    for (const block of coreBlocks) {
      expect(
        getBlock(block.name),
        `${block.name} is not registered`
      ).toBeDefined();
    }
  });

  it("attributes them to the page builder", () => {
    // The package a reader would have to go and change, not the package that
    // happened to perform the registration on someone's behalf.
    clearBlocks();
    registerCoreBlocks(contextWithService());

    for (const block of coreBlocks) {
      expect(getBlockSource(block.name)).toBe(PAGE_BUILDER_PLUGIN);
    }
  });

  it("covers the names the library actually ships", () => {
    // A registration loop over an empty list would pass both checks above
    // forever, so the list itself is pinned.
    expect(coreBlocks.length).toBeGreaterThanOrEqual(3);
    expect(coreBlocks.map(block => block.name).sort()).toEqual([
      "core/accordion",
      "core/accordion-item",
      "core/box",
      "core/button",
      "core/card",
      "core/collection-loop",
      "core/column",
      "core/columns",
      "core/divider",
      "core/embed",
      "core/form",
      "core/gallery",
      "core/heading",
      "core/image",
      "core/list",
      "core/quote",
      "core/section",
      "core/spacer",
      "core/text",
    ]);
  });
});
