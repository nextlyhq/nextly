/**
 * Activity's model: one newest-first list of what email the site sent, as
 * the server's merged Activity answers it (queued email, and the deliveries
 * of sends that were not queued, under one cursor), and the words each row
 * says.
 *
 * Nothing here holds an address, a subject or a body: the rows are built from
 * the server's answers, which carry none.
 *
 * @module components/features/email-hub/activity/activity-model
 */

import type {
  ActivityEntry,
  ActivityProvider,
  ActivityQuery,
  DeliveryOutcome,
  FilterableOrigin,
  QueuedEmailState,
  RecipientKind,
} from "@admin/services/emailActivityApi";

/** One row of the list: a delivery of a send that was not queued, or a queued email. */
export interface ActivityRow {
  source: "delivery" | "queued";
  id: string;
  at: Date;
  /** A delivery's outcome, or where a queued email stands. */
  status: DeliveryOutcome | QueuedEmailState;
  template: ActivityEntry["template"];
  /** Its provider; null for a queued email not yet tried. */
  provider: ActivityProvider | null;
  /** The kinds of recipient it went to; null when not recorded. */
  recipientKinds: RecipientKind[] | null;
  failureReason: string | null;
  /** A queued email's attempts; null for a delivery, or when unknown. */
  attempts: number | null;
  nextAttemptAt: Date | null;
  /** Whether a delivery's recipient has been erased since. */
  erased: boolean;
}

/** What the outcome filter offers: a delivery's two, and queued email's states. */
export type OutcomeFilter =
  | "any"
  | "sent"
  | "failed"
  | "waiting"
  | "retrying"
  | "sending"
  | "cancelled";

/** The outcome filter's choices, in the order it offers them. */
export const OUTCOME_FILTERS: ReadonlyArray<{
  value: OutcomeFilter;
  label: string;
}> = [
  { value: "any", label: "Any outcome" },
  { value: "sent", label: "Sent" },
  { value: "failed", label: "Failed" },
  { value: "retrying", label: "Retrying" },
  { value: "waiting", label: "Waiting" },
  { value: "sending", label: "Sending" },
  { value: "cancelled", label: "Cancelled" },
];

/** How far back the list reaches, from the moment it is read. */
export type TimeWindow = "24h" | "7d" | "30d";

export const TIME_WINDOWS: ReadonlyArray<{
  value: TimeWindow;
  label: string;
  ms: number;
}> = [
  { value: "24h", label: "24 hours", ms: 24 * 60 * 60 * 1000 },
  { value: "7d", label: "7 days", ms: 7 * 24 * 60 * 60 * 1000 },
  { value: "30d", label: "30 days", ms: 30 * 24 * 60 * 60 * 1000 },
];

/** Where a provider came from, as the origin filter offers it. */
export const ORIGIN_FILTERS: ReadonlyArray<{
  value: FilterableOrigin;
  label: string;
}> = [
  { value: "stored", label: "Stored" },
  { value: "code", label: "In code" },
  { value: "deleted", label: "Deleted" },
];

/** The screen's filters. */
export interface ActivityFilter {
  outcome: OutcomeFilter;
  template?: string;
  /** A provider's registered type, which takes in every provider of it. */
  providerType?: string;
  providerOrigin?: FilterableOrigin;
  window: TimeWindow;
}

/**
 * The filters as the server reads them, but for the window's start: that is
 * measured when each first page is read (`windowStart`), so the window rolls
 * with the clock while the list is open.
 */
export function activityQuery(
  filter: ActivityFilter
): Omit<ActivityQuery, "from" | "to" | "before" | "limit"> {
  return {
    ...(filter.outcome === "any" ? {} : { status: filter.outcome }),
    ...(filter.template ? { template: filter.template } : {}),
    ...(filter.providerType ? { providerType: filter.providerType } : {}),
    ...(filter.providerOrigin ? { providerOrigin: filter.providerOrigin } : {}),
  };
}

/** Where a window that ends now starts. */
export function windowStart(window: TimeWindow, now: Date): string {
  const span = (TIME_WINDOWS.find(w => w.value === window) ?? TIME_WINDOWS[1])
    .ms;
  return new Date(now.getTime() - span).toISOString();
}

