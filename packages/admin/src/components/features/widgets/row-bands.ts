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

/** A drawn card as the rule reads it: its placement, its drawn columns and its stored rows. */
export interface BandCard {
  id: string;
  /** The columns it is drawn across at the dashboard's width. */
  span: number;
  /** The rows it spans: its stored height. */
  rows: number;
}

/** A card placed on the grid: the first row it spans and the row after its last. */
interface PlacedRows {
  id: string;
  start: number;
  end: number;
}

/**
 * The cards in `cards`, in their order, grouped into bands: the cards whose rows overlap, each
 * with the next, through any card between them. Placed as the grid places them
 * (`gridPlacements`), so a band is a stretch of rows the grid sizes together.
 */
function rowBands(cards: readonly BandCard[]): PlacedRows[][] {
  // One cell per card, in the cards' order.
  const cells = gridPlacements(cards);
  const placed = cards
    .map((card, index) => {
      const start = cells[index].row;
      return { id: card.id, start, end: start + Math.max(card.rows, 1) };
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
 * holds a card in `offStored`, one drawn across other rows than it stores (grown to show more,
 * or collapsed to one line), whose rows the band's other cards would no longer share. A lone card
 * is a band of its own.
 */
export function contentSizedPlacements(
  cards: readonly BandCard[],
  offStored: ReadonlySet<string>
): ReadonlySet<string> {
  const fitting = new Set<string>();
  for (const band of rowBands(cards)) {
    const [first] = band;
    const even = band.every(
      card =>
        card.start === first.start &&
        card.end === first.end &&
        !offStored.has(card.id)
    );
    if (even) for (const card of band) fitting.add(card.id);
  }
  return fitting;
}
