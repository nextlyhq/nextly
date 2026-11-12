/**
 * What became of a submission's notifications, as its page and a
 * notification's recent sends say it: one reading of a send's stored
 * outcome, shared by the server that answers the routes and the screens that
 * draw them, so the two cannot come to disagree about what "Partly sent" or
 * "Sent after 2 retries" means.
 *
 * A send is stored as `form-submission-sends` keeps it (`StoredSend`): where
 * it stands, its attempts, and each recipient with what became of it. Each
 * recipient reads as one of Waiting, Retrying, Sending, Sent (after N
 * retries), Failed or Cancelled, and a notification as the one its
 * recipients share, or Partly sent when they differ.
 *
 * @module utils/send-status
 */

/** Where a send stands, as stored. */
export type SendState =
  | "waiting"
  | "retrying"
  | "sending"
  | "sent"
  | "failed"
  | "cancelled";

/** The states in which another attempt may still come. */
const IN_PROGRESS: ReadonlySet<SendState> = new Set([
  "waiting",
  "retrying",
  "sending",
]);

/**
 * Why a send was cancelled: a person (in Settings › Email), the submission
 * marked Spam, an erasure, or a cancel the plugin made for another reason.
 */
export type CancelCause =
  | { by: "person"; userId: string | null }
  | { by: "spam" }
  | { by: "erasure" }
  | { by: "sender" }
  | { by: "request" };

/** Where a recipient came from: the notification's own lines, or a filter. */
export type RecipientSource = "team" | "visitor" | "cc" | "bcc" | "added";

/** One recipient of a send, as stored: a hint and a digest, never an address. */
export interface StoredRecipient {
  digest: string;
  hint: string;
  kind: "to" | "cc" | "bcc";
  source: RecipientSource;
  /** What became of it, once a provider was asked. */
  outcome?: "accepted" | "refused" | "unknown" | "skipped";
  /** The retries recorded before it was accepted. */
  retries?: number;
}

/** A send as `form-submission-sends` keeps it. */
export interface StoredSend {
  queuedId: string;
  notification?: string | null;
  notificationName?: string | null;
  state?: SendState | null;
  attempts?: number | null;
  /** The attempts recorded as failing in a way a retry could help. */
  retries?: number | null;
  changedAt?: string | null;
  createdAt?: string | null;
  cancel?: CancelCause | null;
  /** A cancel asked while an attempt was with the provider. */
  cancelRequested?: CancelCause | null;
  retiredBy?: string | null;
  configured?: StoredRecipient[] | null;
  recipients?: StoredRecipient[] | null;
  requestedBy?: string | null;
}

/** One recipient's latest result, as a page shows it. */
export interface RecipientStatus {
  digest: string;
  hint: string;
  kind: StoredRecipient["kind"];
  source: RecipientSource;
  state: SendState;
  /** Attempts before the one that sent it; 0 for the first. */
  retries: number;
  at: string | null;
  cancel?: CancelCause;
}

/** Where a send stands, an unrecorded one read as waiting. */
function stateOf(send: StoredSend): SendState {
  return send.state ?? "waiting";
}

/** Whether another attempt at `send` may still come. */
export function sendInProgress(send: StoredSend): boolean {
  return IN_PROGRESS.has(stateOf(send));
}

/** The recipients a send lists: those it went to, else those it was for. */
function listedOf(send: StoredSend): StoredRecipient[] {
  const sent = send.recipients ?? [];
  return sent.length > 0 ? sent : (send.configured ?? []);
}

/** A recipient's state in one send, from its outcome and the send's state. */
function recipientState(
  send: StoredSend,
  recipient: StoredRecipient
): SendState {
  if (recipient.outcome === "accepted") return "sent";
  const state = stateOf(send);
  // The send went out, and this recipient was refused or not answered for.
  if (state === "sent") return "failed";
  return state;
}

/** One recipient's result in one send. */
function statusIn(
  send: StoredSend,
  recipient: StoredRecipient
): RecipientStatus {
  const state = recipientState(send, recipient);
  return {
    digest: recipient.digest,
    hint: recipient.hint,
    kind: recipient.kind,
    source: recipient.source,
    state,
    retries: state === "sent" ? (recipient.retries ?? 0) : 0,
    at: send.changedAt ?? send.createdAt ?? null,
    ...(state === "cancelled" && send.cancel ? { cancel: send.cancel } : {}),
  };
}

/**
 * Every recipient a notification's sends had for a submission, each with its
 * latest result, oldest first. A recipient a send left out (one Resend found
 * already reached) keeps the result it had.
 */
export function latestByRecipient(
  sends: readonly StoredSend[]
): RecipientStatus[] {
  const latest = new Map<string, RecipientStatus>();
  for (const send of sends) {
    for (const recipient of listedOf(send)) {
      if (recipient.outcome === "skipped") continue;
      latest.set(recipient.digest, statusIn(send, recipient));
    }
  }
  return [...latest.values()];
}

/** How a status is drawn: its words and the tone of its dot. */
export interface StatusLook {
  label: string;
  tone: "ok" | "warn" | "bad" | "quiet";
}

/** A recipient's status in words. */
export function recipientLook(status: RecipientStatus): StatusLook {
  switch (status.state) {
    case "sent":
      return status.retries === 0
        ? { label: "Sent", tone: "ok" }
        : {
            label: `Sent after ${status.retries} ${status.retries === 1 ? "retry" : "retries"}`,
            tone: "warn",
          };
    case "failed":
      return { label: "Failed", tone: "bad" };
    case "cancelled":
      return { label: "Cancelled", tone: "quiet" };
    case "sending":
      return { label: "Sending", tone: "quiet" };
    case "retrying":
      return { label: "Retrying", tone: "warn" };
    default:
      return { label: "Waiting", tone: "quiet" };
  }
}

/**
 * A notification's status in words: the one its recipients share, or Partly
 * sent when they differ. Recipients all sent read as the one that took the
 * most retries.
 */
export function notificationLook(
  statuses: readonly RecipientStatus[]
): StatusLook {
  const [first] = statuses;
  if (!first) return { label: "Waiting", tone: "quiet" };
  if (!statuses.every(status => status.state === first.state)) {
    return { label: "Partly sent", tone: "warn" };
  }
  const most = statuses.reduce(
    (latest, status) => (status.retries > latest.retries ? status : latest),
    first
  );
  return recipientLook(most);
}

/** Why a send was cancelled, in words. */
export function cancelText(cancel: CancelCause | undefined): string {
  switch (cancel?.by) {
    case "person":
      return "Cancelled in Settings › Email";
    case "spam":
      return "Cancelled when the submission was marked Spam";
    case "erasure":
      return "Cancelled when the address was erased";
    default:
      return "Cancelled";
  }
}
