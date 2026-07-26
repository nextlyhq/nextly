/**
 * Ember: Mono's cool room, with one warm source of light.
 *
 * Design intent. Developer tools are almost uniformly cold -- blue, indigo,
 * teal, or nothing at all. Ember keeps Mono's neutrals exactly as they are,
 * cool grey at hue ~260, and makes every interactive surface warm: rust in
 * light, amber in dark. Because the neutrals stay cold, the warmth never
 * spreads into a "beige theme"; it stays localised to the things a user can
 * press, which is what makes the temperature read as heat rather than as paper.
 *
 * Where Signal proves that one colour can be added without changing anything
 * else, Ember pushes the same structure somewhere harder: warm hues share the
 * screen with the two warm statuses a CMS already owns. So the warm family is
 * arranged as a deliberate ramp rather than a single token -- destructive is
 * pulled toward crimson, primary sits at rust, warning and highlight at amber
 * -- and each step is far enough from its neighbour that a red button and a
 * primary button are never mistaken at a glance. That separation is the actual
 * design work in this theme; the rust itself is the easy part.
 *
 * 4px radius: enough to soften the warm fills, not enough to make them buttons
 * from a consumer app.
 */
import type { ThemeDefinition } from "../types";

export const EMBER: ThemeDefinition = {
  id: "ember",
  label: "Ember",
  group: "nextly",
  recommendedLayout: "rail-panel",
  recommendedDensity: "default",
  radius: "4px",
  fontSans: "var(--font-inter), Inter, sans-serif",
  fontMono:
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  light: {
    // Mono's neutrals, value for value. The cold frame is what keeps the warm
    // accents legible as accents.
    background: "oklch(1 0 0)",
    "page-background": "oklch(0.9818 0 0)",
    foreground: "oklch(0.2079 0.0399 265.73)",
    card: "oklch(1 0 0)",
    "card-foreground": "oklch(0.2079 0.0399 265.73)",
    popover: "oklch(1 0 0)",
    "popover-foreground": "oklch(0.2079 0.0399 265.73)",
    // Rust. Lightness is set by the badge, not the button: text-primary on a
    // 10% wash of itself is the tighter pair, landing at 4.58:1 here, while
    // white on the solid fill has margin to spare at 5.2:1. At 0.55 the badge
    // drops to 4.49:1, so the value is walked down until the badge clears and
    // no further -- the two are indistinguishable to the eye.
    primary: "oklch(0.545 0.15 45)",
    "primary-foreground": "oklch(1 0 0)",
    secondary: "oklch(0.9684 0.0068 247.9)",
    "secondary-foreground": "oklch(0.2079 0.0399 265.73)",
    muted: "oklch(0.9696 0 0)",
    "muted-foreground": "oklch(0.54 0.0407 257.44)",
    // Accent follows primary one step deeper and slightly redder, so a filled
    // accent surface sits below a primary button in emphasis instead of
    // reading as a second primary.
    accent: "oklch(0.485 0.14 38)",
    "accent-foreground": "oklch(1 0 0)",
    // Amber rather than Mono's lemon: it is the top of the warm ramp, so a
    // highlighted span belongs to the same family as the accent instead of
    // cutting across it with a green-yellow.
    highlight: "oklch(0.9 0.15 85)",
    "highlight-foreground": "oklch(0.2079 0.0399 265.73)",
    // Pulled from Mono's hue 25 to 18 and saturated further. Rust at hue 45 is
    // close enough to a standard UI red that "delete" and "save" could read as
    // the same gesture; moving destructive toward crimson restores the gap.
    destructive: "oklch(0.5581 0.2208 18)",
    "destructive-solid": "oklch(0.5581 0.2208 18)",
    "destructive-foreground": "oklch(1 0 0)",
    // Green is left cold and untouched. In a warm theme, "succeeded" is the one
    // state that must not look like it belongs to the brand.
    success: "oklch(0.53 0.17 149.2)",
    "success-solid": "oklch(0.53 0.17 149.2)",
    "success-foreground": "oklch(1 0 0)",
    // Warning moves up to hue 78, above primary's 45, so caution reads as
    // yellower and primary as redder rather than the two meeting in orange.
    warning: "oklch(0.565 0.1646 78)",
    "warning-foreground": "oklch(0.2079 0.0399 265.73)",
    "code-bg": "oklch(0.9761 0.0035 247.86)",
    "code-fg": "oklch(0.2079 0.0399 265.73)",
    "code-comment": "oklch(0.541 0.0407 257.44)",
    "code-keyword": "oklch(0.4882 0.2172 303.9)",
    "code-string": "oklch(0.4478 0.1189 152.1)",
    "code-number": "oklch(0.5106 0.1518 44.2)",
    "code-function": "oklch(0.4757 0.1444 254.6)",
    "code-operator": "oklch(0.4936 0.1418 8.4)",
    "code-punctuation": "oklch(0.541 0.0407 257.44)",
    "code-variable": "oklch(0.4694 0.1173 62.3)",
    "code-tag": "oklch(0.5054 0.1905 27.5)",
    "code-deleted": "oklch(0.5054 0.1905 27.5)",
    "code-inserted": "oklch(0.4478 0.1189 152.1)",
    "border-subtle": "oklch(0 0 0 / 0.08)",
    border: "oklch(0 0 0 / 0.445)",
    "border-strong": "oklch(0 0 0 / 0.502)",
    input: "oklch(0.6454 0.0116 286.11)",
    // Reference, not a literal: the focus ring is where a warm accent on a cold
    // page is most obviously doing a job rather than decorating one.
    ring: "var(--nx-primary)",
    "focus-ring": "var(--nx-primary)",
    "shadow-color": "oklch(0 0 0)",
    "sidebar-background": "oklch(1 0 0)",
    "sidebar-foreground": "oklch(0.372 0.0392 257.3)",
    "sidebar-primary": "oklch(0.545 0.15 45)",
    "sidebar-primary-foreground": "oklch(1 0 0)",
    // The faintest rust wash instead of grey, so the resting nav hover already
    // belongs to the accent family.
    "sidebar-accent": "oklch(0.962 0.018 55)",
    "sidebar-accent-foreground": "oklch(0.2079 0.0399 265.73)",
    "sidebar-border": "oklch(0.6446 0.0126 255.53)",
    "sidebar-ring": "var(--nx-primary)",
    "table-border": "var(--nx-border)",
    "table-row-hover": "oklch(0.9848 0 0)",
  },
  dark: {
    // Mono's dark neutrals, unchanged, for the same reason as light.
    background: "oklch(0.1358 0.0163 262.71)",
    "page-background": "oklch(0.1358 0.0163 262.71)",
    foreground: "oklch(0.9838 0.0035 247.86)",
    card: "oklch(0.1916 0.0228 266.36)",
    "card-foreground": "oklch(0.9838 0.0035 247.86)",
    popover: "oklch(0.24 0.0249 257.44)",
    "popover-foreground": "oklch(0.9838 0.0035 247.86)",
    // Authored for dark, not inverted: the hue is walked from rust (45) up to
    // amber (55) as well as lightened, because a dark rust on a near-black page
    // reads as brown. Raising the lightness flips the on-color to the dark
    // neutral, which is what makes the button look like a lit coal.
    primary: "oklch(0.72 0.14 55)",
    "primary-foreground": "oklch(0.2079 0.0399 265.73)",
    secondary: "oklch(0.28 0.0369 259.97)",
    "secondary-foreground": "oklch(0.9838 0.0035 247.86)",
    muted: "oklch(0.28 0.0369 259.97)",
    "muted-foreground": "oklch(0.7107 0.0351 256.79)",
    // Accent deliberately stays a mid-lightness fill under white type rather
    // than tracking primary all the way up, so accent and primary do not become
    // the same block of orange on one page.
    accent: "oklch(0.52 0.13 42)",
    "accent-foreground": "oklch(1 0 0)",
    highlight: "oklch(0.78 0.14 85)",
    "highlight-foreground": "oklch(0.2079 0.0399 265.73)",
    // Crimson carries less luminance than Mono's hue 25 at the same lightness,
    // so the dark text colour is raised to 0.66 to clear 4.5:1 on the popover,
    // which is the lightest surface it lands on.
    destructive: "oklch(0.66 0.2 18)",
    "destructive-solid": "oklch(0.5581 0.2208 18)",
    "destructive-foreground": "oklch(1 0 0)",
    success: "oklch(0.6 0.1921 149.58)",
    "success-solid": "oklch(0.5225 0.1921 149.58)",
    "success-foreground": "oklch(1 0 0)",
    warning: "oklch(0.7686 0.1646 78)",
    "warning-foreground": "oklch(0.2079 0.0399 265.73)",
    "code-bg": "oklch(0.1916 0.0228 266.36)",
    "code-fg": "oklch(0.9838 0.0035 247.86)",
    "code-comment": "oklch(0.6626 0.0364 256.79)",
    "code-keyword": "oklch(0.7482 0.1235 303.9)",
    "code-string": "oklch(0.7654 0.1476 152.1)",
    "code-number": "oklch(0.7807 0.1189 44.2)",
    "code-function": "oklch(0.7365 0.1163 254.6)",
    "code-operator": "oklch(0.7549 0.1234 8.4)",
    "code-punctuation": "oklch(0.6626 0.0364 256.79)",
    "code-variable": "oklch(0.7938 0.1052 62.3)",
    "code-tag": "oklch(0.7118 0.1476 27.5)",
    "code-deleted": "oklch(0.7118 0.1476 27.5)",
    "code-inserted": "oklch(0.7654 0.1476 152.1)",
    "border-subtle": "oklch(1 0 0 / 0.08)",
    border: "oklch(1 0 0 / 0.366)",
    "border-strong": "oklch(1 0 0 / 0.418)",
    input: "oklch(0.54 0.0128 285.92)",
    ring: "var(--nx-primary)",
    "focus-ring": "var(--nx-primary)",
    "shadow-color": "oklch(0 0 0)",
    "sidebar-background": "oklch(0.1358 0.0163 262.71)",
    "sidebar-foreground": "oklch(0.9838 0.0035 247.86)",
    "sidebar-primary": "oklch(0.72 0.14 55)",
    "sidebar-primary-foreground": "oklch(0.2079 0.0399 265.73)",
    // A warm-tinted row rather than plain grey: the active nav item reads as
    // embered even before its label colour is read.
    "sidebar-accent": "oklch(0.29 0.038 50)",
    "sidebar-accent-foreground": "oklch(0.9838 0.0035 247.86)",
    "sidebar-border": "oklch(0.4975 0.0129 257.43)",
    "sidebar-ring": "var(--nx-primary)",
    "table-border": "var(--nx-border)",
    "table-row-hover": "oklch(0.28 0.0369 259.97)",
  },
};
