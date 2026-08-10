/**
 * Calm: soft and quiet, held to WCAG AA.
 *
 * Design intent. This is the mood-board admin -- generous radii, whisper-thin
 * rules, dusty colours, nothing that raises its voice. It is the direction most
 * often asked for ("can it feel less harsh?") and it is included here to answer
 * that question with a measurement instead of an opinion.
 *
 * REHABILITATED 2026-08-10. Calm was authored as a measurement -- how far
 * "soft and quiet" can be taken before an admin stops being legible -- and it
 * missed 48 asserted pairings on purpose. Shortlisting it as a candidate the
 * product might actually ship changed the job: a candidate has to pass. Only
 * lightness moved (plus border alpha); hue and chroma are untouched, so the
 * palette is the same one. What it cost is recorded in calm-rehab-notes.md.
 *
 * Three of the theme's own rules are what made it miss, and each is now
 * softened in look rather than in contrast:
 *
 * 1. The secondary layer, not the reading layer. Body text always cleared 7:1;
 *    what missed was `muted-foreground`, the "quiet" register every timestamp,
 *    helper line, empty state and column caption lives in -- so the theme read
 *    as serene precisely because the second most common text on screen had
 *    stopped being legible. It is now 0.535 (light) / 0.714 (dark), a visible
 *    step firmer and still the quietest text in the palette.
 * 2. Boundaries were suggestions. `border` and `input` sat at an alpha that
 *    made a form look like a page of prose, and a text field indistinguishable
 *    from the space around it. They now clear 3:1 with margin. `border-subtle` is
 *    deliberately left faint: it separates rows rather than identifying a
 *    control, so WCAG 1.4.11 does not reach it.
 * 3. The palette is dusty rather than saturated, so status colours read as mood
 *    rather than as state. Their lightness moved; their hue and chroma did not,
 *    so they are the same dusty colours, darker in light mode and lighter in
 *    dark.
 *
 * The base vs `-solid` split still earns its keep: `destructive-solid` and
 * `success-solid` are the button fills, the base tokens are the text, and the
 * two answer different questions. Dark mode's `primary` is the one intent that
 * changed -- it now carries DARK type rather than near-white, because a single
 * primary cannot be both dark enough for white button text and light enough to
 * read as text on a tint of itself.
 */
import type { ThemeDefinition } from "../types";

