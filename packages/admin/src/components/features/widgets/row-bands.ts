/**
 * Which cards may be drawn at their content's height on the dashboard's content-sized rows.
 *
 * At rest each cell asks the rows it spans for one height, as its minimum (`frame/fit`), and the
 * grid spreads that height over the rows the cell spans. Where every card that shares a stretch of
 * rows starts on the same row and spans as many, they ask the same rows, so those rows are as tall
 * as the tallest request and every card is stretched to that height. Where they do not, as a card
 * three rows high beside one four rows high, the grid spreads each request over a different set of
 * rows: the taller card's request can grow the rows the shorter one spans past what its stored
 * rows draw it at, and two equal requests end at different heights for the gap the extra row adds.
 * So there every card asks for its stored height, which draws those rows as fixed rows draw them.
 *
 * Pure, so the rule is tested over cards without a grid; `ArrangedGrid` applies it.
 *
 * @module components/features/widgets/row-bands
 */

import { gridPlacements } from "./edit/drag/drop-geometry";

/** A drawn card as the rule reads it: its placement, its drawn columns and rows, and its stored rows. */
export interface BandCard {
  id: string;
  /** The columns it is drawn across at the dashboard's width. */
  span: number;
  /**
   * The rows it is drawn across now: its stored rows, or the rows it grew to or collapsed to,
   * which decide where the cards after it land.
   */
  rows: number;
  /** The rows its placement stores. */
  storedRows: number;
}

/**
 * A card placed on the grid: the first row it spans, the row after its last, and whether those
 * are other rows than it stores.
 */
interface PlacedRows {
  id: string;
  start: number;
  end: number;
  offStored: boolean;
}

/**
 * The cards in `cards`, in their order, grouped into bands: the cards whose rows overlap, each
 * with the next, through any card between them. Placed as the grid places them
 * (`gridPlacements`), at the rows each is drawn across now, so a band is a stretch of rows the
 * grid sizes together.
 */
function rowBands(cards: readonly BandCard[]): PlacedRows[][] {
  // One cell per card, in the cards' order.
  const cells = gridPlacements(cards);
  const placed = cards
    .map((card, index) => {
      const start = cells[index].row;
      return {
        id: card.id,
        start,
        end: start + Math.max(card.rows, 1),
        offStored: card.rows !== card.storedRows,
      };
    })
    .sort((a, b) => a.start - b.start);
  const bands: PlacedRows[][] = [];
  let end = Number.NEGATIVE_INFINITY;
  for (const card of placed) {
    const band = bands.at(-1);
    if (band !== undefined && card.start < end) {
      band.push(card);
      end = Math.max(end, card.end);
    } else {
      bands.push([card]);
      end = card.end;
    }
  }
  return bands;
}

/**
 * The placements that may be drawn at their content's height: those in a band
 * ({@link rowBands}) whose cards all start on one row and span as many rows. None in a band that
 * holds a card drawn across other rows than it stores (grown to show more, or collapsed to one
 * line): its cell asks for the height of the rows it is drawn across, which its band's other
 * cards are not certain to share. A lone card is a band of its own.
 */
export function contentSizedPlacements(
  cards: readonly BandCard[]
): ReadonlySet<string> {
  const fitting = new Set<string>();
  for (const band of rowBands(cards)) {
    const [first] = band;
    const even = band.every(
      card =>
        card.start === first.start && card.end === first.end && !card.offStored
    );
    if (even) for (const card of band) fitting.add(card.id);
  }
  return fitting;
}
