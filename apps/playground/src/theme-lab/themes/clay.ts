/**
 * Clay: earthenware. Two glazes, matte surfaces, and rules you can see.
 *
 * Design intent. Clay and Sand start from the same premise -- warm neutrals
 * instead of white -- and then answer it in opposite ways, which is the reason
 * both exist. Sand is one colour and no lines: surfaces are lifted by light and
 * a card is legible because it is brighter than the page. Clay is the matte
 * version. Card, page and popover sit at essentially the same lightness, so
 * nothing is raised and nothing catches light; the structure comes back to
 * ruled lines, drawn deliberately heavier than Mono's, and the only thing that
 * steps down is the outer page behind it all. A viewer who prefers Sand wants
 * depth; a viewer who prefers Clay wants the surface to stay flat and the
 * drawing to do the work.
 *
 * The palette is two fired glazes rather than one accent. Terracotta carries
 * everything a user presses. Olive carries the accent surfaces -- the
 * complement of terracotta on the warm side of the wheel, so the second colour
 * belongs to the same kiln instead of arriving from a UI palette. The one
 * genuine hazard in an earth theme is that terracotta at hue 40 is close to a
 * standard interface red, so destructive is pushed down to hue 20 and held
 * darker: "delete" and "save" must not be the same gesture.
 *
 * 6px radius. Softer than a drawing, harder than a card that pretends to float.
 */
import type { ThemeDefinition } from "../types";

