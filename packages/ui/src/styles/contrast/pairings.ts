/**
 * The token pairings the contrast check asserts, and the ones it deliberately
 * excludes.
 *
 * The rule is: assert the pairings the design system actually renders, not the
 * cartesian product of every token against every other (which is noise). A
 * `text` pair is foreground text on a surface; a `ui` pair is a boundary or
 * indicator (border, focus ring) against its surface. Every entry here is a
 * `foreground-on-surface` or `boundary-on-surface` relationship the admin puts
 * on screen. Exclusions are listed with a reason: a silent omission would read
 * as "covered" when it is not.
 */

/** WCAG minimums: 4.5:1 for normal text, 3:1 for large text, UI, and graphics. */
export type PairKind = "text" | "ui";

export const THRESHOLDS: Record<PairKind, number> = {
  // Normal text. Large text also passes at 3:1, but tokens carry no font size,
  // so every text pair is held to the stricter normal-text minimum (a superset).
  text: 4.5,
  // Borders, focus rings, and other non-text UI boundaries / graphical objects.
  ui: 3,
};

export interface Pairing {
  /** Foreground / boundary token, with the `--` prefix. */
  fg: string;
  /** Surface token the foreground sits on. */
  bg: string;
  kind: PairKind;
  /** Human description used in the (passing or failing) test name. */
  label: string;
}

const codeSyntax = [
  "comment",
  "keyword",
  "string",
  "number",
  "function",
  "operator",
  "punctuation",
  "variable",
  "tag",
  "deleted",
  "inserted",
];

export const PAIRINGS: Pairing[] = [
  // --- Body + surface text (4.5:1) ---
  {
    fg: "--nx-foreground",
    bg: "--nx-background",
    kind: "text",
    label: "body text on page",
  },
  {
    fg: "--nx-foreground",
    bg: "--nx-card",
    kind: "text",
    label: "body text on card",
  },
  {
    fg: "--nx-card-foreground",
    bg: "--nx-card",
    kind: "text",
    label: "card text",
  },
  {
    fg: "--nx-popover-foreground",
    bg: "--nx-popover",
    kind: "text",
    label: "popover text",
  },
  {
    fg: "--nx-muted-foreground",
    bg: "--nx-background",
    kind: "text",
    label: "muted text on page",
  },
  {
    fg: "--nx-muted-foreground",
    bg: "--nx-card",
    kind: "text",
    label: "muted text on card",
  },

  // --- Filled surfaces + their on-color (4.5:1) ---
  {
    fg: "--nx-primary-foreground",
    bg: "--nx-primary",
    kind: "text",
    label: "primary on-color",
  },
  {
    fg: "--nx-secondary-foreground",
    bg: "--nx-secondary",
    kind: "text",
    label: "secondary on-color",
  },
  {
    fg: "--nx-accent-foreground",
    bg: "--nx-accent",
    kind: "text",
    label: "accent on-color",
  },
  {
    fg: "--nx-destructive-foreground",
    bg: "--nx-destructive",
    kind: "text",
    label: "destructive on-color",
  },
  {
    fg: "--nx-success-foreground",
    bg: "--nx-success",
    kind: "text",
    label: "success on-color",
  },
  {
    fg: "--nx-warning-foreground",
    bg: "--nx-warning",
    kind: "text",
    label: "warning on-color",
  },
  {
    fg: "--nx-highlight-foreground",
    bg: "--nx-highlight",
    kind: "text",
    label: "highlight on-color",
  },

  // --- Sidebar text (4.5:1) ---
  {
    fg: "--nx-sidebar-foreground",
    bg: "--nx-sidebar-background",
    kind: "text",
    label: "sidebar text",
  },
  {
    fg: "--nx-sidebar-primary-foreground",
    bg: "--nx-sidebar-primary",
    kind: "text",
    label: "sidebar primary on-color",
  },
  {
    fg: "--nx-sidebar-accent-foreground",
    bg: "--nx-sidebar-accent",
    kind: "text",
    label: "sidebar accent on-color",
  },

  // --- Code block text (4.5:1): the base text and every syntax color on the code surface ---
  { fg: "--nx-code-fg", bg: "--nx-code-bg", kind: "text", label: "code text" },
  ...codeSyntax.map(
    (name): Pairing => ({
      fg: `--nx-code-${name}`,
      bg: "--nx-code-bg",
      kind: "text",
      label: `code ${name}`,
    })
  ),

  // --- Boundaries + focus (3:1). Borders are alpha and get composited first. ---
  {
    fg: "--nx-border",
    bg: "--nx-background",
    kind: "ui",
    label: "border on page",
  },
  { fg: "--nx-border", bg: "--nx-card", kind: "ui", label: "border on card" },
  {
    fg: "--nx-border-strong",
    bg: "--nx-background",
    kind: "ui",
    label: "strong border on page",
  },
  {
    fg: "--nx-input",
    bg: "--nx-background",
    kind: "ui",
    label: "input border on page",
  },
  {
    fg: "--nx-input",
    bg: "--nx-card",
    kind: "ui",
    label: "input border on card",
  },
  {
    fg: "--nx-ring",
    bg: "--nx-background",
    kind: "ui",
    label: "focus ring on page",
  },
  {
    fg: "--nx-focus-ring",
    bg: "--nx-background",
    kind: "ui",
    label: "focus-ring token on page",
  },
  {
    fg: "--nx-sidebar-border",
    bg: "--nx-sidebar-background",
    kind: "ui",
    label: "sidebar border",
  },
  {
    fg: "--nx-sidebar-ring",
    bg: "--nx-sidebar-background",
    kind: "ui",
    label: "sidebar focus ring",
  },
  {
    fg: "--nx-table-border",
    bg: "--nx-card",
    kind: "ui",
    label: "table border on card",
  },
  {
    fg: "--nx-table-border",
    bg: "--nx-background",
    kind: "ui",
    label: "table border on page",
  },
];

export interface Exclusion {
  token: string;
  reason: string;
}

/**
 * Tokens (or token families) intentionally not asserted. Reviewers can see the
 * exact coverage boundary instead of inferring it from silence.
 */
export const EXCLUSIONS: Exclusion[] = [
  {
    token: "--nx-border-subtle",
    reason:
      "A deliberately faint decorative divider (0.08 alpha). WCAG 1.4.11 exempts separators that are not required to identify or operate a component; holding it to 3:1 would defeat its purpose.",
  },
  {
    token: "--nx-focus-ring-offset",
    reason:
      "The solid gap between a focus ring and the content it surrounds, not a foreground/background pair; its job is separation, which the ring's own contrast already covers.",
  },
  {
    token: "--nx-chart-1..5",
    reason:
      "A categorical data-visualization palette. Meaningful chart contrast is adjacent-series and against-plot-background, not a single token pair; assert it where charts are actually rendered.",
  },
  {
    token:
      "--nx-page-background / --nx-table-row-hover / --nx-table-row-selected",
    reason:
      "Surface tints, not foreground colors. Text on them resolves to foreground / primary-foreground, which are already asserted against the base surfaces; the selected row is a --nx-primary fill covered by the primary on-color pair.",
  },
  {
    token: "@theme color-mix() derived shades (e.g. --color-warning-700)",
    reason:
      "Computed in the @theme layer from a base token via color-mix(), not authored --nx-* values. Asserting them requires evaluating color-mix() at the sRGB level; tracked as a follow-up to this base-token check.",
  },
];
