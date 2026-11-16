/**
 * How the document bar lays out the controls at its right end, named once for
 * the bar and for the editor's outline, which draws the same controls in the
 * same places while the document is on its way.
 *
 * Imports nothing, so the outline, which is part of the admin's first frame,
 * reads these without pulling the editor's code in with them.
 *
 * @module components/features/entries/EntryForm/bar-controls
 */

/**
 * The space between the bar's controls, in the group that holds them all and
 * in the document's own verbs inside it, so a control moved from one to the
 * other keeps its place.
 */
export const BAR_CONTROLS_GAP = "gap-1.5";

/**
 * An icon-only control of the bar (More, the panel toggle): a small outline
 * button on the bar's tight padding.
 */
export const BAR_ICON_CONTROL = {
  variant: "outline",
  size: "sm",
  className: "px-2",
} as const;

/** The thin rule before the panel toggle, at the bar's far end. */
export const PANEL_TOGGLE_RULE = "mx-1 h-5 w-px bg-border";
