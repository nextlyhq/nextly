/**
 * The derivation behind every tweakcn preset's description.
 *
 * Asserted here on fixed inputs rather than only through the generated file:
 * the generated file's own test proves it agrees with this code, but not that
 * this code is right about anything. A hex whose hue lands in the wrong band
 * would satisfy the agreement test on both sides at once.
 */
import { describe, expect, it } from "vitest";

import { describePreset, toOklch } from "../tweakcn-description.mjs";

describe("colour reading", () => {
  it("reads hex and oklch as the same colour", () => {
    // Pure white in both notations: the two parsing paths have to agree or a
    // preset's description would depend on how its author happened to spell
    // a colour rather than on what the colour is.
    const hex = toOklch("#ffffff");
    const oklch = toOklch("oklch(1 0 0)");
    expect(hex.l).toBeCloseTo(oklch.l, 3);
    expect(hex.c).toBeCloseTo(oklch.c, 3);
  });

  it("expands shorthand hex", () => {
    expect(toOklch("#fff").l).toBeCloseTo(toOklch("#ffffff").l, 6);
  });

  it("reads the hue of a known colour", () => {
    // tailwind blue-500, the primary of several presets. OKLCH puts blue near
    // 260 degrees, nowhere near HSL's 217 for the same colour -- the reason
    // the hue bands can't be borrowed from an HSL wheel.
    const blue = toOklch("#3b82f6");
    expect(blue.h).toBeGreaterThan(240);
    expect(blue.h).toBeLessThan(275);
  });

  it("refuses a notation it cannot read", () => {
    expect(() => toOklch("hsl(210 40% 50%)")).toThrow(/cannot read colour/);
  });
});

describe("preset description", () => {
  const neutral = { primary: "#000000", background: "#ffffff" };

  it("names the radius band", () => {
    expect(describePreset("0px", neutral)).toMatch(/^Sharp corners,/);
    expect(describePreset("0.35rem", neutral)).toMatch(/^Soft corners,/);
    expect(describePreset("0.625rem", neutral)).toMatch(/^Rounded corners,/);
    expect(describePreset("1.5rem", neutral)).toMatch(/^Pill corners,/);
  });

  it("calls a grey primary achromatic rather than naming a hue", () => {
    // A near-black at 0 chroma technically has a hue; naming it would be
    // precise about something no one can see.
    expect(
      describePreset("0.5rem", { ...neutral, primary: "#171717" })
    ).toContain("achromatic primary");
  });

  it("names the hue family of a coloured primary", () => {
    expect(
      describePreset("0.5rem", { ...neutral, primary: "#3b82f6" })
    ).toContain("blue primary");
    expect(
      describePreset("0.5rem", { ...neutral, primary: "#22c55e" })
    ).toContain("green primary");
    expect(
      describePreset("0.5rem", { ...neutral, primary: "#f59e0b" })
    ).toContain("amber primary");
  });

  it("reads surface temperature off the background tint", () => {
    // Solarized's cream and a lavender-tinted white: both are off-whites, and
    // the only thing separating them is a hue the swatch strip renders at 13
    // pixels square.
    expect(
      describePreset("0.5rem", { ...neutral, background: "#fdf6e3" })
    ).toContain("warm surfaces");
    expect(
      describePreset("0.5rem", { ...neutral, background: "#f5f5ff" })
    ).toContain("cool surfaces");
  });

  it("calls a surface neutral when its tint is below visibility", () => {
    // Pure white, and an off-white whose cast (0.005 chroma) is real in the
    // numbers but not on screen -- calling that one "warm" would be a
    // description of the hex rather than of the theme.
    expect(describePreset("0.5rem", neutral)).toContain("neutral surfaces");
    expect(
      describePreset("0.5rem", { ...neutral, background: "#faf9f5" })
    ).toContain("neutral surfaces");
  });

  it("refuses a radius it cannot read", () => {
    expect(() => describePreset("var(--radius)", neutral)).toThrow(
      /cannot read radius/
    );
  });
});
