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
 * What a submission sent is recorded as it is queued (`recordSend`), in the
 * plugin's own `form-submission-sends` collection.
 *
 * @module handlers/forget-sends
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";

import { SUBMISSION_SENDS_SLUG } from "../collections/sends";

type InTransactionHandler = Parameters<
  PluginContext["hooks"]["onInTransaction"]
>[1];
type InTransactionContext = Parameters<InTransactionHandler>[0];

/** The plugin's services and hooks this needs. */
type ForgettingContext = Pick<PluginContext, "hooks" | "services">;

/** How many of a form's submissions a form deletion reads at a time. */
const DELETE_PAGE = 200;

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

/** A send as it is recorded: the queued email and the key it went with. */
export interface RecordedSend {
  queuedId: string;
  sendKey: string;
}

/** Record that `submissionId` queued a notification. */
export async function recordSend(
  ctx: Pick<PluginContext, "services">,
  submissionId: string,
  send: RecordedSend
): Promise<void> {
  await ctx.services.collections.createEntry(SUBMISSION_SENDS_SLUG, {
    submission: submissionId,
    ...send,
  });
}

/** Forget what the submission a delete removes sent, and its records of it. */
async function forgetSubmissionSends(
  ctx: ForgettingContext,
  write: InTransactionContext
): Promise<void> {
  if (write.operation !== "delete" || write.id === undefined) return;
  const { data } = await ctx.services.ownCollections.listEntriesInTransaction(
    write.transaction,
    SUBMISSION_SENDS_SLUG,
    {
      where: { submission: { equals: String(write.id) } },
      pagination: { limit: 1000 },
      depth: 0,
    }
  );
  const sends = data as Array<{ id: unknown } & Partial<RecordedSend>>;
  if (sends.length === 0) return;
  await ctx.services.email.forgetSends(
    {
      queuedIds: sends.flatMap(send => (send.queuedId ? [send.queuedId] : [])),
      idempotencyKeys: sends.flatMap(send =>
        send.sendKey ? [send.sendKey] : []
      ),
    },
    { tx: write.db }
  );
  for (const send of sends) {
    await ctx.services.collections.deleteEntryInTransaction(
      write.transaction,
      SUBMISSION_SENDS_SLUG,
      String(send.id)
    );
  }
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

/** Forget what submissions sent on every path that deletes them. */
export function registerForgettingSends(
  ctx: ForgettingContext,
  slugs: { forms: string; submissions: string }
): void {
  ctx.hooks.onInTransaction(slugs.submissions, write =>
    forgetSubmissionSends(ctx, write)
  );
  ctx.hooks.onInTransaction(slugs.forms, write =>
    deleteFormSubmissions(ctx, write, slugs.submissions)
  );
}
