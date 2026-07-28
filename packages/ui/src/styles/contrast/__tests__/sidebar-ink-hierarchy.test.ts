/**
 * Guards the two-step relationship between the sidebar's resting and active ink.
 *
 * The nav paints `text-sidebar-foreground` at rest and
 * `text-sidebar-accent-foreground` when a row is active or hovered, so the two
 * tokens have to differ for the active row to read as emphasised. Contrast
 * pairings cannot catch this: each token was individually far above AA against
 * the sidebar surface at the point dark mode had them set to the same near-white
 * value, and the whole pair passed while the hierarchy was gone. What has to be
 * asserted is the relationship between them, in the direction each mode needs —
 * emphasis is darker than rest on a light surface and lighter on a dark one.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { contrastRatio, relativeLuminance, toHex } from "../color";
import {
  parseThemeScale,
  parseThemeTokens,
  type TokenMap,
} from "../parse-theme";
import { resolveColor, type ResolveContext } from "../resolve";

const css = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../theme.css"),
  "utf8"
);
const { light, dark } = parseThemeTokens(css);
const scale = parseThemeScale(css);

const RESTING = "--nx-sidebar-foreground";
const ACTIVE = "--nx-sidebar-accent-foreground";
const SURFACE = "--nx-sidebar-background";

/**
 * How far apart the two states must be. Light mode ships slate-600 against
 * slate-900, which is 1.73:1; the floor sits just under that so the shipped pair
 * passes with no slack to spare and any collapse toward a single value fails.
 */
const MIN_STATE_SEPARATION = 1.6;

const MODES: ReadonlyArray<{ name: "light" | "dark"; tokens: TokenMap }> = [
  { name: "light", tokens: light },
  { name: "dark", tokens: dark },
];

for (const mode of MODES) {
  const ctx: ResolveContext = { tokens: mode.tokens, scale };
  const paint = (token: string): ReturnType<typeof resolveColor> =>
    resolveColor(`var(${token})`, ctx);

  describe(`sidebar ink hierarchy (${mode.name})`, () => {
    it("separates the resting and active states", () => {
      const resting = paint(RESTING);
      const active = paint(ACTIVE);
      const ratio = contrastRatio(resting, active);

      expect(
        ratio,
        `${mode.name}: ${RESTING} ${toHex(resting)} and ${ACTIVE} ` +
          `${toHex(active)} differ by only ${ratio.toFixed(2)}:1, below the ` +
          `${MIN_STATE_SEPARATION}:1 the nav needs for an active row to read ` +
          `as emphasised by its ink rather than only by its fill`
      ).toBeGreaterThanOrEqual(MIN_STATE_SEPARATION);
    });

    it("moves the active state away from the surface, not toward it", () => {
      const surface = relativeLuminance(paint(SURFACE));
      const resting = relativeLuminance(paint(RESTING));
      const active = relativeLuminance(paint(ACTIVE));
      // On a light surface emphasis is the darker ink, on a dark surface the
      // lighter one. Both cases reduce to: active is further from the surface.
      const restingDistance = Math.abs(resting - surface);
      const activeDistance = Math.abs(active - surface);

      expect(
        activeDistance,
        `${mode.name}: ${ACTIVE} sits closer to ${SURFACE} than ${RESTING} ` +
          `does, so the active row is the less prominent of the two`
      ).toBeGreaterThan(restingDistance);
    });
  });
}
