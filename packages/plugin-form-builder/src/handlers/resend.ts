/**
 * Resend: send a submission's notification again to the recipients who have
 * not received it, and to any the person ticks to send again on purpose.
 *
 * - **Who may.** A person who may both update submissions and manage email
 *   deliveries: the route asks the first as its own permission and the
 *   second before anything is read, and refuses either one missing.
 * - **Never beside a send in progress.** While a send of the notification is
 *   waiting, retrying or sending, Resend is refused and the page says a send
 *   is in progress: that send may yet reach everyone.
 * - **Never twice by accident.** The notification is built again from the
 *   form and the answers as they are now, the send filters run on it, and
 *   every recipient it has already reached is left out by digest
 *   (`excludeRecipients`), judged after the filters, so one a filter adds is
 *   left out as surely. A person may tick a recipient who received it, from
 *   those it can address now, to send it to them again. When every `to` is
 *   left out, each remaining copy is sent alone, so a blind copy is never
 *   shown to another.
 * - **One transaction.** The request is stored in `form-submission-resends`,
 *   and its in-transaction handler queues the send (with a fresh key), records
 *   it with who asked, and retires each failed earlier send whose message is
 *   still held (`forgetSends`), so it cannot be retried as well: all or none.
 *
 * @module handlers/resend
 */
import type { PluginContext, PluginRouteContext } from "@nextlyhq/plugin-sdk";
import { NextlyError, respondMutation } from "@nextlyhq/plugin-sdk";
import { z } from "zod";

import { resendsSlugOf, sendsSlugOf } from "../collections/sends";
import type { FormEmailNotification, FormNotification } from "../types";
import {
  type AddressableRecipient,
  addressableNow,
  latestByRecipient,
  reachedExcept,
  type RecipientStatus,
  sendInProgress,
} from "../utils/send-status";

import { type RecordedSend, recordSend } from "./forget-sends";
import { formIdOf } from "./form-closing-hold";
import { configuredRecipients, notificationSendDetails } from "./send-record";
import {
  orderedSends,
  type SendRow,
  sendRowOf,
  sendRows,
  upToDate,
} from "./send-views";

type InTransactionHandler = Parameters<
  PluginContext["hooks"]["onInTransaction"]
>[1];
type InTransactionContext = Parameters<InTransactionHandler>[0];

/** What Resend needs of the plugin that builds and queues notifications. */
export interface ResendDeps {
  formsSlug: string;
  submissionsSlug: string;
  /**
   * The notification's email for the submission as they are now, whether or
   * not it is active or its conditions hold: a person chose to send it.
   */
  build: (
    form: Record<string, unknown>,
    submission: Record<string, unknown>,
    notification: FormNotification
  ) => FormEmailNotification | undefined;
  /** The emails as the `form-builder.beforeEmail` filters leave them. */
  filter: (
    emails: FormEmailNotification[],
    form: Record<string, unknown>,
    submission: Record<string, unknown>
  ) => Promise<FormEmailNotification[]>;
  /** Queue the emails in a transaction, recording each queued one. */
  queue: (input: {
    emails: FormEmailNotification[];
    key: string;
    tx: InTransactionContext["db"];
    excludeRecipients: readonly string[];
    record: (sent: RecordedSend, email: FormEmailNotification) => Promise<void>;
  }) => Promise<void>;
}

const BODY = z.object({
  notification: z.string().min(1).max(200),
  tick: z.array(z.string().min(1).max(128)).max(100).default([]),
});

/** A stored request, as its handler reads it. */
const REQUEST = z.object({
  submission: z.string(),
  notification: z.string(),
  requestedBy: z.string().nullish(),
  ticked: z.array(z.string()).default([]),
  retire: z.array(z.string()).default([]),
  settled: z.array(z.string()).default([]),
});

/** The form a notification belongs to, and the notification itself. */
function notificationOf(
  form: Record<string, unknown>,
  id: string
): FormNotification | undefined {
  const all = Array.isArray(form.notifications)
    ? (form.notifications as FormNotification[])
    : [];
  return all.find(notification => notification.id === id);
}

/** An entry's id as text: a string or a number by dialect. */
function idText(id: unknown): string {
  if (typeof id === "number") return `${id}`;
  return typeof id === "string" ? id : "";
}

/** What a resend of `notification` would do, worked out before it is asked. */
interface Plan {
  exclude: string[];
  retire: string[];
  settled: string[];
}

/**
 * Who a resend of `notification` can send to now, each marked as reached
 * when `history` (its latest result per recipient) shows it received it:
 * what the route plans with and the submission's page offers to tick.
 */
