/**
 * Unit tests for the color resolver: `var()` following across the token and
 * scale maps, and `color-mix(in srgb, ...)` evaluation. These pin the engine
 * that lets the contrast check assert `color-mix()` shades, independent of the
 * theme, so a parsing or mixing regression fails here with a precise value.
 */
import { describe, expect, it } from "vitest";

import { toHex } from "../color";
import { type TokenMap } from "../parse-theme";
import { applyOpacity, resolveColor, type ResolveContext } from "../resolve";

const tokens: TokenMap = new Map([
  ["--nx-red", "oklch(0.5778 0.2078 25.33)"],
  ["--nx-alias", "var(--nx-red)"],
]);
const scale: TokenMap = new Map([
  ["--color-red", "var(--nx-red)"],
  ["--color-red-100", "color-mix(in srgb, var(--nx-red), white 90%)"],
  ["--color-red-700", "color-mix(in srgb, var(--nx-red), black 30%)"],
  ["--color-half", "color-mix(in srgb, white, black 50%)"],
]);
const ctx: ResolveContext = { tokens, scale };

describe("resolveColor", () => {
  it("parses a bare literal", () => {
    expect(toHex(resolveColor("#123456", ctx))).toBe("#123456");
  });

  it("follows a var() into the token map", () => {
    expect(toHex(resolveColor("var(--nx-red)", ctx))).toBe(
      toHex(resolveColor("oklch(0.5778 0.2078 25.33)", ctx))
    );
  });

  it("follows a var() across the scale and token maps", () => {
    // --color-red -> var(--nx-red) -> the literal.
    expect(toHex(resolveColor("var(--color-red)", ctx))).toBe(
      toHex(resolveColor("var(--nx-red)", ctx))
    );
  });

  it("follows a transitive alias", () => {
    expect(toHex(resolveColor("var(--nx-alias)", ctx))).toBe(
      toHex(resolveColor("var(--nx-red)", ctx))
    );
  });

  it("throws on a missing reference", () => {
    expect(() => resolveColor("var(--nx-missing)", ctx)).toThrow(/not found/);
  });
});

describe("color-mix(in srgb, ...)", () => {
  it("mixes white and black 50% to a mid gray (#808080)", () => {
    // 0.5 in each channel rounds to 0x80.
    expect(toHex(resolveColor("var(--color-half)", ctx))).toBe("#808080");
  });

  it("a single stated percentage applies to that side, the other is its complement", () => {
    // white 90% -> the base contributes 10%. Equivalent to an explicit split.
    const oneSided = resolveColor(
      "color-mix(in srgb, var(--nx-red), white 90%)",
      ctx
    );
    const explicit = resolveColor(
      "color-mix(in srgb, var(--nx-red) 10%, white 90%)",
      ctx
    );
    expect(toHex(oneSided)).toBe(toHex(explicit));
  });

  it("mixing toward white lightens (a -100 shade is near white)", () => {
    const shade = resolveColor("var(--color-red-100)", ctx);
    expect(shade.r).toBeGreaterThan(0.9);
    expect(shade.g).toBeGreaterThan(0.9);
    expect(shade.b).toBeGreaterThan(0.9);
  });

  it("mixing toward black darkens (a -700 shade is darker than the base)", () => {
    const base = resolveColor("var(--nx-red)", ctx);
    const shade = resolveColor("var(--color-red-700)", ctx);
    expect(shade.r).toBeLessThan(base.r);
  });
});

describe("applyOpacity", () => {
  it("keeps the color channels and scales an opaque base to the factor", () => {
    const c = resolveColor("var(--nx-red)", ctx);
    const faded = applyOpacity(c, 0.5);
    expect(faded.alpha).toBe(0.5);
    expect({ r: faded.r, g: faded.g, b: faded.b }).toEqual({
      r: c.r,
      g: c.g,
      b: c.b,
    });
  });

  it("multiplies an already-translucent base rather than overwriting it", () => {
    // Matches Tailwind's `color-mix(... NN%, transparent)`: a token that is
    // already 0.4 alpha under `/50` renders at 0.2, not 0.5. `0.4 * 0.5` is
    // exactly 0.2 in IEEE 754, so this is an exact equality, not approximate.
    const faded = applyOpacity({ r: 0, g: 0, b: 0, alpha: 0.4 }, 0.5);
    expect(faded.alpha).toBe(0.2);
  });
});
