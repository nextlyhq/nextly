/**
 * Brutalist: the admin as printed signage.
 *
 * Design intent. Neo-brutalism argues that an interface should stop pretending
 * to be soft. Nothing is rounded, nothing is a hairline, nothing fades: every
 * boundary is a black rule at FULL strength, corners are square, and elevation
 * is a hard black offset block rather than a blur. The palette is three flat
 * inks on white -- black for structure, an electric yellow for the things that
 * are currently active, a cyan for emphasis -- with a butter field behind the
 * white cards so a panel reads as a cut-out sheet laid on a poster.
 *
 * This theme sits at the HEAVY end of the legibility axis. Its risk is not
 * readability but noise: a data table where every cell boundary is a
 * full-strength black rule is legible and exhausting at the same time, which is
 * exactly the trade-off the founder is being asked to look at. Density is
 * `comfortable` because oversized furniture and full-weight rules need air
 * between them or the grid closes up into a solid black mesh.
 *
 * The loud colours are placed only where the harness proves they survive.
 * `accent` and `highlight` are asserted solely against their own on-colour, so
 * they can be as saturated as the poster wants; `primary` also has to work as
 * TEXT on a 10% wash of itself, which no bright yellow can do, so primary is
 * pure black and the yellow is spent on accent surfaces instead. That is the
 * structural reason the buttons here are black and not yellow.
 */
import type { ThemeDefinition } from "../types";

