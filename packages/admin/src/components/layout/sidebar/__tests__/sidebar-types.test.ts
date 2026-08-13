import { describe, expect, it } from "vitest";

import { getFilteredMenuItems } from "../sidebar-types";

describe("getFilteredMenuItems", () => {
  it("lists plugins whether or not the builder is shown", () => {
    expect(getFilteredMenuItems(false).map(i => i.id)).toContain("plugins");
    expect(getFilteredMenuItems(true).map(i => i.id)).toContain("plugins");
  });

  // Positive controls for the case above: the helper still filters something,
  // so a version that stopped filtering entirely cannot pass this file by
  // returning every item unconditionally.
  it("hides the builders item when the builder is off", () => {
    expect(getFilteredMenuItems(false).map(i => i.id)).not.toContain(
      "builders"
    );
  });

  it("shows the builders item when the builder is on", () => {
    expect(getFilteredMenuItems(true).map(i => i.id)).toContain("builders");
  });
});
