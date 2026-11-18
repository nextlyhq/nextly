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
  /** Attempts made so far, the one in flight included. */
  attempts: number;
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
