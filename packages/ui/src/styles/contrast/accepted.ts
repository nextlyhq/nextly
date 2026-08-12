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
 * suite asserts each entry still measures what is recorded, so a token cannot
 * drift further under cover of an existing entry. It asserts each entry is
 * still below its threshold, so one that gets fixed has to be deleted rather
 * than lingering as a false confession. And it asserts every entry still names
 * a real pairing, so a renamed or deleted pairing cannot leave a permanent
 * blanket here.
 *
 * The cost is concentrated rather than spread: `--nx-input` is the resting
 * border of every text field, textarea, select and checkbox, and at 1.09:1 on
 * the page container it is very close to invisible. Anyone revisiting the
 * palette should treat that entry as the first one to buy back.
 */

/** A pairing knowingly shipped below its threshold. */
export interface AcceptedRegression {
  /** {@link Pairing.label}, which is what the contrast suite names a case by. */
  label: string;
  mode: "light" | "dark";
  /** The ratio this pairing measures at the tokens as shipped, to 2dp. */
  ratio: number;
  /** Why the palette keeps the failing value rather than correcting it. */
  reason: string;
}

/**
 * Every entry here traces to one decision: match the reference palette's border
 * weight rather than darken it to pass. The tokens involved are `--nx-input`,
 * `--nx-border-strong` and `--nx-sidebar-border`, all in light mode. Dark mode
 * clears its thresholds unchanged and nothing here applies to it.
 *
 * Only boundary tokens are listed, and that is a boundary of its own. Text
 * ratios are not traded here: a label that fails is read wrongly, whereas a
 * faint border is a control whose edge is hard to place while its label, value
 * and focus ring all still say what it is.
 */
export const ACCEPTED_REGRESSIONS: AcceptedRegression[] = [
  // --nx-input: 0.94, the reference palette's field border. The 3:1 boundary
  // minimum wants roughly 0.63, which reads as a noticeably heavier input than
  // the palette is drawn around.
  {
    label: "input border on page container",
    mode: "light",
    ratio: 1.09,
    reason:
      "Field border against the page container, the weakest instance and the one to buy back first.",
  },
  {
    label: "input border on muted",
    mode: "light",
    ratio: 1.09,
    reason: "Field border against a muted surface.",
  },
  {
    label: "input border on page",
    mode: "light",
    ratio: 1.16,
    reason: "Field border against the page background.",
  },
  {
    label: "input border on popover",
    mode: "light",
    ratio: 1.16,
    reason: "Field border inside a popover.",
  },
  {
    label: "input border on card",
    mode: "light",
    ratio: 1.19,
    reason: "Field border on a card, the strongest instance of this token.",
  },

  // --nx-sidebar-border: 0.94, matching the border weight used elsewhere.
  {
    label: "sidebar border",
    mode: "light",
    ratio: 1.16,
    reason:
      "Sidebar edge against its own surface, held to the same weight as the rest of the palette's borders.",
  },

  // --nx-border-strong: mixed from the border token rather than set darker, so
  // "strong" stays a step up from --nx-border without leaving the palette.
  {
    label: "strong border on page container",
    mode: "light",
    ratio: 2.1,
    reason: "Emphasised boundary against the page container.",
  },
  {
    label: "strong border on page",
    mode: "light",
    ratio: 2.22,
    reason: "Emphasised boundary against the page background.",
  },
];

/** Whether a pairing is one of the knowingly-failing set, for a given mode. */
export function acceptedFor(
  label: string,
  mode: "light" | "dark"
): AcceptedRegression | undefined {
  return ACCEPTED_REGRESSIONS.find(
    entry => entry.label === label && entry.mode === mode
  );
}
