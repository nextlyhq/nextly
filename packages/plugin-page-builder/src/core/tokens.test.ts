import { describe, expect, it } from "vitest";

import { compileTokensCss } from "./style-compiler";
import { tokenSwatches } from "./tokens";

describe("global tokens", () => {
  it("builds humanized swatches from the palette", () => {
    const s = tokenSwatches();
    const primary = s.find(t => t.name === "color.primary")!;
    expect(primary.label).toBe("Primary");
    expect(primary.preview).toBe("#4f46e5");
    expect(s.some(t => t.name === "color.background")).toBe(true);
  });

  it("custom palette overrides the swatches + compiled vars", () => {
    const custom = { "color.primary": "#ff0000" };
    expect(tokenSwatches(custom)).toEqual([
      { name: "color.primary", label: "Primary", preview: "#ff0000" },
    ]);
    expect(compileTokensCss("nx-pb-page", custom)).toContain(
      "--nx-color-primary: #ff0000"
    );
  });
});
