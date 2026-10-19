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
  return { titleId: `card-${domSafe(cardId)}-title` };
}

/**
 * A card id spelled so it is one valid DOM id, and still a different one for every card id.
 *
 * A placement id is opaque and may hold any character, a space included -- and `aria-labelledby`
 * reads a space as a separator, so `card-my card-title` would name two elements that do not
 * exist and the card would lose its accessible name. Every character outside `[A-Za-z0-9-]` is
 * written as `_<hex code point>_`, the underscore included, so two different ids can never come
 * out the same. The id itself stays as it is in `data-card-id`.
 */
function domSafe(cardId: string): string {
  return cardId.replace(
    /[^A-Za-z0-9-]/gu,
    char => `_${char.codePointAt(0)?.toString(16) ?? ""}_`
  );
}
