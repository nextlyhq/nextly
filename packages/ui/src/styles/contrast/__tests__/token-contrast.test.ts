/**
 * Asserts that every foreground/surface and boundary/surface pair the admin
 * renders meets its WCAG minimum, in both light and dark mode, reading the real
 * `--nx-*` tokens straight from `theme.css`. Translucent tokens (borders) are
 * composited over their surface first, so the ratio asserted is the one that
 * renders on screen. A failing pair names both composited colors and the exact
 * ratio so the fix is obvious.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { contrastRatio, toHex, toOpaque } from "../color";
import { PAIRINGS, THRESHOLDS } from "../pairings";
import { parseThemeTokens, resolveToken, type TokenMap } from "../parse-theme";

const THEME_CSS = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../theme.css"
);

const { light, dark } = parseThemeTokens(readFileSync(THEME_CSS, "utf8"));

// A last-resort base for compositing: surfaces in this theme are opaque, so it
// is never actually used, but it keeps the check correct if one ever gains an
// alpha rather than silently trusting the raw translucent value.
const OPAQUE_BASE = { r: 1, g: 1, b: 1, alpha: 1 } as const;

const MODES: ReadonlyArray<{ name: string; tokens: TokenMap }> = [
  { name: "light", tokens: light },
  { name: "dark", tokens: dark },
];

for (const mode of MODES) {
  describe(`token contrast (${mode.name})`, () => {
    it.each(PAIRINGS)("$label ($fg on $bg)", pairing => {
      const required = THRESHOLDS[pairing.kind];

      // Surface first, so a translucent foreground can be blended onto it.
      const surface = toOpaque(
        resolveToken(mode.tokens, pairing.bg),
        OPAQUE_BASE
      );
      const foreground = toOpaque(
        resolveToken(mode.tokens, pairing.fg),
        surface
      );
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