/** One merged Activity entry as a row. */
export function activityRow(entry: ActivityEntry): ActivityRow {
  return {
    source: entry.kind,
    id: entry.id,
    at: new Date(entry.createdAt),
    status: entry.status,
    template: entry.template,
    provider: entry.provider,
    recipientKinds: entry.recipientKinds,
    failureReason: entry.failureReason,
    attempts: entry.attempts,
    nextAttemptAt: entry.nextAttemptAt ? new Date(entry.nextAttemptAt) : null,
    erased: entry.erased,
  };
}

/** The template slug a row names, or null for none or not recorded. */
export function templateSlugOf(
  row: Pick<ActivityRow, "template">
): string | null {
  return typeof row.template === "object" ? row.template.slug : null;
}

/**
 * How a provider is named, wherever the hub names one: a stored provider by
 * its name when the reader may read it, else its type; one set in code, one
 * deleted since, or one whose origin was not recorded, by its type and that.
 */
export function providerLabel(
  provider: ActivityProvider | null,
  nameOf: (id: string) => string | undefined
): string {
  if (provider === null) return "—";
  const { id, type, origin } = provider;
  switch (origin) {
    case "stored":
      return (id ? nameOf(id) : undefined) ?? type;
    case "code":
      return `${type} (in code)`;
    case "deleted":
      return `${type} (deleted)`;
    case "not-recorded":
      return `${type} (origin not recorded)`;
  }
}

/** The queued states that can still change on their own, as the queue runs. */
const UNSETTLED: ReadonlySet<QueuedEmailState> = new Set([
  "waiting",
  "retrying",
  "sending",
]);

/** Whether a queued email in this state can still change by itself. */
export function isUnsettled(state: QueuedEmailState): boolean {
  return UNSETTLED.has(state);
}

/**
 * Whether any of these rows is a queued email that can still change by
 * itself, so a list showing it has to be read again to stay true.
 */
export function holdsUnsettledQueued(rows: readonly ActivityRow[]): boolean {
  return rows.some(row => row.source === "queued" && isUnsettled(row.status));
}

/** What happened to a row, in one line, with a detail when it has one. */
export interface WhatHappened {
  title: string;
  detail?: string;
}

/** A span of time in the words the list uses: "10 min", "3 h", "2 days". */
function spanText(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} days`;
}

/**
 * When an attempt is due, in words: "Next attempt in 10 min", or how late it
 * is, "Next attempt overdue by 30 min", which a stalled jobs trigger makes it.
 */
export function dueText(due: Date | null, now: Date, attempt: string): string {
  if (due === null) return `${attempt} not scheduled`;
  const ms = due.getTime() - now.getTime();
  return ms >= 0
    ? `${attempt} in ${spanText(ms)}`
    : `${attempt} overdue by ${spanText(-ms)}`;
}

/** The row's "what happened" line. */
export function whatHappened(row: ActivityRow, now: Date): WhatHappened {
  const failure = row.failureReason ?? undefined;
  if (row.source === "delivery") {
    return row.status === "sent"
      ? { title: "Sent" }
      : { title: "Failed", detail: failure ?? "No reason was given." };
  }
  switch (row.status) {
    case "waiting":
      return { title: dueText(row.nextAttemptAt, now, "First attempt") };
    case "sending":
      return { title: "With the provider now" };
    case "sent":
      return { title: "Sent" };
    case "retrying": {
      const title = dueText(row.nextAttemptAt, now, "Next attempt");
      return failure ? { title, detail: failure } : { title };
    }
    case "failed":
      return failure
        ? { title: "Failed", detail: failure }
        : { title: "Failed" };
    case "cancelled":
      return failure
        ? { title: "Cancelled", detail: `Last failure: ${failure}` }
        : { title: "Cancelled" };
  }
}

/** The badge a row's outcome shows, and the tone it is drawn in. */
export function outcomeBadge(row: ActivityRow): {
  label: string;
  variant: "success" | "destructive" | "warning" | "info" | "default";
} {
  switch (row.status) {
    case "sent":
      return { label: "Sent", variant: "success" };
    case "failed":
      return { label: "Failed", variant: "destructive" };
    case "retrying":
      return { label: "Retrying", variant: "warning" };
    case "sending":
      return { label: "Sending", variant: "info" };
    case "waiting":
      return { label: "Waiting", variant: "default" };
    case "cancelled":
      return { label: "Cancelled", variant: "default" };
  }
}

/** To, Cc or Bcc, as the list writes them. */
export const RECIPIENT_KIND_LABELS: Record<RecipientKind, string> = {
  to: "To",
  cc: "Cc",
  bcc: "Bcc",
};
