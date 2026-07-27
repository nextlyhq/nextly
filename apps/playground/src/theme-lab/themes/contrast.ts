/**
 * Contrast: maximum legibility, and what it costs.
 *
 * Design intent. The opposite edge of the axis from Calm. Every decision is
 * settled by asking which option is easier to read, and nothing else gets a
 * vote: pure black on pure white, square corners, rules at 0.8 alpha instead of
 * a hairline, and a surface ladder (page 0.93 / card 1.0) so a panel is
 * identifiable by lightness AND by its rule rather than by either alone. Where
 * the rest of the set aims at WCAG AA (4.5:1 text, 3:1 boundaries), this theme
 * aims at AAA (7:1) and the values below are chosen to clear that higher bar --
 * body text, muted text, sidebar text, every status token and every syntax
 * colour, in both modes.
 *
 * How this differs from Ink, which is also black-on-white: Ink is an editorial
 * page and spends its contrast budget on typography, so its rules are the
 * lightest hairline that is still legal (0.43 alpha) and its greys sit where a
 * printed page would put them. Contrast spends the budget on separation
 * instead. Its rules are nearly solid, its "subtle" divider is still plainly
 * visible, its muted grey is four steps darker than Ink's, and it accepts a
 * grey page field that Ink refuses. Ink is restraint; this is insistence.
 *
 * The cost is legible in the tokens themselves and is the reason this theme is
 * an edge rather than a default. Pushing every syntax colour down to ~0.40
 * lightness to reach 7:1 compresses eleven hues into a narrow dark band, so a
 * keyword and a function name are harder to tell APART even though each is
 * easier to read against the slab. Maximum contrast against the background and
 * maximum discrimination between foregrounds are not the same goal, and this
 * theme buys the first with the second.
 */
import type { ThemeDefinition } from "../types";

