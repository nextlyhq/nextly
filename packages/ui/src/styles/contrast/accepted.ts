/**
 * Pairings that render BELOW their WCAG minimum as a deliberate product
 * decision, each recorded with the ratio it actually measures.
 *
 * This is not {@link EXCLUSIONS}, and the difference is the whole point of the
 * file existing. An exclusion says "1.4.11 does not scope this pairing", and
 * every entry there carries a reason drawn from the standard: a decorative
 * separator, a container edge on a control identified by its own label. Those
 * pairings are not failing; they were never in scope. The entries HERE are in
 * scope and are failing. Filing them as exclusions would have been the easy
 * move and would have quietly corrupted the one list a reviewer reads to learn
 * where coverage genuinely ends.
 *
 * So the accepted set is kept separate, and it is kept honest three ways. The
 * suites assert each entry still measures what is recorded, so a token cannot
 * drift further under cover of an existing entry. They assert each entry is
 * still below its threshold, so one that gets fixed has to be deleted rather
 * than lingering as a false confession. And they assert every entry still
 * matches something real, so a renamed or removed pairing cannot leave a
 * permanent blanket here.
 *
 * **Identity is the ROLE PAIR, not a label.** Two different suites consult this
 * list — the token pairings and the scan over ink utilities in real component
 * source — and they name the same colours differently: one has
 * `--color-destructive-foreground` on `--color-destructive-solid`, the other has
 * `text-destructive-foreground` on `bg-destructive-solid`. Keying on either
 * spelling would have forced a second list for the other suite, and two lists
 * of accepted failures drift apart silently, each looking complete on its own.
 * Reducing both to the role pair gives one identity that both can ask for.
 */

/** A pairing knowingly shipped below its threshold. */
export interface AcceptedRegression {
  /** Foreground role: the token name with its `--nx-` / `--color-` prefix cut. */
  fg: string;
  /** Surface role, named the same way. */
  bg: string;
  mode: "light" | "dark";
  /** The ratio this pair measures at the tokens as shipped, to 2dp. */
  ratio: number;
  /** Why the palette keeps the failing value rather than correcting it. */
  reason: string;
  /**
   * Alpha and underlying surface, when the pair needs them to be identified.
   *
   * The role pair alone is not always unique: `bg-primary/10 over card` and
   * `bg-primary/10 over page` are both `primary` on `primary`, and they measure
   * different ratios. Omitted means "the opaque pair", which is what every
   * current entry is; an entry that omits them does NOT match a tinted variant.
   */
  fgAlpha?: number;
  bgAlpha?: number;
  bgOver?: string;
}

/** The parts of a pairing beyond its role pair that change what it measures. */
export interface PairDetail {
  fgAlpha?: number;
  bgAlpha?: number;
  bgOver?: string;
}

/**
 * The role a token plays, independent of which namespace spells it. `--nx-input`
 * and `--color-input` are one role; so are the `text-`/`bg-` utility forms the
 * component scan sees.
 */
export function roleOf(token: string): string {
  // The two strips are mutually exclusive, and conflating them is a live bug
  // rather than a tidiness point: `--nx-border-strong` is a custom property
  // whose role is `border-strong`, but a blanket utility strip turns it into
  // `strong` and it then matches nothing. A leading `--` says which kind of
  // name this is, so branch on it instead of applying both.
  const named = token.startsWith("--")
    ? token.replace(/^--(?:nx|color)-/, "")
    : token.replace(/^(?:text|bg|border|ring)-/, "");

  // The 500 step of a status scale is not a shade of the role, it IS the role:
  // theme.css declares `--color-destructive-500: var(--nx-destructive)`, the
  // same token under a second name. Components use both spellings, so without
  // this the two would need separate accepted entries for one colour -- which
  // is the duplication this whole identity exists to avoid. Only 500 is folded
  // in; every other step is a genuine `color-mix()` and measures differently.
  return named.replace(/-500$/, "");
}

/**
 * Every entry here traces to one decision: take the reference palette's border
 * weight and its red rather than darken either to pass. The tokens involved are
 * `--nx-input`, `--nx-border-strong`, `--nx-sidebar-border`, `--nx-destructive`
 * and `--nx-destructive-solid`, all in light mode. Dark mode clears its
 * thresholds unchanged and nothing here applies to it.
 *
 * The boundary entries and the text entries are not equivalent trades, and the
 * difference is worth keeping in view. A faint border leaves a control whose
 * label, value and focus ring still identify it; a text ratio below minimum
 * means the words themselves are harder to read. `destructive-foreground` on
 * `destructive-solid` is the sharpest case, being the label of a confirm button.
 */
