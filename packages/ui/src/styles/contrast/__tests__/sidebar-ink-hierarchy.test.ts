/**
 * Guards that an active navigation row is distinguishable from a resting one,
 * by whichever signal its mode uses.
 *
 * Contrast pairings cannot catch this. Each token was individually far above AA
 * against the sidebar surface at the point dark mode had resting and active ink
 * set to the same near-white value, and the whole pair passed while the
 * hierarchy was gone. What has to be asserted is the RELATIONSHIP between them.
 *
 * The two modes mark the state differently, so the contract is per mode and is
 * declared in {@link MODE_SIGNAL} rather than inferred from the tokens:
 *
 * - **dark** holds resting ink a step back from active, in the direction that
 *   mode needs — emphasis is lighter on a dark surface.
 * - **light** paints both inks at the reference palette's value and marks the
 *   row with its fill plus a font-weight change. The fill is roughly 1.11:1,
 *   far below the 3:1 WCAG 1.4.11 asks of a state indicator, so it cannot carry
 *   the state alone; the weight change is what satisfies the criterion, being a
 *   difference that is not a colour and so not subject to a ratio at all.
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
 * Which signal each mode uses to mark the active row. DECLARED, not derived:
 * this is the palette's decision, and reading it back out of the tokens would
 * let a mode that lost its signal by accident be scored against the weaker
 * contract instead of failing.
 *
 * Dark holds resting ink a step back from active. Light paints both at the
 * reference palette's value and marks the row with fill plus font weight.
 */
const MODE_SIGNAL: Record<"light" | "dark", "ink" | "fill"> = {
  light: "fill",
  dark: "ink",
};

/**
 * Where the active row is rendered. When the fill carries the state, 1.4.11
 * still applies -- it scopes 3:1 to information required to identify a
 * component's STATE, and there is no exemption for a large filled region (that
 * is 1.4.3, and it is about text). A fill at roughly 1.11:1 therefore cannot be
 * the only signal, so the row also has to carry something that is not a colour.
 */
const MENU_BUTTON = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../admin/src/components/layout/sidebar/index.tsx"
);

/** A weight change is the non-colour signal; any of these three carries it. */
const MARKER = /data-\[active=true\]:font-(?:medium|semibold|bold)/;

/**
 * Every variant that renders an active row, each anchored to something stable
 * in the source rather than to a line number.
 */
const ACTIVE_ROW_VARIANTS = [
  { label: "menu button", anchor: "const sidebarMenuButtonVariants" },
  { label: "menu sub-button", anchor: 'data-sidebar="menu-sub-button"' },
] as const;

/**
 * The source from a variant's anchor to the next one, so a marker belonging to
 * one variant cannot satisfy the assertion for another. The last variant runs
 * to end of file.
 */
function variantSource(source: string, anchor: string): string {
  const start = source.indexOf(anchor);
  if (start === -1) return "";
  const rest = ACTIVE_ROW_VARIANTS.map(v => source.indexOf(v.anchor)).filter(
    at => at > start
  );
  return source.slice(start, rest.length > 0 ? Math.min(...rest) : undefined);
}

/**
 * How far the active fill must sit from the sidebar surface. Light mode ships
 * 0.94 against 0.99, which is 1.11:1; the floor sits just under that, so the
 * shipped pair passes with no slack and a fill nudged toward the surface fails.
 *
 * This is NOT a 1.4.11 threshold and must not be read as one. 1.4.11 asks 3:1
 * of a state indicator and this is nowhere near it; the fill is held to a floor
 * only so it does not vanish entirely. What satisfies the criterion is the
 * non-colour signal asserted alongside it.
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

  const signal = MODE_SIGNAL[mode.name];

  describe(`sidebar ink hierarchy (${mode.name})`, () => {
    // Which branch runs is read from MODE_SIGNAL, a DECLARED policy, never from
    // the tokens themselves. Deriving it -- "do the two inks differ?" -- makes
    // the check answer a question the values get to decide: dark ink collapsing
    // by accident would silently move that mode onto the fill branch, which its
    // fill happens to pass at 1.48:1, and the exact regression this file exists
    // for would come back green.
    //
    // That regression: dark mode once had one ink value for both states, each
    // individually far above AA against the surface, and the whole suite passed
    // while the hierarchy was gone.
    if (signal === "ink") {
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
      it("keeps the fill distinguishable from the surface", () => {
        const surface = paint(SURFACE);
        const fill = paint(ACTIVE_FILL);
        const ratio = contrastRatio(surface, fill);

        expect(
          ratio,
          `${mode.name}: ${ACTIVE_FILL} ${toHex(fill)} against ${SURFACE} ` +
            `${toHex(surface)} is ${ratio.toFixed(2)}:1. The fill carries the ` +
            `active state in this mode, so it cannot merge into the surface.`
        ).toBeGreaterThanOrEqual(MIN_FILL_SEPARATION);
      });

      it("carries a non-colour signal as well as the fill", () => {
        // The fill alone is about 1.11:1, well under the 3:1 that 1.4.11 asks
        // of a state indicator, so on its own it would leave a low-vision user
        // unable to tell which row is selected. A weight change is not a colour
        // and is not subject to a contrast ratio, which is what makes it the
        // repair rather than a second faint tint.
        //
        // Asserted against the component source because that is where the
        // signal lives; a token file cannot show whether anything renders it.
        // Checked per VARIANT, not file-wide. Both the top-level menu button
        // and the sub-button render active rows, and a count over the whole
        // file passes while one of them has lost its marker -- the other
        // occurrence covers for it, and active sub-navigation silently falls
        // back to the fill alone.
        const source = readFileSync(MENU_BUTTON, "utf8");
        const fill = contrastRatio(paint(SURFACE), paint(ACTIVE_FILL)).toFixed(
          2
        );
        const unmarked = ACTIVE_ROW_VARIANTS.filter(
          variant => !variantSource(source, variant.anchor).match(MARKER)
        ).map(variant => variant.label);

        expect(
          unmarked,
          `${mode.name}: these sidebar variants apply no weight change for ` +
            `data-[active=true], so the ${fill}:1 fill is the only thing ` +
            `marking their active row. Add a non-colour signal, or separate ` +
            `${RESTING} from ${ACTIVE} so the ink carries it.`
        ).toEqual([]);
      });
    }
  });
}
