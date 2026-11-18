/**
 * Activity's model: one newest-first list of what email the site sent, made
 * of the delivery log and queued email, and the words each row says.
 *
 * The server answers the two as separate lists, each paged by its own cursor.
 * They are merged here into the one list the screen shows, and the screen's
 * filters are translated into each list's own. Kept in this one module so the
 * screen does not change when the server answers one merged list instead.
 *
 * Nothing here holds an address, a subject or a body: the rows are built from
 * the server's answers, which carry none.
 *
 * @module components/features/email-hub/activity/activity-model
 */

import type {
  DeliveryActivity,
  DeliveryActivityQuery,
  DeliveryOutcome,
  QueuedEmailActivity,
  QueuedEmailActivityQuery,
  QueuedEmailState,
  RecipientKind,
} from "@admin/services/emailActivityApi";

/** One row of the list: a delivery record, or a queued email. */
export type ActivityRow =
  | {
      source: "delivery";
      id: string;
      at: Date;
      outcome: DeliveryOutcome;
      templateSlug: string | null;
      provider: { id: string | null; type: string };
      recipientKind: RecipientKind;
      failureReason: string | null;
      namedPerson: boolean;
      erased: boolean;
    }
  | {
      source: "queued";
      id: string;
      at: Date;
      state: QueuedEmailState;
      attempts: number;
      nextAttemptAt: Date | null;
      lastFailureReason: string | null;
      messageHeld: boolean;
      templateSlug: string | null;
      queuedBy: string;
    };

/** What the outcome filter offers: the delivery log's two, and queued email's states. */
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

/** How far back the list reaches. */
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

/**
 * The provider filter's choice: a stored provider by its id, or one deleted
 * since by the type the log keeps for it.
 */
export type ProviderChoice = { id: string } | { type: string };

/** The screen's filters. */
export interface ActivityFilter {
  outcome: OutcomeFilter;
  template?: string;
  provider?: ProviderChoice;
  window: TimeWindow;
}

/** The states only queued email has; the delivery log records none of them. */
const QUEUED_ONLY: ReadonlySet<OutcomeFilter> = new Set([
  "waiting",
  "retrying",
  "sending",
  "cancelled",
]);

/**
 * The query each list is asked, or `null` for a list the filters leave out.
 *
 * The delivery log is left out for a state only queued email has. Queued
 * email is left out while a provider is chosen: its list cannot be narrowed
 * by provider, and listing it unfiltered would show emails the filter does
 * not match.
 */
export function sourcesFor(
  filter: ActivityFilter,
  now: Date
): {
  deliveries: DeliveryActivityQuery | null;
  queued: QueuedEmailActivityQuery | null;
} {
  const window =
    TIME_WINDOWS.find(w => w.value === filter.window) ?? TIME_WINDOWS[1];
  const from = new Date(now.getTime() - window.ms).toISOString();
  const template = filter.template ? { template: filter.template } : {};
  const outcome = filter.outcome === "any" ? undefined : filter.outcome;

  const deliveries: DeliveryActivityQuery | null =
    outcome !== undefined && QUEUED_ONLY.has(outcome)
      ? null
      : {
          ...(outcome ? { outcome: outcome as DeliveryOutcome } : {}),
          ...template,
          ...(filter.provider
            ? "id" in filter.provider
              ? { providerId: filter.provider.id }
              : { providerType: filter.provider.type }
            : {}),
          from,
        };
  const queued: QueuedEmailActivityQuery | null = filter.provider
    ? null
    : {
        ...(outcome ? { state: outcome } : {}),
        ...template,
        from,
      };
  return { deliveries, queued };
}

/** A delivery record as a row. */
export function deliveryRow(record: DeliveryActivity): ActivityRow {
  return {
    source: "delivery",
    id: record.id,
    at: new Date(record.createdAt),
    outcome: record.outcome,
    templateSlug: record.templateSlug,
    provider: record.provider,
    recipientKind: record.recipientKind,
    failureReason: record.failureReason,
    namedPerson: record.namedPerson,
    erased: record.erased,
  };
}

/** A queued email as a row. */
export function queuedRow(record: QueuedEmailActivity): ActivityRow {
  return {
    source: "queued",
    id: record.id,
    at: new Date(record.createdAt),
    state: record.state,
    attempts: record.attempts,
    nextAttemptAt: record.nextAttemptAt ? new Date(record.nextAttemptAt) : null,
    lastFailureReason: record.lastFailure?.reason ?? null,
    messageHeld: record.messageHeld,
    templateSlug: record.templateSlug,
    queuedBy: record.queuedBy,
  };
}

/** One list's loaded rows, newest first, and whether it has more to load. */
export interface LoadedSource {
  rows: ActivityRow[];
  more: boolean;
}

/**
 * The loaded rows of every list as one list, newest first.
 *
 * A list with more to load could still hold a row newer than another list's
 * oldest loaded row, so nothing as old as its own oldest loaded row is shown
 * until it loads further: the merged list grows at its end and never has a
 * row appear above one already shown. A row at that very time is held too,
 * since the next page can hold another at the same time that sorts before it.
 */
export function mergeNewestFirst(
  sources: readonly LoadedSource[]
): ActivityRow[] {
  let frontier = -Infinity;
  for (const source of sources) {
    if (!source.more) continue;
    const oldest = source.rows[source.rows.length - 1];
    // A list with more and nothing loaded yet holds back everything.
    frontier = Math.max(frontier, oldest ? oldest.at.getTime() : Infinity);
  }
  return sources
    .flatMap(source => source.rows)
    .filter(row => row.at.getTime() > frontier)
    .sort(
      (a, b) =>
        b.at.getTime() - a.at.getTime() ||
        (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
    );
}

/** The queued states that can still change on their own, as the queue runs. */
const UNSETTLED: ReadonlySet<QueuedEmailState> = new Set([
  "waiting",
  "retrying",
  "sending",
]);

/**
 * Whether any of these rows is a queued email that can still change by
 * itself, so a list showing it has to be read again to stay true.
 */
export function holdsUnsettledQueued(rows: readonly ActivityRow[]): boolean {
  return rows.some(row => row.source === "queued" && UNSETTLED.has(row.state));
}

/** What happened to a row, in one line, with a detail and a note when it has them. */
export interface WhatHappened {
  title: string;
  detail?: string;
  note?: string;
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
function dueText(due: Date | null, now: Date, attempt: string): string {
  if (due === null) return `${attempt} not scheduled`;
  const ms = due.getTime() - now.getTime();
  return ms >= 0
    ? `${attempt} in ${spanText(ms)}`
    : `${attempt} overdue by ${spanText(-ms)}`;
}

/** The row's "what happened" line. */
export function whatHappened(row: ActivityRow, now: Date): WhatHappened {
  if (row.source === "delivery") {
    return row.outcome === "sent"
      ? { title: "Sent" }
      : {
          title: "Failed",
          detail: row.failureReason ?? "No reason was given.",
        };
  }
  const failure = row.lastFailureReason ?? undefined;
  switch (row.state) {
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
      return {
        title: "Failed",
        ...(failure ? { detail: failure } : {}),
        ...(row.messageHeld
          ? {}
          : { note: "Its message was cleared, so it can't be sent again." }),
      };
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
  const value = row.source === "delivery" ? row.outcome : row.state;
  switch (value) {
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
