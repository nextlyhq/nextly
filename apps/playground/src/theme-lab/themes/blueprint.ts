/**
 * Blueprint: the admin as a technical drawing.
 *
 * Design intent. Three moves, all of them structural rather than decorative.
 * Neutrals sit at hue 220 with chroma near 0.015, a cool grey-cyan that reads
 * as drafting film rather than as a blue theme. Rules are drawn heavier than
 * Mono's so a table or a form section looks ruled, like a drawing sheet, not
 * merely divided. And the mono face is declared as IBM Plex Mono, the closest
 * widely available type to engineering lettering, so every id, slug, and code
 * span shares the drawing's voice.
 *
 * Light mode is ink on film; dark mode is the cyanotype -- pale lines on a deep
 * navy-black, which is where the blueprint name comes from and where the theme
 * is at its most distinct.
 */
import type { ThemeDefinition } from "../types";

export const BLUEPRINT: ThemeDefinition = {
  id: "blueprint",
  label: "Blueprint",
  description:
    "Technical drafting. Cool grey-cyan, mono numerals, tight 2px corners.",
  group: "nextly",
  // A drawing packs information tightly; loose spacing would undo the premise.
  recommendedDensity: "compact",
  // Just enough to avoid a knife edge on inputs while still reading as drawn.
  radius: "2px",
  fontSans: "var(--font-inter), Inter, sans-serif",
  fontMono: "var(--font-ibm-plex-mono), ui-monospace, monospace",
  light: {
    background: "oklch(0.9915 0.005 220)",
    // The sheet the drawing sits on, a step cooler and darker than the surface.
    "page-background": "oklch(0.9645 0.012 220)",
    foreground: "oklch(0.215 0.03 245)",
    card: "oklch(0.9915 0.005 220)",
    "card-foreground": "oklch(0.215 0.03 245)",
    popover: "oklch(0.9915 0.005 220)",
    "popover-foreground": "oklch(0.215 0.03 245)",
    // Drafting ink: a navy so dark it behaves like black in layout, but shows
    // its hue where it fills a button or a selected row.
    primary: "oklch(0.3 0.075 250)",
    "primary-foreground": "oklch(0.99 0.005 220)",
    secondary: "oklch(0.955 0.014 220)",
    "secondary-foreground": "oklch(0.215 0.03 245)",
    muted: "oklch(0.958 0.012 220)",
    // Held at 0.52 so it clears 4.5:1 on `muted`, the darkest surface it lands
    // on, not just on the near-white card.
    "muted-foreground": "oklch(0.52 0.022 235)",
    accent: "oklch(0.5 0.1 235)",
    "accent-foreground": "oklch(1 0 0)",
    // A drafting marker rather than a highlighter: cyan sits in the theme's own
    // hue family, so emphasis does not import a foreign colour.
    highlight: "oklch(0.9 0.13 200)",
    "highlight-foreground": "oklch(0.215 0.03 245)",
    destructive: "oklch(0.55 0.2 27)",
    "destructive-solid": "oklch(0.55 0.2 27)",
    "destructive-foreground": "oklch(1 0 0)",
    success: "oklch(0.5 0.14 155)",
    "success-solid": "oklch(0.5 0.14 155)",
    "success-foreground": "oklch(1 0 0)",
    warning: "oklch(0.548 0.15 75)",
    "warning-foreground": "oklch(0.215 0.03 245)",
    "code-bg": "oklch(0.962 0.012 220)",
    "code-fg": "oklch(0.215 0.03 245)",
    "code-comment": "oklch(0.52 0.022 235)",
    "code-keyword": "oklch(0.46 0.16 285)",
    "code-string": "oklch(0.45 0.11 175)",
    "code-number": "oklch(0.5 0.13 55)",
    "code-function": "oklch(0.45 0.13 250)",
    "code-operator": "oklch(0.48 0.13 350)",
    "code-punctuation": "oklch(0.52 0.022 235)",
    "code-variable": "oklch(0.47 0.1 62)",
    "code-tag": "oklch(0.5 0.18 28)",
    "code-deleted": "oklch(0.5 0.18 28)",
    "code-inserted": "oklch(0.45 0.11 175)",
    // Rules, not hairlines. The alpha runs above Mono's 0.445 so a ruled table
    // reads as drawn lines; the tint is navy rather than black for the same
    // reason the shadow is -- a neutral black rule would look like dirt on film.
    "border-subtle": "oklch(0.25 0.05 240 / 0.14)",
    border: "oklch(0.25 0.05 240 / 0.55)",
    "border-strong": "oklch(0.25 0.05 240 / 0.66)",
    input: "oklch(0.6 0.03 235)",
    // Reference, not a literal: tracks --nx-primary if a theme changes it.
    ring: "var(--nx-primary)",
    "focus-ring": "var(--nx-primary)",
    "shadow-color": "oklch(0.3 0.04 240)",
    "sidebar-background": "oklch(0.9645 0.012 220)",
    "sidebar-foreground": "oklch(0.34 0.028 240)",
    "sidebar-primary": "oklch(0.3 0.075 250)",
    "sidebar-primary-foreground": "oklch(0.99 0.005 220)",
    "sidebar-accent": "oklch(0.938 0.016 220)",
    "sidebar-accent-foreground": "oklch(0.215 0.03 245)",
    "sidebar-border": "oklch(0.6 0.03 235)",
    "sidebar-ring": "var(--nx-primary)",
    "table-border": "var(--nx-border)",
    "table-row-hover": "oklch(0.968 0.01 220)",
  },
  dark: {
    // Cyanotype. The whole dark surface carries hue 245 at a chroma high enough
    // to be unmistakably blue-black, which is a deliberate departure from the
    // near-neutral dark the light mode's low chroma would have implied.
    background: "oklch(0.155 0.028 245)",
    "page-background": "oklch(0.155 0.028 245)",
    foreground: "oklch(0.955 0.008 220)",
    card: "oklch(0.2 0.032 245)",
    "card-foreground": "oklch(0.955 0.008 220)",
    popover: "oklch(0.245 0.034 245)",
    "popover-foreground": "oklch(0.955 0.008 220)",
    // Inverted from light: the drawing's line colour becomes the pale one, so
    // a primary button is a bright line-weight block on navy.
    primary: "oklch(0.88 0.055 225)",
    "primary-foreground": "oklch(0.16 0.03 245)",
    secondary: "oklch(0.285 0.035 245)",
    "secondary-foreground": "oklch(0.955 0.008 220)",
    muted: "oklch(0.285 0.035 245)",
    "muted-foreground": "oklch(0.72 0.025 230)",
    // Lighter than the light-mode accent would suggest, but still dark enough
    // for white type: white on the light value (0.5) is comfortable, so the
    // dark value is nudged only slightly to sit off the navy surface.
    accent: "oklch(0.52 0.1 235)",
    "accent-foreground": "oklch(1 0 0)",
    highlight: "oklch(0.8 0.12 200)",
    "highlight-foreground": "oklch(0.16 0.03 245)",
    // Text tokens lighten against navy; `-solid` holds the light-mode value so
    // white type on a filled destructive or success button still clears AA.
    destructive: "oklch(0.7 0.18 27)",
    "destructive-solid": "oklch(0.55 0.2 27)",
    "destructive-foreground": "oklch(1 0 0)",
    success: "oklch(0.72 0.15 155)",
    "success-solid": "oklch(0.5 0.14 155)",
    "success-foreground": "oklch(1 0 0)",
    warning: "oklch(0.78 0.14 75)",
    "warning-foreground": "oklch(0.16 0.03 245)",
    "code-bg": "oklch(0.2 0.032 245)",
    "code-fg": "oklch(0.955 0.008 220)",
    "code-comment": "oklch(0.68 0.025 230)",
    "code-keyword": "oklch(0.77 0.12 285)",
    "code-string": "oklch(0.79 0.12 175)",
    "code-number": "oklch(0.8 0.12 55)",
    "code-function": "oklch(0.76 0.11 250)",
    "code-operator": "oklch(0.78 0.12 350)",
    "code-punctuation": "oklch(0.68 0.025 230)",
    "code-variable": "oklch(0.81 0.1 62)",
    "code-tag": "oklch(0.74 0.14 28)",
    "code-deleted": "oklch(0.74 0.14 28)",
    "code-inserted": "oklch(0.79 0.12 175)",
    // Pale cyan-white lines rather than plain white alpha, so the rules keep
    // the cyanotype cast. Alpha is raised to 0.5 because a tinted line loses
    // luminance against navy faster than a pure white one does.
    "border-subtle": "oklch(0.92 0.04 220 / 0.12)",
    border: "oklch(0.92 0.04 220 / 0.5)",
    "border-strong": "oklch(0.92 0.04 220 / 0.6)",
    input: "oklch(0.53 0.03 235)",
    ring: "var(--nx-primary)",
    "focus-ring": "var(--nx-primary)",
    // Near-black navy: deeper than the surface so elevation still reads, and
    // hued so a raised card does not cast a grey shadow on a blue sheet.
    "shadow-color": "oklch(0.09 0.03 245)",
    "sidebar-background": "oklch(0.135 0.026 245)",
    "sidebar-foreground": "oklch(0.955 0.008 220)",
    "sidebar-primary": "oklch(0.88 0.055 225)",
    "sidebar-primary-foreground": "oklch(0.16 0.03 245)",
    "sidebar-accent": "oklch(0.285 0.035 245)",
    "sidebar-accent-foreground": "oklch(0.955 0.008 220)",
    "sidebar-border": "oklch(0.5 0.035 235)",
    "sidebar-ring": "var(--nx-primary)",
    "table-border": "var(--nx-border)",
    "table-row-hover": "oklch(0.225 0.033 245)",
  },
};
