import { asc, eq } from "@nextlyhq/plugin-sdk/db";
import type {
  PluginDatabase,
  PluginTransaction,
} from "@nextlyhq/plugin-sdk/schema";

import { commerceError } from "../errors";
import { cartLines, carts } from "../schema/tables";

import { allOf } from "./conditions";
import { isCartExpired, liveCartCondition } from "./lifetime";
import { hashCartToken, parseCartToken } from "./token";
import type { StoredCartLine } from "./view";

/** A cart a token found, live at the moment it was read. */
export interface LiveCart {
  /** The token that found the cart, which its cookie keeps. */
  readonly token: string;
  readonly id: string;
  readonly version: number;
  readonly expiresAt: Date;
  /** Whether the cart has become an order. */
  readonly checkedOut: boolean;
}

type Reader = Pick<PluginDatabase, "select" | "table">;

/**
 * The live cart a token finds, or `null`: the one way the cart and checkout
 * find a shopper's cart. A malformed token is never looked up, and a cart
 * past its deadline or made in another currency than the store's is not
 * served, whether or not the sweep has removed it yet.
 */
export async function findLiveCart(
  db: Reader,
  presented: string | null,
  currency: string,
  now: Date
): Promise<LiveCart | null> {
  const token = parseCartToken(presented);
  if (token === null) return null;
  const c = db.table(carts);
  const row = await db
    .select(carts)
    .where(eq(c.tokenHash, hashCartToken(token)))
    .first();
  if (!row || isCartExpired(row, now) || row.currency !== currency) {
    return null;
  }
  return {
    token,
    id: row.id,
    version: row.version,
    expiresAt: row.expiresAt,
    checkedOut: row.checkedOutAt !== null,
  };
}

/** A cart's lines, in the order they were added. */
export async function readCartLines(
  db: Reader,
  cartId: string
): Promise<StoredCartLine[]> {
  const l = db.table(cartLines);
  // UUIDv7 ids sort by when they were made, so lines read in the order they
  // were added.
  const rows = await db
    .select(cartLines)
    .where(eq(l.cartId, cartId))
    .orderBy(asc(l.id))
    .all();
  return rows.map(row => ({
    reference: row.reference,
    quantity: row.quantity,
    seenUnitPriceAmount: row.seenUnitPriceAmount,
    seenUnitPriceCurrency: row.seenUnitPriceCurrency,
  }));
}

/**
 * Move a cart's version by compare-and-set inside `tx`, with whatever else
 * the write sets: the one way a cart is changed, by the cart and by
 * checkout alike. Answers whether this write won: `false` when another change
 * committed first, or the cart is no longer live at `now`, whose deadline is
 * never moved again.
 *
 * @throws `COMMERCE_CART_BUSY` when the database cannot say how many rows the
 *   write changed, since a won race and a lost one then look alike
 */
export async function moveCart(
  tx: PluginTransaction,
  cart: { readonly id: string; readonly version: number },
  now: Date,
  set: { readonly expiresAt?: Date; readonly checkedOutAt?: Date }
): Promise<boolean> {
  const c = tx.table(carts);
  const moved = await tx
    .update(carts, { ...set, version: cart.version + 1, updatedAt: now })
    .where(
      allOf(
        eq(c.id, cart.id),
        eq(c.version, cart.version),
        liveCartCondition(c.expiresAt, now)
      )
    );
  if (moved < 0) {
    throw commerceError("COMMERCE_CART_BUSY", {
      reason: "the database did not report the rows the write changed",
    });
  }
  return moved === 1;
}
