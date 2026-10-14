import { asc, eq, inArray } from "@nextlyhq/plugin-sdk/db";
import type {
  PluginDatabase,
  PluginTransaction,
} from "@nextlyhq/plugin-sdk/schema";
import { z } from "zod";

import type {
  CatalogueItem,
  CatalogueSource,
} from "../contracts/catalogue-source";
import { commerceError } from "../errors";
import { parseRequest } from "../request-input";
import { referenceKey } from "../schema/reference-key";
import { cartLines, carts } from "../schema/tables";

import { findItems } from "./catalogue-read";
import { allOf } from "./conditions";
import { cartDeadline, isCartExpired, liveCartCondition } from "./lifetime";
import { allowLine, MAX_CART_LINES, MAX_LINE_QUANTITY } from "./line-rules";
import { hashCartToken, newCartToken, parseCartToken } from "./token";
import {
  buildCartView,
  emptyCartView,
  type CartView,
  type StoredCartLine,
} from "./view";

/**
 * What the caller does with the cart cookie after a cart action.
 *
 * - `keep`: leave the cookie as it is.
 * - `set`: (re)write it with `token` until `expiresAt`, the cart's deadline.
 *   Sent whenever a cart is made or changes, since its deadline moved.
 * - `clear`: remove it; the token it held reaches no live cart.
 *
 * @experimental
 */
export type CartCookieAction =
  | { readonly action: "keep" }
  | { readonly action: "set"; readonly token: string; readonly expiresAt: Date }
  | { readonly action: "clear" };

/** @experimental */
export interface CartResult {
  readonly cart: CartView;
  readonly cookie: CartCookieAction;
}

/**
 * The cart actions. Each takes the token from the shopper's cookie, or
 * `null` when there is none, and never a cart id: the token is the only thing
 * that finds a cart, so no parameter can reach another shopper's.
 *
 * @experimental
 */
export interface CartService {
  /** The shopper's cart. Makes nothing: a cart is made on its first change. */
  get(input: { readonly token: string | null }): Promise<CartResult>;
  /** Add `quantity` units of an item, to its line if the cart has one. */
  add(input: {
    readonly token: string | null;
    readonly reference: string;
    readonly quantity: number;
  }): Promise<CartResult>;
  /** Set an item's line to `quantity` units; 0 removes the line. */
  setQuantity(input: {
    readonly token: string | null;
    readonly reference: string;
    readonly quantity: number;
  }): Promise<CartResult>;
  /** Remove an item's line. */
  remove(input: {
    readonly token: string | null;
    readonly reference: string;
  }): Promise<CartResult>;
  /** Remove every line. */
  clear(input: { readonly token: string | null }): Promise<CartResult>;
}

/** @experimental */
export interface CartServiceOptions {
  readonly db: PluginDatabase;
  readonly source: CatalogueSource;
  /** The store's currency. A cart made in another one is not served. */
  readonly currency: string;
  readonly lifetimeDays: number;
  /** The clock, for tests. */
  readonly now?: () => Date;
}

/**
 * How many times a change is tried before the cart is reported busy.
 *
 * An attempt fails only when another change to the same cart committed while
 * it ran, and each failure is a different such change, since the next attempt
 * reads the cart after it. So every one of up to this many changes arriving at
 * one cart at once applies. More at once than that is not a shopper, and is
 * refused rather than waited on. Each attempt reads the cart afresh, so a
 * retry is never a blind repeat.
 */
const MAX_ATTEMPTS = 8;

// Each action parses its whole input exactly as it was passed: server code
// calls the service directly, so a missing or malformed argument, or a key
// the schema does not know, is a validation error rather than a crash or a
// key silently dropped. The token's own shape is judged when it is looked up,
// and a malformed one finds no cart.
const tokenSchema = z.string().nullable();
const referenceSchema = z.string().min(1).max(255);
const tokenOnlySchema = z.strictObject({ token: tokenSchema });
const addSchema = z.strictObject({
  token: tokenSchema,
  reference: referenceSchema,
  quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY),
});
const setSchema = z.strictObject({
  token: tokenSchema,
  reference: referenceSchema,
  quantity: z.number().int().min(0).max(MAX_LINE_QUANTITY),
});
const removeSchema = z.strictObject({
  token: tokenSchema,
  reference: referenceSchema,
});

