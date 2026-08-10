/**
 * Sand: elevated neutrals. Structure carried by light, not by lines.
 *
 * Design intent. Every other theme here separates regions by drawing a rule
 * between them. Sand asks what the admin looks like if it does not: the page is
 * oatmeal rather than white, the card is one step LIGHTER than the page it sits
 * on, and the outer page is one step DARKER, so a card is legible as "raised"
 * before any border is perceived. Borders are pushed down to the faintest line
 * that is still a legal boundary, and the work they gave up is handed to a warm
 * shadow. This is the direction that asks the founder a real question: is the
 * admin's structure made of ink, or of light?
 *
 * The lightness ladder is the whole theme, so it is stated once here and held
 * everywhere: popover > card > background > page-background. It runs the same
 * way in dark mode -- a lifted surface is lighter than what it sits on in both
 * -- which is why dark is authored rather than inverted. Inverting would put
 * the card BELOW the page and destroy the one idea the theme has.
 *
 * The single colour is clay: a low-chroma terracotta that reads as a fired
 * version of the surfaces rather than as a brand colour dropped onto them. 8px
 * radius, the softest in the set, because a raised surface with hard corners
 * reads as a cut-out rather than as a card.
 */
import type { ThemeDefinition } from "../types";

export const SAND: ThemeDefinition = {
  id: "sand",
  label: "Sand",
  description:
    "Elevated neutrals. Oatmeal surfaces, clay accent, borderless with soft shadows.",
  group: "nextly",
  // Comfortable: elevation needs air around it. Packed rows would put two
  // shadows within a few pixels of each other and the depth cue collapses.
  recommendedDensity: "comfortable",
  radius: "8px",
  fontSans: "var(--font-inter), Inter, sans-serif",
  fontMono:
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  light: {
    // The ladder. Chroma falls as lightness rises so the lifted surfaces read
    // as catching more light rather than as being a different material.
    background: "oklch(0.97 0.012 85)",
    "page-background": "oklch(0.952 0.014 85)",
    foreground: "oklch(0.24 0.02 60)",
    card: "oklch(0.984 0.008 85)",
    "card-foreground": "oklch(0.24 0.02 60)",
    popover: "oklch(0.988 0.006 85)",
    "popover-foreground": "oklch(0.24 0.02 60)",
    // Clay: the same hue family as the surfaces, taken down to where it fires.
    // Chroma stays at 0.07 so it never separates from the oatmeal it sits on.
    primary: "oklch(0.5 0.07 45)",
    "primary-foreground": "oklch(0.99 0.005 85)",
    secondary: "oklch(0.945 0.014 82)",
    "secondary-foreground": "oklch(0.24 0.02 60)",
    muted: "oklch(0.938 0.014 82)",
    // Held at 4.5:1 against `muted`, the darkest surface it lands on. Mono can
    // sit at 0.54 because its muted surface is near-white; a tinted mid-light
    // surface compresses the range and the text has to come down with it.
    "muted-foreground": "oklch(0.505 0.021 70)",
    // Accent is unglazed clay: one step below primary and slightly desaturated,
    // so an accent fill reads as the same material left unfinished.
    accent: "oklch(0.455 0.055 45)",
    "accent-foreground": "oklch(0.99 0.005 85)",
    highlight: "oklch(0.9 0.14 88)",
    "highlight-foreground": "oklch(0.24 0.02 60)",
    // Statuses run darker than Mono's across the board. Dark text on a 0.97
    // surface has measurably less headroom than the same text on white, so each
    // one is lowered until it clears 4.5:1 on the page rather than only on the
    // card and popover above it.
    destructive: "oklch(0.55 0.2 25)",
    "destructive-solid": "oklch(0.55 0.2 25)",
    "destructive-foreground": "oklch(0.99 0.005 85)",
    success: "oklch(0.51 0.165 149)",
    "success-solid": "oklch(0.51 0.165 149)",
    "success-foreground": "oklch(0.99 0.005 85)",
    warning: "oklch(0.5157 0.16 72)",
    "warning-foreground": "oklch(0.24 0.02 60)",
    // The code surface is a shade of paper rather than the usual cool slab, so
    // a snippet stays inside the theme. Every syntax colour comes down with it:
    // the block is darker than Mono's, and a colour that only just cleared
    // 4.5:1 on Mono's near-white code-bg would not clear it here.
    "code-bg": "oklch(0.955 0.012 82)",
    "code-fg": "oklch(0.24 0.02 60)",
    "code-comment": "oklch(0.515 0.025 70)",
    "code-keyword": "oklch(0.468 0.2 303.9)",
    "code-string": "oklch(0.428 0.115 152.1)",
    "code-number": "oklch(0.49 0.145 44.2)",
    "code-function": "oklch(0.455 0.138 254.6)",
    "code-operator": "oklch(0.473 0.135 8.4)",
    "code-punctuation": "oklch(0.515 0.025 70)",
    "code-variable": "oklch(0.449 0.112 62.3)",
    "code-tag": "oklch(0.485 0.182 27.5)",
    "code-deleted": "oklch(0.485 0.182 27.5)",
    "code-inserted": "oklch(0.428 0.115 152.1)",
    // Warm near-black at alpha rather than pure black: a neutral hairline over
    // a tinted surface reads grey-green and dirties the warmth.
    "border-subtle": "oklch(0.28 0.03 60 / 0.05)",
    // Set at the floor rather than chosen for looks: black at this alpha over
    // the popover, the lightest surface it crosses, lands at 3.16:1, and the
    // 3:1 boundary minimum breaks a little under 0.50. Anything fainter would
    // be a nicer drawing and an illegal boundary; the separation the design
    // actually wants comes from the shadow below, not from this line.
    border: "oklch(0.28 0.03 60 / 0.515)",
    "border-strong": "oklch(0.28 0.03 60 / 0.6)",
    input: "oklch(0.62 0.02 70)",
    ring: "var(--nx-primary)",
    "focus-ring": "var(--nx-primary)",
    // The load-bearing token in this theme. A black shadow on an oatmeal
    // surface desaturates it and reads as dirt rather than depth; the warm
    // brown keeps the tint intact as the surface darkens under the card.
    "shadow-color": "oklch(0.35 0.04 60)",
    // The sidebar sits at the page's own level, below the cards, so the panel
    // reads as the surface everything else is raised off.
    "sidebar-background": "oklch(0.952 0.014 85)",
    "sidebar-foreground": "oklch(0.42 0.022 70)",
    "sidebar-primary": "oklch(0.5 0.07 45)",
    "sidebar-primary-foreground": "oklch(0.99 0.005 85)",
    "sidebar-accent": "oklch(0.922 0.022 75)",
    "sidebar-accent-foreground": "oklch(0.24 0.02 60)",
    "sidebar-border": "oklch(0.605 0.02 70)",
    "sidebar-ring": "var(--nx-primary)",
    "table-border": "var(--nx-border)",
    "table-row-hover": "oklch(0.962 0.013 85)",
  },
  dark: {
    // The same ladder, authored for dark rather than flipped: popover > card >
    // background > page-background. A lightness inversion of the light mode
    // would put the card underneath the page and lose the theme's one idea.
    background: "oklch(0.185 0.009 70)",
    "page-background": "oklch(0.155 0.008 70)",
    foreground: "oklch(0.955 0.006 85)",
    card: "oklch(0.225 0.01 72)",
    "card-foreground": "oklch(0.955 0.006 85)",
    popover: "oklch(0.26 0.011 72)",
    "popover-foreground": "oklch(0.955 0.006 85)",
    // Clay does not survive a dark page at 0.5 -- it goes to brown. The dark
    // primary is authored as sand instead: the same hue family carried up to
    // where it glows, which flips the on-color to the warm near-black.
    primary: "oklch(0.76 0.075 65)",
    "primary-foreground": "oklch(0.2 0.012 60)",
    secondary: "oklch(0.28 0.011 72)",
    "secondary-foreground": "oklch(0.955 0.006 85)",
    muted: "oklch(0.28 0.011 72)",
    // Raised above Mono's equivalent because this theme's popover sits at 0.26
    // rather than 0.24, and the popover is the lightest surface muted text has
    // to hold 4.5:1 against.
    "muted-foreground": "oklch(0.725 0.018 75)",
    // A mid fill under near-white type, deliberately not tracking primary all
    // the way up, so accent and primary stay two distinct levels of emphasis.
    accent: "oklch(0.53 0.055 50)",
    "accent-foreground": "oklch(0.985 0.004 85)",
    highlight: "oklch(0.78 0.135 88)",
    "highlight-foreground": "oklch(0.2 0.012 60)",
    // Status TEXT is lifted for the dark surfaces; the `-solid` fills stay dark
    // enough for near-white on-color type, which is the split the two roles
    // exist for.
    destructive: "oklch(0.685 0.19 25)",
    "destructive-solid": "oklch(0.55 0.2 25)",
    "destructive-foreground": "oklch(0.99 0.005 85)",
    success: "oklch(0.66 0.165 149)",
    "success-solid": "oklch(0.51 0.165 149)",
    "success-foreground": "oklch(0.99 0.005 85)",
    warning: "oklch(0.8 0.15 72)",
    "warning-foreground": "oklch(0.2 0.012 60)",
    "code-bg": "oklch(0.225 0.01 72)",
    "code-fg": "oklch(0.955 0.006 85)",
    "code-comment": "oklch(0.685 0.018 75)",
    "code-keyword": "oklch(0.7482 0.1235 303.9)",
    "code-string": "oklch(0.7654 0.1476 152.1)",
    "code-number": "oklch(0.7807 0.1189 44.2)",
    "code-function": "oklch(0.7365 0.1163 254.6)",
    "code-operator": "oklch(0.7549 0.1234 8.4)",
    "code-punctuation": "oklch(0.685 0.018 75)",
    "code-variable": "oklch(0.7938 0.1052 62.3)",
    "code-tag": "oklch(0.7118 0.1476 27.5)",
    "code-deleted": "oklch(0.7118 0.1476 27.5)",
    "code-inserted": "oklch(0.7654 0.1476 152.1)",
    "border-subtle": "oklch(0.95 0.02 80 / 0.05)",
    // Warm light at the floor for the popover, the lightest surface it crosses.
    border: "oklch(0.95 0.02 80 / 0.405)",
    "border-strong": "oklch(0.95 0.02 80 / 0.48)",
    input: "oklch(0.57 0.014 72)",
    ring: "var(--nx-primary)",
    "focus-ring": "var(--nx-primary)",
    // Deliberately not the light mode's 0.35: a shadow lighter than the surface
    // it falls on renders as a warm halo instead of depth. The warmth is kept
    // and the lightness dropped below the darkest surface in the ladder.
    "shadow-color": "oklch(0.1 0.02 55)",
    "sidebar-background": "oklch(0.155 0.008 70)",
    "sidebar-foreground": "oklch(0.9 0.008 80)",
    "sidebar-primary": "oklch(0.76 0.075 65)",
    "sidebar-primary-foreground": "oklch(0.2 0.012 60)",
    "sidebar-accent": "oklch(0.285 0.018 65)",
    "sidebar-accent-foreground": "oklch(0.955 0.006 85)",
    "sidebar-border": "oklch(0.5 0.014 72)",
    "sidebar-ring": "var(--nx-primary)",
    "table-border": "var(--nx-border)",
    "table-row-hover": "oklch(0.245 0.011 72)",
  },
};
