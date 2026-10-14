import type { CatalogueItem } from "../contracts/catalogue-source";
import { commerceError } from "../errors";
import type { Money } from "../money/money";

/**
 * The most lines one cart holds, so one client cannot grow a cart, and every
 * read of it, without bound.
 */
export const MAX_CART_LINES = 100;

/**
 * The most units of one item a line holds whatever the item, for the same
 * reason. A source's own limit for an item sold to order may be lower.
 */
export const MAX_LINE_QUANTITY = 999;

/**
 * The most units of `item` one line may hold: 1 for a one-off item, the
 * source's per-line limit for an item sold to order, and the cart's own limit
 * otherwise. A counted item is not held to its stock here: refusing a
 * quantity the stock cannot meet is checkout's, which holds the stock.
 */
export function maxLineQuantity(item: CatalogueItem): number {
  switch (item.stock.kind) {
    case "one-off":
      return 1;
    case "to-order":
      return Math.min(item.stock.maxPerLine, MAX_LINE_QUANTITY);
    case "counted":
    case "untracked":
      return MAX_LINE_QUANTITY;
  }
}

/**
 * The unit price a line of `quantity` units of the item at `reference` is
 * shown at, refusing a line a cart may not hold: an item the source does not
 * know, one whose price is given only on request, or more units than
 * `maxLineQuantity` allows.
 *
 * @throws `COMMERCE_ITEM_NOT_FOUND`, `COMMERCE_PRICE_ON_REQUEST`,
 *   `COMMERCE_QUANTITY_NOT_ALLOWED`
 */
export function allowLine(
  reference: string,
  item: CatalogueItem | undefined,
  quantity: number
): Money {
  if (!item) throw commerceError("COMMERCE_ITEM_NOT_FOUND", { reference });
  if (item.price.kind === "on-request") {
    throw commerceError("COMMERCE_PRICE_ON_REQUEST", { reference });
  }
  const max = maxLineQuantity(item);
  if (quantity > max) {
    throw commerceError("COMMERCE_QUANTITY_NOT_ALLOWED", {
      reference,
      quantity,
      max,
    });
  }
  return item.price.unitPrice;
}
