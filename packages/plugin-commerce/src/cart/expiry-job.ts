import { defineJob, type JobDefinition } from "@nextlyhq/plugin-sdk";
import { asc, inArray } from "@nextlyhq/plugin-sdk/db";
import type { PluginDatabase } from "@nextlyhq/plugin-sdk/schema";

import { cartLines, carts } from "../schema/tables";

import { allOf } from "./conditions";
import { sweepableCartCondition } from "./lifetime";

/** The job type that removes expired carts. */
export const CART_EXPIRY_JOB = "commerce:cart-expiry";

/**
 * How many carts one batch removes. A batch is one short transaction, so a
 * backlog of expired carts never holds a long lock or one huge statement.
 */
const BATCH_SIZE = 200;

/**
 * Remove up to `limit` carts the sweep may remove at `now` (past their
 * deadline by more than `SWEEP_GRACE_MS`), with their lines, and answer how
 * many carts went.
 *
 * Safe to run twice and alongside cart changes: no write ever changes a cart
 * past its deadline (a change to it makes a new cart instead), so a cart this
 * finds expired is still expired, with the same lines, when it is removed. The lines are
 * removed by their cart rather than left to the foreign key's cascade, so
 * nothing depends on SQLite's foreign keys being switched on.
 */
export async function sweepExpiredCarts(
  db: PluginDatabase,
  now: Date,
  limit: number = BATCH_SIZE
): Promise<number> {
  const c = db.table(carts);
  const expired = await db
    .select(carts)
    .where(sweepableCartCondition(c.expiresAt, now))
    .orderBy(asc(c.expiresAt))
    .limit(limit)
    .all();
  if (expired.length === 0) return 0;
  const ids = expired.map(row => row.id);
  await db.transaction(async tx => {
    const l = tx.table(cartLines);
    const t = tx.table(carts);
    await tx.delete(cartLines).where(inArray(l.cartId, ids));
    await tx
      .delete(carts)
      .where(
        allOf(inArray(t.id, ids), sweepableCartCondition(t.expiresAt, now))
      );
  });
  return ids.length;
}

/**
 * The sweep that keeps the carts table to live carts. Core keeps one queued,
 * so every jobs pass runs it. Expiry does not wait on it: every read refuses
 * a cart past its deadline whether or not this has run, so a late or missed
 * pass leaves only rows behind, never a cart served too long.
 *
 * It stops at the pass's deadline, checked before each batch, and leaves the
 * rest to the next pass.
 */
export function cartExpiryJob(deps: {
  /** The database, once the plugin has started. */
  readonly db: () => PluginDatabase;
  /** The clock the deadline is checked against, for tests. */
  readonly clock?: () => Date;
  /** Carts removed per batch, for tests. */
  readonly batchSize?: number;
}): JobDefinition {
  return defineJob({
    slug: CART_EXPIRY_JOB,
    sweep: true,
    handler: async (_input, context) => {
      const db = deps.db();
      const now = context.now;
      const clock = deps.clock ?? (() => new Date());
      for (;;) {
        if (clock().getTime() >= context.deadline.getTime()) return;
        const batch = deps.batchSize ?? BATCH_SIZE;
        if ((await sweepExpiredCarts(db, now, batch)) < batch) return;
      }
    },
  });
}
