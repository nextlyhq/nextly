/**
 * The three notations an author types or pastes: each is read into the same
 * colour, and a colour written in one reads back as itself.
 */
import { describe, expect, it } from "vitest";

import { formatColour, hslToRgb, parseColour, rgbToHsl } from "./formats";
import { toHex } from "./hex";

/** What a parse answers, as the hex and alpha a person can check by eye. */
function read(text: string): string | null {
  const colour = parseColour(text);
  return colour === null ? null : toHex(colour, colour.alpha);
}

describe("reading hex", () => {
  it.each([
    ["#0af", "#00aaff"],
    ["#0af8", "#00aaff88"],
    ["#00aaff", "#00aaff"],
    ["#00aaff80", "#00aaff80"],
    ["00AAFF", "#00aaff"],
  ])("reads %s", (text, hex) => {
    expect(read(text)).toBe(hex);
  });
});

describe("reading rgb()", () => {
  it.each([
    ["rgb(255, 0, 0)", "#ff0000"],
    ["rgb(255 0 0)", "#ff0000"],
    ["rgb(100% 0% 50%)", "#ff0080"],
    ["rgba(255, 0, 0, 0.5)", "#ff000080"],
    ["rgba(255, 0, 0, 50%)", "#ff000080"],
    ["rgb(255 0 0 / 50%)", "#ff000080"],
    ["rgba(255 0 0 / 0.5)", "#ff000080"],
    ["RGB( 255 , 0 , 0 )", "#ff0000"],
    ["  rgb(300 -5 0)  ", "#ff0000"],
  ])("reads %s", (text, hex) => {
    expect(read(text)).toBe(hex);
  });
});

describe("reading hsl()", () => {
  it.each([
    ["hsl(120 100% 25%)", "#008000"],
    ["hsl(120, 100%, 25%)", "#008000"],
    ["hsl(120deg 100% 25%)", "#008000"],
    ["hsl(0.5turn 100% 50%)", "#00ffff"],
    ["hsl(-120 100% 50%)", "#0000ff"],
    ["hsl(120 100 25)", "#008000"],
    ["hsla(120, 100%, 25%, 0.5)", "#00800080"],
    ["hsl(120 100% 25% / 50%)", "#00800080"],
    ["hsla(120 100% 25% / .5)", "#00800080"],
  ])("reads %s", (text, hex) => {
    expect(read(text)).toBe(hex);
  });
});

describe("refusing what is no colour yet", () => {
  it.each([
    "",
    "#ab",
    "#12345",
    "rgb(255, 0)",
    "rgb(255 0 0 0.5)",
    "rgb(255, 0, 0 / 1)",
    "rgb(255 0 0 / )",
    "rgb(255 0 0 / 1 / 1)",
    "rgb(red 0 0)",
    "rgb(1px 0 0)",
    "hsl(120 100% 25%",
    "hsl(120foo 100% 25%)",
    "oklch(0.7 0.1 200)",
    "red",
  ])("answers null for %j", text => {
    expect(parseColour(text)).toBeNull();
  });
});

describe("writing a colour", () => {
  const green = { r: 0, g: 128 / 255, b: 0 };

  it("writes each notation, the alpha only when it is not opaque", () => {
    expect(formatColour(green, 1, "hex")).toBe("#008000");
    expect(formatColour(green, 1, "rgb")).toBe("rgb(0 128 0)");
    expect(formatColour(green, 1, "hsl")).toBe("hsl(120 100% 25%)");
    expect(formatColour(green, 0.5, "rgb")).toBe("rgb(0 128 0 / 0.5)");
    expect(formatColour(green, 0.5, "hsl")).toBe("hsl(120 100% 25% / 0.5)");
  });

  it("reads back what it writes as the same colour", () => {
    for (const hex of ["#3b82f6", "#000000", "#ffffff", "#808080", "#ff00ff"]) {
      const colour = parseColour(hex);
      if (colour === null) throw new Error(`${hex} did not parse`);
      for (const format of ["hex", "rgb"] as const) {
        expect(read(formatColour(colour, 1, format))).toBe(hex);
      }
    }
  });

  it("converts between rgb and hsl both ways", () => {
    const hsl = rgbToHsl({ r: 1, g: 0, b: 0 });
    expect(hsl).toEqual({ h: 0, s: 1, l: 0.5 });
    const back = hslToRgb(hsl);
    expect(back).toEqual({ r: 1, g: 0, b: 0 });
    expect(rgbToHsl({ r: 0.5, g: 0.5, b: 0.5 })).toEqual({
      h: 0,
      s: 0,
      l: 0.5,
    });
  });
});
