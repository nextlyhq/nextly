import { eq, inArray } from "@nextlyhq/plugin-sdk/db";
import type {
  PluginDatabase,
  PluginTransaction,
} from "@nextlyhq/plugin-sdk/schema";

import { allOf } from "../cart/conditions";
import type {
  CatalogueItem,
  CatalogueStock,
} from "../contracts/catalogue-source";
import { commerceError } from "../errors";
import { referenceKey } from "../schema/reference-key";
import { stockHolds, stockItems } from "../schema/tables";

/**
 * Commerce's own record of an item's stock, as availability is worked out
 * from it.
 */
export interface StockRecord {
  readonly id: string;
  readonly onHand: number | null;
  readonly held: number;
  readonly version: number;
}

/**
 * How many units of an item can be bought now: the one answer to the
 * question, for the cart and for checkout alike.
 *
 * Once commerce keeps the item's on-hand figure (recorded at a stock count,
 * then lowered by its own sales), that figure is the stock; until then the
 * source's figure is. Every active hold comes off it, whatever the source:
 * the catalogue contract leaves a source free to count holds in its own
 * figure or not, so a hold taken off twice understates stock while an order
 * is unpaid, where a hold not taken off at all could sell a unit twice.
 */
export function availableUnits(
  sourceAvailable: number,
  record: StockRecord | undefined
): number {
  if (!record) return sourceAvailable;
  const stock = record.onHand ?? sourceAvailable;
  return Math.max(0, stock - record.held);
}

type Reader = Pick<PluginDatabase, "select" | "table">;

/** Commerce's stock records for `references`, keyed by reference, in one read. */
export async function stockRecords(
  db: Reader,
  references: readonly string[]
): Promise<Map<string, StockRecord>> {
  const found = new Map<string, StockRecord>();
  if (references.length === 0) return found;
  const s = db.table(stockItems);
  const rows = await db
    .select(stockItems)
    .where(inArray(s.referenceKey, [...new Set(references)].map(referenceKey)))
    .all();
  for (const row of rows) {
    found.set(row.reference, {
      id: row.id,
      onHand: row.onHand,
      held: row.held,
      version: row.version,
    });
  }
  return found;
}

/**
 * The items as a shopper may buy them: each counted or one-off item's stock
 * replaced by what is available after commerce's own holds. Items sold to
 * order or untracked are as the source gave them, since nothing is held for
 * them.
 */
export async function withCommerceStock(
  db: Reader,
  items: ReadonlyMap<string, CatalogueItem>
): Promise<Map<string, CatalogueItem>> {
  const counted = [...items.values()].filter(item => isCounted(item.stock));
  const records = await stockRecords(
    db,
    counted.map(item => item.reference)
  );
  return availableStock(items, records);
}

/**
 * `withCommerceStock` once the records are read: each counted or one-off
 * item's stock replaced by what `availableUnits` leaves of it, a one-off item
 * never above one unit, and every other item as the source gave it.
 */
export function availableStock(
  items: ReadonlyMap<string, CatalogueItem>,
  records: ReadonlyMap<string, StockRecord>
): Map<string, CatalogueItem> {
  const adjusted = new Map(items);
  for (const item of items.values()) {
    if (!isCounted(item.stock)) continue;
    const available = availableUnits(
      item.stock.available,
      records.get(item.reference)
    );
    adjusted.set(item.reference, {
      ...item,
      stock: {
        kind: item.stock.kind,
        available:
          item.stock.kind === "one-off" ? Math.min(available, 1) : available,
      },
    });
  }
  return adjusted;
}

function isCounted(stock: CatalogueStock): stock is {
  readonly kind: "one-off" | "counted";
  readonly available: number;
} {
  return stock.kind === "counted" || stock.kind === "one-off";
}

/**
 * A hold could not be taken because another checkout changed the item's
 * stock record first. The checkout tries again from the start: what it read
 * is no longer what is there.
 */
export class StockRecordMoved extends Error {
  constructor(readonly reference: string) {
    super(`the stock record of ${reference} changed while it was held`);
    this.name = "StockRecordMoved";
  }
}

/** A hold taken, by its own id. */
export interface HeldLine {
  readonly holdId: string;
  readonly reference: string;
}

/** One line to hold stock for, with the source's figure read for it. */
export interface HoldRequest {
  readonly reference: string;
  readonly quantity: number;
  readonly stock: CatalogueStock;
}

/**
 * Hold the stock an order takes, inside the order's transaction.
 *
 * Each counted or one-off item's record is moved by compare-and-set: of two
 * checkouts holding the last unit at once, one moves the record and the other
 * finds it moved and tries again, now finding nothing left. An item with no
 * record yet gets one; two checkouts creating it at once collide on its
 * unique reference, and the loser tries again the same way. Items sold to
 * order or untracked hold nothing.
 *
 * @throws `COMMERCE_OUT_OF_STOCK` when the item cannot cover the quantity, and
 *   `StockRecordMoved` (or the database's unique violation) when the checkout
 *   must start again
 */
export async function holdStock(
  tx: PluginTransaction,
  hold: {
    readonly orderId: string;
    readonly lines: readonly HoldRequest[];
    readonly expiresAt: Date;
    readonly now: Date;
  }
): Promise<readonly HeldLine[]> {
  const held: HeldLine[] = [];
  // Every counted line's record in one read; each write below still checks
  // its row by compare-and-set, which is what catches another checkout.
  const records = await stockRecords(
    tx,
    hold.lines.filter(line => isCounted(line.stock)).map(l => l.reference)
  );
  for (const line of hold.lines) {
    if (!isCounted(line.stock)) continue;
    const record = records.get(line.reference);
    const available = availableUnits(line.stock.available, record);
    if (available < line.quantity) {
      throw commerceError("COMMERCE_OUT_OF_STOCK", {
        reference: line.reference,
        asked: line.quantity,
        available,
      });
    }
    if (!record) {
      await tx.insert(stockItems, {
        reference: line.reference,
        referenceKey: referenceKey(line.reference),
        held: line.quantity,
        createdAt: hold.now,
        updatedAt: hold.now,
      });
    } else {
      const s = tx.table(stockItems);
      const moved = await tx
        .update(stockItems, {
          held: record.held + line.quantity,
          version: record.version + 1,
          updatedAt: hold.now,
        })
        .where(allOf(eq(s.id, record.id), eq(s.version, record.version)));
      if (moved !== 1) throw new StockRecordMoved(line.reference);
    }
    const row = await tx.insertReturning(stockHolds, {
      orderId: hold.orderId,
      reference: line.reference,
      referenceKey: referenceKey(line.reference),
      quantity: line.quantity,
      state: "active",
      expiresAt: hold.expiresAt,
      createdAt: hold.now,
      updatedAt: hold.now,
    });
    held.push({ holdId: row.id, reference: line.reference });
  }
  return held;
}
