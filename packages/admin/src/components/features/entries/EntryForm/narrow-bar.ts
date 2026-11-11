/**
 * The document's state in the admin's one-row bar, where the bar's right part
 * is narrower than 32rem (where History and the preview fold into More): each
 * part keeps its mark (the status pill's dot, the save state's icon and
 * button) and says its words to a screen reader only, so the state never runs
 * into the document's verbs.
 *
 * The state group carries the attribute; each part's words carry the class.
 * Container queries do the measuring, so nothing re-renders as the bar
 * resizes.
 */
export const STATE_COMPACT_ATTRIBUTE = "data-state-compact";

/** A state part's words, read to a screen reader only in a narrow bar. */
export const WORDS_IN_NARROW_BAR =
  "in-data-[state-compact]:@max-lg/toolbar:sr-only";