export const CONTRAST: ThemeDefinition = {
  id: "contrast",
  label: "Contrast",
  group: "nextly",
  // Legibility here comes from the colours, not from spacing, so the density
  // stays where a working admin wants it rather than being traded away.
  recommendedDensity: "default",
  radius: "0px",
  fontSans: "var(--font-inter), Inter, sans-serif",
  fontMono:
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  light: {
    background: "oklch(1 0 0)",
    // A real step, not a tint. The card is identified twice over: it is lighter
    // than the field it sits on and it carries a near-solid rule.
    "page-background": "oklch(0.93 0 0)",
    foreground: "oklch(0 0 0)",
    card: "oklch(1 0 0)",
    "card-foreground": "oklch(0 0 0)",
    popover: "oklch(1 0 0)",
    "popover-foreground": "oklch(0 0 0)",
    primary: "oklch(0 0 0)",
    "primary-foreground": "oklch(1 0 0)",
    secondary: "oklch(0.9 0 0)",
    "secondary-foreground": "oklch(0 0 0)",
    muted: "oklch(0.93 0 0)",
    // 0.4 rather than the ~0.54 an AA theme uses: this clears 7:1 on every
    // surface it lands on, which is what makes secondary text a real reading
    // register here instead of a decorative one.
    "muted-foreground": "oklch(0.4 0 0)",
    // The one hue in the chrome. A second black fill would be maximally legible
    // and completely ambiguous next to the primary button, so the accent is
    // separated by hue while staying dark enough to keep white type at AAA.
    accent: "oklch(0.3 0.13 255)",
    "accent-foreground": "oklch(1 0 0)",
    highlight: "oklch(0.92 0.19 100)",
    "highlight-foreground": "oklch(0 0 0)",
    // Statuses are held at AAA as text on every surface AND as fills under
    // white type, which is why they sit well below the usual 0.55-0.58 band.
    destructive: "oklch(0.45 0.2 27)",
    "destructive-solid": "oklch(0.45 0.2 27)",
    "destructive-foreground": "oklch(1 0 0)",
    success: "oklch(0.42 0.13 150)",
    "success-solid": "oklch(0.42 0.13 150)",
    "success-foreground": "oklch(1 0 0)",
    warning: "oklch(0.44 0.12 70)",
    "warning-foreground": "oklch(0 0 0)",
    // Every syntax colour is pushed to ~0.40 so each clears 7:1 on the slab.
    // The trade is stated in the file header: they read better against the
    // background and worse against each other.
    "code-bg": "oklch(0.95 0 0)",
    "code-fg": "oklch(0 0 0)",
    "code-comment": "oklch(0.38 0 0)",
    "code-keyword": "oklch(0.4 0.19 300)",
    "code-string": "oklch(0.4 0.12 152)",
    "code-number": "oklch(0.42 0.14 45)",
    "code-function": "oklch(0.4 0.15 258)",
    "code-operator": "oklch(0.41 0.15 10)",
    "code-punctuation": "oklch(0.38 0 0)",
    "code-variable": "oklch(0.42 0.11 62)",
    "code-tag": "oklch(0.42 0.19 28)",
    "code-deleted": "oklch(0.42 0.19 28)",
    "code-inserted": "oklch(0.4 0.12 152)",
    // No invisible register. Even the decorative divider is drawn at a weight a
    // reader can actually see, which is the whole argument of the theme.
    "border-subtle": "oklch(0 0 0 / 0.25)",
    border: "oklch(0 0 0 / 0.8)",
    "border-strong": "oklch(0 0 0 / 1)",
    input: "oklch(0.2 0 0)",
    // Reference, not a literal: tracks --nx-primary if a theme changes it.
    ring: "var(--nx-primary)",
    "focus-ring": "var(--nx-primary)",
    "shadow-color": "oklch(0 0 0)",
    // The rail steps down from the card so the three regions -- rail, field,
    // panel -- are three distinct lightnesses before any rule is considered.
    "sidebar-background": "oklch(0.96 0 0)",
    "sidebar-foreground": "oklch(0 0 0)",
    "sidebar-primary": "oklch(0 0 0)",
    "sidebar-primary-foreground": "oklch(1 0 0)",
    "sidebar-accent": "oklch(0.87 0 0)",
    "sidebar-accent-foreground": "oklch(0 0 0)",
    "sidebar-border": "oklch(0.25 0 0)",
    "sidebar-ring": "var(--nx-primary)",
    "table-border": "var(--nx-border)",
    "table-row-hover": "oklch(0.93 0 0)",
  },
  dark: {
    // Authored, not inverted. The light mode steps its surfaces DOWN from the
    // card (page 0.93 under card 1.0); dark steps them UP from the page,
    // because a dark surface can only be lifted, and a mirrored ladder would
    // have put the popover below the page it floats over.
    background: "oklch(0 0 0)",
    "page-background": "oklch(0 0 0)",
    foreground: "oklch(1 0 0)",
    card: "oklch(0.13 0 0)",
    "card-foreground": "oklch(1 0 0)",
    popover: "oklch(0.18 0 0)",
    "popover-foreground": "oklch(1 0 0)",
    primary: "oklch(1 0 0)",
    "primary-foreground": "oklch(0 0 0)",
    secondary: "oklch(0.22 0 0)",
    "secondary-foreground": "oklch(1 0 0)",
    muted: "oklch(0.18 0 0)",
    // Held at 7:1 against the popover, the lightest surface it lands on, rather
    // than against the black page where anything would pass.
    "muted-foreground": "oklch(0.82 0 0)",
    // The accent inverts to a pale blue block with black type: dark navy on a
    // black page would have collapsed into the background.
    accent: "oklch(0.82 0.12 240)",
    "accent-foreground": "oklch(0 0 0)",
    highlight: "oklch(0.88 0.18 100)",
    "highlight-foreground": "oklch(0 0 0)",
    // Text tokens rise to clear 7:1 on the page; `-solid` stays at the
    // light-mode value so white button type keeps its own AAA margin on the
    // fill. The split is what allows both to be true at once.
    // 0.735 rather than 0.72: red carries the least luminance of the three
    // statuses, and the popover at 0.18 is the lightest surface this text lands
    // on, so it is the pair that sets the floor for the whole AAA claim.
    destructive: "oklch(0.735 0.18 27)",
    "destructive-solid": "oklch(0.45 0.2 27)",
    "destructive-foreground": "oklch(1 0 0)",
    success: "oklch(0.78 0.16 150)",
    "success-solid": "oklch(0.42 0.13 150)",
    "success-foreground": "oklch(1 0 0)",
    warning: "oklch(0.82 0.15 75)",
    "warning-foreground": "oklch(0 0 0)",
    "code-bg": "oklch(0.1 0 0)",
    "code-fg": "oklch(1 0 0)",
    "code-comment": "oklch(0.85 0 0)",
    "code-keyword": "oklch(0.84 0.13 300)",
    "code-string": "oklch(0.86 0.15 152)",
    "code-number": "oklch(0.86 0.13 45)",
    "code-function": "oklch(0.84 0.12 258)",
    "code-operator": "oklch(0.84 0.13 10)",
    "code-punctuation": "oklch(0.85 0 0)",
    "code-variable": "oklch(0.87 0.11 62)",
    "code-tag": "oklch(0.82 0.15 28)",
    "code-deleted": "oklch(0.82 0.15 28)",
    "code-inserted": "oklch(0.86 0.15 152)",
    "border-subtle": "oklch(1 0 0 / 0.25)",
    border: "oklch(1 0 0 / 0.8)",
    "border-strong": "oklch(1 0 0 / 1)",
    input: "oklch(0.85 0 0)",
    ring: "var(--nx-primary)",
    "focus-ring": "var(--nx-primary)",
    "shadow-color": "oklch(0 0 0)",
    "sidebar-background": "oklch(0.1 0 0)",
    "sidebar-foreground": "oklch(1 0 0)",
    "sidebar-primary": "oklch(1 0 0)",
    "sidebar-primary-foreground": "oklch(0 0 0)",
    "sidebar-accent": "oklch(0.26 0 0)",
    "sidebar-accent-foreground": "oklch(1 0 0)",
    "sidebar-border": "oklch(0.75 0 0)",
    "sidebar-ring": "var(--nx-primary)",
    "table-border": "var(--nx-border)",
    "table-row-hover": "oklch(0.18 0 0)",
  },
};
