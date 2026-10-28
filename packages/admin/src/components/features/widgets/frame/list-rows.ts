/**
 * How many rows a list card draws: the whole rows its body holds at its density.
 *
 * A list shows whole rows and never scrolls, so the number it draws is a fact about its body's
 * height and how tall a row is, not a number a person types. Each density has one row height, so
 * changing density changes how many rows fit without changing the card's size.
 *
 * The body height is the card's own: its height in grid rows less what the frame draws around
 * the body (`cardBodyHeightPx`), so a taller card draws more rows. A card drawn with no height
 * of its own (a preview, a body drawn outside the grid) is counted from its size tier instead: a
 * small body holds three default rows, a medium one five and a large one ten.
 * {@link listBodyHeight} is the one place either turns into pixels.
 *
 * @module components/features/widgets/frame/list-rows
 */

import type { SizeTier } from "@nextlyhq/ui/format";
import { cardBodyHeightPx, LIST_ROW_HEIGHT_PX } from "nextly/card-geometry";
import { LIST_DENSITIES, type ListDensity } from "nextly/config";
import { createContext, useContext, type Context } from "react";

// A list row's height at each density, and the whole rows a body of some height holds at one:
// core's (`nextly/card-geometry`), the formula a widget's server `load` counts its rows by
// (`rowsThatFit`), so the rows a load reads and the rows drawn here are one count.
export { LIST_ROW_HEIGHT_PX, rowsInBody } from "nextly/card-geometry";

/** How many default-density rows a card's body holds at each tier. */
const TIER_BODY_ROWS: Readonly<Record<SizeTier, number>> = Object.freeze({
  small: 3,
  medium: 5,
  large: 10,
});

/**
 * The height of a list card's body at `tier`, in pixels: the room its tier gives the rows, for a
 * card with no height of its own.
 */
export function tierBodyHeight(tier: SizeTier): number {
  return TIER_BODY_ROWS[tier] * LIST_ROW_HEIGHT_PX.default;
}

/** What a card's rows are counted at: its tier, and its height in grid rows where it has one. */
export interface RowsSize {
  tier: SizeTier;
  h?: number | undefined;
}

/** The height of a card's body in pixels: from its height where it has one, else its tier. */
export function listBodyHeight(size: RowsSize): number {
  return size.h === undefined
    ? tierBodyHeight(size.tier)
    : cardBodyHeightPx(size.h);
}

/**
 * The density a card's settings name, or `default` for none or a value no density has: a
 * stored setting is the reader's own data and may predate the choice it names.
 */
export function listDensityOf(settings: unknown): ListDensity {
  const value =
    typeof settings === "object" && settings !== null && "density" in settings
      ? settings.density
      : undefined;
  return isListDensity(value) ? value : "default";
}

/** Whether `value` names a density. */
function isListDensity(value: unknown): value is ListDensity {
  return LIST_DENSITIES.some(density => density === value);
}

/**
 * The density of the card a list is drawn in, as its settings name it. The frame provides it, so
 * a list body reads its card's density without each archetype being handed the settings.
 */
export const ListDensityContext: Context<ListDensity> =
  createContext<ListDensity>("default");

/** The density of the card this list is drawn in; default outside a card. */
export function useListDensity(): ListDensity {
  return useContext(ListDensityContext);
}
