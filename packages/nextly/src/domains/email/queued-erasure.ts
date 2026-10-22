/**
 * What erasing a person or an address does to queued email: every queued
 * email that names them, or goes to the address and names nobody, is
 * cancelled and cleared, in the erasure's own transaction.
 *
 * - **Cancelled** when it is waiting or has failed: no attempt follows.
 * - **Cleared** whatever its state: the message, and the digests of the
 *   addresses it goes to. One whose attempt is already with the provider
 *   keeps its state; that attempt finishes with the message it already has,
 *   and its delivery records are written erased, as every record naming a
 *   deleted person is.
 * - A person's queued emails name them by their digest from then on, as
 *   their delivery records do.
 *
 * Read by digest only, so an address is never stored to find them: the
 * delivery records' keyed digest of each recipient, under every secret the
 * install still knows (`recipientDigests`).
 *
 * @module domains/email/queued-erasure
 */

import type { Column, SQL, Table } from "drizzle-orm";
import { and, eq, inArray, isNull } from "drizzle-orm";

import { emailDeliveriesMysql } from "../../schemas/email-deliveries/mysql";
import { emailDeliveriesPg } from "../../schemas/email-deliveries/postgres";
import { emailDeliveriesSqlite } from "../../schemas/email-deliveries/sqlite";
import { emailQueueMysql } from "../../schemas/email-queue/mysql";
import { emailQueuePg } from "../../schemas/email-queue/postgres";
import { emailQueueSqlite } from "../../schemas/email-queue/sqlite";
import { emailQueueRecipientsMysql } from "../../schemas/email-queue-recipients/mysql";
import { emailQueueRecipientsPg } from "../../schemas/email-queue-recipients/postgres";
import { emailQueueRecipientsSqlite } from "../../schemas/email-queue-recipients/sqlite";

import { recipientDigests } from "./delivery-record";

/** The queue's two tables, as one dialect defines them. */
export interface EmailQueueTables {
  queue: Table & {
    id: Column;
    state: Column;
    message: Column;
    principalKind: Column;
    principalId: Column;
    settledAt: Column;
    updatedAt: Column;
  };
  recipients: Table & { queuedId: Column; recipientHash: Column };
}

/** The Drizzle surface an erasure of queued email needs. */
export interface QueuedErasureDb {
  select(fields: unknown): {
    from(table: unknown): {
      where(condition: unknown): {
        limit(count: number): PromiseLike<unknown[]>;
      };
    };
  };
  update(table: unknown): {
    set(data: unknown): { where(condition: unknown): Promise<unknown> };
  };
  delete(table: unknown): { where(condition: unknown): Promise<unknown> };
}

/** Queued emails read per statement, inside SQLite's bind-parameter limit. */
const BATCH = 500;

/**
 * The queue's tables beside a dialect's delivery table, for an erasure
 * handed only the latter. Undefined for a table that is neither.
 */
export function queueTablesBeside(
  deliveries: unknown
): EmailQueueTables | undefined {
  if (deliveries === emailDeliveriesPg) {
    return { queue: emailQueuePg, recipients: emailQueueRecipientsPg };
  }
  if (deliveries === emailDeliveriesMysql) {
    return { queue: emailQueueMysql, recipients: emailQueueRecipientsMysql };
  }
  if (deliveries === emailDeliveriesSqlite) {
    return { queue: emailQueueSqlite, recipients: emailQueueRecipientsSqlite };
  }
  return undefined;
}

/**
 * Cancel and clear the queued emails among `ids`, as the module describes,
 * and set `values` on every one of them.
 */
async function cancelAndClear(
  db: QueuedErasureDb,
  tables: EmailQueueTables,
  ids: string[],
  values: Record<string, unknown>
): Promise<void> {
  const { queue, recipients } = tables;
  const now = Date.now();
  const these = inArray(queue.id, ids);
  await db
    .update(queue)
    .set({ state: "cancelled", settledAt: now })
    .where(and(these, inArray(queue.state, ["waiting", "failed"])));
  await db
    .update(queue)
    .set({ ...values, message: null, updatedAt: now })
    .where(these);
  await db.delete(recipients).where(inArray(recipients.queuedId, ids));
}

/**
 * Cancel and clear every queued email naming `person`, and name them on it
 * by `digest`. Runs in the person's deletion, under the deleted-people lock.
 */
export async function cancelQueuedEmailsOf(
  db: QueuedErasureDb,
  tables: EmailQueueTables,
  person: { kind: string; id: string },
  digest: string
): Promise<void> {
  const { queue } = tables;
  const naming: SQL | undefined = and(
    eq(queue.principalKind, person.kind),
    eq(queue.principalId, person.id)
  );
  // Each batch renames what it read, so the next reads the rest.
  for (;;) {
    const rows = (await db
      .select({ id: queue.id })
      .from(queue)
      .where(naming)
      .limit(BATCH)) as Array<{ id: string }>;
    if (rows.length === 0) return;
    await cancelAndClear(
      db,
      tables,
      rows.map(row => row.id),
      { principalId: digest }
    );
  }
}

/**
 * Cancel and clear every queued email to `address` that names nobody. One
 * that names a person belongs to that person, whoever else holds the
 * address, and is cancelled by their own deletion instead.
 */
export async function cancelQueuedEmailsTo(
  db: QueuedErasureDb,
  tables: EmailQueueTables,
  address: string
): Promise<void> {
  const { queue, recipients } = tables;
  const digests = recipientDigests(address);
  // Each batch removes the recipient rows it read, so the next reads the
  // rest. One that names a person keeps its rows and is passed over.
  const passedOver = new Set<string>();
  for (;;) {
    const sent = (await db
      .select({ queuedId: recipients.queuedId })
      .from(recipients)
      .where(inArray(recipients.recipientHash, digests))
      .limit(BATCH + passedOver.size)) as Array<{ queuedId: string }>;
    const candidates = [
      ...new Set(
        sent.map(row => row.queuedId).filter(id => !passedOver.has(id))
      ),
    ];
    if (candidates.length === 0) return;
    const unnamed = (await db
      .select({ id: queue.id })
      .from(queue)
      .where(and(inArray(queue.id, candidates), isNull(queue.principalKind)))
      .limit(candidates.length)) as Array<{ id: string }>;
    const ids = unnamed.map(row => row.id);
    for (const id of candidates) if (!ids.includes(id)) passedOver.add(id);
    if (ids.length > 0) await cancelAndClear(db, tables, ids, {});
  }
}
