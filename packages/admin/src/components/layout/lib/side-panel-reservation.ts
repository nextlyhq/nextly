/**
 * How much of the window's inline end a mounted panel needs kept clear.
 *
 * A panel pinned to the edge with `position: fixed` is outside the layout, so
 * the page underneath keeps its full width and draws beneath it. Whatever the
 * page put there is then visible and unclickable: the pointer lands on the
 * panel, the handler never runs, and nothing reports a refusal because nothing
 * refused. That is worse than a disabled control, which at least says so.
 *
 * The alternative to reserving is a `z-index`, and it does not address this —
 * raising the page over the panel would put the page's controls ON TOP of the
 * panel's rows, which is the same collision with the winner swapped. Space has
 * to be made, not fought over.
 *
 * @module components/layout/lib/side-panel-reservation
 */

/** One mounted panel's claim, held for as long as that panel is on screen. */
export interface SidePanelReservation {
  /** CSS pixels of the inline end this panel occupies. */
  readonly width: number;
}

/**
 * The width to keep clear, which is the WIDEST claim rather than their sum.
 *
 * Panels pinned to the same edge overlap each other rather than queueing, so
 * two 480px panels still occupy 480px. Summing would indent the page by 960px
 * and leave half the window empty — and it would do so only in the rare state
 * where two are open, which is exactly the state nobody checks.
 */
export function resolveReservedInlineEnd(
  reservations: Iterable<SidePanelReservation>
): number {
  let widest = 0;
  for (const reservation of reservations) {
    if (reservation.width > widest) widest = reservation.width;
  }
  return widest;
}