/** A change to one cart, as the write applies it. */
type CartChange =
  | {
      readonly kind: "line";
      readonly reference: string;
      /** The line's quantity after the change, from the line before it. */
      readonly quantity: (current: number) => number;
    }
  | { readonly kind: "clear" };

interface LiveCart {
  /** The token that found the cart, which its cookie keeps. */
  readonly token: string;
  readonly id: string;
  readonly version: number;
  readonly expiresAt: Date;
}

/** @experimental */
export function createCartService(options: CartServiceOptions): CartService {
  const { db, source, currency, lifetimeDays } = options;
  const clock = options.now ?? (() => new Date());

  /**
   * The live cart the token finds, or `null`. A cart past its deadline, or
   * made in another currency than the store's, is not served, whether or not
   * the sweep has removed it yet.
   */
  async function liveCart(
    presented: string | null,
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
    };
  }

  async function storedLines(cartId: string): Promise<StoredCartLine[]> {
    const l = db.table(cartLines);
    // UUIDv7 ids sort by when they were made, so lines read in the order
    // they were added.
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

  // The source is asked for the whole cart at once, outside any transaction:
  // it may be an outside API, and network time inside a transaction holds
  // its connection and locks for as long as the call takes.
  async function view(cart: LiveCart): Promise<CartView> {
    const lines = await storedLines(cart.id);
    const items = await findItems(
      source,
      currency,
      lines.map(line => line.reference)
    );
    return buildCartView({
      currency,
      expiresAt: cart.expiresAt,
      lines,
      items,
    });
  }

  /**
   * The lines a change leaves, and the source's items for them, read in one
   * call. A change that adds needs the changed item; one that leaves the
   * cart empty, or takes a line out, needs nothing of the source but the
   * lines that stay, so a cart can still be emptied while its source is down.
   */
  async function plan(
    cartChange: CartChange,
    lines: readonly StoredCartLine[]
  ): Promise<{
    next: { lines: PlannedLine[] };
    items: Map<string, CatalogueItem>;
  }> {
    const current =
      cartChange.kind === "line"
        ? (lines.find(line => line.reference === cartChange.reference)
            ?.quantity ?? 0)
        : 0;
    const adds = cartChange.kind === "line" && cartChange.quantity(current) > 0;
    if (!adds) {
      const next = planWrite(cartChange, lines, undefined);
      const items = await findItems(
        source,
        currency,
        next.lines.map(line => line.reference)
      );
      return { next, items };
    }
    const items = await findItems(source, currency, [
      ...lines.map(line => line.reference),
      cartChange.reference,
    ]);
    return {
      next: planWrite(cartChange, lines, items.get(cartChange.reference)),
      items,
    };
  }

  /**
   * Apply one change, retrying while other changes to the same cart commit
   * first.
   *
   * Each change moves the cart's version, and a write applies only while the
   * version is the one this attempt read, and only while the cart is still
   * live: compare-and-set, since the plugin surface takes no row locks. A
   * cart that expired since it was read is never revived; the next attempt
   * finds no live cart and makes a new one. So of two changes racing on one cart, one
   * commits and the other reads the cart again and applies to what it finds;
   * neither is lost and neither applies to a cart that has since changed.
   *
   * Every item the answer shows is read from the source before the write, in
   * one call outside any transaction, and the answer is built from what was
   * written. The write is then the last thing that can fail: a change that
   * committed always answers, with the cookie for the cart it changed, so a
   * new cart is never left without its token and a retried request is never
   * one whose change had in fact applied.
   */
  async function change(
    presented: string | null,
    cartChange: CartChange
  ): Promise<CartResult> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const read = clock();
      const cart = await liveCart(presented, read);
      const lines = cart ? await storedLines(cart.id) : [];
      const { next, items } = await plan(cartChange, lines);

      // The write's own moment, taken after the source was read: a cart that
      // expired while a slow source answered is not changed, and the new
      // deadline runs from the write, not from before the lookup.
      const now = clock();
      const expiresAt = cartDeadline(now, lifetimeDays);
      // Built before the write, so an answer that cannot be built (an amount
      // past the safe range) refuses the change rather than following it.
      const answer = buildCartView({
        currency,
        expiresAt,
        lines: next.lines,
        items,
      });

      if (!cart) {
        // Nothing to remove from a cart that does not exist, and no cart is
        // made just to hold nothing. A token that found no live cart is
        // cleared from the browser.
        if (next.lines.length === 0) return noCart(presented);
        // Always a new token, never the one the browser sent: a token the
        // browser chose would let whoever planted it in that browser read the
        // cart that grew from it.
        const fresh = newCartToken();
        await db.transaction(async tx => {
          const row = await tx.insertReturning(carts, {
            tokenHash: hashCartToken(fresh),
            currency,
            expiresAt,
            createdAt: now,
            updatedAt: now,
          });
          await writeLines(tx, row.id, [], next.lines, now);
        });
        return {
          cart: answer,
          cookie: { action: "set", token: fresh, expiresAt },
        };
      }

      const applied = await db.transaction(async tx => {
        const c = tx.table(carts);
        const moved = await tx
          .update(carts, {
            version: cart.version + 1,
            expiresAt,
            updatedAt: now,
          })
          .where(
            allOf(
              eq(c.id, cart.id),
              eq(c.version, cart.version),
              liveCartCondition(c.expiresAt, now)
            )
          );
        if (moved < 0) {
          // A driver that cannot say how many rows it changed cannot tell a
          // won race from a lost one, so the change is refused, never assumed.
          throw commerceError("COMMERCE_CART_BUSY", {
            reason: "the database did not report the rows the write changed",
          });
        }
        if (moved === 0) return false;
        await writeLines(tx, cart.id, lines, next.lines, now);
        return true;
      });
      if (!applied) continue;

      return {
        cart: answer,
        cookie: { action: "set", token: cart.token, expiresAt },
      };
    }
    throw commerceError("COMMERCE_CART_BUSY", { attempts: MAX_ATTEMPTS });
  }

  /**
   * The answer for a shopper with no live cart. A cookie that was sent but
   * found none, being malformed, unknown or past its cart's deadline, is
   * cleared, so the browser stops sending it.
   */
  function noCart(presented: string | null): CartResult {
    return {
      cart: emptyCartView(currency),
      cookie: presented === null ? { action: "keep" } : { action: "clear" },
    };
  }

  return {
    async get(input) {
      const { token } = parseRequest(tokenOnlySchema, input);
      const cart = await liveCart(token, clock());
      if (!cart) return noCart(token);
      const answer = await view(cart);
      // The source can answer after the cart's deadline. A cart that expired
      // meanwhile is answered as none, unless a change made while the source
      // was read moved its deadline on, in which case that cart is read again.
      if (!isCartExpired(cart, clock())) {
        return { cart: answer, cookie: { action: "keep" } };
      }
      const moved = await liveCart(token, clock());
      if (!moved) return noCart(token);
      return { cart: await view(moved), cookie: { action: "keep" } };
    },

    async add(input) {
      const { token, reference, quantity } = parseRequest(addSchema, input);
      return change(token, {
        kind: "line",
        reference,
        quantity: current => current + quantity,
      });
    },

    async setQuantity(input) {
      const { token, reference, quantity } = parseRequest(setSchema, input);
      // Setting a line to nothing needs nothing from the source: an item it
      // no longer knows can still be taken out of a cart.
      return change(token, {
        kind: "line",
        reference,
        quantity: () => quantity,
      });
    },

    async remove(input) {
      const { token, reference } = parseRequest(removeSchema, input);
      return change(token, {
        kind: "line",
        reference,
        quantity: () => 0,
      });
    },

    async clear(input) {
      const { token } = parseRequest(tokenOnlySchema, input);
      return change(token, { kind: "clear" });
    },
  };
}

