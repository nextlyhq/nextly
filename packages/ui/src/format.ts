/**
 * Number formatting for dashboard cards, as a server-safe entry point.
 *
 * Published at `@nextlyhq/ui/format` rather than from the root barrel, which carries a
 * `"use client"` banner: these are pure functions over numbers with `Intl`, no React and no
 * DOM, so a server can format a figure exactly as the admin does.
 *
 * A top-level file, as every entry the admin's client code imports is, so its source sits where
 * its published name says (`dist/format.mjs` from `src/format.ts`); the formatter itself lives in
 * `lib/format`.
 *
 * @module format
 */

/**
 * @experimental The size tier a card is drawn at, and what a formatted figure carries.
 */
export type {
  ChangeDirection,
  FormatCountOptions,
  FormattedChange,
  FormattedNumber,
  SizeTier,
} from "./lib/format/number";

/**
 * @experimental Format a count, total or chart value, and a change against an earlier period.
 *
 * `formatCount` compacts ("1.2k") only in the small tier, shows a floor as "N+", and always
 * gives the full value as the accessible name. `formatChange` carries direction in an arrow
 * and a sign, never in colour alone.
 */
export { formatChange, formatCount } from "./lib/format/number";
