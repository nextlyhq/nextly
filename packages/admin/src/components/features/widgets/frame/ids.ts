/**
 * The ids a card's frame gives its parts, derived from the card's id.
 *
 * Exported so the code that draws a card's customise controls -- its drag handle and its card
 * menu -- can name them after the card ("Card actions for Recent activity") through
 * `aria-labelledby`, without reading the DOM or being handed an id it would have to keep in
 * step. One function, so the frame and its callers cannot disagree on the spelling.
 *
 * @module components/features/widgets/frame/ids
 */

export interface FrameIds {
  /** The card's title heading. */
  titleId: string;
}

export function frameIds(cardId: string): FrameIds {
  return { titleId: `card-${cardId}-title` };
}
