import { describe, expect, it } from "vitest";

import {
  fontWeightOptions,
  foldedControlFor,
  lineHeightFromText,
  lineHeightScrubOrigin,
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
      key: "s:bold",
      label: "Bold",
      value: "bold",
    });
    expect(fontWeightOptions(450)[0]).toEqual({
      key: "n:450",
      label: "450",
      value: 450,
    });
    // A listed weight is not repeated.
    expect(fontWeightOptions(700)).toHaveLength(11);
  });

  it("keeps a weight stored as text apart from the number it spells", () => {
    // "700" as a string is not the 700 the list stores. Shown as its own
    // choice, it can be seen and repaired by choosing Bold 700.
    const options = fontWeightOptions("700");
    expect(options[0]).toEqual({ key: "s:700", label: "700", value: "700" });
    expect(options.find(option => option.key === "n:700")?.label).toBe(
      "Bold 700"
    );
  });
});

describe("lineHeightFromText", () => {
  it("stores a plain number as a number and anything else as typed", () => {
    expect(lineHeightFromText("1.5")).toBe(1.5);
    expect(lineHeightFromText(" 2 ")).toBe(2);
    expect(lineHeightFromText(".8")).toBe(0.8);
    // CSS's whole number grammar, exponents included.
    expect(lineHeightFromText("1e2")).toBe(100);
    expect(lineHeightFromText(".5e1")).toBe(5);
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

describe("where a drag on the line height's label starts", () => {
  it("starts from the field's text, a number or a length", () => {
    expect(lineHeightScrubOrigin("1.5", undefined)).toBe(1.5);
    expect(lineHeightScrubOrigin("24px", undefined)).toBe("24px");
  });

  it("starts an empty field from the value it shows from another tier", () => {
    expect(lineHeightScrubOrigin("", "1.5")).toBe(1.5);
    expect(lineHeightScrubOrigin(" ", "24px")).toBe("24px");
  });

  it("does not start where nothing is one number or one length", () => {
    expect(lineHeightScrubOrigin("", undefined)).toBeUndefined();
    expect(lineHeightScrubOrigin("", "normal")).toBeUndefined();
  });
});