export const CLAY: ThemeDefinition = {
  id: "clay",
  label: "Clay",
  group: "nextly",
  recommendedDensity: "default",
  radius: "6px",
  fontSans: "var(--font-inter), Inter, sans-serif",
  fontMono:
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  light: {
    // Matte: card and background are the same body, and popover is lifted by
    // the smallest amount that still reads as detached when it opens. The only
    // real step is the page behind everything, which frames rather than raises.
    background: "oklch(0.95 0.018 70)",
    "page-background": "oklch(0.925 0.021 70)",
    foreground: "oklch(0.235 0.025 55)",
    card: "oklch(0.95 0.018 70)",
    "card-foreground": "oklch(0.235 0.025 55)",
    popover: "oklch(0.955 0.016 70)",
    "popover-foreground": "oklch(0.235 0.025 55)",
    // Terracotta. Deeper and more saturated than Sand's clay, because with no
    // elevation to mark the primary button it has to carry the emphasis alone.
    primary: "oklch(0.48 0.11 40)",
    "primary-foreground": "oklch(0.99 0.006 85)",
    secondary: "oklch(0.925 0.02 70)",
    "secondary-foreground": "oklch(0.235 0.025 55)",
    muted: "oklch(0.918 0.02 70)",
    // Held at 4.5:1 against `muted`, the darkest surface it lands on. Clay's
    // surfaces run about two steps below Sand's, so this comes down with them.
    "muted-foreground": "oklch(0.495 0.025 65)",
    // The second glaze. Olive sits opposite terracotta while staying on the
    // warm side of the wheel, so an accent surface reads as a different firing
    // of the same material rather than as an unrelated brand colour.
    accent: "oklch(0.5 0.06 120)",
    "accent-foreground": "oklch(0.99 0.006 85)",
    // Ochre, between the two glazes, so a highlighted span belongs to the
    // palette instead of importing a highlighter yellow into an earth theme.
    highlight: "oklch(0.87 0.13 85)",
    "highlight-foreground": "oklch(0.235 0.025 55)",
    // Hue 20 rather than Mono's 25, and darker: terracotta at hue 40 is close
    // enough to a UI red that the two must be separated by hue and by weight.
    destructive: "oklch(0.535 0.2 20)",
    "destructive-solid": "oklch(0.535 0.2 20)",
    "destructive-foreground": "oklch(0.99 0.006 85)",
    // Deliberately kept a true green rather than pulled toward the olive
    // accent, so "succeeded" cannot be read as "is an accent surface".
    success: "oklch(0.495 0.16 149)",
    "success-solid": "oklch(0.495 0.16 149)",
    "success-foreground": "oklch(0.99 0.006 85)",
    warning: "oklch(0.525 0.155 72)",
    "warning-foreground": "oklch(0.235 0.025 55)",
    // The code block is the one place the theme is allowed to sink: a recessed
    // slab in a flat surface, which is the matte equivalent of a raised card.
    // Every syntax colour is lowered to hold 4.5:1 on a surface this deep.
    "code-bg": "oklch(0.932 0.018 70)",
    "code-fg": "oklch(0.235 0.025 55)",
    "code-comment": "oklch(0.5 0.028 65)",
    "code-keyword": "oklch(0.452 0.19 303.9)",
    "code-string": "oklch(0.412 0.11 152.1)",
    "code-number": "oklch(0.474 0.14 44.2)",
    "code-function": "oklch(0.44 0.132 254.6)",
    "code-operator": "oklch(0.457 0.13 8.4)",
    "code-punctuation": "oklch(0.5 0.028 65)",
    "code-variable": "oklch(0.433 0.108 62.3)",
    "code-tag": "oklch(0.47 0.176 27.5)",
    "code-deleted": "oklch(0.47 0.176 27.5)",
    "code-inserted": "oklch(0.412 0.11 152.1)",
    "border-subtle": "oklch(0.26 0.035 50 / 0.12)",
    // Drawn heavier than Mono's and far heavier than Sand's floor. In a theme
    // with no elevation, the rule is the only thing separating one region from
    // the next, so it is a line a viewer is meant to notice.
    border: "oklch(0.26 0.035 50 / 0.55)",
    "border-strong": "oklch(0.26 0.035 50 / 0.66)",
    input: "oklch(0.58 0.028 65)",
    ring: "var(--nx-primary)",
    "focus-ring": "var(--nx-primary)",
    // Warm and low. Clay barely uses shadow -- there is nothing to raise -- but
    // where one does render (menus, dialogs) a neutral black would grey the
    // terracotta underneath it and make the surface look soiled.
    "shadow-color": "oklch(0.32 0.05 50)",
    // The sidebar takes the page's darker step, so the navigation reads as the
    // slab the content is cut into rather than as a panel floating beside it.
    "sidebar-background": "oklch(0.925 0.021 70)",
    "sidebar-foreground": "oklch(0.41 0.028 60)",
    "sidebar-primary": "oklch(0.48 0.11 40)",
    "sidebar-primary-foreground": "oklch(0.99 0.006 85)",
    "sidebar-accent": "oklch(0.895 0.026 75)",
    "sidebar-accent-foreground": "oklch(0.235 0.025 55)",
    "sidebar-border": "oklch(0.575 0.028 65)",
    "sidebar-ring": "var(--nx-primary)",
    "table-border": "var(--nx-border)",
    "table-row-hover": "oklch(0.937 0.019 70)",
  },
  dark: {
    // Wet clay rather than an inverted plate: the surfaces stay matte and near
    // each other, with only the page stepping down behind them, exactly as in
    // light. Popover is the sole lifted layer, because in dark a shadow cannot
    // show that a menu is detached and the lightness has to say it instead.
    background: "oklch(0.205 0.016 60)",
    "page-background": "oklch(0.172 0.014 58)",
    foreground: "oklch(0.955 0.008 80)",
    card: "oklch(0.205 0.016 60)",
    "card-foreground": "oklch(0.955 0.008 80)",
    popover: "oklch(0.25 0.014 60)",
    "popover-foreground": "oklch(0.955 0.008 80)",
    // Terracotta authored upward for dark: at 0.48 on a near-black page it goes
    // to dried blood. Carried to 0.72 it reads as fired clay under kiln light,
    // and the on-color flips to the warm near-black.
    primary: "oklch(0.72 0.115 45)",
    "primary-foreground": "oklch(0.2 0.014 55)",
    secondary: "oklch(0.28 0.016 62)",
    "secondary-foreground": "oklch(0.955 0.008 80)",
    muted: "oklch(0.28 0.016 62)",
    "muted-foreground": "oklch(0.72 0.02 70)",
    // Olive stays a mid fill under near-white type rather than being lifted
    // with primary, so the two glazes remain two distinct levels of emphasis
    // instead of two similar warm blocks on one page.
    accent: "oklch(0.52 0.07 120)",
    "accent-foreground": "oklch(0.99 0.006 85)",
    highlight: "oklch(0.78 0.13 85)",
    "highlight-foreground": "oklch(0.2 0.014 55)",
    destructive: "oklch(0.675 0.19 20)",
    "destructive-solid": "oklch(0.535 0.2 20)",
    "destructive-foreground": "oklch(0.99 0.006 85)",
    success: "oklch(0.655 0.165 149)",
    "success-solid": "oklch(0.495 0.16 149)",
    "success-foreground": "oklch(0.99 0.006 85)",
    warning: "oklch(0.79 0.15 72)",
    "warning-foreground": "oklch(0.2 0.014 55)",
    "code-bg": "oklch(0.172 0.014 58)",
    "code-fg": "oklch(0.955 0.008 80)",
    "code-comment": "oklch(0.665 0.02 70)",
    "code-keyword": "oklch(0.7482 0.1235 303.9)",
    "code-string": "oklch(0.7654 0.1476 152.1)",
    "code-number": "oklch(0.7807 0.1189 44.2)",
    "code-function": "oklch(0.7365 0.1163 254.6)",
    "code-operator": "oklch(0.7549 0.1234 8.4)",
    "code-punctuation": "oklch(0.665 0.02 70)",
    "code-variable": "oklch(0.7938 0.1052 62.3)",
    "code-tag": "oklch(0.7118 0.1476 27.5)",
    "code-deleted": "oklch(0.7118 0.1476 27.5)",
    "code-inserted": "oklch(0.7654 0.1476 152.1)",
    "border-subtle": "oklch(0.93 0.025 75 / 0.12)",
    // Heavier than Mono's dark rule, matching the light mode's intent: with the
    // surfaces this close together the line carries all of the separation.
    border: "oklch(0.93 0.025 75 / 0.45)",
    "border-strong": "oklch(0.93 0.025 75 / 0.55)",
    input: "oklch(0.56 0.018 65)",
    ring: "var(--nx-primary)",
    "focus-ring": "var(--nx-primary)",
    // Warm, but below every surface in the theme. A 0.32 shadow over a 0.205
    // page would be lighter than what it falls on and read as a glow.
    "shadow-color": "oklch(0.09 0.025 50)",
    "sidebar-background": "oklch(0.172 0.014 58)",
    "sidebar-foreground": "oklch(0.9 0.01 75)",
    "sidebar-primary": "oklch(0.72 0.115 45)",
    "sidebar-primary-foreground": "oklch(0.2 0.014 55)",
    "sidebar-accent": "oklch(0.29 0.024 55)",
    "sidebar-accent-foreground": "oklch(0.955 0.008 80)",
    // Lighter than the content-area `input` rule despite doing the same job:
    // the sidebar sits on the theme's darkest surface, so the same value that
    // clears 3:1 on a card falls under it here.
    "sidebar-border": "oklch(0.51 0.018 62)",
    "sidebar-ring": "var(--nx-primary)",
    "table-border": "var(--nx-border)",
    "table-row-hover": "oklch(0.235 0.016 60)",
  },
};
