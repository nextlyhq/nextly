/**
 * A submission's sends as its page reads them, and a notification's recent
 * sends: the rows `form-submission-sends` keeps, brought up to date with
 * where core says each unsettled one stands, and grouped by notification.
 *
 * A row is up to date with every change core told the plugin of, in that
 * change's transaction. The one cancel core does not tell a plugin of is an
 * erasure's, which must never wait on a plugin's code; so a row still
 * waiting, retrying or sending is read against core's state
 * (`ctx.services.email.readQueued`), and one core has settled reads as it
 * stands there. An email core no longer holds while the row says it is
 * still on its way was erased and pruned since.
 *
 * @module handlers/send-views
 */
import type { PluginContext, QueuedEmailStatus } from "@nextlyhq/plugin-sdk";
import { z } from "zod";

import { sendsSlugOf } from "../collections/sends";
import {
  latestByRecipient,
  type RecipientStatus,
  sendInProgress,
  type StoredSend,
} from "../utils/send-status";

/** A send as its row is read, with the row's id. */
export type SendRow = StoredSend & {
  id: string;
  submission: string;
  form?: string | null;
  /** The Resend request that made it, for a send made again. */
  resend?: string | null;
};

const RECIPIENT = z.object({
  digest: z.string(),
  hint: z.string(),
  kind: z.enum(["to", "cc", "bcc"]),
  source: z.enum(["team", "visitor", "cc", "bcc", "added"]).catch("added"),
  outcome: z.enum(["accepted", "refused", "unknown", "skipped"]).optional(),
  retries: z.number().int().optional(),
});

const CAUSE = z.union([
  z.object({ by: z.literal("person"), userId: z.string().nullable() }),
  z.object({ by: z.enum(["spam", "erasure", "sender", "request"]) }),
]);

const STATE = z.enum([
  "waiting",
  "retrying",
  "sending",
  "sent",
  "failed",
  "cancelled",
]);

/** A JSON column's value, whether a dialect hands it back parsed or as text. */
function jsonOf(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

/** A text column's value, or null. */
function textOf(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** A date column's value as text, or null. */
function dateOf(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return textOf(value);
}

/** A stored row of `form-submission-sends`, as the views read it. */
export function sendRowOf(entry: Record<string, unknown>): SendRow {
  const recipients = z.array(RECIPIENT).safeParse(jsonOf(entry.recipients));
  const configured = z.array(RECIPIENT).safeParse(jsonOf(entry.configured));
  const cancel = CAUSE.safeParse(jsonOf(entry.cancel));
  const requested = CAUSE.safeParse(jsonOf(entry.cancelRequested));
  const state = STATE.safeParse(entry.state);
  return {
    id: String(entry.id),
    submission: textOf(entry.submission) ?? "",
    queuedId: textOf(entry.queuedId) ?? "",
    form: textOf(entry.form),
    notification: textOf(entry.notification),
    notificationName: textOf(entry.notificationName),
    state: state.success ? state.data : null,
    attempts: typeof entry.attempts === "number" ? entry.attempts : null,
    retries: typeof entry.retries === "number" ? entry.retries : null,
    resend: textOf(entry.resend),
    changedAt: dateOf(entry.changedAt),
    createdAt: dateOf(entry.createdAt),
    cancel: cancel.success ? cancel.data : null,
    cancelRequested: requested.success ? requested.data : null,
    retiredBy: textOf(entry.retiredBy),
    configured: configured.success ? configured.data : null,
    recipients: recipients.success ? recipients.data : null,
    requestedBy: textOf(entry.requestedBy),
  };
}

/** The most rows one read takes; a submission or a page needs far fewer. */
const MOST_ROWS = 500;

/** A row read against where core says its queued email stands. */
function reconciled(
  send: SendRow,
  status: QueuedEmailStatus | undefined
): SendRow {
  if (!sendInProgress(send)) return send;
  if (status === undefined) {
    return { ...send, state: "cancelled", cancel: { by: "erasure" } };
  }
  if (status.state === "cancelled") {
    return { ...send, state: "cancelled", cancel: { by: "erasure" } };
  }
  if (status.state === "sent" || status.state === "failed") {
    return { ...send, state: status.state };
  }
  return send;
}

/** `rows` read against core's state of each one still on its way. */
export async function upToDate(
  ctx: Pick<PluginContext, "services">,
  rows: readonly SendRow[]
): Promise<SendRow[]> {
  const unsettled = rows.filter(sendInProgress).map(row => row.queuedId);
  if (unsettled.length === 0) return [...rows];
  const statuses = new Map(
    (await ctx.services.email.readQueued(unsettled)).map(status => [
      status.id,
      status,
    ])
  );
  return rows.map(row => reconciled(row, statuses.get(row.queuedId)));
}

/**
 * Sends in the order they were made. Rows stored in the same second sort
 * alike by their time on some dialects, so an original comes before a send
 * Resend made, which always follows it.
 */
export function orderedSends(
  rows: SendRow[],
  options: { newestFirst?: boolean }
): SendRow[] {
  const sign = options.newestFirst ? -1 : 1;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const time = (a.row.createdAt ?? "").localeCompare(b.row.createdAt ?? "");
      if (time !== 0) return sign * time;
      const resent =
        Number(Boolean(a.row.resend)) - Number(Boolean(b.row.resend));
      return resent !== 0 ? sign * resent : a.index - b.index;
    })
    .map(({ row }) => row);
}

