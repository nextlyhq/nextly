/**
 * A plugin forgetting the email it sent about something it has deleted.
 *
 * When a plugin deletes a record whose data its emails carried (a form
 * submission, say), it hands core the ids of the emails it queued for it and
 * the idempotency keys it sent them with. In one transaction, its own when
 * the plugin passes one:
 *
 * - each of those queued emails that is still waiting, or failed and could
 *   be retried, is cancelled, and every one of them has its message and
 *   recipient digests cleared, as an erased person's are; one whose attempt
 *   is already with the provider finishes with the message it has;
 * - every delivery record of those sends is erased: the address digest and
 *   the key digest go, the row stays.
 *
 * A send is found by its key digest, so a send whose key a person's deletion
 * already cleared (`erasePrincipalDeliveries` clears it from every record of
 * the send, keeping the other recipients' address digests) is no longer
 * found by its key: those records are the other recipients', and go with
 * their own erasure.
 *
 * Only the plugin's own: a queued email is matched on the plugin's scope as
 * well as its id, and a key is digested with the plugin's scope, so another
 * caller's ids and keys name nothing here.
 *
 * @module domains/email/plugin-send-forgetting
 */

import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { z } from "zod";

import { getDialectTables } from "../../database/index";
import { NextlyError } from "../../errors/nextly-error";
import { linkedTransaction } from "../../plugins/database/plugin-transaction-link";
import {
  assertNoOpenTransaction,
  type OpenTransactionProbe,
} from "../../shared/lib/open-transaction";
import { runAdapterTransaction } from "../../shared/lib/run-adapter-transaction";
import { adapterDialect, rowLockServer } from "../audit/audit-log-writer";
import {
  type PrincipalDigestDb,
  principalDigestTablesOf,
  readPrincipalDigests,
} from "../audit/principal-digest";

import {
  type ErasableDeliveriesTable,
  eraseKeyedDeliveries,
  type RecipientErasureCapableDb,
} from "./erase-recipient";
import { tellCancelReached } from "./queued-cancel";
import {
  cancelQueuedEmailsAmong,
  type EmailQueueTables,
  type QueuedErasureDb,
} from "./queued-erasure";
import { assertIdempotencyKey, idempotencyKeyDigest } from "./send-claims";

const OPERATION = "ctx.services.email.forgetSends";

/** A transaction as forgetting uses it: its Drizzle handle. */
interface ForgettingTransaction {
  getDrizzle<D = unknown>(): D;
}

/**
 * Whether `tx` is the adapter's whole transaction, as every adapter hands
 * its work: what telling the plugin binds its handles to.
 */
function isTransactionContext(
  tx: ForgettingTransaction
): tx is ForgettingTransaction & TransactionContext {
  const candidate = tx as Partial<TransactionContext>;
  return (
    typeof candidate.select === "function" &&
    typeof candidate.insert === "function" &&
    typeof candidate.execute === "function"
  );
}

/**
 * What forgetting needs of an adapter: a transaction of its own, and whether
 * one is open in the calling flow. The plugin context's adapter is one.
 */
export type ForgettingAdapter = OpenTransactionProbe & {
  transaction<T>(work: (tx: ForgettingTransaction) => Promise<T>): Promise<T>;
};

/** What a plugin forgets: the emails it queued, and the keys it sent with. */
export interface ForgetSendsInput {
  /** Ids of queued emails, as `queue` and `queueWithTemplate` answered. */
  queuedIds?: readonly string[];
  /** The idempotency keys the sends carried. */
  idempotencyKeys?: readonly string[];
}

/** A queued email's id, as the queue makes one. */
const QUEUED_ID = z.string().min(1).max(36);

/** The input as checked: each list without repeats. */
function checkedInput(input: ForgetSendsInput): {
  queuedIds: string[];
  keys: string[];
} {
  const ids = z
    .array(QUEUED_ID)
    .max(10_000)
    .safeParse(input.queuedIds ?? []);
  const keys = input.idempotencyKeys ?? [];
  if (!ids.success || !Array.isArray(keys) || keys.length > 10_000) {
    throw NextlyError.validation({
      errors: [
        {
          path: ids.success ? "idempotencyKeys" : "queuedIds",
          code: "INVALID",
          message:
            "`queuedIds` and `idempotencyKeys` are each a list of at most 10,000 strings.",
        },
      ],
      logContext: { operation: OPERATION },
    });
  }
  for (const key of keys) assertIdempotencyKey(key);
  return { queuedIds: [...new Set(ids.data)], keys: [...new Set(keys)] };
}

/**
 * Forget the sends `input` names, for the caller whose scope is `scope`, as
 * the module describes. With `tx`, the handle a plugin's
 * `ctx.db.transaction` callback (or an in-transaction handler) received, it
 * commits with the caller's own writes; without one it runs in a transaction
 * of its own, and is refused inside an open transaction rather than joining
 * or racing it.
 */
export async function forgetPluginSends(
  scope: string,
  input: ForgetSendsInput,
  options: {
    tx?: unknown;
    /** The adapter of the context asking: its transactions, and whether one is open. */
    adapter: ForgettingAdapter;
    secrets: readonly string[];
  }
): Promise<void> {
  const { queuedIds, keys } = checkedInput(input);
  if (queuedIds.length === 0 && keys.length === 0) return;
  const { adapter, secrets } = options;
  const dialect = adapterDialect(adapter);
  if (!dialect) {
    throw NextlyError.internal({
      logContext: {
        operation: OPERATION,
        reason: "the adapter's database is not known",
      },
    });
  }
  const tables = getDialectTables(dialect) as unknown as {
    emailQueue: EmailQueueTables["queue"];
    emailQueueRecipients: EmailQueueTables["recipients"];
    emailDeliveries: ErasableDeliveriesTable;
  };
  const server = rowLockServer(adapter, dialect);
  const forget = async (tx: ForgettingTransaction) => {
    const db = tx.getDrizzle<
      QueuedErasureDb & RecipientErasureCapableDb & PrincipalDigestDb
    >();
    // Locks in the order the erasures take them: the digest key's (a person's
    // deletion takes it first), then the delivery records, then the queued
    // emails (an address's erasure writes its records before its queue
    // rows). Taking any two the other way round could leave each transaction
    // holding the lock the other waits for.
    if (keys.length > 0) {
      const stored = await readPrincipalDigests(
        db,
        server,
        principalDigestTablesOf(getDialectTables(dialect)),
        "shared",
        secrets
      );
      await eraseKeyedDeliveries(
        db,
        tables.emailDeliveries,
        keys.map(key =>
          idempotencyKeyDigest(subject => stored.digest(subject), scope, key)
        )
      );
    }
    const reached = await cancelQueuedEmailsAmong(
      db,
      {
        dialect,
        queue: tables.emailQueue,
        recipients: tables.emailQueueRecipients,
      },
      scope,
      queuedIds
    );
    // The plugin is told in the same transaction, as every cancel tells it;
    // refused rather than left untold where it cannot be.
    if (!isTransactionContext(tx)) {
      throw NextlyError.internal({
        logContext: {
          operation: OPERATION,
          reason: "the transaction cannot be handed to the plugin",
        },
      });
    }
    await tellCancelReached(tx, dialect, reached, { by: "sender" });
  };

  if (options.tx !== undefined) {
    await linkedTransaction(options.tx, OPERATION).run(forget);
    return;
  }
  // A precondition: refused before a transaction of its own is opened.
  assertNoOpenTransaction(adapter, OPERATION);
  await runAdapterTransaction(adapter.transaction.bind(adapter), forget);
}
