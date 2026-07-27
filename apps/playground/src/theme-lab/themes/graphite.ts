/**
 * Graphite: Mono with the temperature turned around.
 *
 * Design intent. Mono's neutrals sit at hue ~260, a cool blue-grey that reads
 * as "screen". Graphite keeps the identical achromatic structure (black
 * primary, grey accent, no brand colour anywhere) and moves every neutral to
 * hue 70, the warm grey of pencil on paper. Chroma stays under 0.02 so the
 * surfaces read as grey rather than beige; the warmth should be felt, not
 * named. The only other change is a 4px radius, enough to soften Mono's hard
 * 0px corners without becoming a rounded, consumer-looking UI.
 */
import type { ThemeDefinition } from "../types";

export const GRAPHITE: ThemeDefinition = {
  id: "graphite",
  label: "Graphite",
  group: "nextly",
  recommendedDensity: "default",
  // Softens Mono's square corners by one step; small enough that dense tables
  // and inputs still align on a strict grid.
  radius: "4px",
  fontSans: "var(--font-inter), Inter, sans-serif",
  fontMono:
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  light: {
    // Surfaces are off-white rather than pure white: at 0.9955 lightness the
    // warmth is visible next to a white browser chrome without dimming the page.
    background: "oklch(0.9955 0.0035 70)",
    "page-background": "oklch(0.9735 0.006 70)",
    foreground: "oklch(0.2145 0.014 70)",
    card: "oklch(0.9955 0.0035 70)",
    "card-foreground": "oklch(0.2145 0.014 70)",
    popover: "oklch(0.9955 0.0035 70)",
    "popover-foreground": "oklch(0.2145 0.014 70)",
    // Primary stays achromatic. Graphite is a temperature change, not the
    // introduction of a brand colour, so the highest-emphasis surface in the
    // admin remains pure black exactly as in Mono.
    primary: "oklch(0 0 0)",
    "primary-foreground": "oklch(1 0 0)",
    secondary: "oklch(0.9605 0.007 70)",
    "secondary-foreground": "oklch(0.2145 0.014 70)",
    muted: "oklch(0.9645 0.006 70)",
    // Held at 0.525 so it still clears 4.5:1 against `muted`, the darkest of the
    // four surfaces it is painted on.
    "muted-foreground": "oklch(0.525 0.0145 70)",
    accent: "oklch(0.5285 0.016 70)",
    "accent-foreground": "oklch(1 0 0)",
    // Amber rather than Mono's lemon yellow: hue 85 sits with the warm greys
    // instead of cutting across them.
    highlight: "oklch(0.905 0.145 85)",
    "highlight-foreground": "oklch(0.2145 0.014 70)",
    destructive: "oklch(0.5655 0.2 27)",
    "destructive-solid": "oklch(0.5655 0.2 27)",
    "destructive-foreground": "oklch(1 0 0)",
    success: "oklch(0.5185 0.165 149.2)",
    "success-solid": "oklch(0.5185 0.165 149.2)",
    "success-foreground": "oklch(1 0 0)",
    warning: "oklch(0.5535 0.158 68)",
    "warning-foreground": "oklch(0.2145 0.014 70)",
    // Syntax hues are kept wide apart rather than pulled warm: a reader tells
    // keyword from string from number by hue, so collapsing the palette toward
    // 70 would cost more than the warmth gains. Only the code surface warms.
    "code-bg": "oklch(0.9765 0.006 70)",
    "code-fg": "oklch(0.2145 0.014 70)",
    "code-comment": "oklch(0.535 0.014 70)",
    "code-keyword": "oklch(0.4882 0.2172 303.9)",
    "code-string": "oklch(0.4478 0.1189 152.1)",
    "code-number": "oklch(0.5106 0.1518 44.2)",
    "code-function": "oklch(0.4757 0.1444 254.6)",
    "code-operator": "oklch(0.4936 0.1418 8.4)",
    "code-punctuation": "oklch(0.535 0.014 70)",
    "code-variable": "oklch(0.4694 0.1173 62.3)",
    "code-tag": "oklch(0.5054 0.1905 27.5)",
    "code-deleted": "oklch(0.5054 0.1905 27.5)",
    "code-inserted": "oklch(0.4478 0.1189 152.1)",
    // Rules are a warm near-black at low alpha rather than pure black, so a
    // hairline picks up the surface temperature instead of looking soot-grey.
    "border-subtle": "oklch(0.22 0.015 70 / 0.08)",
    border: "oklch(0.22 0.015 70 / 0.5)",
    "border-strong": "oklch(0.22 0.015 70 / 0.56)",
    input: "oklch(0.6305 0.0145 70)",
    // Reference, not a literal: tracks --nx-primary if a theme changes it.
    ring: "var(--nx-primary)",
    "focus-ring": "var(--nx-primary)",
    // Warm dark rather than black: at 5-10% alpha a black shadow over a warm
    // surface greys it out, while this keeps elevation the same temperature.
    "shadow-color": "oklch(0.3 0.02 70)",
    "sidebar-background": "oklch(0.9955 0.0035 70)",
    "sidebar-foreground": "oklch(0.3715 0.0145 70)",
    "sidebar-primary": "oklch(0.2145 0.014 70)",
    "sidebar-primary-foreground": "oklch(0.9845 0.004 70)",
    "sidebar-accent": "oklch(0.9605 0.007 70)",
    "sidebar-accent-foreground": "oklch(0.2145 0.014 70)",
    "sidebar-border": "oklch(0.6295 0.0145 70)",
    "sidebar-ring": "var(--nx-primary)",
    "table-border": "var(--nx-border)",
    "table-row-hover": "oklch(0.9785 0.005 70)",
  },
  dark: {
    // Dark is authored, not inverted. The near-black carries the same hue 70
    // at a lower chroma, because a warm cast reads much stronger against black
    // than against white and would tip into brown at the light-mode chroma.
    background: "oklch(0.1455 0.006 70)",
    "page-background": "oklch(0.1455 0.006 70)",
    foreground: "oklch(0.9785 0.004 70)",
    card: "oklch(0.1985 0.008 70)",
    "card-foreground": "oklch(0.9785 0.004 70)",
    popover: "oklch(0.2425 0.009 70)",
    "popover-foreground": "oklch(0.9785 0.004 70)",
    primary: "oklch(1 0 0)",
    "primary-foreground": "oklch(0.2145 0.014 70)",
    secondary: "oklch(0.2835 0.01 70)",
    "secondary-foreground": "oklch(0.9785 0.004 70)",
    muted: "oklch(0.2835 0.01 70)",
    "muted-foreground": "oklch(0.7185 0.0135 70)",
    accent: "oklch(0.5285 0.016 70)",
    "accent-foreground": "oklch(1 0 0)",
    highlight: "oklch(0.79 0.135 85)",
    "highlight-foreground": "oklch(0.2145 0.014 70)",
    // Status text lightens so it reads on the dark surface, while `-solid`
    // stays dark enough for white button text to clear 4.5:1 on the fill.
    destructive: "oklch(0.655 0.19 27)",
    "destructive-solid": "oklch(0.5655 0.2 27)",
    "destructive-foreground": "oklch(1 0 0)",
    success: "oklch(0.6 0.1921 149.58)",
    "success-solid": "oklch(0.5225 0.1921 149.58)",
    "success-foreground": "oklch(1 0 0)",
    warning: "oklch(0.7686 0.155 68)",
    "warning-foreground": "oklch(0.2145 0.014 70)",
    "code-bg": "oklch(0.1985 0.008 70)",
    "code-fg": "oklch(0.9785 0.004 70)",
    "code-comment": "oklch(0.6685 0.0135 70)",
    "code-keyword": "oklch(0.7482 0.1235 303.9)",
    "code-string": "oklch(0.7654 0.1476 152.1)",
    "code-number": "oklch(0.7807 0.1189 44.2)",
    "code-function": "oklch(0.7365 0.1163 254.6)",
    "code-operator": "oklch(0.7549 0.1234 8.4)",
    "code-punctuation": "oklch(0.6685 0.0135 70)",
    "code-variable": "oklch(0.7938 0.1052 62.3)",
    "code-tag": "oklch(0.7118 0.1476 27.5)",
    "code-deleted": "oklch(0.7118 0.1476 27.5)",
    "code-inserted": "oklch(0.7654 0.1476 152.1)",
    // Borders flip to white alpha: a dark rule on a dark surface disappears,
    // so the boundary has to be drawn with light instead.
    "border-subtle": "oklch(1 0 0 / 0.08)",
    border: "oklch(1 0 0 / 0.38)",
    "border-strong": "oklch(1 0 0 / 0.44)",
    input: "oklch(0.5455 0.014 70)",
    ring: "var(--nx-primary)",
    "focus-ring": "var(--nx-primary)",
    // Deeper than the light-mode shadow: elevation on a near-black surface has
    // to be darker than the surface to read at all, so the warmth is kept and
    // the lightness dropped rather than reusing the light value.
    "shadow-color": "oklch(0.18 0.015 70)",
    "sidebar-background": "oklch(0.1455 0.006 70)",
    "sidebar-foreground": "oklch(0.9785 0.004 70)",
    "sidebar-primary": "oklch(0.9785 0.004 70)",
    "sidebar-primary-foreground": "oklch(0.2145 0.014 70)",
    "sidebar-accent": "oklch(0.2835 0.01 70)",
    "sidebar-accent-foreground": "oklch(0.9785 0.004 70)",
    "sidebar-border": "oklch(0.5045 0.013 70)",
    "sidebar-ring": "var(--nx-primary)",
    "table-border": "var(--nx-border)",
    "table-row-hover": "oklch(0.2835 0.01 70)",
  },
};
