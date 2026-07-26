/**
 * Ink: the admin as a printed page.
 *
 * Design intent. Everything that normally separates regions in a CMS -- tinted
 * panels, elevation, rounded cards -- is removed, and structure is carried by
 * rules and typography alone, the way a newspaper or a book does it. The page,
 * the card, and the popover are the same paper (`page-background` equals
 * `background`), corners are square, and boundaries are the lightest hairline
 * that is still legally a boundary. A serif face is declared so long-form
 * fields can be set in it while the UI chrome stays sans.
 *
 * Neutrals are strictly achromatic -- zero chroma, not "almost grey". A page
 * this flat shows any hue cast immediately, and the theme's whole claim is that
 * nothing is tinted.
 */
import type { ThemeDefinition } from "../types";

export const INK: ThemeDefinition = {
  id: "ink",
  label: "Ink",
  group: "nextly",
  // A masthead over a single column of content is the editorial reading shape;
  // a narrow icon rail would fight the theme's calm.
  recommendedLayout: "topbar-sidebar",
  // Print-like leading. The theme trades density for legibility on purpose.
  recommendedDensity: "comfortable",
  radius: "0px",
  fontSans: "var(--font-inter), Inter, sans-serif",
  fontMono:
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  // Available to long-form content so an editor writing prose sees prose.
  fontSerif: "var(--font-source-serif), serif",
  light: {
    // Pure paper. Page and card are identical, so a form does not sit in a
    // floating white box on a grey field -- it is simply set on the page.
    background: "oklch(1 0 0)",
    "page-background": "oklch(1 0 0)",
    foreground: "oklch(0 0 0)",
    card: "oklch(1 0 0)",
    "card-foreground": "oklch(0 0 0)",
    popover: "oklch(1 0 0)",
    "popover-foreground": "oklch(0 0 0)",
    primary: "oklch(0 0 0)",
    "primary-foreground": "oklch(1 0 0)",
    secondary: "oklch(0.96 0 0)",
    "secondary-foreground": "oklch(0 0 0)",
    muted: "oklch(0.965 0 0)",
    "muted-foreground": "oklch(0.52 0 0)",
    // Accent is a solid black block with white type, the editorial device for
    // emphasis, rather than Mono's mid-grey fill.
    accent: "oklch(0 0 0)",
    "accent-foreground": "oklch(1 0 0)",
    // A marker stripe over text: high chroma, high lightness, black type on it.
    highlight: "oklch(0.94 0.16 100)",
    "highlight-foreground": "oklch(0 0 0)",
    // Statuses are printing inks -- darker and less saturated than a screen
    // palette -- so they read as part of the page rather than as UI chrome.
    destructive: "oklch(0.52 0.19 27)",
    "destructive-solid": "oklch(0.52 0.19 27)",
    "destructive-foreground": "oklch(1 0 0)",
    success: "oklch(0.5 0.14 150)",
    "success-solid": "oklch(0.5 0.14 150)",
    "success-foreground": "oklch(1 0 0)",
    warning: "oklch(0.53 0.13 70)",
    "warning-foreground": "oklch(0 0 0)",
    // The one tinted surface in the theme, and barely: a code block needs to be
    // identifiable as a block, and a hairline alone is not enough at a glance.
    "code-bg": "oklch(0.9755 0 0)",
    "code-fg": "oklch(0 0 0)",
    "code-comment": "oklch(0.52 0 0)",
    "code-keyword": "oklch(0.42 0.19 300)",
    "code-string": "oklch(0.44 0.11 152)",
    "code-number": "oklch(0.47 0.14 45)",
    "code-function": "oklch(0.42 0.15 258)",
    "code-operator": "oklch(0.45 0.13 10)",
    "code-punctuation": "oklch(0.52 0 0)",
    "code-variable": "oklch(0.45 0.11 62)",
    "code-tag": "oklch(0.46 0.19 28)",
    "code-deleted": "oklch(0.46 0.19 28)",
    "code-inserted": "oklch(0.44 0.11 152)",
    // Hairlines. 0.43 is the lightest a black rule on white can be and still
    // clear the 3:1 boundary minimum (0.416 is the exact floor); lighter looks
    // finer but stops being a boundary anyone can see. Lighter than Mono's
    // 0.445 by design, and no lighter than the rule allows.
    "border-subtle": "oklch(0 0 0 / 0.06)",
    border: "oklch(0 0 0 / 0.43)",
    // The one heavy rule in the set: section and table headers get a real line,
    // the way a masthead sits over columns.
    "border-strong": "oklch(0 0 0 / 0.7)",
    input: "oklch(0.6 0 0)",
    // Reference, not a literal: tracks --nx-primary if a theme changes it.
    ring: "var(--nx-primary)",
    "focus-ring": "var(--nx-primary)",
    "shadow-color": "oklch(0 0 0)",
    "sidebar-background": "oklch(1 0 0)",
    "sidebar-foreground": "oklch(0.34 0 0)",
    "sidebar-primary": "oklch(0 0 0)",
    "sidebar-primary-foreground": "oklch(1 0 0)",
    "sidebar-accent": "oklch(0.96 0 0)",
    "sidebar-accent-foreground": "oklch(0 0 0)",
    "sidebar-border": "oklch(0.62 0 0)",
    "sidebar-ring": "var(--nx-primary)",
    "table-border": "var(--nx-border)",
    "table-row-hover": "oklch(0.9755 0 0)",
  },
  dark: {
    // The reverse plate: true black paper, true white ink. Authored rather than
    // inverted -- the greys below are chosen against black, not mirrored from
    // the light values, which would land far too bright.
    background: "oklch(0 0 0)",
    "page-background": "oklch(0 0 0)",
    foreground: "oklch(1 0 0)",
    card: "oklch(0 0 0)",
    "card-foreground": "oklch(1 0 0)",
    // The single break from flatness. A popover floats over content, and in
    // dark mode a shadow cannot show that, so the layer is lifted instead.
    popover: "oklch(0.12 0 0)",
    "popover-foreground": "oklch(1 0 0)",
    primary: "oklch(1 0 0)",
    "primary-foreground": "oklch(0 0 0)",
    secondary: "oklch(0.22 0 0)",
    "secondary-foreground": "oklch(1 0 0)",
    muted: "oklch(0.22 0 0)",
    "muted-foreground": "oklch(0.72 0 0)",
    // Mirrors the light-mode block: solid fill, opposite-polarity type.
    accent: "oklch(1 0 0)",
    "accent-foreground": "oklch(0 0 0)",
    highlight: "oklch(0.85 0.15 100)",
    "highlight-foreground": "oklch(0 0 0)",
    // Text tokens lighten to read on black; `-solid` stays at the light-mode
    // ink so white button type still clears 4.5:1 on the fill.
    destructive: "oklch(0.7 0.17 27)",
    "destructive-solid": "oklch(0.52 0.19 27)",
    "destructive-foreground": "oklch(1 0 0)",
    success: "oklch(0.72 0.15 150)",
    "success-solid": "oklch(0.5 0.14 150)",
    "success-foreground": "oklch(1 0 0)",
    warning: "oklch(0.78 0.14 70)",
    "warning-foreground": "oklch(0 0 0)",
    "code-bg": "oklch(0.1 0 0)",
    "code-fg": "oklch(1 0 0)",
    "code-comment": "oklch(0.68 0 0)",
    "code-keyword": "oklch(0.78 0.12 300)",
    "code-string": "oklch(0.79 0.14 152)",
    "code-number": "oklch(0.8 0.12 45)",
    "code-function": "oklch(0.76 0.11 258)",
    "code-operator": "oklch(0.78 0.12 10)",
    "code-punctuation": "oklch(0.68 0 0)",
    "code-variable": "oklch(0.81 0.1 62)",
    "code-tag": "oklch(0.74 0.14 28)",
    "code-deleted": "oklch(0.74 0.14 28)",
    "code-inserted": "oklch(0.79 0.14 152)",
    // White alpha on black, at the same hairline weight the light mode uses:
    // 0.37 clears 3:1 over black (0.349 is the floor).
    "border-subtle": "oklch(1 0 0 / 0.07)",
    border: "oklch(1 0 0 / 0.37)",
    "border-strong": "oklch(1 0 0 / 0.62)",
    input: "oklch(0.52 0 0)",
    ring: "var(--nx-primary)",
    "focus-ring": "var(--nx-primary)",
    "shadow-color": "oklch(0 0 0)",
    "sidebar-background": "oklch(0 0 0)",
    "sidebar-foreground": "oklch(0.94 0 0)",
    "sidebar-primary": "oklch(1 0 0)",
    "sidebar-primary-foreground": "oklch(0 0 0)",
    "sidebar-accent": "oklch(0.22 0 0)",
    "sidebar-accent-foreground": "oklch(1 0 0)",
    "sidebar-border": "oklch(0.5 0 0)",
    "sidebar-ring": "var(--nx-primary)",
    "table-border": "var(--nx-border)",
    "table-row-hover": "oklch(0.14 0 0)",
  },
};
