/**
 * The site's fluid range, read one way by everything that reads it.
 *
 * Two places make text styles' fluid sizes again across the range the site
 * uses: the merge of the site's code and its stored edits, for the text
 * styles the code supplies, and the Site Style Single's write, for the stored
 * ones. Read two ways, the range could give a style one size on the page and
 * another in the database, so both read it here.
 *
 * Node-safe: no React, no admin imports.
 *
 * @module site-fluid-range
 */
import {
  DEFAULT_FLUID_RANGE,
  isPlainRecord,
  type FluidRangeWidths,
  type SiteTokenSet,
} from "@nextlyhq/blocks-engine";

/**
 * The site's fluid range as stored: two positive, finite widths in px, the
 * smallest screen below the largest, or a fluid size would grow across no
 * width at all.
 */
export function isFluidRange(
  value: unknown
): value is { min: number; max: number } {
  return (
    isPlainRecord(value) &&
    typeof value.min === "number" &&
    typeof value.max === "number" &&
    Number.isFinite(value.min) &&
    Number.isFinite(value.max) &&
    value.min > 0 &&
    value.min < value.max
  );
}

/**
 * The range a tokens section says the site uses: its own, else the code's,
 * else 360 to 1280, as the editor reads it. `undefined` for a range the
 * validator refuses, so nothing is made again across it.
 *
 * `tokens` is read as stored data, since a write may send anything there.
 */
export function siteFluidRange(
  tokens: unknown,
  code: SiteTokenSet | undefined
): FluidRangeWidths | undefined {
  const own = isPlainRecord(tokens) ? tokens.fluidRange : undefined;
  if (own !== undefined) return isFluidRange(own) ? own : undefined;
  const coded = code?.fluidRange;
  return coded !== undefined && isFluidRange(coded)
    ? coded
    : DEFAULT_FLUID_RANGE;
}
