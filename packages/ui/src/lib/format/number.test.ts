import { describe, expect, it } from "vitest";

import { formatChange, formatCount } from "./number";

describe("formatCount", () => {
  it("shows the full grouped value outside the small tier", () => {
    expect(formatCount(1248)).toEqual({ text: "1,248", label: "1,248" });
    expect(formatCount(1248, { tier: "medium" })).toEqual({
      text: "1,248",
      label: "1,248",
    });
    expect(formatCount(1248, { tier: "large" })).toEqual({
      text: "1,248",
      label: "1,248",
    });
  });

  it("compacts only in the small tier and only from 1,000, naming the full value", () => {
    expect(formatCount(1248, { tier: "small" })).toEqual({
      text: "1.2k",
      label: "1,248",
    });
    expect(formatCount(999, { tier: "small" })).toEqual({
      text: "999",
      label: "999",
    });
    expect(formatCount(-1500, { tier: "small" })).toEqual({
      text: "-1.5k",
      label: "-1,500",
    });
  });

  it("keeps the capitals of millions and billions", () => {
    expect(formatCount(3_400_000, { tier: "small" }).text).toBe("3.4M");
    expect(formatCount(1_200_000_000, { tier: "small" }).text).toBe("1.2B");
  });

  it("shows a floor as N+ and names it N or more", () => {
    expect(formatCount(100, { floor: true })).toEqual({
      text: "100+",
      label: "100 or more",
    });
    expect(formatCount(1248, { floor: true, tier: "small" })).toEqual({
      text: "1.2k+",
      label: "1,248 or more",
    });
  });

  it("formats in the locale it is given", () => {
    expect(formatCount(1248, { locale: "de-DE" }).text).toBe("1.248");
  });
});

describe("formatChange", () => {
  it("carries direction in an arrow and a sign, and says it in words", () => {
    expect(formatChange(18)).toEqual({
      text: "↑ +18",
      label: "up 18",
      direction: "up",
    });
    expect(formatChange(-18)).toEqual({
      text: "↓ −18",
      label: "down 18",
      direction: "down",
    });
    expect(formatChange(0)).toEqual({
      text: "→ ±0",
      label: "no change",
      direction: "none",
    });
  });

  it("formats its magnitude as a count does", () => {
    expect(formatChange(1248, { tier: "small" }).text).toBe("↑ +1.2k");
    expect(formatChange(1248).label).toBe("up 1,248");
  });
});
