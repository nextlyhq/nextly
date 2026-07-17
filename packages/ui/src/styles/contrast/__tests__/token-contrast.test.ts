/**
 * Asserts that every foreground/surface and boundary/surface pair the admin
 * renders meets its WCAG minimum, in both light and dark mode, reading the real
 * tokens straight from `theme.css`. Translucent tokens and alpha utilities are
 * composited over their surface first, and `color-mix()` shades are evaluated,
 * so the ratio asserted is the one that renders on screen. A failing pair names
 * both composited colors and the exact ratio so the fix is obvious.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { compositeOver, contrastRatio, toHex, type Rgb } from "../color";
import { PAIRINGS, THRESHOLDS, type Pairing } from "../pairings";
import {
  parseThemeScale,
  parseThemeTokens,
  type TokenMap,
} from "../parse-theme";
import { resolveColor, withAlpha, type ResolveContext } from "../resolve";

const THEME_CSS = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../theme.css"
);

const css = readFileSync(THEME_CSS, "utf8");
const { light, dark } = parseThemeTokens(css);
const scale = parseThemeScale(css);

// A last-resort base for compositing an unexpectedly translucent surface; the
// real surfaces are opaque, so it is never used, but it keeps the check correct
// rather than trusting a raw translucent value.
const OPAQUE_BASE: Rgb = { r: 1, g: 1, b: 1, alpha: 1 };

const opaque = (c: Rgb, base: Rgb): Rgb =>
  c.alpha < 1 ? compositeOver(c, base) : c;

/** Resolve the surface a pairing sits on, compositing any alpha tint. */
function surfaceOf(pairing: Pairing, ctx: ResolveContext): Rgb {
  const raw = resolveColor(`var(${pairing.bg})`, ctx);
  if (pairing.bgAlpha !== undefined) {
    const over = resolveColor(
      `var(${pairing.bgOver ?? "--color-background"})`,
      ctx
    );
    return compositeOver(
      withAlpha(raw, pairing.bgAlpha),
      opaque(over, OPAQUE_BASE)
    );
  }
  return opaque(raw, OPAQUE_BASE);
}

/** Resolve the foreground, applying any alpha, composited onto its surface. */
function foregroundOf(
  pairing: Pairing,
  ctx: ResolveContext,
  surface: Rgb
): Rgb {
  let fg = resolveColor(`var(${pairing.fg})`, ctx);
  if (pairing.fgAlpha !== undefined) fg = withAlpha(fg, pairing.fgAlpha);
  return opaque(fg, surface);
}

const MODES: ReadonlyArray<{ name: "light" | "dark"; tokens: TokenMap }> = [
  { name: "light", tokens: light },
  { name: "dark", tokens: dark },
];

for (const mode of MODES) {
  const ctx: ResolveContext = { tokens: mode.tokens, scale };
  const applicable = PAIRINGS.filter(
    p => p.mode === undefined || p.mode === mode.name
  );

  describe(`token contrast (${mode.name})`, () => {
    it.each(applicable)("$label ($fg on $bg)", pairing => {
      const required = THRESHOLDS[pairing.kind];

      const surface = surfaceOf(pairing, ctx);
      const foreground = foregroundOf(pairing, ctx, surface);
      const ratio = contrastRatio(foreground, surface);

      expect(
        ratio,
        `${mode.name}: ${pairing.label} — ${pairing.fg} ${toHex(foreground)} on ` +
          `${pairing.bg} ${toHex(surface)} = ${ratio.toFixed(2)}:1, ` +
          `needs ${required}:1 (${pairing.kind})`
      ).toBeGreaterThanOrEqual(required);
    });
  });
}