export const ACCEPTED_REGRESSIONS: AcceptedRegression[] = [
  // --nx-input: the reference field border. The 3:1 boundary minimum wants
  // roughly oklch(0.63), a noticeably heavier input than the palette is drawn
  // around.
  {
    fg: "input",
    bg: "page-background",
    mode: "light",
    ratio: 1.09,
    reason:
      "Field border against the page container, the weakest instance and the one to buy back first.",
  },
  {
    fg: "input",
    bg: "muted",
    mode: "light",
    ratio: 1.09,
    reason: "Field border against a muted surface.",
  },
  {
    fg: "input",
    bg: "background",
    mode: "light",
    ratio: 1.16,
    reason: "Field border against the page background.",
  },
  {
    fg: "input",
    bg: "popover",
    mode: "light",
    ratio: 1.16,
    reason: "Field border inside a popover.",
  },
  {
    fg: "input",
    bg: "card",
    mode: "light",
    ratio: 1.19,
    reason: "Field border on a card, the strongest instance of this token.",
  },

  // --nx-sidebar-border: matching the border weight used elsewhere.
  {
    fg: "sidebar-border",
    bg: "sidebar-background",
    mode: "light",
    ratio: 1.16,
    reason:
      "Sidebar edge against its own surface, held to the same weight as the rest of the palette's borders.",
  },

  // --nx-border-strong: mixed from the border token rather than set darker, so
  // "strong" stays a step up from --nx-border without leaving the palette.
  {
    fg: "border-strong",
    bg: "page-background",
    mode: "light",
    ratio: 2.1,
    reason: "Emphasised boundary against the page container.",
  },
  {
    fg: "border-strong",
    bg: "background",
    mode: "light",
    ratio: 2.22,
    reason: "Emphasised boundary against the page background.",
  },

  // --nx-destructive / --nx-destructive-solid: the reference red. Darkening it
  // to clear 4.5:1 produces a visibly different colour, and the status scale is
  // mixed from this token, so every destructive shade moves with it.
  {
    fg: "destructive",
    bg: "background",
    mode: "light",
    ratio: 3.73,
    reason: "Destructive label on the page background.",
  },
  {
    fg: "destructive",
    bg: "popover",
    mode: "light",
    ratio: 3.73,
    reason: "Destructive label inside a popover.",
  },
  {
    fg: "destructive",
    bg: "card",
    mode: "light",
    ratio: 3.84,
    reason: "Destructive label on a card.",
  },
  {
    fg: "destructive",
    bg: "page-background",
    mode: "light",
    ratio: 3.52,
    reason:
      "Destructive label on the page container, which is what .admin-page-container paints and is a separate token from the page background.",
  },
  {
    fg: "destructive",
    bg: "muted",
    mode: "light",
    ratio: 3.52,
    reason:
      "Destructive label on the muted surface of a dashboard widget or stat tile. The tightest of the text pairs, muted being the darkest of the surfaces this ink lands on.",
  },
  {
    fg: "destructive",
    bg: "sidebar-background",
    mode: "light",
    ratio: 3.73,
    reason: "Destructive label on the sidebar surface, in quick-link rows.",
  },
  // Destructive ink on a TINTED destructive fill: the error panels, the delete
  // affordances on repeater and component rows, and the dashboard widgets. The
  // tint sits on the muted surface, and blending it there lands closer to the
  // ink than any opaque pair does -- which is why these are keyed by alpha and
  // by the surface underneath, and why the opaque entries above do not cover
  // them. These are the worst ratios in this file.
  {
    fg: "destructive",
    bg: "destructive",
    bgAlpha: 0.1,
    bgOver: "muted",
    mode: "light",
    ratio: 3.11,
    reason:
      "Error-panel text on a 10% destructive tint over the muted surface. The lowest ratio the palette ships, and it is a message someone reads when something has already gone wrong.",
  },
  {
    fg: "destructive",
    bg: "destructive",
    bgAlpha: 0.05,
    bgOver: "muted",
    mode: "light",
    ratio: 3.31,
    reason:
      "Destructive ink on a 5% tint over the muted surface: dashboard widget counts and empty states.",
  },
  // The same two tints over the remaining surfaces. Listed rather than reduced
  // to a rule, because each is a distinct measured colour and the file's whole
  // purpose is that a reader can see the number without recomputing it. The
  // spread is narrow (3.11 to 3.60) and every one of them fails, which is the
  // useful summary: nowhere in the admin does destructive ink on its own tint
  // reach the text minimum.
  {
    fg: "destructive",
    bg: "destructive",
    bgAlpha: 0.1,
    bgOver: "background",
    mode: "light",
    ratio: 3.29,
    reason: "10% tint over the page.",
  },
  {
    fg: "destructive",
    bg: "destructive",
    bgAlpha: 0.1,
    bgOver: "card",
    mode: "light",
    ratio: 3.38,
    reason: "10% tint over a card, the best of the tinted set.",
  },
  {
    fg: "destructive",
    bg: "destructive",
    bgAlpha: 0.1,
    bgOver: "popover",
    mode: "light",
    ratio: 3.29,
    reason: "10% tint inside a popover.",
  },
  {
    fg: "destructive",
    bg: "destructive",
    bgAlpha: 0.1,
    bgOver: "sidebar-background",
    mode: "light",
    ratio: 3.29,
    reason: "10% tint on the sidebar surface.",
  },
  {
    fg: "destructive",
    bg: "destructive",
    bgAlpha: 0.05,
    bgOver: "background",
    mode: "light",
    ratio: 3.5,
    reason: "5% tint over the page.",
  },
  {
    fg: "destructive",
    bg: "destructive",
    bgAlpha: 0.05,
    bgOver: "card",
    mode: "light",
    ratio: 3.6,
    reason: "5% tint over a card.",
  },
  {
    fg: "destructive",
    bg: "destructive",
    bgAlpha: 0.05,
    bgOver: "popover",
    mode: "light",
    ratio: 3.5,
    reason: "5% tint inside a popover.",
  },
  {
    fg: "destructive",
    bg: "destructive",
    bgAlpha: 0.05,
    bgOver: "sidebar-background",
    mode: "light",
    ratio: 3.5,
    reason: "5% tint on the sidebar surface.",
  },
  {
    fg: "destructive-foreground",
    bg: "destructive-solid",
    mode: "light",
    ratio: 3.84,
    reason:
      "White label on the solid destructive fill: the Delete / Discard / Unpublish confirm buttons. The most consequential entry in this file.",
  },
  {
    fg: "destructive-600",
    bg: "muted",
    mode: "light",
    ratio: 4.23,
    reason:
      "The 600 shade painted directly on the muted surface, in the entry meta strip.",
  },
  {
    fg: "destructive-600",
    bg: "background",
    mode: "light",
    ratio: 4.48,
    reason:
      "The same meta-strip ink against the page. Two hundredths short, and the closest entries in this file to passing.",
  },
  {
    fg: "destructive-600",
    bg: "popover",
    mode: "light",
    ratio: 4.48,
    reason: "The meta-strip ink inside a popover; same colour as on the page.",
  },
  {
    fg: "destructive-600",
    bg: "sidebar-background",
    mode: "light",
    ratio: 4.48,
    reason: "The meta-strip ink on the sidebar surface.",
  },
  {
    fg: "destructive-600",
    bg: "destructive-50",
    mode: "light",
    ratio: 4.33,
    reason:
      "Derived chip shade, mixed from the base token rather than chosen, so it moved with it. The closest of these to passing.",
  },
];

/**
 * The accepted entry for a foreground/surface pair, in a given mode.
 *
 * Alpha and underlying surface must match exactly, including both being absent.
 * A tinted variant of an accepted opaque pair measures a different ratio and is
 * a different decision, so it does not inherit the acceptance.
 */
export function acceptedFor(
  fg: string,
  bg: string,
  mode: "light" | "dark",
  detail: PairDetail = {}
): AcceptedRegression | undefined {
  const fgRole = roleOf(fg);
  const bgRole = roleOf(bg);
  const over = detail.bgOver === undefined ? undefined : roleOf(detail.bgOver);
  return ACCEPTED_REGRESSIONS.find(
    entry =>
      entry.mode === mode &&
      entry.fg === fgRole &&
      entry.bg === bgRole &&
      entry.fgAlpha === detail.fgAlpha &&
      entry.bgAlpha === detail.bgAlpha &&
      (entry.bgOver === undefined
        ? over === undefined
        : roleOf(entry.bgOver) === over)
  );
}
