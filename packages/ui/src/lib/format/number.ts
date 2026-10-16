/**
 * The one number formatter for dashboard cards.
 *
 * Every figure a card shows -- a count, a chart value, a tooltip, a table cell, a text
 * alternative -- goes through here, so the same number reads the same everywhere it appears.
 * Two figures for one value that disagree ("1.2k" in a chart, "1,248" in its table, "1248" in
 * its description) are what this exists to make impossible.
 *
 * It is pure arithmetic on numbers with `Intl.NumberFormat`: no React, no DOM, so a server can
 * format the same way the admin does.
 *
 * @module lib/format/number
 */

/**
 * @experimental The size a card is drawn at, from its own width. Compact numbers appear only in the small
 * tier, where a full grouped value would not fit; everywhere else the exact value fits and is
 * shown.
 */
export type SizeTier = "small" | "medium" | "large";

/** @experimental How a count is formatted: its locale, its card's tier, and whether it is a floor. */
export interface FormatCountOptions {
  /** The admin's locale. Defaults to `en-US`, the admin's own default. */
  locale?: string;
  /** The tier the figure is drawn in. Only `small` compacts. */
  tier?: SizeTier;
  /**
   * The value is a lower bound: a source that stops counting at a limit knows only "at
   * least this many". Shown as "N+" and named "N or more".
   */
  floor?: boolean;
}

/** @experimental What a figure looks like, and what assistive technology hears for it. */
export interface FormattedNumber {
  /** Drawn on screen: "1,248", "1.2k", "100+". */
  text: string;
  /**
   * The accessible name: always the full grouped value, so "1.2k" is heard as "1,248"; a
   * floor is heard as "100 or more", never as a bare "100".
   */
  label: string;
}

const COMPACT_FROM = 1000;

// Intl formatters are costly to build and a dashboard formats hundreds of figures, so one of
// each kind is kept per locale.
const groupedCache = new Map<string, Intl.NumberFormat>();
const compactCache = new Map<string, Intl.NumberFormat>();

function grouped(locale: string): Intl.NumberFormat {
  let f = groupedCache.get(locale);
  if (!f) {
    f = new Intl.NumberFormat(locale);
    groupedCache.set(locale, f);
  }
  return f;
}

function compact(locale: string): Intl.NumberFormat {
  let f = compactCache.get(locale);
  if (!f) {
    f = new Intl.NumberFormat(locale, {
      notation: "compact",
      maximumFractionDigits: 1,
    });
    compactCache.set(locale, f);
  }
  return f;
}

/**
 * @experimental Format a count, total or chart value.
 *
 * Compact form ("1.2k", "3.4M") only in the small tier and only from 1,000; the thousands
 * suffix is lowercased and the larger ones keep their capitals, so "M" (million) cannot be
 * read as "m" (metres, or milli). The accessible name is always the full grouped value.
 *
 * @example
 * formatCount(1248, { tier: "small" }) // { text: "1.2k", label: "1,248" }
 * formatCount(1248, { tier: "medium" }) // { text: "1,248", label: "1,248" }
 * formatCount(100, { floor: true })    // { text: "100+", label: "100 or more" }
 */
export function formatCount(
  value: number,
  options: FormatCountOptions = {}
): FormattedNumber {
  const locale = options.locale ?? "en-US";
  const full = grouped(locale).format(value);
  const shown =
    options.tier === "small" && Math.abs(value) >= COMPACT_FROM
      ? compact(locale)
          .format(value)
          // "1.2K" -> "1.2k"; "3.4M" and "1.2B" keep their capitals.
          .replace(/K$/, "k")
      : full;
  return options.floor
    ? { text: `${shown}+`, label: `${full} or more` }
    : { text: shown, label: full };
}

/** @experimental Which way a change goes, for styling; never the only signal (the arrow and sign are). */
export type ChangeDirection = "up" | "down" | "none";

/** @experimental A formatted change, with its direction. */
export interface FormattedChange extends FormattedNumber {
  direction: ChangeDirection;
}

/**
 * @experimental Format a change against an earlier period.
 *
 * The direction is carried by an arrow AND a sign, so it reads without colour (WCAG 1.4.1):
 * "↑ +18", "↓ −18", "→ ±0". The accessible name says it in words: "up 18", "down 18",
 * "no change". The minus is U+2212, which screen readers and typography both treat as a minus
 * rather than a hyphen.
 */
export function formatChange(
  delta: number,
  options: Omit<FormatCountOptions, "floor"> = {}
): FormattedChange {
  const magnitude = formatCount(Math.abs(delta), options);
  if (delta === 0) {
    return { text: "→ ±0", label: "no change", direction: "none" };
  }
  return delta > 0
    ? {
        text: `↑ +${magnitude.text}`,
        label: `up ${magnitude.label}`,
        direction: "up",
      }
    : {
        text: `↓ −${magnitude.text}`,
        label: `down ${magnitude.label}`,
        direction: "down",
      };
}