export const BRUTALIST: ThemeDefinition = {
  id: "brutalist",
  label: "Brutalist",
  group: "nextly",
  // Icon-only rail: the navigation becomes a column of heavy square blocks,
  // which is the layout that most looks like the theme rather than merely
  // wearing it.
  recommendedLayout: "rail-only",
  // Full-weight rules on every edge need whitespace or the page turns to mesh.
  recommendedDensity: "comfortable",
  radius: "0px",
  fontSans: "var(--font-inter), Inter, sans-serif",
  fontMono:
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  light: {
    // White sheets on a butter field. The step between them is a colour change
    // rather than a lightness change, so a card is identified by its black rule
    // and its hue break, never by a shadow gradient.
    background: "oklch(1 0 0)",
    "page-background": "oklch(0.955 0.075 100)",
    foreground: "oklch(0 0 0)",
    card: "oklch(1 0 0)",
    "card-foreground": "oklch(0 0 0)",
    popover: "oklch(1 0 0)",
    "popover-foreground": "oklch(0 0 0)",
    // Black, not yellow. Primary has to read as text on a 10% tint of itself
    // (the primary badge), which rules out every high-lightness colour; the
    // yellow lives on `accent`, which carries no such requirement.
    primary: "oklch(0 0 0)",
    "primary-foreground": "oklch(1 0 0)",
    secondary: "oklch(0.955 0.075 100)",
    "secondary-foreground": "oklch(0 0 0)",
    muted: "oklch(0.955 0 0)",
    // Secondary text is still heavy. A brutalist page has no whisper register:
    // text is either present at full weight or it is not on the page.
    "muted-foreground": "oklch(0.42 0 0)",
    // Electric yellow: the active/selected surface, always with black type.
    accent: "oklch(0.88 0.19 100)",
    "accent-foreground": "oklch(0 0 0)",
    // Cyan marker, the third flat ink.
    highlight: "oklch(0.86 0.14 195)",
    "highlight-foreground": "oklch(0 0 0)",
    // Statuses are poster inks: saturated, but held at the lightness the tinted
    // badge shades need, since the same token generates both the text colour
    // and the 600/50 chip pair.
    destructive: "oklch(0.55 0.22 27)",
    "destructive-solid": "oklch(0.55 0.22 27)",
    "destructive-foreground": "oklch(1 0 0)",
    success: "oklch(0.52 0.17 150)",
    "success-solid": "oklch(0.52 0.17 150)",
    "success-foreground": "oklch(1 0 0)",
    warning: "oklch(0.56 0.165 70)",
    "warning-foreground": "oklch(0 0 0)",
    // A flat grey slab inside a black rule, not a tinted panel.
    "code-bg": "oklch(0.955 0 0)",
    "code-fg": "oklch(0 0 0)",
    "code-comment": "oklch(0.5 0 0)",
    "code-keyword": "oklch(0.42 0.19 300)",
    "code-string": "oklch(0.43 0.11 152)",
    "code-number": "oklch(0.46 0.14 45)",
    "code-function": "oklch(0.42 0.15 258)",
    "code-operator": "oklch(0.44 0.13 10)",
    "code-punctuation": "oklch(0.5 0 0)",
    "code-variable": "oklch(0.44 0.11 62)",
    "code-tag": "oklch(0.45 0.19 28)",
    "code-deleted": "oklch(0.45 0.19 28)",
    "code-inserted": "oklch(0.43 0.11 152)",
    // Every rule is a real line. Even the decorative divider is drawn at 0.4
    // alpha rather than the near-invisible 0.06-0.08 the other themes use --
    // "subtle" is not a register this theme has.
    "border-subtle": "oklch(0 0 0 / 0.4)",
    border: "oklch(0 0 0 / 1)",
    // Weight is carried by stroke thickness, not by colour, so the strong rule
    // is the same full-strength black as the normal one.
    "border-strong": "oklch(0 0 0 / 1)",
    input: "oklch(0 0 0)",
    // Reference, not a literal: tracks --nx-primary if a theme changes it.
    ring: "var(--nx-primary)",
    "focus-ring": "var(--nx-primary)",
    // Pure black, undiluted: the offset shadow is a solid displaced block, so
    // any tint in it would read as a printing misregistration.
    "shadow-color": "oklch(0 0 0)",
    // The rail is a block of the field colour rather than another white sheet,
    // so the navigation is a poster edge and the content is the cut-out.
    "sidebar-background": "oklch(0.955 0.075 100)",
    "sidebar-foreground": "oklch(0 0 0)",
    "sidebar-primary": "oklch(0 0 0)",
    "sidebar-primary-foreground": "oklch(1 0 0)",
    "sidebar-accent": "oklch(0.88 0.19 100)",
    "sidebar-accent-foreground": "oklch(0 0 0)",
    "sidebar-border": "oklch(0 0 0)",
    "sidebar-ring": "var(--nx-primary)",
    "table-border": "var(--nx-border)",
    "table-row-hover": "oklch(0.955 0.075 100)",
  },
  dark: {
    // Authored, not inverted. The field keeps its yellow hue but drops to an
    // olive-black so the same relationship survives -- coloured field, neutral
    // sheets, full-strength rules -- while the sheets stay far enough above the
    // field for the black offset shadow to still register against it.
    background: "oklch(0.18 0 0)",
    "page-background": "oklch(0.1 0.03 100)",
    foreground: "oklch(1 0 0)",
    card: "oklch(0.18 0 0)",
    "card-foreground": "oklch(1 0 0)",
    popover: "oklch(0.18 0 0)",
    "popover-foreground": "oklch(1 0 0)",
    primary: "oklch(1 0 0)",
    "primary-foreground": "oklch(0 0 0)",
    secondary: "oklch(0.26 0.02 100)",
    "secondary-foreground": "oklch(1 0 0)",
    muted: "oklch(0.26 0 0)",
    "muted-foreground": "oklch(0.8 0 0)",
    // The yellow barely moves: it is the theme's identity, and on a near-black
    // sheet it needs no help. Only enough lightness comes off to stop it
    // glowing against the darker surround.
    accent: "oklch(0.85 0.19 100)",
    "accent-foreground": "oklch(0 0 0)",
    highlight: "oklch(0.82 0.14 195)",
    "highlight-foreground": "oklch(0 0 0)",
    // Text tokens lighten to read on the dark sheet; `-solid` stays at the
    // light-mode ink so white button type still clears 4.5:1 on the fill.
    destructive: "oklch(0.68 0.2 27)",
    "destructive-solid": "oklch(0.55 0.22 27)",
    "destructive-foreground": "oklch(1 0 0)",
    success: "oklch(0.72 0.18 150)",
    "success-solid": "oklch(0.52 0.17 150)",
    "success-foreground": "oklch(1 0 0)",
    warning: "oklch(0.8 0.16 75)",
    "warning-foreground": "oklch(0 0 0)",
    "code-bg": "oklch(0.12 0 0)",
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
    "border-subtle": "oklch(1 0 0 / 0.4)",
    border: "oklch(1 0 0 / 1)",
    "border-strong": "oklch(1 0 0 / 1)",
    input: "oklch(1 0 0)",
    ring: "var(--nx-primary)",
    "focus-ring": "var(--nx-primary)",
    // Still black, and still readable: the field at 0.1 is above the shadow, so
    // the displaced block reads as a hole rather than as a halo.
    "shadow-color": "oklch(0 0 0)",
    "sidebar-background": "oklch(0.1 0.03 100)",
    "sidebar-foreground": "oklch(1 0 0)",
    "sidebar-primary": "oklch(1 0 0)",
    "sidebar-primary-foreground": "oklch(0 0 0)",
    "sidebar-accent": "oklch(0.85 0.19 100)",
    "sidebar-accent-foreground": "oklch(0 0 0)",
    "sidebar-border": "oklch(1 0 0)",
    "sidebar-ring": "var(--nx-primary)",
    "table-border": "var(--nx-border)",
    "table-row-hover": "oklch(0.26 0.02 100)",
  },
};