/** A line as it is written: its quantity and the unit price shown for it. */
interface PlannedLine {
  readonly reference: string;
  readonly quantity: number;
  readonly seenUnitPriceAmount: number;
  readonly seenUnitPriceCurrency: string;
}

/**
 * The cart's lines after `change`, from the lines it has now. A line the
 * change does not touch is kept as it is; the changed line takes the item's
 * price now as the price shown for it, since the shopper acted on that price.
 *
 * @throws `COMMERCE_QUANTITY_NOT_ALLOWED` when an add takes a line past what
 *   the item allows, `COMMERCE_CART_FULL` when a new line would pass the cart's
 *   limit
 */
function planWrite(
  change: CartChange,
  lines: readonly StoredCartLine[],
  item: CatalogueItem | undefined
): { lines: PlannedLine[] } {
  if (change.kind === "clear") return { lines: [] };
  const current = lines.find(line => line.reference === change.reference);
  const quantity = change.quantity(current?.quantity ?? 0);
  const others = lines.filter(line => line.reference !== change.reference);
  if (quantity === 0) return { lines: others };

  // Checked against the line's total as this attempt read the cart, not the
  // request's quantity alone: an add cannot know what was already there.
  const unitPrice = allowLine(change.reference, item, quantity);
  if (!current && others.length >= MAX_CART_LINES) {
    throw commerceError("COMMERCE_CART_FULL", { max: MAX_CART_LINES });
  }
  const changed: PlannedLine = {
    reference: change.reference,
    quantity,
    seenUnitPriceAmount: unitPrice.amount,
    seenUnitPriceCurrency: unitPrice.currency,
  };
  return {
    lines: current
      ? lines.map(line =>
          line.reference === change.reference ? changed : line
        )
      : [...lines, changed],
  };
}

