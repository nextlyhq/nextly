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

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import type { Column, SQL, Table } from "drizzle-orm";
import { and, eq, inArray, isNull, ne, or } from "drizzle-orm";

import { NextlyError } from "../../errors";
import { emailDeliveriesMysql } from "../../schemas/email-deliveries/mysql";
import { emailDeliveriesPg } from "../../schemas/email-deliveries/postgres";
import { emailDeliveriesSqlite } from "../../schemas/email-deliveries/sqlite";
import { emailQueueMysql } from "../../schemas/email-queue/mysql";
import { emailQueuePg } from "../../schemas/email-queue/postgres";
import { emailQueueSqlite } from "../../schemas/email-queue/sqlite";
import { emailQueueRecipientsMysql } from "../../schemas/email-queue-recipients/mysql";
import { emailQueueRecipientsPg } from "../../schemas/email-queue-recipients/postgres";
import { emailQueueRecipientsSqlite } from "../../schemas/email-queue-recipients/sqlite";
import {
  type RowLockStrength,
  rowLockStrength,
} from "../../shared/lib/row-lock";

import { recipientDigests } from "./delivery-record";

/** The queue's two tables, as one dialect defines them, and that dialect. */
export interface EmailQueueTables {
  dialect: SupportedDialect;
  queue: Table & {
    id: Column;
    state: Column;
    message: Column;
    principalKind: Column;
    principalId: Column;
    settledAt: Column;
    updatedAt: Column;
  };
  recipients: Table & {
    queuedId: Column;
    recipientHash: Column;
    recipientKind: Column;
  };
}

/** The Drizzle surface an erasure of queued email needs. */
export interface QueuedErasureDb {
  select(fields: unknown): {
    from(table: unknown): {
      where(condition: unknown): {
        limit(count: number): MaybeLockableRead<unknown[]>;
      };
      /** Every Drizzle handle has it; optional so a narrower one can be passed. */
      innerJoin?(
        table: unknown,
        on: unknown
      ): {
        where(condition: unknown): {
          limit(count: number): MaybeLockableRead<unknown[]>;
        };
      };
    };
  };
  update(table: unknown): {
    set(data: unknown): { where(condition: unknown): Promise<unknown> };
  };
  delete(table: unknown): { where(condition: unknown): Promise<unknown> };
}

/**
 * `query` under the lock a deletion takes: an erasure reads the queued emails
 * it cancels as they are committed, not as an older snapshot had them. On
 * MySQL a plain read inside a transaction answers from the snapshot its first
 * read took, which can predate a queued email the deletion's lock just waited
 * for. SQLite's writer holds the database, and takes none.
 */
function locked<R>(
  tables: EmailQueueTables,
  query: MaybeLockableRead<R>
): PromiseLike<R> {
  const strength = rowLockStrength({ dialect: tables.dialect }, "exclusive");
  if (strength === null) return query;
  if (!query.for) {
    // A handle that cannot lock would read the snapshot this guards against.
    throw NextlyError.internal({
      logContext: { reason: "queued-email erasure needs a locking read" },
    });
  }
  return query.for(strength);
}

/** A read that can take a row lock where the dialect has one (not SQLite's). */
type MaybeLockableRead<R> = PromiseLike<R> & {
  for?(strength: RowLockStrength): Promise<R>;
};

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
    return {
      dialect: "postgresql",
      queue: emailQueuePg,
      recipients: emailQueueRecipientsPg,
    };
  }
  if (deliveries === emailDeliveriesMysql) {
    return {
      dialect: "mysql",
      queue: emailQueueMysql,
      recipients: emailQueueRecipientsMysql,
    };
  }
  if (deliveries === emailDeliveriesSqlite) {
    return {
      dialect: "sqlite",
      queue: emailQueueSqlite,
      recipients: emailQueueRecipientsSqlite,
    };
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
    const rows = (await locked(
      tables,
      db.select({ id: queue.id }).from(queue).where(naming).limit(BATCH)
    )) as Array<{ id: string }>;
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
 * Cancel and clear every queued email to `address`, unless it is the `to`
 * of one that names a person: that address is the person's, whoever else
 * holds it, and goes with their own deletion instead. A copy (`cc`, `bcc`)
 * is someone else, so erasing it cancels the email even when it names a
 * person, as the delivery records name the person on the `to` row only.
 */
export async function cancelQueuedEmailsTo(
  db: QueuedErasureDb,
  tables: EmailQueueTables,
  address: string
): Promise<void> {
  const { queue, recipients } = tables;
  const reaches = and(
    inArray(recipients.recipientHash, recipientDigests(address)),
    or(isNull(queue.principalKind), ne(recipients.recipientKind, "to"))
  );
  // Decided in the database, a batch at a time: each removes the digests of
  // the emails it cancels, so the next reads only those left.
  for (;;) {
    const from = db.select({ queuedId: recipients.queuedId }).from(recipients);
    if (!from.innerJoin) {
      throw NextlyError.internal({
        logContext: { reason: "queued-email erasure needs a joining handle" },
      });
    }
    const rows = (await locked(
      tables,
      from
        .innerJoin(queue, eq(queue.id, recipients.queuedId))
        .where(reaches)
        .limit(BATCH)
    )) as Array<{ queuedId: string }>;
    if (rows.length === 0) return;
    await cancelAndClear(
      db,
      tables,
      [...new Set(rows.map(row => row.queuedId))],
      {}
    );
  }
}
