/**
 * The shape of a complete theme. A theme is data, not CSS: one definition
 * feeds both the browser stylesheet and the contrast validator, so the colors
 * asserted are exactly the colors rendered.
 *
 * Token keys omit the `--nx-` prefix; the generator adds it. Dark is authored
 * in full rather than derived from light, because a lightness inversion does
 * not preserve contrast and can leave the sRGB gamut.
 */

export type LayoutId =
  | "rail-panel"
  | "single-sidebar"
  | "topbar-sidebar"
  | "right-panel"
  | "rail-only";

export type DensityId = "compact" | "default" | "comfortable";

/** Token name without the `--nx-` prefix, mapped to a CSS color value. */
export type ThemeTokens = Record<string, string>;

export interface ThemeDefinition {
  id: string;
  label: string;
  group: "nextly" | "tweakcn";
  recommendedLayout: LayoutId;
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
] as const satisfies readonly string[];
