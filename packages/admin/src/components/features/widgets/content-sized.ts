/**
 * The widgets whose bodies report the height their content takes (`frame/fit`), and so may stand
 * shorter than their stored rows at rest: core's Needs your attention and Upcoming releases, by
 * the ids core declares them under (`core-widgets/ids.ts` in nextly, which the admin does not
 * import at run time). While one of them is loading, its cell asks for the height a one-item
 * answer takes rather than its stored height (`useLoadingFitsOneItem`).
 *
 * The one list of them. It imports nothing, so the browser tests read this same set rather than
 * keeping a copy of their own.
 *
 * @module components/features/widgets/content-sized
 */

/** The content-sized widgets, by widget id. */
export const CONTENT_SIZED_WIDGETS: ReadonlySet<string> = new Set([
  "core/needs-attention",
  "core/upcoming-releases",
]);