/**
 * Write the difference between `before` and `after` to the cart's lines,
 * inside the transaction that moved the cart's version. Only lines that
 * changed are written, so a change to one line touches one row.
 */
async function writeLines(
  tx: PluginTransaction,
  cartId: string,
  before: readonly StoredCartLine[],
  after: readonly PlannedLine[],
  now: Date
): Promise<void> {
  const l = tx.table(cartLines);
  const wanted = new Map(after.map(line => [line.reference, line]));
  const had = new Map(before.map(line => [line.reference, line]));

  // Every line that went, in one statement: emptying a full cart is one
  // round trip inside the transaction, not one per line.
  const removed = before
    .filter(line => !wanted.has(line.reference))
    .map(line => referenceKey(line.reference));
  if (removed.length > 0) {
    await tx
      .delete(cartLines)
      .where(allOf(eq(l.cartId, cartId), inArray(l.referenceKey, removed)));
  }
  for (const line of after) {
    const previous = had.get(line.reference);
    if (!previous) {
      await tx.insert(cartLines, {
        cartId,
        reference: line.reference,
        referenceKey: referenceKey(line.reference),
        quantity: line.quantity,
        seenUnitPriceAmount: line.seenUnitPriceAmount,
        seenUnitPriceCurrency: line.seenUnitPriceCurrency,
        createdAt: now,
        updatedAt: now,
      });
    } else if (
      previous.quantity !== line.quantity ||
      previous.seenUnitPriceAmount !== line.seenUnitPriceAmount ||
      previous.seenUnitPriceCurrency !== line.seenUnitPriceCurrency
    ) {
      await tx
        .update(cartLines, {
          quantity: line.quantity,
          seenUnitPriceAmount: line.seenUnitPriceAmount,
          seenUnitPriceCurrency: line.seenUnitPriceCurrency,
          updatedAt: now,
        })
        .where(
          allOf(
            eq(l.cartId, cartId),
            eq(l.referenceKey, referenceKey(line.reference))
          )
        );
    }
  }
}
