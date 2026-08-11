/**
 * The shape of a complete theme. A theme is data, not CSS: one definition
 * feeds both the browser stylesheet and the contrast validator, so the colors
 * asserted are exactly the colors rendered.
 *
 * Token keys omit the `--nx-` prefix; the generator adds it. Dark is authored
 * in full rather than derived from light, because a lightness inversion does
 * not preserve contrast and can leave the sRGB gamut.
 */

export type DensityId = "compact" | "default" | "comfortable";

/** Token name without the `--nx-` prefix, mapped to a CSS color value. */
export type ThemeTokens = Record<string, string>;

export interface ThemeDefinition {
  id: string;
  label: string;
  /**
   * One line saying what makes this theme different, shown beside its swatch
   * strip in the switcher. Required on both groups so the picker renders every
   * row the same way: the Nextly originals are hand-written because the
   * difference between them is an intent no token can express, and the tweakcn
   * presets are derived mechanically by the importer from their own radius and
   * colours so a regeneration cannot leave the list half-labelled.
   */
  description: string;
  group: "nextly" | "tweakcn";
  recommendedDensity: DensityId;
  /** Value for the unprefixed `--radius` knob the whole radius scale derives from. */
  radius: string;
  fontSans: string;
  fontMono: string;
  fontSerif?: string;
  light: ThemeTokens;
  dark: ThemeTokens;
}

/**
 * Every token a theme must set. A partial theme would inherit leftovers from
 * whichever theme rendered before it, which reads as a design choice rather
 * than the bug it is, so completeness is asserted rather than assumed.
 */
export const REQUIRED_TOKENS = [
  "background",
  "page-background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "highlight",
  "highlight-foreground",
  "destructive",
  "destructive-solid",
  "destructive-foreground",
  "success",
  "success-solid",
  "success-foreground",
  "warning",
  "warning-foreground",
  "border-subtle",
  "border",
  "border-strong",
  "input",
  "ring",
  "focus-ring",
  "shadow-color",
  // Code-block syntax highlighting. Asserted by the shared contrast harness
  // (packages/ui/src/styles/contrast/pairings.ts) because code blocks render
  // real text a reader must be able to read, not decoration.
  "code-bg",
  "code-fg",
  "code-comment",
  "code-keyword",
  "code-string",
  "code-number",
  "code-function",
  "code-operator",
  "code-punctuation",
  "code-variable",
  "code-tag",
  "code-deleted",
  "code-inserted",
  "sidebar-background",
  "sidebar-foreground",
  "sidebar-primary",
  "sidebar-primary-foreground",
  "sidebar-accent",
  "sidebar-accent-foreground",
  "sidebar-border",
  "sidebar-ring",
  "table-border",
  "table-row-hover",
  // The header, footer and pagination band. Required like any other surface:
  // left out, a theme repaints the page and the cards while the table header
  // keeps the SHIPPED neutral, and the completeness check cannot see the gap
  // because the token is not on this list.
  "table-header-bg",
] as const satisfies readonly string[];

/**
 * Tokens a theme MAY declare, and which are derived when it does not.
 *
 * The chart slots are the only ones so far. They are not required because a
 * palette borrowed from elsewhere has no chart colours to state, and demanding
 * five per theme would mean inventing them; `generate-css` derives those from
 * roles every theme already declares instead. A theme that DOES state them
 * keeps them, which is what lets the control hold the shipped values rather
 * than a derivation of its own roles.
 *
 * Listed rather than merely tolerated: without this, the rule keeping stray
 * tokens out of a theme would have to be relaxed to "anything goes", and a
 * genuine typo would stop being caught.
 */
export const OPTIONAL_TOKENS = [
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
] as const satisfies readonly string[];
