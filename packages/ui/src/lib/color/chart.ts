/**
 * The five shared chart colours, as the tokens a chart's marks are drawn in.
 *
 * A token reference rather than a colour, so a mark follows the theme in light
 * and dark and a chart never sets a colour of its own. Server-safe, so a chart a
 * server renders names its colours exactly as the admin's do.
 *
 * @module lib/color/chart
 */

/** One of the five shared chart colours, `--nx-chart-1` to `--nx-chart-5`. */
export type ChartSlot = 1 | 2 | 3 | 4 | 5;

/** The token a slot is drawn in. */
export function chartColour(slot: ChartSlot): string {
  return `var(--nx-chart-${slot})`;
}
