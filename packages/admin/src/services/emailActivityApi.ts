/**
 * The Email hub's Activity reads: the merged Activity of queued email and
 * the deliveries of sends that were not queued, each row's detail, and
 * whether queued email is overdue because the jobs trigger is not running.
 *
 * Every read needs `read-email-deliveries`; the server refuses without it.
 * Nothing here carries an address, a subject or a body: the server never
 * returns one on these routes, and these types name no field that could.
 *
 * The shapes mirror core's `ActivityEntry`, its detail reads and
 * `QueuedEmailOverdue` as JSON: the admin is built apart from core and reads
 * them off the wire, so times arrive as ISO strings.
 *
 * @module services/emailActivityApi
 */

import { fetcher } from "../lib/api/fetcher";
import type { ListResponse } from "../lib/api/response-types";

/**
 * Where a provider came from: a stored one, one set in the app's code, a
 * stored one deleted since, or not recorded (a record from before origins
 * were kept).
 */
export type ProviderOrigin = "stored" | "code" | "deleted" | "not-recorded";

/** The origins the Activity can be narrowed by; a row not recorded matches none. */
export type FilterableOrigin = Exclude<ProviderOrigin, "not-recorded">;

/**
 * The provider that carried a send: the stored one's id only while it
 * exists, its registered type, which outlives it, and where it came from.
 */
export interface ActivityProvider {
  id: string | null;
  type: string;
  origin: ProviderOrigin;
}

/** What happened to one recipient of one send. */
export type DeliveryOutcome = "sent" | "failed";

/** Where a queued email stands. */
export type QueuedEmailState =
  | "waiting"
  | "retrying"
  | "sending"
  | "sent"
  | "failed"
  | "cancelled";

/** To, Cc or Bcc. */
export type RecipientKind = "to" | "cc" | "bcc";

/** One delivery record: one recipient of one send. */
export interface DeliveryActivity {
  id: string;
  createdAt: string;
  outcome: DeliveryOutcome;
  /** The template it was sent from, or null for a send without one. */
  templateSlug: string | null;
  provider: ActivityProvider;
  recipientKind: RecipientKind;
  /** Why it failed, with anything address-shaped removed; null when sent. */
  failureReason: string | null;
  /** Whether the send named a person on the site as this recipient. */
  namedPerson: boolean;
  /** Whether this recipient has been erased since. */
  erased: boolean;
}

/** A failed attempt's failure, with no address in it. */
export interface EmailFailure {
  /** Whether sending again later can succeed. */
  retryable: boolean;
  /** The provider's status: an HTTP status, or an SMTP reply code. */
  status?: number;
  reason: string;
  /** Whether the email arrived cannot be known. */
  unknown?: true;
}

/** One queued email. */
export interface QueuedEmailActivity {
  id: string;
  createdAt: string;
  updatedAt: string;
  /** When it was sent, failed for good, or was cancelled. */
  settledAt: string | null;
  state: QueuedEmailState;
  /**
   * Attempts made so far, the one in flight included; null when the job that
   * counted them has since been pruned, so the count is no longer known.
   */
  attempts: number | null;
  /** When the next attempt is due, while one is to follow. */
  nextAttemptAt: string | null;
  lastFailure: EmailFailure | null;
  /** Whether its message is still held, so it could still be sent. */
  messageHeld: boolean;
  /** The template it is sent from; null without one, or when not recorded. */
  templateSlug: string | null;
  /** Who queued it: `site`, `core`, or `plugin:<name>`. */
  queuedBy: string;
}

/**
 * Which version of its template a send used: the template's owner, whether
 * the site had overridden it, and a digest of the version as saved (a draft
 * test send has no saved version); `none` for a send without a template;
 * `not-recorded` for a send from before versions were recorded.
 */
export type TemplateVersion =
  | {
      owner: string;
      overridden: boolean;
      digest: string | null;
      draft?: true;
    }
  | "none"
  | "not-recorded";

/** How a provider answered a failure, structured: never its own text. */
export type DeliveryFailureKind = "retryable" | "refused" | "unknown";

