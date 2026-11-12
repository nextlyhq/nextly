/**
 * Every path that deletes a submission forgets the notifications it sent, in
 * the deletion's own transaction: a notification not yet sent (waiting,
 * retrying, or failed but retryable) is cancelled and cleared, and the
 * delivery records of one that went out are erased
 * (`ctx.services.email.forgetSends`), so nothing is sent from data that is
 * gone. One deletion, a bulk one and the retention pass all delete
 * submissions one by one through the collection, so each reaches the
 * submissions handler here; deleting a form deletes its submissions the same
 * way, in the form's transaction.
 *
 * Marking a submission Spam calls off what it queued the same way, in the
 * transaction that marks it: a notification still waiting, waiting to be
 * retried, or failed with its message still held is cancelled and its
 * message cleared, so nothing about spam is sent and Settings › Email cannot
 * retry it later. One already with the provider finishes with the message it
 * has, as the queued send's cancellation rules say: it ends sent if the
 * provider takes it, and cancelled if it fails, since its next attempt finds
 * no message. The delivery records of what went out stay: the submission is
 * still there, and they go when it is deleted.
 *
 * What a submission sent is recorded as it is queued (`recordSend`), in the
 * plugin's own `form-submission-sends` collection, in the transaction that
 * stores the submission and queues the notification.
 *
 * @module handlers/forget-sends
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";

import { resendsSlugOf, sendsSlugOf } from "../collections/sends";
import type { StoredRecipient } from "../utils/send-status";

import { nameCancels } from "./send-history";

type InTransactionHandler = Parameters<
  PluginContext["hooks"]["onInTransaction"]
>[1];
type InTransactionContext = Parameters<InTransactionHandler>[0];

/** The plugin's services, hooks and own slugs this needs. */
type ForgettingContext = Pick<PluginContext, "hooks" | "services" | "self">;

/**
 * How many rows a deletion reads at a time: a form's submissions, or a
 * submission's sends. Below the services' cap on one page, and drained until
 * none is left, so a large form or a submission with many notifications is
 * forgotten whole.
 */
export const DELETE_PAGE = 200;

/**
 * How a submission's sends and requests are read: with no row lock. The
 * write deleting the submission or marking it Spam holds the submission's
 * row, and core changes or cancels each queued email under that email's own
 * row lock before telling the plugin, so nothing else changes them
 * meanwhile, and each is then written by its id. A locking read would take
 * MySQL's next-key locks on the `submission` index, which deadlock when
 * several submissions are deleted or marked Spam at once, each in its own
 * transaction.
 */
const UNLOCKED = { lock: "none" } as const;

/**
 * The forms each transaction is deleting, by the transaction's key. A
 * submission deleted with its form need not hand its one-response key to
 * the next submission, which is about to go too.
 */
const formsBeingDeleted = new WeakMap<object, Set<string>>();

/** Whether the transaction `write` runs in is deleting the form `formId`. */
export function deletingForm(
  write: Pick<InTransactionContext, "transactionKey">,
  formId: string
): boolean {
  return formsBeingDeleted.get(write.transactionKey)?.has(formId) ?? false;
}

/**
 * A send as it is recorded: the queued email and the key it went with, and,
 * for a notification, which one sent it and who it was configured for
 * (`send-history`).
 */
export interface RecordedSend {
  queuedId: string;
  sendKey: string;
  form?: string;
  notification?: string;
  notificationName?: string;
  state?: string;
  configured?: StoredRecipient[];
  requestedBy?: string;
  resend?: string;
}

/**
 * Record that `submissionId` queued a notification, in `transaction`: the
 * one storing the submission and queuing the notification, so the record,
 * the submission and the queued email commit or roll back together.
 */
export async function recordSend(
  ctx: Pick<PluginContext, "services" | "self">,
  transaction: InTransactionContext["transaction"],
  submissionId: string,
  send: RecordedSend
): Promise<void> {
  await ctx.services.collections.createEntryInTransaction(
    transaction,
    sendsSlugOf(ctx),
    { submission: submissionId, ...send }
  );
}

/** A submission's status as a write describes it, or undefined. */
function statusOf(row: unknown): unknown {
  return row && typeof row === "object"
    ? (row as { status?: unknown }).status
    : undefined;
}

/** Whether `write` is the update that marks its submission Spam. */
function marksSpam(write: InTransactionContext): boolean {
  return (
    write.operation === "update" &&
    statusOf(write.data) === "spam" &&
    statusOf(write.originalData) !== "spam"
  );
}

/**
 * The queued emails a submission's notifications went out as, read on the
 * write's transaction. Paged by number: nothing here deletes the records.
 */
async function queuedIdsOf(
  ctx: ForgettingContext,
  write: InTransactionContext
): Promise<string[]> {
  const ids: string[] = [];
  for (let page = 1; ; page += 1) {
    const { data } = await ctx.services.ownCollections.listEntriesInTransaction(
      write.transaction,
      sendsSlugOf(ctx),
      {
        where: { submission: { equals: String(write.id) } },
        pagination: { limit: DELETE_PAGE, page },
        depth: 0,
      },
      UNLOCKED
    );
    const sends = data as Array<Partial<RecordedSend>>;
    for (const send of sends) if (send.queuedId) ids.push(send.queuedId);
    if (sends.length < DELETE_PAGE) return ids;
  }
}