export async function addressableFor(
  ctx: Pick<PluginContext, "services">,
  email: FormEmailNotification,
  notification: FormNotification,
  history: readonly RecipientStatus[]
): Promise<AddressableRecipient[]> {
  const configured = await configuredRecipients(
    email,
    notification.recipientType === "field" ? "visitor" : "team",
    address => ctx.services.email.recipientDigest(address)
  );
  return addressableNow(configured, history);
}

/**
 * The recipients a resend leaves out, as `sends` show them: each one that
 * received it and is not ticked to send again. Refused when that leaves
 * nobody it can address now: what the route plans with, and what the
 * request's own transaction works out again from the sends as it locked
 * them.
 */
function leftOut(
  addressNow: readonly AddressableRecipient[],
  sends: readonly SendRow[],
  tick: readonly string[]
): string[] {
  const exclude = reachedExcept(latestByRecipient(sends), tick);
  if (addressNow.every(recipient => exclude.includes(recipient.digest))) {
    throw NextlyError.conflict({
      reason: "state",
      message:
        "Everyone this notification can address has received it. Tick a recipient to send it to them again.",
    });
  }
  return exclude;
}

/**
 * Work out what a resend does, refusing one beside a send in progress, one
 * ticking a recipient it cannot address now, and one with nobody to send to.
 */
async function planResend(
  ctx: Pick<PluginContext, "services">,
  sends: readonly SendRow[],
  addressNow: readonly AddressableRecipient[],
  tick: readonly string[]
): Promise<Plan> {
  if (sends.some(sendInProgress)) {
    throw NextlyError.conflict({
      reason: "state",
      message:
        "A send of this notification is in progress. Wait for it to finish before sending it again.",
    });
  }
  const now = new Set(addressNow.map(recipient => recipient.digest));
  if (tick.some(digest => !now.has(digest))) {
    throw NextlyError.validation({
      errors: [
        {
          path: "tick",
          code: "INVALID",
          message:
            "Only a recipient this notification can address now can be ticked.",
        },
      ],
    });
  }
  const exclude = leftOut(addressNow, sends, tick);
  const failed = sends.filter(
    send => send.state === "failed" && !send.retiredBy
  );
  const held = await ctx.services.email.readQueued(
    failed.map(send => send.queuedId)
  );
  return {
    exclude,
    retire: held.filter(status => status.messageHeld).map(status => status.id),
    settled: sends.map(send => send.queuedId),
  };
}

/**
 * `POST /submissions/:id/resend`: send `notification` again. The route's own
 * permission is updating submissions; managing email deliveries is asked
 * here, before anything else.
 */
export async function resendRoute(
  req: Request,
  ctx: PluginRouteContext,
  deps: ResendDeps
): Promise<Response> {
  if (!ctx.caller || !(await ctx.caller.can("manage", "email-deliveries"))) {
    throw NextlyError.forbidden({
      logContext: { reason: "resend needs manage-email-deliveries" },
    });
  }
  const parsed = BODY.safeParse(await req.json().catch(() => undefined));
  if (!parsed.success) {
    throw NextlyError.validation({
      errors: [
        {
          path: "notification",
          code: "INVALID",
          message: "Say which notification to send again.",
        },
      ],
    });
  }
  const submissionId = ctx.params.id ?? "";
  // Read as the person: one they may not read is one they may not resend.
  const submission = (await ctx.services.collections.findEntryById(
    deps.submissionsSlug,
    submissionId,
    { as: "user", user: ctx.user ?? undefined }
  )) as unknown as Record<string, unknown>;
  if (submission.status === "spam") {
    throw NextlyError.conflict({
      reason: "state",
      message: "Mark this submission Not spam before sending its emails.",
    });
  }
  const form = (await ctx.services.ownCollections.findEntryById(
    deps.formsSlug,
    formIdOf(submission.form) ?? ""
  )) as unknown as Record<string, unknown>;
  const notification = notificationOf(form, parsed.data.notification);
  const email = notification
    ? deps.build(form, submission, notification)
    : undefined;
  if (!notification || !email) {
    throw NextlyError.notFound({
      message: "This notification has no one to send to now.",
    });
  }
  const sends = await upToDate(
    ctx,
    await sendRows(ctx, {
      submission: { equals: String(submission.id) },
      notification: { equals: notification.id },
    })
  );
  const plan = await planResend(
    ctx,
    sends,
    await addressableFor(ctx, email, notification, latestByRecipient(sends)),
    parsed.data.tick
  );
  const created = await ctx.services.collections.createEntry(
    resendsSlugOf(ctx),
    {
      submission: String(submission.id),
      notification: notification.id,
      requestedBy: ctx.user?.id ?? null,
      ticked: parsed.data.tick,
      ...plan,
    }
  );
  return respondMutation(
    "Sent again to the recipients who had not received it.",
    { id: idText((created as { id?: unknown }).id) },
    { status: 201 }
  );
}

