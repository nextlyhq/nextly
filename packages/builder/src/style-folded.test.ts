import { describe, expect, it } from "vitest";

import {
  fontWeightOptions,
  foldedControlFor,
  lineHeightFromText,
} from "./style-folded";

describe("the folded style properties", () => {
  it("folds font weight and line height, and nothing whose form is the choice", () => {
    expect(foldedControlFor("fontWeight")).toBe("font-weight");
    expect(foldedControlFor("lineHeight")).toBe("number-or-length");
    expect(foldedControlFor("borderRadius")).toBeUndefined();
    expect(foldedControlFor("fontStyle")).toBeUndefined();
    // A key every object carries is not a property here.
    expect(foldedControlFor("constructor")).toBeUndefined();
  });
});

describe("fontWeightOptions", () => {
  it("names the nine weights, then the relative ones, storing numbers", () => {
    const options = fontWeightOptions(undefined);
    expect(options.map(option => option.label)).toEqual([
      "Thin 100",
      "Extra light 200",
      "Light 300",
      "Regular 400",
      "Medium 500",
      "Semibold 600",
      "Bold 700",
      "Extra bold 800",
      "Black 900",
      "Lighter",
      "Bolder",
    ]);
    expect(options[6]?.value).toBe(700);
    expect(options[9]?.value).toBe("lighter");
  });

  it("shows a stored keyword or an unlisted weight first, as stored", () => {
    expect(fontWeightOptions("bold")[0]).toEqual({
      key: "bold",
      label: "Bold",
      value: "bold",
    });
    expect(fontWeightOptions(450)[0]).toEqual({
      key: "450",
      label: "450",
      value: 450,
    });
    // A listed weight is not repeated.
    expect(fontWeightOptions(700)).toHaveLength(11);
  });
});

describe("lineHeightFromText", () => {
  it("stores a plain number as a number and anything else as typed", () => {
    expect(lineHeightFromText("1.5")).toBe(1.5);
    expect(lineHeightFromText(" 2 ")).toBe(2);
    expect(lineHeightFromText(".8")).toBe(0.8);
    expect(lineHeightFromText("24px")).toBe("24px");
    expect(lineHeightFromText("150%")).toBe("150%");
    expect(lineHeightFromText("normal")).toBe("normal");
  });

  it("leaves a number CSS would refuse as typed, and clears on nothing", () => {
    // A digit must follow a decimal point; the catalogue refuses "1." with
    // its own words rather than this storing the 1 the author did not write.
    expect(lineHeightFromText("1.")).toBe("1.");
    expect(lineHeightFromText("   ")).toBeNull();
  });

  it("trims CSS whitespace only, so a non-breaking space is not dropped", () => {
    // A non-breaking space is not whitespace to CSS: a value carrying one goes
    // on as typed, for the catalogue to refuse, and one alone is not nothing.
    expect(lineHeightFromText("\u00a01.5")).toBe("\u00a01.5");
    expect(lineHeightFromText("\u00a0")).toBe("\u00a0");
    expect(lineHeightFromText("\t1.5\n")).toBe(1.5);
  });
});
