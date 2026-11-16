/**
 * How many rows a widget query may ask for, and how many it gets.
 *
 * Its own module, with NO imports, for the reason `layout-limits.ts` is: the
 * admin reserves a list card's rows from this before any data arrives, and it
 * reaches core only through `nextly/config`, which is published as safe for a
 * browser. `query.ts` imports the source registry and the error types.
 * Declared here, the validator that bounds a query and the editor that
 * reserves its rows ask ONE question.
 *
 * @module domains/widgets/query-limits
 */

/** Nothing may return more rows than this, whatever the caller asked for. */
export const MAX_WIDGET_LIMIT = 50;

/** The row count when a caller does not specify one, or specifies garbage. */
export const DEFAULT_WIDGET_LIMIT = 5;

/**
 * The most rows a dashboard card draws, whatever its setting asks.
 *
 * Not {@link MAX_WIDGET_LIMIT}: that bounds every widget query, a card's or
 * not, and is the server's clamp. This is a card's: the most its "Number of
 * entries" setting offers, and the most its list or table draws. A card asks
 * one row above what it draws, to learn whether more exist, which stays
 * within the clamp.
 *
 * Twenty, the most of the "Number of entries" choices (5, 10 or 20): a card
 * is as tall as its content and never scrolls, so past twenty rows a card is
 * a page, and "View all" opens the page that list belongs on.
 */
export const MAX_WIDGET_ROWS = 20;

/**
 * The rows a list card loads and shows for its "Number of entries" setting:
 * the setting read by {@link effectiveWidgetLimit} (five where it is missing
 * or garbage), at most {@link MAX_WIDGET_ROWS}. Never the card's size: a card
 * is as tall as its content, so its rows are what its reader asked for. A
 * card's `load` asks one more, to learn whether more exist, and the admin
 * draws and holds the place of this many; one rule for both, so the rows a
 * load reads and the rows the card draws cannot come to disagree.
 *
 * @experimental
 */
export function listEntries(limit: unknown): number {
  return Math.min(effectiveWidgetLimit(limit), MAX_WIDGET_ROWS);
}

/**
 * How tightly a list card sets its rows: `default`, or `compact`, whose shorter
 * rows let the same card hold more of them. The card's Density setting names
 * one, and the admin decides how many rows fit from it.
 *
 * @experimental
 */
export const LIST_DENSITIES = ["default", "compact"] as const;
export type ListDensity = (typeof LIST_DENSITIES)[number];

/**
 * The rows a query declaring `limit` is run at.
 *
 * Clamps rather than rejects: a widget asking for too much is a configuration
 * mistake, not an attack, and silently bounding it keeps the card working
 * instead of failing it outright.
 *
 * `Number.isFinite` is the guard, not `typeof limit === "number"`: `NaN` IS
 * `typeof "number"`, and every comparison against `NaN` (including
 * `Math.min`/`Math.max`) itself evaluates to `NaN`, so a plain
 * `Math.min(Math.max(NaN, 1), MAX)` returns `NaN` -- an unclamped, unbounded
 * `LIMIT NaN` reaching the compiler. `Math.trunc` on the finite branch closes
 * the neighbouring gap where a fractional limit (`5.7`) passed unchanged.
 */
export function effectiveWidgetLimit(limit: unknown): number {
  const requested = Number.isFinite(limit)
    ? Math.trunc(limit as number)
    : DEFAULT_WIDGET_LIMIT;
  return Math.min(Math.max(requested, 1), MAX_WIDGET_LIMIT);
}
