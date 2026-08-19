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

  /**
   * The two cases above are the achromatic EXTREMES, where every candidate
   * ordering agrees and a broken comparison still lands on the right answer.
   * They passed against an implementation that compared the dark option using
   * the ratio for pure black while returning slate-900. A mid-tone brand is the
   * separating case, so it is the one asserted by measured ratio below.
   */
  const luminance = (hex: string): number => {
    const clean = hex.replace("#", "");
    const channel = (offset: number) => {
      const c = parseInt(clean.slice(offset, offset + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  };
  const ratio = (a: string, b: string): number => {
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };
  /** The hex each emitted CSS color stands for, so a ratio can be computed. */
  const HEX_FOR_CSS: Record<string, string> = {
    "hsl(0 0% 100%)": "#ffffff",
    "hsl(222.2 47.4% 11.2%)": "#0f172a",
    "hsl(0 0% 0%)": "#000000",
  };

  it.each([
    // A mid-tone indigo: white 4.47 and slate-900 4.00 both miss AA, black
    // reaches 4.70. The shipped picker chose slate-900 here and produced 4.00.
    "#6366f1",
    // A mid-tone green and a mid-tone red, so the case is not one lucky colour.
    "#2e8b57",
    "#c2410c",
  ])("picks a foreground that MEETS AA on %s", background => {
    const fg = getForegroundForBackground(background);
    const hex = HEX_FOR_CSS[fg];
    // The emitted value must be one this test can measure, or the assertion
    // below would silently pass on an unrecognised colour.
    expect(hex, `unmeasurable foreground ${fg}`).toBeDefined();
    expect(
      ratio(background, hex as string),
      `${fg} on ${background} is below AA for normal text`
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("prefers the designed dark tone over pure black when it already passes", () => {
    // The escalation must not fire where the designed pair works: a very light
    // background clears AA with slate-900, so black would be a needless change
    // of the product's look.
    expect(getForegroundForBackground("#f8fafc")).toBe(
      "hsl(222.2 47.4% 11.2%)"
    );
  });

  it("returns the best available foreground when nothing can reach AA", () => {
    // A mid-grey has no accessible foreground at all: white and black both land
    // near 3.9. The picker still returns the higher of the two rather than
    // inventing a colour, and the shortfall is a fact about the brand.
    const fg = getForegroundForBackground("#808080");
    const hex = HEX_FOR_CSS[fg];
    expect(hex).toBeDefined();
    expect(ratio("#808080", hex as string)).toBeGreaterThanOrEqual(
      ratio("#808080", "#ffffff")
    );
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