/**
 * Cancel and clear what a submission queued as it is marked Spam (see the
 * module). Only the queued emails are named, not the keys they were sent
 * with, so the delivery records of what already went out are kept.
 */
async function cancelSpamSends(
  ctx: ForgettingContext,
  write: InTransactionContext
): Promise<void> {
  if (!marksSpam(write)) return;
  const queuedIds = await queuedIdsOf(ctx, write);
  if (queuedIds.length === 0) return;
  await ctx.services.email.forgetSends({ queuedIds }, { tx: write.db });
  // Told as the plugin's own cancel; kept as what it was: the Spam mark.
  await nameCancels(ctx, write.transaction, queuedIds, { by: "spam" });
}

/** Forget what the submission a delete removes sent, and its records of it. */
async function forgetSubmissionSends(
  ctx: ForgettingContext,
  write: InTransactionContext
): Promise<void> {
  if (write.operation !== "delete" || write.id === undefined) return;
  const slug = sendsSlugOf(ctx);
  await inBatches(ctx, write, slug, sends =>
    forgetBatch(
      ctx,
      write,
      slug,
      sends
    )
  );
  await inBatches(ctx, write, resendsSlugOf(ctx), async requests => {
    for (const row of requests) {
      await ctx.services.collections.deleteEntryInTransaction(
        write.transaction,
        resendsSlugOf(ctx),
        String(row.id)
      );
    }
  });
}

/**
 * Hand `remove` each batch of the rows in `slug` that name the submission a
 * delete removes, until none is left. `remove` deletes the batch it is
 * given, so the first page is always the next batch.
 */
async function inBatches(
  ctx: ForgettingContext,
  write: InTransactionContext,
  slug: string,
  remove: (rows: Array<{ id: unknown }>) => Promise<void>
): Promise<void> {
  for (;;) {
    const { data } = await ctx.services.ownCollections.listEntriesInTransaction(
      write.transaction,
      slug,
      {
        where: { submission: { equals: String(write.id) } },
        pagination: { limit: DELETE_PAGE },
        depth: 0,
      },
      UNLOCKED
    );
    const rows = data as Array<{ id: unknown }>;
    if (rows.length > 0) await remove(rows);
    if (rows.length < DELETE_PAGE) return;
  }
}

/**
 * Delete a batch of a submission's send records, then forget the sends.
 * Records first: the cancel each forget causes then finds no record to fold
 * into (`send-history`), so a deletion writes nothing it is about to delete.
 * An update and a delete of one record in one transaction, beside another
 * deletion doing the same, deadlocks MySQL on the content-events table.
 */
async function forgetBatch(
  ctx: ForgettingContext,
  write: InTransactionContext,
  slug: string,
  sends: Array<{ id: unknown } & Partial<RecordedSend>>
): Promise<void> {
  for (const send of sends) {
    await ctx.services.collections.deleteEntryInTransaction(
      write.transaction,
      slug,
      String(send.id)
    );
  }
  await ctx.services.email.forgetSends(
    {
      queuedIds: sends.flatMap(send => (send.queuedId ? [send.queuedId] : [])),
      idempotencyKeys: sends.flatMap(send =>
        send.sendKey ? [send.sendKey] : []
      ),
    },
    { tx: write.db }
  );
}

/** Delete a form's submissions with the form, each forgetting what it sent. */
async function deleteFormSubmissions(
  ctx: ForgettingContext,
  write: InTransactionContext,
  submissionsSlug: string
): Promise<void> {
  if (write.operation !== "delete" || write.id === undefined) return;
  const formId = String(write.id);
  const deleting = formsBeingDeleted.get(write.transactionKey) ?? new Set();
  deleting.add(formId);
  formsBeingDeleted.set(write.transactionKey, deleting);
  for (;;) {
    const { data } = await ctx.services.ownCollections.listEntriesInTransaction(
      write.transaction,
      submissionsSlug,
      {
        where: { form: { equals: formId } },
        pagination: { limit: DELETE_PAGE },
        depth: 0,
      }
    );
    for (const row of data as Array<{ id: unknown }>) {
      await ctx.services.collections.deleteEntryInTransaction(
        write.transaction,
        submissionsSlug,
        String(row.id)
      );
    }
    if (data.length < DELETE_PAGE) return;
  }
}

/**
 * Forget what submissions sent on every path that deletes them, and call
 * off what one queued as it is marked Spam.
 */
export function registerForgettingSends(
  ctx: ForgettingContext,
  slugs: { forms: string; submissions: string }
): void {
  ctx.hooks.onInTransaction(slugs.submissions, async write => {
    await forgetSubmissionSends(ctx, write);
    await cancelSpamSends(ctx, write);
  });
  ctx.hooks.onInTransaction(slugs.forms, write =>
    deleteFormSubmissions(ctx, write, slugs.submissions)
  );
}
