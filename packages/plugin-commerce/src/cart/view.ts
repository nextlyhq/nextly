import type { CatalogueItem } from "../contracts/catalogue-source";
import { equals, money, multiply, sum, type Money } from "../money/money";

/**
 * What a line's item can be bought as, from the catalogue source's figure at
 * the moment the cart was read.
 *
 * - `in-stock`: `available` is the number the source reports, or `null` when
 *   it does not count the item.
 * - `sold-out`: the source reports none. The line stays, and checkout refuses
 *   it; the cart only says so early.
 * - `to-order`: made to order or on backorder; a line may ask for at most
 *   `maxPerLine`.
 * - `price-on-request`: the item no longer has a listed price, so it cannot be
 *   bought from a cart.
 * - `not-found`: the source no longer knows the item.
 *
 * @experimental
 */
export type CartLineAvailability =
  | { readonly kind: "in-stock"; readonly available: number | null }
  | { readonly kind: "sold-out" }
  | { readonly kind: "to-order"; readonly maxPerLine: number }
  | { readonly kind: "price-on-request" }
  | { readonly kind: "not-found" };

/** @experimental */
export interface CartLineView {
  readonly reference: string;
  /** The item's name, or `null` when the source no longer knows it. */
  readonly name: string | null;
  readonly sku: string | null;
  readonly quantity: number;
  /** The listed unit price now, or `null` when there is none. */
  readonly unitPrice: Money | null;
  /** The unit price shown when the line was last added to or changed. */
  readonly seenUnitPrice: Money;
  /** Whether `unitPrice` differs from `seenUnitPrice`. */
  readonly priceChanged: boolean;
  /** `unitPrice` times `quantity`, or `null` when there is no unit price. */
  readonly lineTotal: Money | null;
  readonly availability: CartLineAvailability;
}

/**
 * The cart as a shopper sees it. Every amount is priced from the catalogue
 * source at the moment of reading; nothing a browser sent is in it.
 *
 * @experimental
 */
export interface CartView {
  readonly currency: string;
  readonly lines: readonly CartLineView[];
  /** The sum of the lines' quantities. */
  readonly itemCount: number;
  /** The sum of the line totals that have a price. Not a charge: checkout prices again. */
  readonly subtotal: Money;
  /** When the cart expires unless it changes, or `null` for a cart not yet made. */
  readonly expiresAt: string | null;
}

/** A stored line, as the view needs it. */
export interface StoredCartLine {
  readonly reference: string;
  readonly quantity: number;
  readonly seenUnitPriceAmount: number;
  readonly seenUnitPriceCurrency: string;
}

/** The view of a shopper with no cart yet. */
export function emptyCartView(currency: string): CartView {
  return {
    currency,
    lines: [],
    itemCount: 0,
    subtotal: money(0, currency),
    expiresAt: null,
  };
}

/**
 * Build the view from the stored lines and the source's answer for them.
 * Built field by field, so a column added to the table or a field a source
 * adds to its answer never reaches a shopper.
 */
export function buildCartView(input: {
  readonly currency: string;
  readonly expiresAt: Date;
  readonly lines: readonly StoredCartLine[];
  readonly items: ReadonlyMap<string, CatalogueItem>;
}): CartView {
  const lines = input.lines.map(line =>
    lineView(line, input.items.get(line.reference))
  );
  return {
    currency: input.currency,
    lines,
    itemCount: lines.reduce((n, line) => n + line.quantity, 0),
    subtotal: sum(
      input.currency,
      lines.flatMap(line => (line.lineTotal ? [line.lineTotal] : []))
    ),
    expiresAt: input.expiresAt.toISOString(),
  };
}

function lineView(
  line: StoredCartLine,
  item: CatalogueItem | undefined
): CartLineView {
  const seenUnitPrice = money(
    line.seenUnitPriceAmount,
    line.seenUnitPriceCurrency
  );
  const unitPrice = item?.price.kind === "listed" ? item.price.unitPrice : null;
  return {
    reference: line.reference,
    name: item?.name ?? null,
    sku: item?.sku ?? null,
    quantity: line.quantity,
    unitPrice,
    seenUnitPrice,
    priceChanged: unitPrice !== null && !equals(unitPrice, seenUnitPrice),
    lineTotal: unitPrice ? multiply(unitPrice, line.quantity) : null,
    availability: availabilityOf(item),
  };
}

function availabilityOf(item: CatalogueItem | undefined): CartLineAvailability {
  if (!item) return { kind: "not-found" };
  if (item.price.kind === "on-request") return { kind: "price-on-request" };
  const stock = item.stock;
  switch (stock.kind) {
    case "untracked":
      return { kind: "in-stock", available: null };
    case "to-order":
      return { kind: "to-order", maxPerLine: stock.maxPerLine };
    case "counted":
    case "one-off":
      return stock.available > 0
        ? { kind: "in-stock", available: stock.available }
        : { kind: "sold-out" };
  }
}