/** One attempt on a detail sheet's timeline, oldest first. */
export interface DeliveryAttempt {
  id: string;
  createdAt: string;
  outcome: DeliveryOutcome;
  recipientKind: RecipientKind;
  provider: ActivityProvider;
  failureKind: DeliveryFailureKind | null;
  failureStatus: number | null;
  /** Core's sentence for the failure, with anything address-shaped removed. */
  failureReason: string | null;
  templateVersion: TemplateVersion;
  erased: boolean;
}

/** A delivery's detail sheet. */
export interface DeliveryDetail extends DeliveryActivity {
  /** The queued email this was an attempt of, when it was one. */
  queuedId: string | null;
  templateVersion: TemplateVersion;
  failureKind: DeliveryFailureKind | null;
  failureStatus: number | null;
  /** Every attempt of its queued email, or itself alone. */
  timeline: DeliveryAttempt[];
  /** Whether the timeline stopped at its limit, its oldest left out. */
  timelineTruncated: boolean;
}

/** A queued email's detail sheet. */
export interface QueuedEmailDetail extends QueuedEmailActivity {
  /** Whether its last failure came from its template, for "Fix template". */
  templateCaused: boolean;
  /** The template version its latest attempt sent; null before any. */
  templateVersion: TemplateVersion | null;
  timeline: DeliveryAttempt[];
  timelineTruncated: boolean;
}

/** Whether queued email is waiting on a jobs trigger that is not running. */
export interface QueuedEmailOverdue {
  /** Queued emails more than `warningAfterMinutes` past due. */
  overdue: number;
  /** Whether `overdue` stopped counting at its ceiling. */
  capped: boolean;
  warningAfterMinutes: number;
}

/**
 * One row of the merged Activity: a queued email, or a delivery of a send
 * that was not queued. A queued email's own deliveries are its timeline, in
 * its detail, not rows of their own.
 */
export interface ActivityEntry {
  kind: "delivery" | "queued";
  id: string;
  createdAt: string;
  /** A delivery's outcome, or where a queued email stands. */
  status: DeliveryOutcome | QueuedEmailState;
  /** Its template; `none` for a message without one; `not-recorded` when unknown. */
  template: { slug: string } | "none" | "not-recorded";
  /** Its provider; null for a queued email not yet tried. */
  provider: ActivityProvider | null;
  /** The kinds of recipient it went to; null when not recorded. */
  recipientKinds: RecipientKind[] | null;
  /** Why it (last) failed, with nothing address-shaped in it. */
  failureReason: string | null;
  /** A queued email's attempts so far; null for a delivery, or when unknown. */
  attempts: number | null;
  /** When a queued email's next attempt is due, while one is to follow. */
  nextAttemptAt: string | null;
  /** Whether a delivery's recipient has been erased since. */
  erased: boolean;
}

/** How the merged Activity is narrowed. Times are ISO 8601 instants. */
export interface ActivityQuery {
  status?: DeliveryOutcome | QueuedEmailState;
  template?: string;
  /** A provider's registered type. */
  providerType?: string;
  providerOrigin?: FilterableOrigin;
  from?: string;
  to?: string;
  /** The `meta.nextBefore` of the page before. */
  before?: string;
  limit?: number;
}

/** A query string of the values given, in the order given. */
function queryString(query: object): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

/**
 * The merged Activity, newest first, under one cursor and one set of filters,
 * a page at a time.
 */
export function listActivity(
  query: ActivityQuery = {}
): Promise<ListResponse<ActivityEntry>> {
  return fetcher<ListResponse<ActivityEntry>>(
    `/email-deliveries/activity${queryString(query)}`,
    {},
    true
  );
}

/** Whether queued email is overdue because the jobs trigger is not running. */
export function getQueuedEmailOverdue(): Promise<QueuedEmailOverdue> {
  return fetcher<QueuedEmailOverdue>("/email-deliveries/overdue", {}, true);
}

/** One delivery's detail sheet: its timeline, its provider's answer and its template version. */
export function getDeliveryDetail(id: string): Promise<DeliveryDetail> {
  return fetcher<DeliveryDetail>(
    `/email-deliveries/${encodeURIComponent(id)}`,
    {},
    true
  );
}

/** One queued email's detail sheet. */
export function getQueuedEmailDetail(id: string): Promise<QueuedEmailDetail> {
  return fetcher<QueuedEmailDetail>(
    `/email-deliveries/queued/${encodeURIComponent(id)}`,
    {},
    true
  );
}
