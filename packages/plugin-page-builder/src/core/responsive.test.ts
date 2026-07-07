import { describe, expect, it } from "vitest";

import { readStyleValue, writeStyleValue } from "./responsive";
import type { ResponsiveStyle } from "./types";

describe("responsive style helpers", () => {
  it("reads base value when breakpoint override absent", () => {
    const s: ResponsiveStyle = { base: { color: "#111" } };
    expect(readStyleValue(s, "color", "base")).toBe("#111");
    expect(readStyleValue(s, "color", "mobile")).toBeUndefined();
  });

  it("writes a breakpoint override without touching base", () => {
    const s: ResponsiveStyle = { base: { color: "#111" } };
    const next = writeStyleValue(s, "color", "mobile", "#f00");
    expect(next.base?.color).toBe("#111");
    expect(next.mobile?.color).toBe("#f00");
    // immutability
    expect(s.mobile).toBeUndefined();
  });

  it("removes a key when value is undefined or empty", () => {
    const s: ResponsiveStyle = { base: { color: "#111", fontSize: "16px" } };
    const cleared = writeStyleValue(s, "color", "base", undefined);
    expect(cleared.base?.color).toBeUndefined();
    expect(cleared.base?.fontSize).toBe("16px");
    expect(
      writeStyleValue(s, "fontSize", "base", "").base?.fontSize
    ).toBeUndefined();
  });
});
