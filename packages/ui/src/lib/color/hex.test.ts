/**
 * Hex is what a person types, so the cases that matter are the ones a person produces: a partial
 * string mid-keystroke, a pasted short form, mixed case, a stray space, and alpha.
 */
import { describe, expect, it } from "vitest";

import { rgbToHsv, hsvToRgb } from "./convert";
import { parseHex, toHex } from "./hex";

/** Channel bytes, which is what a hex string actually carries. */
const bytes = (hex: string): number[] => {
  const parsed = parseHex(hex);
  if (!parsed) throw new Error(`expected ${hex} to parse`);
  return [parsed.r, parsed.g, parsed.b, parsed.alpha].map(n =>
    Math.round(n * 255)
  );
};

describe("reading a hex colour", () => {
  it("reads the long form, with and without alpha", () => {
    expect(bytes("#3b82f6")).toEqual([59, 130, 246, 255]);
    expect(bytes("#3b82f680")).toEqual([59, 130, 246, 128]);
  });

  it("expands a short form by repeating each digit, not by padding", () => {
    // `#abc` is `#aabbcc`. Padding with zero would make it `#a0b0c0`, under which `#fff` is not
    // white — the one case that makes the difference impossible to miss.
    expect(bytes("#fff")).toEqual([255, 255, 255, 255]);
    expect(bytes("#abc")).toEqual(bytes("#aabbcc"));
    expect(bytes("#abcd")).toEqual(bytes("#aabbccdd"));
  });

  it("accepts what people actually paste", () => {
    expect(bytes("3B82F6")).toEqual(bytes("#3b82f6"));
    expect(bytes("  #3b82f6  ")).toEqual(bytes("#3b82f6"));
  });

  it("returns null rather than guessing", () => {
    // Mid-keystroke is the ordinary case for a field someone is typing into, so "not a colour yet"
    // has to be answerable without an exception and without a silent black.
    expect(parseHex("#3b8")).not.toBeNull();
    for (const input of [
      "",
      "#",
      "#3",
      "#3b",
      "#3b82f",
      "#3b82f6g",
      "blue",
      "#3b82f6aa1",
    ]) {
      expect(parseHex(input), `${input} should not parse`).toBeNull();
    }
  });
});

describe("writing a hex colour", () => {
  it("omits the alpha pair when the colour is opaque", () => {
    // `#3b82f6ff` is the same colour, and the short form is what someone expects to read back out
    // of a field they typed `#3b82f6` into.
    expect(toHex({ r: 59 / 255, g: 130 / 255, b: 246 / 255 })).toBe("#3b82f6");
    expect(toHex({ r: 1, g: 1, b: 1 }, 1)).toBe("#ffffff");
  });

  it("writes it when the colour is not", () => {
    expect(toHex({ r: 0, g: 0, b: 0 }, 0)).toBe("#00000000");
    expect(toHex({ r: 1, g: 1, b: 1 }, 128 / 255)).toBe("#ffffff80");
  });

  it("still produces a valid hex string when a channel is out of range", () => {
    // Values wrong by a LOT, not by floating-point drift: drift rounds to the right byte on its
    // own, so a near-boundary fixture passes with or without the clamp and proves nothing. A
    // channel left in 0-255, or a computation that overshot, is what would otherwise emit
    // something nothing downstream can parse.
    expect(toHex({ r: 1.5, g: -0.5, b: 0.5 })).toBe("#ff0080");
    expect(toHex({ r: 255, g: 0, b: 0 })).toBe("#ff0000");
    expect(toHex({ r: 0, g: 0, b: 0 }, 4)).toBe("#000000");
  });
});

describe("a channel that is not a number at all", () => {
  it("still produces a valid hex string", () => {
    // `clamp01(NaN)` is NaN — both of its comparisons are false — and formatting that yields the
    // three characters "NaN", producing `#NaN0000`. That is precisely the string this module
    // documents itself as never returning, so the guarantee was false rather than merely untested.
    expect(toHex({ r: NaN, g: 0, b: 0 })).toBe("#000000");
    expect(toHex({ r: 0, g: Infinity, b: -Infinity })).toBe("#000000");
    expect(toHex({ r: 1, g: 1, b: 1 }, NaN)).toBe("#ffffff");
  });

  it("treats a non-finite alpha as opaque, not as invisible", () => {
    // A channel's neutral value is 0 and an alpha's is 1 — this parameter's own default. Falling
    // back to 0 would turn a colour invisible on a stray NaN, silently, with nothing in the output
    // to say why.
    expect(toHex({ r: 0, g: 0, b: 0 }, NaN)).toBe("#000000");
    expect(toHex({ r: 0, g: 0, b: 0 }, 0)).toBe("#00000000");
  });

  it("never emits a string a parser would reject", () => {
    // The property the individual cases are examples of: whatever goes in, what comes out is a
    // hex colour this module can read back.
    for (const value of [NaN, Infinity, -Infinity, 1e9, -1e9]) {
      const written = toHex({ r: value, g: value, b: value }, value);
      expect(parseHex(written), `${value} produced ${written}`).not.toBeNull();
    }
  });
});

describe("hex against the conversions it sits beside", () => {
  it("survives a round trip through the picker's own geometry", () => {
    // The pairing that matters in practice: a colour typed as hex, dragged on the saturation
    // square, and written back. Byte-exact, because a picker that shifts a colour the user did not
    // touch is the defect this guards.
    for (const hex of ["#000000", "#ffffff", "#3b82f6", "#ff0000", "#7f7f7f"]) {
      const parsed = parseHex(hex);
      if (!parsed) throw new Error(`expected ${hex} to parse`);
      expect(toHex(hsvToRgb(rgbToHsv(parsed)))).toBe(hex);
    }
  });

  it("carries alpha through a round trip untouched", () => {
    const parsed = parseHex("#3b82f640");
    if (!parsed) throw new Error("expected the alpha form to parse");
    expect(toHex(hsvToRgb(rgbToHsv(parsed)), parsed.alpha)).toBe("#3b82f640");
  });
});
