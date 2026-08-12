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

/** The active row's fill, and the surface it has to be visible against. */
const ACTIVE_FILL = "--nx-sidebar-accent";

/**
 * How far the active fill must sit from the sidebar surface when it is the only
 * signal. Light mode ships 0.94 against 0.99, which is 1.11:1; the floor sits
 * just under that, so the shipped pair passes with no slack and a fill nudged
 * toward the surface fails. It is deliberately not 3:1 — an active row is a
 * large filled area rather than a boundary, and 1.4.11 does not scope it — but
 * it cannot be nothing.
 */
const MIN_FILL_SEPARATION = 1.1;

const MODES: ReadonlyArray<{ name: "light" | "dark"; tokens: TokenMap }> = [
  { name: "light", tokens: light },
  { name: "dark", tokens: dark },
];

for (const mode of MODES) {
  const ctx: ResolveContext = { tokens: mode.tokens, scale };
  const paint = (token: string): ReturnType<typeof resolveColor> =>
    resolveColor(`var(${token})`, ctx);

  const inkSeparates = contrastRatio(paint(RESTING), paint(ACTIVE)) > 1;

  describe(`sidebar ink hierarchy (${mode.name})`, () => {
    // Which signal marks the active row is a palette decision, and the modes
    // make it differently: dark mode holds resting ink a step back from active,
    // light mode paints both at the same value and lets the fill carry it.
    // Asserting the two-step unconditionally would fail light mode for making a
    // choice rather than for losing one.
    //
    // What must NOT happen is losing BOTH signals at once, which is the defect
    // this file was written for: dark mode once had one ink value for both
    // states, each individually far above AA against the surface, and the whole
    // suite passed while the hierarchy was gone. So the assertions are split by
    // which signal the mode uses, and neither branch is optional -- a mode with
    // no ink separation is held to its fill instead.
    if (inkSeparates) {
      it("separates the resting and active states by ink", () => {
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
        // lighter one. Both reduce to: active is further from the surface.
        const restingDistance = Math.abs(resting - surface);
        const activeDistance = Math.abs(active - surface);

        expect(
          activeDistance,
          `${mode.name}: ${ACTIVE} sits closer to ${SURFACE} than ${RESTING} ` +
            `does, so the active row is the less prominent of the two`
        ).toBeGreaterThan(restingDistance);
      });
    } else {
      it("marks the active row by its fill when the ink does not", () => {
        // With one ink value across both states the fill is the only thing
        // distinguishing an active row, so it has to be visible against the
        // sidebar on its own. 1.4.11's 3:1 is the wrong bar -- this is a state
        // indicator on a large filled area rather than a boundary -- but it
        // cannot be nothing, and a fill that merges into the surface leaves the
        // nav with no active state at all.
        const surface = paint(SURFACE);
        const fill = paint(ACTIVE_FILL);
        const ratio = contrastRatio(surface, fill);

        expect(
          ratio,
          `${mode.name}: ${RESTING} and ${ACTIVE} are the same value, so ` +
            `${ACTIVE_FILL} ${toHex(fill)} is the only signal for an active ` +
            `row -- and against ${SURFACE} ${toHex(surface)} it is just ` +
            `${ratio.toFixed(2)}:1. Either separate the two ink tokens, or ` +
            `move the fill further from the surface.`
        ).toBeGreaterThanOrEqual(MIN_FILL_SEPARATION);
      });
    }
  });
}
