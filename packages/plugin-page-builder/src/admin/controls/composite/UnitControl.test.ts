import { describe, expect, it } from "vitest";

import { formatUnit, parseUnit } from "./UnitControl";

describe("UnitControl helpers", () => {
  it("parses value + unit, defaulting to px", () => {
    expect(parseUnit("-8px")).toEqual({ n: "-8", u: "px" });
    expect(parseUnit("50%")).toEqual({ n: "50", u: "%" });
    expect(parseUnit("1.5rem")).toEqual({ n: "1.5", u: "rem" });
    expect(parseUnit("")).toEqual({ n: "", u: "px" });
  });

  it("formats, emitting '' for empty and appending unit incl. negatives", () => {
    expect(formatUnit("-8", "px")).toBe("-8px");
    expect(formatUnit("2", "rem")).toBe("2rem");
    expect(formatUnit("", "px")).toBe("");
  });
});