export const CALM: ThemeDefinition = {
  id: "calm",
  label: "Calm",
  description:
    "Soft and quiet. Generous radii, dusty colours, low contrast held to AA.",
  group: "nextly",
  // Air is load-bearing: with rules this faint, spacing is the only remaining
  // signal that two rows are two rows.
  recommendedDensity: "comfortable",
  radius: "16px",
  fontSans: "var(--font-inter), Inter, sans-serif",
  fontMono:
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  light: {
    // Barely-there cool white. Card and popover are pure white so a surface is
    // identified by being *lighter* than the page, since there is no rule
    // strong enough to identify it any other way.
    background: "oklch(0.99 0.002 260)",
    "page-background": "oklch(0.975 0.004 260)",
    // Soft charcoal, never black. Still clears AAA on the page -- the theme is
    // quiet, not careless, and this is the one register it does not soften.
    foreground: "oklch(0.45 0.01 260)",
    card: "oklch(1 0 0)",
    "card-foreground": "oklch(0.45 0.01 260)",
    popover: "oklch(1 0 0)",
    "popover-foreground": "oklch(0.45 0.01 260)",
    // Dusty blue, set at the darkest lightness that still reads as dusty:
    // it carries white type at 5:1, which is what the on-colour pairing needs.
    primary: "oklch(0.487 0.06 250)",
    "primary-foreground": "oklch(1 0 0)",
    secondary: "oklch(0.965 0.004 260)",
    "secondary-foreground": "oklch(0.45 0.01 260)",
    muted: "oklch(0.97 0.003 260)",
    // The quiet register, and the theme's single largest legibility cost.
    "muted-foreground": "oklch(0.535 0.012 260)",
    // A wash rather than a fill: the selected row is a tint of the page, and
    // the type on it stays the ordinary soft charcoal.
    accent: "oklch(0.94 0.02 250)",
    "accent-foreground": "oklch(0.45 0.01 260)",
    // Pale sage marker. A saturated highlighter would be the loudest thing on
    // the screen, which the theme does not allow.
    highlight: "oklch(0.93 0.06 130)",
    "highlight-foreground": "oklch(0.45 0.01 260)",
    // Dusty statuses: state as mood. Hue and chroma are the original ones;
    // only lightness moved, far enough that each clears 4.5:1 as TEXT. The
    // `-solid` fills are the button colours and answer a different question.
    destructive: "oklch(0.552 0.13 22)",
    "destructive-solid": "oklch(0.56 0.17 22)",
    "destructive-foreground": "oklch(1 0 0)",
    success: "oklch(0.528 0.09 155)",
    "success-solid": "oklch(0.52 0.14 155)",
    "success-foreground": "oklch(1 0 0)",
    warning: "oklch(0.542 0.1 75)",
    "warning-foreground": "oklch(0.45 0.01 260)",
    // A comment is the muted register inside a code block, so it tracks
    // `muted-foreground` rather than being exempted -- code is text a reader
    // has to read, and the theme applies one rule to both.
    "code-bg": "oklch(0.972 0.004 260)",
    "code-fg": "oklch(0.45 0.01 260)",
    "code-comment": "oklch(0.515 0.01 260)",
    "code-keyword": "oklch(0.52 0.14 300)",
    "code-string": "oklch(0.5 0.09 152)",
    "code-number": "oklch(0.54 0.11 45)",
    "code-function": "oklch(0.52 0.11 258)",
    "code-operator": "oklch(0.53 0.1 10)",
    "code-punctuation": "oklch(0.515 0.01 260)",
    "code-variable": "oklch(0.52 0.09 62)",
    "code-tag": "oklch(0.53 0.14 28)",
    "code-deleted": "oklch(0.53 0.14 28)",
    "code-inserted": "oklch(0.5 0.09 152)",
    // Rules stay quiet but are no longer suggestions: `border` and
    // `border-strong` clear 3:1 against their surface, while `border-subtle`
    // keeps its near-invisible alpha -- it separates rows rather than
    // identifying a control, so WCAG 1.4.11 does not reach it.
    "border-subtle": "oklch(0.45 0.01 260 / 0.04)",
    border: "oklch(0.45 0.01 260 / 0.52)",
    "border-strong": "oklch(0.45 0.01 260 / 0.78)",
    input: "oklch(0.632 0.006 260)",
    // Reference, not a literal: tracks --nx-primary if a theme changes it.
    ring: "var(--nx-primary)",
    "focus-ring": "var(--nx-primary)",
    // A cool, heavily-diffused shadow. Elevation here is a haze, not an edge.
    "shadow-color": "oklch(0.55 0.03 260)",
    "sidebar-background": "oklch(0.975 0.004 260)",
    "sidebar-foreground": "oklch(0.5 0.012 260)",
    "sidebar-primary": "oklch(0.487 0.06 250)",
    "sidebar-primary-foreground": "oklch(1 0 0)",
    "sidebar-accent": "oklch(0.945 0.015 250)",
    "sidebar-accent-foreground": "oklch(0.45 0.01 260)",
    "sidebar-border": "oklch(0.614 0.005 260)",
    "sidebar-ring": "var(--nx-primary)",
    "table-border": "var(--nx-border)",
    "table-row-hover": "oklch(0.975 0.004 260)",
  },
  dark: {
    // Authored as dusk rather than as an inversion. A soft theme in dark mode
    // is not black-and-white with the lightness flipped -- it is a narrow band
    // in the middle, so the surfaces sit near 0.24 and the text near 0.86 and
    // neither end of the range is ever reached.
    background: "oklch(0.24 0.008 262)",
    "page-background": "oklch(0.21 0.008 262)",
    foreground: "oklch(0.86 0.006 262)",
    card: "oklch(0.27 0.009 262)",
    "card-foreground": "oklch(0.86 0.006 262)",
    popover: "oklch(0.29 0.01 262)",
    "popover-foreground": "oklch(0.86 0.006 262)",
    primary: "oklch(0.80 0.07 250)",
    "primary-foreground": "oklch(0.21 0.008 262)",
    secondary: "oklch(0.31 0.01 262)",
    "secondary-foreground": "oklch(0.86 0.006 262)",
    muted: "oklch(0.31 0.01 262)",
    // The same quiet register, one band above the surface instead of below the
    // text -- and the same cost, for the same reason.
    "muted-foreground": "oklch(0.714 0.012 262)",
    accent: "oklch(0.34 0.02 250)",
    "accent-foreground": "oklch(0.86 0.006 262)",
    highlight: "oklch(0.72 0.07 130)",
    "highlight-foreground": "oklch(0.21 0.008 262)",
    destructive: "oklch(0.728 0.12 22)",
    "destructive-solid": "oklch(0.56 0.17 22)",
    "destructive-foreground": "oklch(0.99 0.002 260)",
    success: "oklch(0.703 0.09 155)",
    "success-solid": "oklch(0.52 0.14 155)",
    "success-foreground": "oklch(0.99 0.002 260)",
    warning: "oklch(0.68 0.1 75)",
    "warning-foreground": "oklch(0.21 0.008 262)",
    "code-bg": "oklch(0.21 0.008 262)",
    "code-fg": "oklch(0.86 0.006 262)",
    "code-comment": "oklch(0.714 0.012 262)",
    "code-keyword": "oklch(0.74 0.1 300)",
    "code-string": "oklch(0.75 0.1 152)",
    "code-number": "oklch(0.77 0.09 45)",
    "code-function": "oklch(0.73 0.09 258)",
    "code-operator": "oklch(0.75 0.09 10)",
    "code-punctuation": "oklch(0.714 0.012 262)",
    "code-variable": "oklch(0.78 0.08 62)",
    "code-tag": "oklch(0.72 0.11 28)",
    "code-deleted": "oklch(0.72 0.11 28)",
    "code-inserted": "oklch(0.75 0.1 152)",
    // Faint white rules over a mid-dark surface lose contrast faster than dark
    // rules over a light one, so the dark mode is the softer of the two even
    // though the alpha values look comparable.
    "border-subtle": "oklch(1 0 0 / 0.04)",
    border: "oklch(1 0 0 / 0.40)",
    "border-strong": "oklch(1 0 0 / 0.55)",
    input: "oklch(0.598 0.012 262)",
    ring: "var(--nx-primary)",
    "focus-ring": "var(--nx-primary)",
    "shadow-color": "oklch(0.12 0.01 262)",
    "sidebar-background": "oklch(0.21 0.008 262)",
    "sidebar-foreground": "oklch(0.8 0.008 262)",
    "sidebar-primary": "oklch(0.80 0.07 250)",
    "sidebar-primary-foreground": "oklch(0.21 0.008 262)",
    "sidebar-accent": "oklch(0.29 0.015 250)",
    "sidebar-accent-foreground": "oklch(0.86 0.006 262)",
    "sidebar-border": "oklch(0.543 0.01 262)",
    "sidebar-ring": "var(--nx-primary)",
    "table-border": "var(--nx-border)",
    "table-row-hover": "oklch(0.27 0.009 262)",
  },
};
