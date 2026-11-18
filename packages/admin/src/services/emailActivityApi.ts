/**
 * The Email hub's Activity reads: the delivery log, queued email, and whether
 * queued email is overdue because the jobs trigger is not running.
 *
 * Every read needs `read-email-deliveries`; the server refuses without it.
 * Nothing here carries an address, a subject or a body: the server never
 * returns one on these routes, and these types name no field that could.
 *
 * The shapes mirror core's `DeliveryActivity`, `QueuedEmailActivity` and
 * `QueuedEmailOverdue` as JSON: the admin is built apart from core and reads
 * them off the wire, so times arrive as ISO strings.
 *
 * @module services/emailActivityApi
 */

import { fetcher } from "../lib/api/fetcher";
import type { ListResponse } from "../lib/api/response-types";

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
  /**
   * The stored provider that carried it, while it is still stored (`id`),
   * and its registered type, which outlives it.
   */
  provider: { id: string | null; type: string };
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
  provider: { id: string | null; type: string };
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

/** How the delivery log is narrowed. Times are ISO 8601 instants. */
export interface DeliveryActivityQuery {
  outcome?: DeliveryOutcome;
  template?: string;
  providerId?: string;
  providerType?: string;
  from?: string;
  to?: string;
  before?: string;
  limit?: number;
}

/** How queued email is narrowed. Times are ISO 8601 instants. */
export interface QueuedEmailActivityQuery {
  state?: QueuedEmailState;
  template?: string;
  from?: string;
  to?: string;
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

/** The delivery log, newest first, a page at a time. */
export function listDeliveryActivity(
  query: DeliveryActivityQuery = {}
): Promise<ListResponse<DeliveryActivity>> {
  return fetcher<ListResponse<DeliveryActivity>>(
    `/email-deliveries${queryString(query)}`,
    {},
    true
  );
}

/** Queued email, newest first, a page at a time. */
export function listQueuedEmailActivity(
  query: QueuedEmailActivityQuery = {}
): Promise<ListResponse<QueuedEmailActivity>> {
  return fetcher<ListResponse<QueuedEmailActivity>>(
    `/email-deliveries/queued${queryString(query)}`,
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
