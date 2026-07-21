/**
 * Branding colors reach the browser as `--nx-*` custom properties that the
 * theme consumes directly (`--color-primary: var(--nx-primary)`), so anything
 * these helpers emit has to be a complete CSS color and has to land on the
 * class the admin actually renders. Both were wrong before: a bare "H S% L%"
 * triplet computed to `rgba(0,0,0,0)`, and the server-rendered rule targeted a
 * class that exists nowhere, so branded admins painted transparent surfaces.
 */
import { describe, expect, it } from "vitest";

import {
  getBrandingCss,
  getForegroundForBackground,
  hexToCssColor,
  isValidHex,
} from "../color-utils";

/** A bare triplet is not a color; `hsl(...)`/`oklch(...)`/`#hex` are. */
const COMPLETE_CSS_COLOR = /^(hsl|oklch|rgb)\(|^#[0-9a-fA-F]{3,8}$/;

describe("hexToCssColor", () => {
  it("emits a complete CSS color, not a bare triplet", () => {
    expect(hexToCssColor("#6366f1")).toMatch(COMPLETE_CSS_COLOR);
  });

  it("preserves the converted hue, saturation and lightness", () => {
    expect(hexToCssColor("#6366f1")).toBe("hsl(238.7 83.5% 66.7%)");
  });

  it.each([
    ["#000000", "hsl(0 0% 0%)"],
    ["#ffffff", "hsl(0 0% 100%)"],
  ])("handles the achromatic bound %s", (hex, expected) => {
    expect(hexToCssColor(hex)).toBe(expected);
  });
});

describe("getForegroundForBackground", () => {
  it("returns white on a dark background, as a complete color", () => {
    const fg = getForegroundForBackground("#000000");
    expect(fg).toBe("hsl(0 0% 100%)");
    expect(fg).toMatch(COMPLETE_CSS_COLOR);
  });

  it("returns the dark tone on a light background, as a complete color", () => {
    const fg = getForegroundForBackground("#ffffff");
    expect(fg).toBe("hsl(222.2 47.4% 11.2%)");
    expect(fg).toMatch(COMPLETE_CSS_COLOR);
  });
});

describe("isValidHex", () => {
  it.each(["#6366f1", "#ABCDEF"])("accepts %s", v =>
    expect(isValidHex(v)).toBe(true)
  );

  it.each(["6366f1", "#fff", "#6366f", "rgb(1,2,3)", ""])("rejects %s", v =>
    expect(isValidHex(v)).toBe(false)
  );
});

describe("getBrandingCss", () => {
  it("returns null when no colors are configured", () => {
    expect(getBrandingCss(undefined)).toBeNull();
    expect(getBrandingCss({})).toBeNull();
    expect(getBrandingCss({ colors: {} })).toBeNull();
  });

  it("returns null when every configured color is invalid", () => {
    expect(getBrandingCss({ colors: { primary: "nope" } })).toBeNull();
  });

  it("targets .nextly-admin, the class the admin root renders", () => {
    const css = getBrandingCss({ colors: { primary: "#6366f1" } });

    expect(css).toContain(".nextly-admin, .nextly-admin.dark {");
    // The rule previously targeted a class that is rendered nowhere.
    expect(css).not.toContain("adminapp");
  });

  it("writes the --nx-* tokens the theme actually defines", () => {
    const css = getBrandingCss({
      colors: { primary: "#6366f1", accent: "#f59e0b" },
    });

    for (const token of [
      "--nx-primary:",
      "--nx-primary-foreground:",
      "--nx-ring:",
      "--nx-focus-ring:",
      "--nx-sidebar-ring:",
      "--nx-chart-1:",
      "--nx-accent:",
      "--nx-accent-foreground:",
      "--nx-chart-2:",
    ]) {
      expect(css).toContain(token);
    }
  });

  it("never writes an unprefixed token, which nothing consumes", () => {
    const css = getBrandingCss({
      colors: { primary: "#6366f1", accent: "#f59e0b" },
    });

    // e.g. "--primary:" would be dead weight; only "--nx-primary:" is read.
    expect(css).not.toMatch(/[^-]--primary:/);
    expect(css).not.toMatch(/[^-]--accent:/);
  });

  it("assigns only complete CSS colors", () => {
    const css =
      getBrandingCss({ colors: { primary: "#6366f1", accent: "#f59e0b" } }) ??
      "";

    const values = [...css.matchAll(/--nx-[\w-]+:\s*([^;]+);/g)].map(m =>
      m[1].trim()
    );

    expect(values.length).toBeGreaterThan(0);
    for (const value of values) {
      expect(value).toMatch(COMPLETE_CSS_COLOR);
    }
  });

  it("emits only the accent tokens when only accent is configured", () => {
    const css = getBrandingCss({ colors: { accent: "#f59e0b" } }) ?? "";

    expect(css).toContain("--nx-accent:");
    expect(css).not.toContain("--nx-primary:");
  });
});
