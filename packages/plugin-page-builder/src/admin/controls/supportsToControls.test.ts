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

  it("typography selects carry option lists (weight/case/decoration/appearance)", () => {
    const g = supportsToControls({ typography: true }).find(
      x => x.group === "Typography"
    )!;
    const weight = g.controls.find(c => c.styleKey === "fontWeight")!;
    expect(weight.control).toBe("select");
    expect(weight.options && weight.options.length).toBeGreaterThan(0);
    expect(
      g.controls.find(c => c.styleKey === "textTransform")!.options!.length
    ).toBeGreaterThan(0);
  });

  it("exposes gradient, width-alignment, shadow presets and link colors", () => {
    const groups = supportsToControls({
      background: { gradient: true },
      dimensions: { width: true },
      shadow: true,
      color: { link: true },
    });
    const flat = groups.flatMap(g => g.controls);
    expect(flat.some(c => c.control === "gradient")).toBe(true);
    expect(flat.some(c => c.styleKey === "widthAlign")).toBe(true);
    const shadow = flat.find(c => c.styleKey === "boxShadow")!;
    expect(shadow.control).toBe("select");
    expect(shadow.options!.some(o => o.label === "Deep")).toBe(true);
    expect(flat.some(c => c.styleKey === "linkColor")).toBe(true);
    expect(flat.some(c => c.styleKey === "linkColorHover")).toBe(true);
  });
});
