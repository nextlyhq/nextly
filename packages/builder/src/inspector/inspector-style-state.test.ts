/**
 * The tab the block panel shows: the author's, where the selected block has
 * it, and otherwise the block's first, without forgetting the author's.
 */
import { describe, expect, it } from "vitest";

import { openingTabFor, shownTab } from "./inspector-style-state";

describe("the tab the panel shows", () => {
  it("is the author's tab where the block has it", () => {
    expect(shownTab("style", ["content", "style", "advanced"])).toBe("style");
    expect(shownTab("advanced", ["style", "advanced"])).toBe("advanced");
  });

  it("is the block's first tab where the block lacks the author's", () => {
    expect(shownTab("content", ["style", "advanced"])).toBe("style");
  });

  it("is Content where the author has chosen nothing the panel knows", () => {
    expect(shownTab("elsewhere", ["content", "style", "advanced"])).toBe(
      "content"
    );
  });
});

describe("the tab a mount opens on", () => {
  it("is Style while a host restores a state, and Content otherwise", () => {
    expect(openingTabFor({ state: "hover", onChange: () => {} })).toBe("style");
    expect(openingTabFor({ onChange: () => {} })).toBe("content");
    expect(openingTabFor(undefined)).toBe("content");
  });
});
