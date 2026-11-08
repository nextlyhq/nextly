/**
 * The widgets whose bodies report the height their content takes (`frame/fit`), and so may stand
 * shorter than their stored rows at rest: core's Needs your attention and Upcoming releases, by
 * the ids core declares them under (`core-widgets/ids.ts` in nextly, which the admin does not
 * import at run time). While one of them is loading, its cell asks for the height a one-item
 * answer takes rather than its stored height (`useLoadingFitsOneItem`).
 *
 * The one list of them. It imports nothing, so the browser tests read these same widgets rather
 * than keeping a copy of their own.
 *
 * @module components/features/widgets/content-sized
 */

/** How a content-sized widget's answer lays its items out, which its loading request follows. */
export interface ContentSizedWidget {
  /**
   * Whether its answer is drawn as a table at the large tier (a heading row over table rows) in
   * place of list rows, as Upcoming releases' is (`ListCard`, for a model with fields beside its
   * title). That heading has no fixed height, so its one-item answer's height is not known before
   * it is drawn, and a card that loads at the large tier keeps its stored height.
   */
  tableAtLargeTier: boolean;
}

/** The content-sized widgets, by widget id. */
export const CONTENT_SIZED_WIDGETS: ReadonlyMap<string, ContentSizedWidget> =
  new Map([
    // Its items are list rows at every tier.
    ["core/needs-attention", { tableAtLargeTier: false }],
    ["core/upcoming-releases", { tableAtLargeTier: true }],
  ]);
