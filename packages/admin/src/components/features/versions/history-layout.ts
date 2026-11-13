/**
 * The version history page's frame: its header, and the rail beside the
 * comparison. Shared by the page and by its loading outline, so the outline
 * stands where the page will draw and nothing moves when the page arrives.
 *
 * @module components/features/versions/history-layout
 */

/** The page as a whole: the header over the rail and the comparison. */
export const HISTORY_FRAME = "flex h-full min-h-0 flex-col";

/** The header: the way back, the page's title and the document's name. */
export const HISTORY_HEAD =
  "flex items-center gap-3 border-b border-border px-4 py-3";

/** The title and the document's name under it, one line each. */
export const HISTORY_TITLES = "min-w-0";

/** The rail and the comparison: stacked below `lg`, side by side above it. */
export const HISTORY_SPLIT = "flex min-h-0 flex-1 flex-col lg:flex-row";

/**
 * The rail of versions: a fixed 18rem beside the comparison, and a bounded
 * height over it when stacked.
 */
export const HISTORY_RAIL =
  "max-h-[40vh] shrink-0 overflow-y-auto border-b border-border lg:max-h-none lg:w-72 lg:border-r lg:border-b-0";
