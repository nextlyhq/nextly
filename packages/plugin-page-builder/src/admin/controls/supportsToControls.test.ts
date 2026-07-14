import { describe, expect, it } from "vitest";

import { supportsToControls } from "./supportsToControls";

describe("supportsToControls", () => {
  it("groups typography + border controls from supports", () => {
    const groups = supportsToControls({
      typography: { fontSize: true, fontWeight: true },
      border: { radius: true },
    });
    const typo = groups.find(g => g.group === "Typography")!;
    expect(typo.controls.map(c => c.styleKey)).toEqual([
      "fontSize",
      "fontWeight",
    ]);
    const border = groups.find(g => g.group === "Border & Shadow")!;
    expect(border.controls.some(c => c.styleKey === "borderRadius")).toBe(true);
  });

  it("returns no groups for empty supports", () => {
    expect(supportsToControls({})).toEqual([]);
  });
});
