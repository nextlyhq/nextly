/**
 * A shadow read as CSS reads it: its layers, and in each layer the parts an
 * author would set as fields, and what is certainly wrong with one.
 */
import { describe, expect, it } from "vitest";

import { shadowLayerParts } from "./css-value";
import { checkTokenKind, tokenKindExample } from "./site-token-kind";

/** Each layer's parts as `kind:text`, the shape a reader compares. */
function partsOf(text: string): string[][] {
  return shadowLayerParts(text).map(layer =>
    layer.map(part => `${part.kind}:${part.text}`)
  );
}

describe("a shadow's layers and parts", () => {
  it("reads one layer's sizes and colour", () => {
    expect(partsOf("0 4px 12px rgba(0, 0, 0, 0.2)")).toEqual([
      ["length:0", "length:4px", "length:12px", "colour:rgba(0, 0, 0, 0.2)"],
    ]);
  });

  it("splits layers at the commas between them, not inside a function", () => {
    expect(
      partsOf("inset 0 1px 0 rgba(255,255,255,.2), 0 2px 4px #0003")
    ).toEqual([
      [
        "inset:inset",
        "length:0",
        "length:1px",
        "length:0",
        "colour:rgba(255,255,255,.2)",
      ],
      ["length:0", "length:2px", "length:4px", "colour:#0003"],
    ]);
  });

  it("keeps a reference apart from a colour, since it may stand for either", () => {
    expect(partsOf("0 2px 4px var(--site-color-text)")).toEqual([
      [
        "length:0",
        "length:2px",
        "length:4px",
        "reference:var(--site-color-text)",
      ],
    ]);
  });

  it("names a size through a function, a bare number and a word for what they are", () => {
    expect(partsOf("calc(1px + 1px) 2 shady")).toEqual([
      ["function:calc(1px + 1px)", "unitless:2", "unknown:shady"],
    ]);
  });

  it("reads a negative offset with its amount", () => {
    const [layer] = shadowLayerParts("-2px 3px");
    expect(layer?.map(part => part.amount)).toEqual([-2, 3]);
  });
});

describe("a shadow variable's value", () => {
  it.each([
    "0 1px 2px rgba(0,0,0,.2)",
    "none",
    "inset 0 1px 0 #fff",
    "0 1px 2px red, inset 0 0 0 1px var(--site-color-border)",
    "0 0 0 1px currentcolor",
    "1px 2px",
    "0 2px 4px 1px #000",
    // A size through a function this does not compute still passes.
    "calc(1px + 2px) 2px 4px #000",
    "var(--shadow-a), 0 1px 2px #000",
    "inherit",
  ])("stays quiet about %s", value => {
    expect(checkTokenKind("shadow", value)).toBeUndefined();
  });

  it.each([
    ["0 4px 12pxred", '"12pxred", which is not a size or a colour'],
    ["0 4 12px #000", '"4", a number with no unit where a size goes'],
    ["0 2px banana", '"banana", which is not a size or a colour'],
    ["4px #000", "no X and Y offset"],
    ["1px 2px 3px 4px 5px #000", "more than four sizes"],
    ["0 2px 4px red blue", "two colours"],
    ["0 2px -4px #000", "a negative blur"],
    ["0 2px 4px #000,", "an empty layer"],
    ["inset inset 0 2px", '"inset" twice'],
    ["0 2px 20deg #000", '"20deg", which is not a size or a colour'],
  ])("says what is wrong with %s", (value, said) => {
    expect(checkTokenKind("shadow", value)).toContain(said);
  });

  it("offers an example to copy", () => {
    expect(tokenKindExample("shadow")).toBe(
      "a shadow, such as 0 2px 4px rgba(0, 0, 0, 0.2)"
    );
  });
});
