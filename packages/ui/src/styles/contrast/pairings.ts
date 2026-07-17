/**
 * The token pairings the contrast check asserts, and the ones it deliberately
 * excludes.
 *
 * The rule is: assert the pairings the design system actually renders, not the
 * cartesian product of every token against every other (which is noise). A
 * `text` pair is foreground text on a surface; a `ui` pair is a boundary or
 * indicator (border, focus ring) against its surface. Coverage spans the base
 * `--nx-*` tokens, the `@theme` `--color-*` shades (evaluated through
 * `color-mix()`), and the intentional alpha-utility tints (`bg-primary/10`).
 * Exclusions are listed with a reason: a silent omission would read as
 * "covered" when it is not.
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
  /** Foreground / boundary custom property, with the `--` prefix. */
  fg: string;
  /** Surface custom property the foreground sits on. */
  bg: string;
  kind: PairKind;
  /** Human description used in the (passing or failing) test name. */
  label: string;
  /** Restrict to one mode when the rendered pair is mode-specific (badge/alert
   * shades flip between light and dark). Omitted means assert in both. */
  mode?: "light" | "dark";
  /** Alpha applied to the foreground before compositing (`text-primary/50`). */
  fgAlpha?: number;
  /** Alpha applied to the surface before it is composited onto {@link bgOver}
   * (`bg-primary/10`). */
  bgAlpha?: number;
  /** The base surface a translucent `bg` is painted over (defaults to page). */
  bgOver?: string;
}

const STATUSES = ["destructive", "success", "warning"] as const;

// Body + surface text, filled on-colors, sidebar, and code (the base --nx-*
// contract). Borders and focus are further down.
const BASE_TEXT: Pairing[] = [
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
  {
    fg: "--nx-muted-foreground",
    bg: "--nx-muted",
    kind: "text",
    label: "muted text on muted surface",
  },
  {
    fg: "--nx-muted-foreground",
    bg: "--nx-popover",
    kind: "text",
    label: "muted text on popover",
  },

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
    fg: "--nx-highlight-foreground",
    bg: "--nx-highlight",
    kind: "text",
    label: "highlight on-color",
  },

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
];

