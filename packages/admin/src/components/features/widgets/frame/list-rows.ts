/**
 * A list card's rows: how tightly they are set, and each density's row height.
 *
 * How MANY rows a list card draws is not decided here: it is its reader's "Number of entries"
 * (`rowsDrawn` in `frame/tier`, core's `listEntries`), since a card is as tall as its content.
 * Density decides only how tall each of those rows is drawn.
 *
 * @module components/features/widgets/frame/list-rows
 */

import { LIST_DENSITIES, type ListDensity } from "nextly/config";
import { createContext, useContext, type Context } from "react";

// A list row's height at each density: core's (`nextly/card-geometry`), the pixels the row
// classes draw (`LIST_ROW_HEIGHT_CLASS`).
export { LIST_ROW_HEIGHT_PX } from "nextly/card-geometry";

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
