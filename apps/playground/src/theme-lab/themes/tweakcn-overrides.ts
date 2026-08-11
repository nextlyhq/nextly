/**
 * Accessibility corrections applied on top of imported tweakcn presets.
 *
 * WHY THIS EXISTS RATHER THAN EDITING THE GENERATED FILE.
 * `tweakcn.generated.ts` is written by `scripts/import-tweakcn.mjs` and says
 * "do not edit by hand" for a good reason: the next import overwrites it. An
 * accessibility fix applied there would be silently reverted by a routine
 * regeneration, and nothing would fail -- the theme would simply go back to
 * missing WCAG AA while still looking maintained. Corrections live here so a
 * regeneration composes with them instead of erasing them.
 *
 * WHAT A CORRECTION MAY DO. Only lightness (and border alpha) moves; hue and
 * chroma are never touched. A tweakcn preset's identity is its palette, so a
 * corrected preset must still be recognisably that preset -- otherwise it
 * should be a Nextly original with its own name rather than someone else's
 * theme wearing changed colours.
 *
 * WHAT THIS IS NOT. It is not a place to make a preset "better". Every entry
 * exists because a measured pairing fell below the threshold WCAG requires,
 * and each records the value it replaced so the change is auditable.
 *
 * @module themes/tweakcn-overrides
 */
import type { ThemeDefinition, ThemeTokens } from "../types";

/**
 * Per-mode token replacements for one preset.
 *
 * `ThemeTokens` rather than `Partial<ThemeTokens>`: it is already an index
 * signature with no required keys, so a subset satisfies it -- while
 * `Partial<>` would widen every value to `string | undefined` and spreading
 * that into a complete token map would smuggle `undefined` past the type.
 */
interface ThemeOverride {
  reason: string;
  light?: ThemeTokens;
  dark?: ThemeTokens;
}

export const TWEAKCN_OVERRIDES: Record<string, ThemeOverride> = {
  "tweakcn-vercel": {
    reason:
      "14 asserted pairings below WCAG AA, from four tokens: a light-mode " +
      "destructive too pale to read as text, and boundary tokens (input, " +
      "border-strong, sidebar-border) sitting near their surfaces in both " +
      "modes. Solved to 5.0 (text) and 3.4 (boundary) so the values keep " +
      "headroom above the gate rather than resting on it.",
    light: {
      // 3.73:1 as text on the page -> 5.0:1. Hue and chroma unchanged, so it
      // is the same red.
      destructive: "oklch(0.5661 0.19 23.03)",
      // The BUTTON FILL, a separate token from the text one. Vercel sets both
      // to the same value, so correcting only `destructive` left white type on
      // an uncorrected fill at 3.84:1 -- a fix that looked complete because
      // the count fell from 14 to 1.
      "destructive-solid": "oklch(0.5661 0.19 23.03)",
      // 1.16:1 against the page: a field edge indistinguishable from the
      // space around it, which is the "checkboxes are barely visible" report.
      input: "oklch(0.6373 0 0)",
      "border-strong": "oklch(0.6300 0 0)",
      "sidebar-border": "oklch(0.6300 0 0)",
    },
    dark: {
      input: "oklch(0.5190 0 0)",
      "sidebar-border": "oklch(0.5190 0 0)",
    },
  },
};

/**
 * Applies the corrections to a preset, returning a new definition.
 *
 * Returns the input unchanged when a preset has no override, so an
 * uncorrected preset is the same object and cannot pick up a copy's drift.
 */
export function withOverride(theme: ThemeDefinition): ThemeDefinition {
  const override = TWEAKCN_OVERRIDES[theme.id];
  if (!override) return theme;
  return {
    ...theme,
    light: { ...theme.light, ...override.light },
    dark: { ...theme.dark, ...override.dark },
  };
}