/** The sends rows `where` selects, oldest first. */
export async function sendRows(
  ctx: Pick<PluginContext, "services" | "self">,
  where: Record<string, unknown>,
  options: { newestFirst?: boolean; limit?: number } = {}
): Promise<SendRow[]> {
  const { data } = await ctx.services.ownCollections.listEntries(
    sendsSlugOf(ctx),
    {
      where,
      sort: {
        field: "createdAt",
        direction: options.newestFirst ? "desc" : "asc",
      },
      pagination: { limit: options.limit ?? MOST_ROWS },
      depth: 0,
    }
  );
  return orderedSends(
    data.map(entry => sendRowOf(entry)),
    options
  );
}

/** One notification's sends of a submission, as its page shows them. */
export interface NotificationSends {
  /** The notification's id, or null for a send recorded before ids were kept. */
  notification: string | null;
  name: string;
  /** Every recipient it has had, with its latest result. */
  recipients: RecipientStatus[];
  /** Whether a send of it is waiting, retrying or sending. */
  inProgress: boolean;
  /** Each send, oldest first: what it did and who asked for it. */
  sends: Array<{
    queuedId: string;
    state: string;
    attempts: number;
    at: string | null;
    requestedBy: string | null;
    retired: boolean;
  }>;
}

/** The name a group of sends reads under: its latest one's. */
function nameOf(sends: readonly SendRow[]): string {
  for (let index = sends.length - 1; index >= 0; index -= 1) {
    const name = sends[index]?.notificationName;
    if (name) return name;
  }
  return "Notification";
}

/** A submission's sends, up to date, by notification in the order sent. */
function groupByNotification(rows: readonly SendRow[]): NotificationSends[] {
  const groups = new Map<string, SendRow[]>();
  for (const row of rows) {
    const key = row.notification ?? `queued:${row.queuedId}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()].map(sends => ({
    notification: sends[0]?.notification ?? null,
    name: nameOf(sends),
    recipients: latestByRecipient(sends),
    inProgress: sends.some(sendInProgress),
    sends: sends.map(send => ({
      queuedId: send.queuedId,
      state: send.state ?? "waiting",
      attempts: send.attempts ?? 0,
      at: send.changedAt ?? send.createdAt ?? null,
      requestedBy: send.requestedBy ?? null,
      retired: Boolean(send.retiredBy),
    })),
  }));
}

/** A submission's sends, up to date and grouped by notification. */
export async function submissionSends(
  ctx: Pick<PluginContext, "services" | "self">,
  submissionId: string
): Promise<NotificationSends[]> {
  const rows = await sendRows(ctx, {
    submission: { equals: submissionId },
  });
  // A send recorded before the history was kept names no notification and
  // no recipient, so nothing true can be said of it: it is not listed.
  const kept = rows.filter(row => row.notification);
  return groupByNotification(await upToDate(ctx, kept));
}

/** One recent send of a notification, as its page lists it. */
export interface RecentSend {
  submission: string;
  recipients: RecipientStatus[];
  at: string | null;
}

/** A notification's latest sends across its form's submissions, newest first. */
export async function recentSends(
  ctx: Pick<PluginContext, "services" | "self">,
  formId: string,
  notificationId: string,
  limit: number
): Promise<RecentSend[]> {
  const rows = await sendRows(
    ctx,
    {
      form: { equals: formId },
      notification: { equals: notificationId },
    },
    { newestFirst: true, limit }
  );
  return (await upToDate(ctx, rows)).map(send => ({
    submission: send.submission,
    recipients: latestByRecipient([send]),
    at: send.changedAt ?? send.createdAt ?? null,
  }));
}