/** The submission's sends of a notification, locked for the resend. */
async function lockedSends(
  ctx: Pick<PluginContext, "services" | "self">,
  write: InTransactionContext,
  submission: string,
  notification: string
): Promise<SendRow[]> {
  const { data } = await ctx.services.ownCollections.listEntriesInTransaction(
    write.transaction,
    sendsSlugOf(ctx),
    {
      where: {
        submission: { equals: submission },
        notification: { equals: notification },
      },
      pagination: { limit: 500 },
      depth: 0,
    },
    { lock: "update" }
  );
  // Oldest first, as every reading of the history takes them: the latest
  // result per recipient is the last one met.
  return orderedSends(
    data.map(entry => sendRowOf(entry)),
    {}
  );
}

/**
 * Retire the failed sends among `retire`: forgotten by their plugin, so their
 * messages are cleared and nothing retries them, and marked as retired by
 * this request, keeping their failure.
 */
async function retireFailed(
  ctx: Pick<PluginContext, "services" | "self">,
  write: InTransactionContext,
  sends: readonly SendRow[],
  retire: readonly string[]
): Promise<void> {
  if (retire.length === 0) return;
  await ctx.services.email.forgetSends(
    { queuedIds: [...retire] },
    { tx: write.db }
  );
  for (const send of sends.filter(row => retire.includes(row.queuedId))) {
    await ctx.services.collections.updateEntryInTransaction(
      write.transaction,
      sendsSlugOf(ctx),
      send.id,
      { retiredBy: String(write.id), _overwrite: true }
    );
  }
}

/** Queue a stored resend request, in the transaction that stores it. */
async function resendInTransaction(
  ctx: Pick<PluginContext, "services" | "self">,
  deps: ResendDeps,
  write: InTransactionContext
): Promise<void> {
  if (write.operation !== "create") return;
  const request = REQUEST.parse(write.data);
  const sends = await lockedSends(
    ctx,
    write,
    request.submission,
    request.notification
  );
  // A send begun since the request was worked out: refused, as the route
  // refuses one in progress. One the route found settled, by an erasure
  // core told no plugin of, is not.
  const settled = new Set(request.settled);
  if (sends.some(send => sendInProgress(send) && !settled.has(send.queuedId))) {
    throw NextlyError.conflict({
      reason: "state",
      message:
        "A send of this notification is in progress. Wait for it to finish before sending it again.",
    });
  }
  await retireFailed(ctx, write, sends, request.retire);
  const submission =
    (await ctx.services.ownCollections.findEntryByIdInTransaction(
      write.transaction,
      deps.submissionsSlug,
      request.submission
    )) as unknown as Record<string, unknown>;
  const form = (await ctx.services.ownCollections.findEntryByIdInTransaction(
    write.transaction,
    deps.formsSlug,
    formIdOf(submission.form) ?? "",
    { lock: "none" }
  )) as unknown as Record<string, unknown>;
  const notification = notificationOf(form, request.notification);
  const email = notification
    ? deps.build(form, submission, notification)
    : undefined;
  if (!notification || !email) {
    throw NextlyError.notFound({
      message: "This notification has no one to send to now.",
    });
  }
  // Worked out again from the sends as locked here, not taken from the
  // plan: one another resend reached since the plan was made is left out,
  // and a resend left with nobody is refused, so two at once cannot both
  // send to the same recipient.
  const exclude = leftOut(
    await addressableFor(ctx, email, notification, latestByRecipient(sends)),
    sends,
    request.ticked
  );
  let recorded = 0;
  await deps.queue({
    emails: await deps.filter([email], form, submission),
    key: `${request.submission}:resend:${String(write.id)}`,
    tx: write.db,
    excludeRecipients: exclude,
    record: async (sent, queued) => {
      recorded += 1;
      await recordSend(ctx, write.transaction, request.submission, {
        ...sent,
        ...(await notificationSendDetails(ctx, {
          formId: formIdOf(submission.form) ?? "",
          notifications: [notification],
          email: queued,
        })),
        ...(request.requestedBy ? { requestedBy: request.requestedBy } : {}),
        resend: String(write.id),
      });
    },
  });
  if (recorded === 0) {
    throw NextlyError.validation({
      errors: [
        {
          path: "notification",
          code: "INVALID",
          message: "The notification could not be sent again.",
        },
      ],
    });
  }
}

/** Queue each stored resend request in the transaction that stores it. */
export function registerResend(
  ctx: Pick<PluginContext, "hooks" | "services" | "self">,
  deps: ResendDeps
): void {
  ctx.hooks.onInTransaction(resendsSlugOf(ctx), write =>
    resendInTransaction(ctx, deps, write)
  );
}
