/**
 * The comparison page's frame, shared by the page and by its loading outline,
 * so the outline stands where the page will draw and nothing moves when the
 * page arrives.
 *
 * @module components/features/versions/history-layout
 */

/**
 * The page as a whole: at least the height it is given, growing with the
 * comparison, which scrolls with the page rather than inside a box of its own.
 */
export const HISTORY_FRAME = "flex min-h-full flex-col";

/** The page's column: the trail, the title row, the picker and the fields. */
export const HISTORY_COLUMN =
  "mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-5 sm:px-6";

/** The card that chooses the two versions and the language. */
export const HISTORY_PICKER =
  "flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4";
