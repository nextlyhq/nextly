/**
 * Cancelling a queued email, and telling the plugin that queued it.
 *
 * A cancel takes effect as a queued email's cancellation rules say
 * (`queued-erasure`): one waiting, or failed with its message held, is
 * cancelled and cleared; one whose attempt is already with the provider
 * keeps its state, and that attempt finishes with the message it has. The
 * plugin that queued it is told in the cancel's own transaction: `cancelled`
 * with the cause, or for one in flight, `sending` with the cause as a
 * request, which ends `sent` if the provider takes it and `cancelled` if it
 * fails (`queued-send-changes`).
 *
 * - **By a person**: `cancelQueuedEmailAsPerson`, which the Direct API's
 *   `email.cancelQueued` calls once the caller is allowed to manage email
 *   deliveries.
 * - **By the plugin itself**: `forgetSends` (`plugin-send-forgetting`).
 *
 * An erasure cancels queued email too, in the erasure's own transaction, and
 * tells no plugin there: a person's erasure must never wait on, or fail
 * with, a plugin's code. A plugin learns of it by reading the email's state
 * (`readQueuedEmails`).
 *
 * @module domains/email/queued-cancel
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import { loadedDialect } from "../../database/dialect-tables";
import { NextlyError } from "../../errors";
import { runAdapterTransaction } from "../../shared/lib/run-adapter-transaction";

import {
  cancelQueuedEmailsAmong,
  type QueuedErasureDb,
  type ReachedQueuedEmail,
} from "./queued-erasure";
import { attemptsOn, type QueueDialect } from "./queued-send-read";
import {
  changesObserved,
  notifyQueuedEmailChange,
  type QueuedEmailCancelCause,
  type QueuedEmailChange,
} from "./queued-send-changes";

/** What the plugin that queued `email` is told of a cancel reaching it. */
function changeFor(
  email: ReachedQueuedEmail,
  attempt: number,
  cause: QueuedEmailCancelCause,
  at: Date
): QueuedEmailChange | undefined {
  const base = { queuedId: email.id, attempt, at };
  if (email.state === "waiting" || email.state === "failed") {
    return { ...base, state: "cancelled", cancel: cause };
  }
  if (email.state === "sending") {
    return { ...base, state: "sending", cancelRequested: cause };
  }
  // Sent or cancelled already: the cancel changed nothing it would hear of.
  return undefined;
}

/**
 * Tell the plugins that queued the emails a cancel reached, in the cancel's
 * transaction `tx`.
 */
export async function tellCancelReached(
  tx: TransactionContext,
  dialect: QueueDialect,
  reached: readonly ReachedQueuedEmail[],
  cause: QueuedEmailCancelCause
): Promise<void> {
  const told = reached.filter(email => changesObserved(email.scope));
  if (told.length === 0) return;
  const attempts = await attemptsOn(
    tx,
    dialect,
    told.flatMap(email => (email.jobId ? [email.jobId] : []))
  );
  const at = new Date();
  for (const email of told) {
    const change = changeFor(
      email,
      email.jobId ? (attempts.get(email.jobId) ?? 0) : 0,
      cause,
      at
    );
    if (change) await notifyQueuedEmailChange(tx, email.scope, change);
  }
}

/**
 * Cancel the queued email `id` as a person (`userId`, or null for the
 * site's own code naming nobody), in a transaction of its own, telling the
 * plugin that queued it. Answers the state it stood in before.
 *
 * @throws {NextlyError} `NOT_FOUND` for no such email, and `CONFLICT` for one
 *   already sent or cancelled.
 */
export async function cancelQueuedEmailAsPerson(
  adapter: DrizzleAdapter,
  id: string,
  userId: string | null
): Promise<{ id: string; state: string }> {
  const dialect = adapter.getCapabilities().dialect as QueueDialect;
  const tables = loadedDialect(dialect).tables;
  return runAdapterTransaction<{ id: string; state: string }, TransactionContext>(
    run => adapter.transaction(ctx => run(ctx)),
    async tx => {
      const [email] = await cancelQueuedEmailsAmong(
        tx.getDrizzle<QueuedErasureDb>(),
        {
          dialect,
          queue: tables.emailQueue,
          recipients: tables.emailQueueRecipients,
        },
        undefined,
        [id]
      );
      if (!email) {
        throw NextlyError.notFound({ logContext: { queuedId: id } });
      }
      if (email.state === "sent" || email.state === "cancelled") {
        throw NextlyError.conflict({
          message: "This email has already been sent or cancelled.",
          logContext: { queuedId: id, state: email.state },
        });
      }
      await tellCancelReached(tx, dialect, [email], { by: "person", userId });
      return { id: email.id, state: email.state };
    }
  );
}