const CODE_SYNTAX = [
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
const CODE_TEXT: Pairing[] = [
  { fg: "--nx-code-fg", bg: "--nx-code-bg", kind: "text", label: "code text" },
  ...CODE_SYNTAX.map(
    (name): Pairing => ({
      fg: `--nx-code-${name}`,
      bg: "--nx-code-bg",
      kind: "text",
      label: `code ${name}`,
    })
  ),
];

// Status colors carry two roles (Radix/Primer split): the base token is the
// readable TEXT color, and `-solid` is the button fill under white on-color
// text. Both are asserted so neither role drifts below AA.
const STATUS_TEXT: Pairing[] = STATUSES.flatMap((s): Pairing[] => [
  {
    fg: `--color-${s}`,
    bg: "--color-background",
    kind: "text",
    label: `${s} text on page`,
  },
  {
    fg: `--color-${s}`,
    bg: "--color-card",
    kind: "text",
    label: `${s} text on card`,
  },
]);
const STATUS_ON_SOLID: Pairing[] = ["destructive", "success"].map(
  (s): Pairing => ({
    fg: `--color-${s}-foreground`,
    bg: `--color-${s}-solid`,
    kind: "text",
    label: `${s} on-color (solid fill)`,
  })
);

// Tinted status surfaces (badges, alerts, chips). These are `color-mix()`
// shades, and the light/dark shade choices flip, so each is mode-specific. The
// pairs asserted are the tightest that render (darkest text on the lightest
// tint), so passing them covers the looser combinations too.
const STATUS_SHADES: Pairing[] = STATUSES.flatMap((s): Pairing[] => [
  {
    fg: `--color-${s}-700`,
    bg: `--color-${s}-100`,
    kind: "text",
    mode: "light",
    label: `${s} badge text (light)`,
  },
  {
    fg: `--color-${s}-600`,
    bg: `--color-${s}-50`,
    kind: "text",
    mode: "light",
    label: `${s} chip text 600/50 (light)`,
  },
  {
    fg: `--color-${s}-800`,
    bg: `--color-${s}-100`,
    kind: "text",
    mode: "light",
    label: `${s} chip text 800/100 (light)`,
  },
  {
    fg: `--color-${s}-900`,
    bg: `--color-${s}-50`,
    kind: "text",
    mode: "light",
    label: `${s} alert text (light)`,
  },
  {
    fg: `--color-${s}-100`,
    bg: `--color-${s}-900`,
    kind: "text",
    mode: "dark",
    label: `${s} badge text (dark)`,
  },
  {
    fg: `--color-${s}-100`,
    bg: `--color-${s}-950`,
    kind: "text",
    mode: "dark",
    label: `${s} alert text (dark)`,
  },
]);

// The alert's meaningful boundary is its thick left accent (`border-l-status`),
// held to the 3:1 UI minimum on the alert's own tinted surface.
const ALERT_ACCENT: Pairing[] = STATUSES.flatMap((s): Pairing[] => [
  {
    fg: `--color-${s}`,
    bg: `--color-${s}-50`,
    kind: "ui",
    mode: "light",
    label: `${s} alert accent (light)`,
  },
  {
    fg: `--color-${s}`,
    bg: `--color-${s}-950`,
    kind: "ui",
    mode: "dark",
    label: `${s} alert accent (dark)`,
  },
]);

// The one intentional alpha-utility tint that carries text: the primary badge
// (`bg-primary/10 text-primary`, `dark:bg-primary/20`). Its surface is the
// translucent primary painted over the page.
const PRIMARY_BADGE: Pairing[] = [
  {
    fg: "--color-primary",
    bg: "--color-primary",
    bgAlpha: 0.1,
    bgOver: "--color-background",
    kind: "text",
    mode: "light",
    label: "primary badge text (light)",
  },
  {
    fg: "--color-primary",
    bg: "--color-primary",
    bgAlpha: 0.2,
    bgOver: "--color-background",
    kind: "text",
    mode: "dark",
    label: "primary badge text (dark)",
  },
];

// The default/info alert: text-primary on a bg-primary/5 tint, in both modes.
// text-primary is mode-correct, so it reads on the tint over either surface.
const INFO_ALERT: Pairing[] = ["--color-background", "--color-card"].map(
  (over): Pairing => ({
    fg: "--color-primary",
    bg: "--color-primary",
    bgAlpha: 0.05,
    bgOver: over,
    kind: "text",
    label: `info alert text on ${over === "--color-card" ? "card" : "page"}`,
  })
);

// Boundaries + focus (3:1). Alpha borders are composited over their surface.
const BOUNDARIES: Pairing[] = [
  {
    fg: "--nx-border",
    bg: "--nx-background",
    kind: "ui",
    label: "border on page",
  },
  { fg: "--nx-border", bg: "--nx-card", kind: "ui", label: "border on card" },
  {
    fg: "--nx-border",
    bg: "--nx-popover",
    kind: "ui",
    label: "border on popover",
  },
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
    fg: "--nx-input",
    bg: "--nx-popover",
    kind: "ui",
    label: "input border on popover",
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

export const PAIRINGS: Pairing[] = [
  ...BASE_TEXT,
  ...CODE_TEXT,
  ...STATUS_TEXT,
  ...STATUS_ON_SOLID,
  ...STATUS_SHADES,
  ...ALERT_ACCENT,
  ...PRIMARY_BADGE,
  ...INFO_ALERT,
  ...BOUNDARIES,
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
    token: "alert thin container border (--color-*-200 on -50 / -900 on -950)",
    reason:
      "The faint full border around an Alert is decorative: the alert is identified by its tinted fill, its thick left accent (asserted above), and its icon. Like --nx-border-subtle this is a 1.4.11 separator, not a required boundary.",
  },
  {
    token: "--nx-warning-foreground on --nx-warning",
    reason:
      "Not rendered. Warning has no solid button; its base token is the text color and nothing paints warning-foreground on a warning fill. Asserting it would test a pair that never reaches the screen.",
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
    token: "ad-hoc alpha-opacity utilities (text-*/NN, border-*/NN)",
    reason:
      "Opacity utilities applied per call site (e.g. text-primary/50) are usage-level, not tokens, so a token check cannot see their surface. The failing ones are fixed at the source and guarded by alpha-utilities.test.ts; the one intentional text tint (the primary badge) is asserted above.",
  },
];
