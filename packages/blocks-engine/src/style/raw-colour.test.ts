/**
 * Which colour values do not follow the site's light and dark variables.
 */
import { describe, expect, it } from "vitest";

import { isRawColour } from "./raw-colour";

describe("isRawColour", () => {
  it("flags a colour written as a value", () => {
    expect(isRawColour("#1d2b6b")).toBe(true);
    expect(isRawColour("rgb(0 0 0 / 50%)")).toBe(true);
    expect(isRawColour("oklch(70% 0.1 250)")).toBe(true);
    expect(isRawColour("rebeccapurple")).toBe(true);
  });

  it("does not flag a variable, which follows light and dark", () => {
    expect(isRawColour({ $token: "color.text" })).toBe(false);
    expect(isRawColour("var(--site-color-text)")).toBe(false);
    expect(
      isRawColour("color-mix(in srgb, var(--site-color-text), white)")
    ).toBe(false);
  });

  it("does not flag light-dark(), which carries a value for each mode", () => {
    expect(isRawColour("light-dark(#fff, #111)")).toBe(false);
    expect(isRawColour("LIGHT-DARK(#fff, #111)")).toBe(false);
  });

  it("does not flag a keyword that takes its colour from somewhere else", () => {
    for (const keyword of [
      "currentColor",
      "transparent",
      "inherit",
      "initial",
      "unset",
      "revert",
      "revert-layer",
      "none",
    ]) {
      expect(isRawColour(keyword), keyword).toBe(false);
    }
  });

  it("does not flag what holds no colour at all", () => {
    expect(isRawColour(undefined)).toBe(false);
    expect(isRawColour("")).toBe(false);
    expect(isRawColour("   ")).toBe(false);
    expect(isRawColour(0)).toBe(false);
  });
});
