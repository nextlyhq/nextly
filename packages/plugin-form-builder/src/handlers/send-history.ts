/**
 * What became of each notification a submission sent, kept with its send.
 *
 * Core tells the plugin of every change of its own queued emails inside the
 * transaction that makes it (`ctx.services.email.onQueuedEmailChange`): an
 * attempt starting, a failure a retry can help, sent, failed, or cancelled
 * with why. Each change is folded into the send's row of
 * `form-submission-sends` in that same transaction, so the row cannot fall
 * behind the send, nor record a change that was undone.
 *
 * - Each recipient is kept as the send went to it, after send filters ran:
 *   its line, a masked hint and the plugin's digest (never the address), what
 *   became of it, and where it came from: the notification's own lines, or a
 *   filter that added it.
 * - A cancel keeps its cause. One made while an attempt was with the
 *   provider is kept as asked, and is the cause once that attempt fails.
 * - A failed send that Resend retires stays failed: it did fail, and nothing
 *   sends it again.
 *
 * Written only as changes happen, the rows do not move when the
 * submission's answers or the notification are edited later, and they are
 * deleted with the submission (`forget-sends`).
 *
 * @module handlers/send-history
 */
import type { PluginContext, QueuedEmailChange } from "@nextlyhq/plugin-sdk";

import { sendsSlugOf } from "../collections/sends";
import type {
  CancelCause,
  RecipientSource,
  StoredRecipient,
  StoredSend,
} from "../utils/send-status";

import { type SendRow, sendRowOf } from "./send-views";

/** A core cancel cause, as the send's row keeps it. */
function causeOf(cause: NonNullable<QueuedEmailChange["cancel"]>): CancelCause {
  return cause.by === "person"
    ? { by: "person", userId: cause.userId }
    : { by: cause.by };
}

/** Where a final recipient came from: the line it was configured on, else a filter. */
function sourceOf(
  configured: readonly StoredRecipient[] | null | undefined,
  digest: string
): RecipientSource {
  return configured?.find(entry => entry.digest === digest)?.source ?? "added";
}

/**
 * The change's recipients as the row keeps them, each with where it came
 * from, and one accepted with the retries recorded before it was: as an
 * earlier change recorded it, else the row's count so far. Counted from the
 * retries recorded rather than the attempt's number, so a send whose record
 * of acceptance was undone, and is made again by the next attempt, reads as
 * sent the first time, as it was.
 */
function foldedRecipients(
  stored: StoredSend,
  change: QueuedEmailChange
): StoredRecipient[] {
  const before = new Map(
    (stored.recipients ?? []).map(recipient => [recipient.digest, recipient])
  );
  return (change.recipients ?? []).map(recipient => {
    const accepted = recipient.outcome === "accepted";
    const earlier = before.get(recipient.digest);
    return {
      digest: recipient.digest,
      hint: recipient.hint,
      kind: recipient.kind,
      outcome: recipient.outcome,
      source: sourceOf(stored.configured, recipient.digest),
      ...(accepted
        ? {
            retries:
              earlier?.outcome === "accepted" && earlier.retries !== undefined
                ? earlier.retries
                : (stored.retries ?? 0),
          }
        : {}),
    };
  });
}

/** What a cancelled change makes of the row. */
function cancelledPatch(
  stored: StoredSend,
  change: QueuedEmailChange
): Record<string, unknown> {
  // A failed send forgotten by its own plugin is being retired by Resend:
  // it keeps its failure.
  if (stored.state === "failed" && change.cancel?.by === "sender") return {};
  const cause =
    change.cancel?.by === "request" || change.cancel === undefined
      ? (stored.cancelRequested ?? { by: "request" })
      : causeOf(change.cancel);
  return { state: "cancelled", cancel: cause };
}

/**
 * The row's fields a change sets: where the send stands, its attempts, when
 * it changed, a cancel's cause, and each final recipient's outcome. Empty
 * when the change leaves the row as it is.
 */
export function foldChange(
  stored: StoredSend,
  change: QueuedEmailChange
): Record<string, unknown> {
  const state =
    change.state === "cancelled"
      ? cancelledPatch(stored, change)
      : { state: change.state };
  if (Object.keys(state).length === 0) return {};
  return {
    ...state,
    attempts: Math.max(stored.attempts ?? 0, change.attempt),
    ...(change.state === "retrying"
      ? { retries: (stored.retries ?? 0) + 1 }
      : {}),
    changedAt: change.at,
    ...(change.cancelRequested
      ? { cancelRequested: causeOf(change.cancelRequested) }
      : {}),
    ...(change.recipients
      ? { recipients: foldedRecipients(stored, change) }
      : {}),
  };
}

/** The send `queuedId` names, locked for the change, or undefined. */
async function sendRow(
  ctx: Pick<PluginContext, "services" | "self">,
  transaction: Parameters<
    PluginContext["services"]["ownCollections"]["listEntriesInTransaction"]
  >[0],
  queuedId: string
): Promise<SendRow | undefined> {
  const { data } = await ctx.services.ownCollections.listEntriesInTransaction(
    transaction,
    sendsSlugOf(ctx),
    {
      where: { queuedId: { equals: queuedId } },
      pagination: { limit: 1 },
      depth: 0,
    },
    { lock: "update" }
  );
  const [entry] = data;
  return entry ? sendRowOf(entry) : undefined;
}

/** Keep each change of a submission's notifications with its send. */
export function registerSendHistory(
  ctx: Pick<PluginContext, "services" | "self">
): void {
  ctx.services.email.onQueuedEmailChange(async (change, { transaction }) => {
    const row = await sendRow(ctx, transaction, change.queuedId);
    // Not a notification's: another email this plugin queued, or one whose
    // submission is gone.
    if (!row) return;
    const patch = foldChange(row, change);
    if (Object.keys(patch).length === 0) return;
    await ctx.services.collections.updateEntryInTransaction(
      transaction,
      sendsSlugOf(ctx),
      String(row.id),
      { ...patch, _overwrite: true }
    );
  });
}

/**
 * Name `cause` as why the sends among `queuedIds` were cancelled, where the
 * plugin's own forgetting cancelled them (`sender`), in `transaction`: what
 * marking a submission Spam calls it.
 */
export async function nameCancels(
  ctx: Pick<PluginContext, "services" | "self">,
  transaction: Parameters<typeof sendRow>[1],
  queuedIds: readonly string[],
  cause: CancelCause
): Promise<void> {
  for (const queuedId of queuedIds) {
    const row = await sendRow(ctx, transaction, queuedId);
    if (!row) continue;
    const patch: Record<string, unknown> = {};
    if (row.cancel?.by === "sender") patch.cancel = cause;
    if (row.cancelRequested?.by === "sender") patch.cancelRequested = cause;
    if (Object.keys(patch).length === 0) continue;
    await ctx.services.collections.updateEntryInTransaction(
      transaction,
      sendsSlugOf(ctx),
      String(row.id),
      { ...patch, _overwrite: true }
    );
  }
}
