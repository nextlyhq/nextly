/**
 * Every figure on a card goes through here: the one formatter from `@nextlyhq/ui/format`,
 * in the admin's locale.
 *
 * The locale is the one the admin formats dates in (General Settings, through the date
 * config), so a card's numbers and its dates read in one locale rather than numbers following
 * the browser and dates following the admin.
 *
 * @module components/features/widgets/frame/format
 */

import {
  formatChange,
  formatCount,
  type FormatCountOptions,
  type FormattedChange,
  type FormattedNumber,
} from "@nextlyhq/ui/format";

import { getGlobalDateTimeConfig } from "@admin/lib/dates/format";

function adminLocale(): string {
  return getGlobalDateTimeConfig().locale ?? "en-US";
}

/**
 * The locale a card's text is ordered in: the one its numbers are written in, so a chart that
 * breaks a tie by label sorts as the same setup reads.
 */
export function cardLocale(): string {
  return adminLocale();
}

/** A count, total or chart value, as drawn and as heard. */
export function cardNumber(
  value: number,
  options: Omit<FormatCountOptions, "locale"> = {}
): FormattedNumber {
  return formatCount(value, { ...options, locale: adminLocale() });
}

/** A change against an earlier period, with its arrow and sign. */
export function cardChange(
  delta: number,
  options: Omit<FormatCountOptions, "locale" | "floor"> = {}
): FormattedChange {
  return formatChange(delta, { ...options, locale: adminLocale() });
}
