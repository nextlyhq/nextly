/**
 * The union exists so a token survives being stored. Every case below is a
 * value that would otherwise be mistaken for the other member of it — and the
 * consequence of each mistake is not symmetric: treating a literal as a token
 * loses a colour, while treating a token as a literal loses the LINK, so the
 * page stops following the site's theme and nothing reports it.
 */
import { describe, expect, it } from "vitest";

import { colorTokenName, isColorTokenValue, resolveColorValue } from "./value";

describe("telling a token from a colour", () => {
  it("recognises a token reference", () => {
    expect(isColorTokenValue({ $token: "color.primary" })).toBe(true);
    expect(colorTokenName({ $token: "color.primary" })).toBe("color.primary");
  });

  it("treats a literal colour as a literal", () => {
    expect(isColorTokenValue("#3b82f6")).toBe(false);
    expect(colorTokenName("#3b82f6")).toBeNull();
  });

  it.each([
    ["an array", []],
    ["null", null],
    ["a number", 7],
    ["an object with no $token", { token: "color.primary" }],
    ["a $token that is not a string", { $token: 7 }],
  ])("rejects %s", (_label, value) => {
    expect(isColorTokenValue(value)).toBe(false);
  });

  it.each([
    [
      "an array carrying $token",
      Object.assign([], { $token: "color.primary" }),
    ],
    [
      "a class instance carrying $token",
      new (class {
        $token = "color.primary";
      })(),
    ],
  ])("rejects %s, which is not a plain object", (_label, value) => {
    // The separating cases. Every rejection above is already satisfied by the
    // `$token` test alone, so they pass whether or not the shape is checked at
    // all — these are the only ones that require it. The array matters because
    // it reaches storage looking like a token and serializes to `[]`, losing
    // the reference with nothing to report it.
    expect(isColorTokenValue(value)).toBe(false);
  });
});

describe("resolving a value to a colour", () => {
  const tokens = { "color.primary": "#3b82f6" };

  it("looks a token up in the site's tokens", () => {
    expect(resolveColorValue({ $token: "color.primary" }, tokens)).toBe(
      "#3b82f6"
    );
  });

  it("returns a literal unchanged", () => {
    // The positive control: a resolver that answered null for everything would
    // satisfy the absent-token case below.
    expect(resolveColorValue("#ff0000", tokens)).toBe("#ff0000");
  });

  it("answers null for a token the site does not define", () => {
    // Not a fallback colour. A swatch that confidently renders the wrong colour
    // is worse than one that renders nothing, because only one of them is
    // visible as a problem.
    expect(resolveColorValue({ $token: "color.ghost" }, tokens)).toBeNull();
  });

  it.each(["constructor", "toString", "valueOf"])(
    "answers null for the inherited name %s",
    name => {
      // A token name is a dot path with no reserved words, so these are legal
      // names a site can define. Read off an ordinary object they resolve to
      // functions from the prototype — not a colour, and not the null the
      // signature promises.
      expect(resolveColorValue({ $token: name }, tokens)).toBeNull();
    }
  );

  it("still resolves a token the site DOES define", () => {
    // The positive control for the three above: refusing every inherited name
    // by refusing everything would satisfy them.
    expect(resolveColorValue({ $token: "color.primary" }, tokens)).toBe(
      "#3b82f6"
    );
  });

  it("answers null for a token when no lookup is supplied", () => {
    expect(resolveColorValue({ $token: "color.primary" })).toBeNull();
  });
});
