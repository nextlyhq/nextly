import { describe, it, expect } from "vitest";

import { defaultBlockRegistry } from "../../core/registry";
import "../../render/blocks"; // register core blocks

import { firstPopulatedTab } from "./inspectorTabs";

describe("firstPopulatedTab", () => {
  it("prefers Content when the block has content fields", () => {
    expect(firstPopulatedTab(defaultBlockRegistry.get("core/heading"))).toBe(
      "content"
    );
  });

  it("returns content or style for a block that has style controls", () => {
    const grid = defaultBlockRegistry.get("core/grid");
    const tab = firstPopulatedTab(grid);
    expect(tab === "content" || tab === "style").toBe(true);
  });

  it("returns Advanced only when there is no content or style", () => {
    expect(firstPopulatedTab(undefined)).toBe("advanced");
  });
});
