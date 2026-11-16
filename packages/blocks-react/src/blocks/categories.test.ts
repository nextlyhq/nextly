import { describe, expect, it } from "vitest";

import { CORE_PALETTE_ORDER } from "./categories";
import { coreBlocks } from "./index";

describe("the Add panel's order of the core blocks", () => {
  it("lists every core block exactly once", () => {
    // A block missing here would drop to the end of its group, and a name
    // that is no block would rank nothing: both are mistakes no one sees.
    expect([...CORE_PALETTE_ORDER].sort()).toEqual(
      coreBlocks.map(block => block.name).sort()
    );
  });

  it("puts each category's blocks together, in the categories' own order", () => {
    // The groups are drawn per category, so an order that interleaved them
    // would still draw, but would no longer read as the design's list.
    const categoryOf = new Map(
      coreBlocks.map(block => [block.name, block.editor?.category])
    );
    const runs = CORE_PALETTE_ORDER.map(name => categoryOf.get(name)).filter(
      (category, index, all) => index === 0 || all[index - 1] !== category
    );
    expect(runs).toEqual([
      "layout",
      "content",
      "entry",
      "media",
      "interactive",
    ]);
  });
});
