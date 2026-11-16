/**
 * What a plugin is told about the email it queued, as each one changes.
 *
 * A plugin that queues email about something of its own (a form's
 * notifications, say) keeps what became of each send beside that thing, for
 * as long as the thing exists: core's delivery log keeps no address and is
 * pruned. So each change of one of its queued emails is handed to the plugin
 * inside the transaction that makes it, and what the plugin writes there
 * commits or rolls back with the change: its record cannot fall behind the
 * send, nor run ahead of it.
 *
 * - **Its own sends only.** Handlers are registered for a scope (the
 *   plugin's, `plugin:<name>`), and a change is handed only to the handlers
 *   of the scope that queued the email.
 * - **Per final recipient.** The recipients a change lists are the ones the
 *   send went to after `email.beforeSend` filters ran, each with its line,
 *   what became of it, a masked hint for a screen, and the plugin's own keyed
 *   digest of the mailbox (`ctx.security.digests`, purpose
 *   {@link RECIPIENT_DIGEST_PURPOSE}), which stays the same across rotations
 *   of the install's secret. No address leaves the send.
 * - **Repeated, never skipped.** A change whose transaction rolls back (a
 *   handler that throws among them) is made again by the next attempt, so a
 *   handler writes as an upsert keyed by the queued id and the digest.
 *
 * @module domains/email/queued-send-changes
 */

import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import type { EmailDeliveryRecipientKind } from "./delivery-record";
import { mailboxOf } from "./delivery-record";
import type { EmailFailure } from "./failure";

/** The purpose a plugin's recipient digests are taken under. */
export const RECIPIENT_DIGEST_PURPOSE = "email-recipient";

/**
 * @experimental What became of one final recipient: `accepted` and
 * `refused` are the provider's answers, `unknown` a call that ended without
 * one (a retry may find it was delivered), and `skipped` a recipient the send
 * left out because the caller excluded it (`excludeRecipients`).
 */
export type QueuedRecipientOutcome =
  | "accepted"
  | "refused"
  | "unknown"
  | "skipped";

/** @experimental One final recipient of a queued email, as a change lists it. */
export interface QueuedEmailRecipient {
  /** The line it was on: `to`, `cc` or `bcc`. */
  kind: EmailDeliveryRecipientKind;
  outcome: QueuedRecipientOutcome;
  /** The mailbox masked for a screen, such as `j•••@example.com`. */
  hint: string;
  /**
   * The plugin's own keyed digest of the mailbox, lower-cased: what
   * `recipientDigest` gives for the address, and what `excludeRecipients`
   * takes.
   */
  digest: string;
}

/**
 * @experimental Why a queued email was cancelled.
 *
 * - `person`: a person cancelled it, by their user id (null when the site's
 *   own code cancelled it without naming one).
 * - `sender`: the plugin that queued it forgot it (`forgetSends`).
 * - `request`: a cancel reached it while an attempt was with the provider,
 *   reported then with its own cause (see `cancelRequested`); that attempt
 *   failed, so it was not tried again.
 */
export type QueuedEmailCancelCause =
  | { by: "person"; userId: string | null }
  | { by: "sender" }
  | { by: "request" };

/**
 * @experimental A change of a queued email, as its plugin is told it.
 *
 * - `sending`: attempt `attempt` is starting, or, with `cancelRequested`, a
 *   cancel reached the attempt already with the provider: it ends `sent` if
 *   the provider takes it and `cancelled` if it fails.
 * - `retrying`: attempt `attempt` failed in a way a retry can help; another
 *   follows.
 * - `sent`, `failed`, `cancelled`: settled, with no attempt to follow.
 */
export interface QueuedEmailChange {
  queuedId: string;
  /** The key the plugin queued it with, when it gave one. */
  idempotencyKey?: string;
  state: "sending" | "retrying" | "sent" | "failed" | "cancelled";
  /** Attempts made so far, this one included; 0 before the first. */
  attempt: number;
  at: Date;
  /** Every final recipient, where a provider was asked (or none was needed). */
  recipients?: QueuedEmailRecipient[];
  /** Why an attempt did not succeed, with no address in it. */
  failure?: EmailFailure;
  /** Why it was cancelled, on `cancelled`. */
  cancel?: QueuedEmailCancelCause;
  /** A cancel that reached an attempt in flight, on `sending`. */
  cancelRequested?: QueuedEmailCancelCause;
}

/** A change's handler, as core holds it: handed the change's transaction. */
export type QueuedEmailChangeRunner = (
  change: QueuedEmailChange,
  tx: TransactionContext
) => Promise<void>;

/** A scope's digest of a mailbox, for its changes and its exclusions. */
export type RecipientDigester = (mailbox: string) => Promise<string>;

const runners = new Map<string, Set<QueuedEmailChangeRunner>>();
const digesters = new Map<string, RecipientDigester>();

/**
 * Hand every change of `scope`'s queued emails to `runner`. Returns the
 * undo, which a plugin's teardown calls.
 */
export function onQueuedEmailChange(
  scope: string,
  runner: QueuedEmailChangeRunner
): () => void {
  const set = runners.get(scope) ?? new Set<QueuedEmailChangeRunner>();
  set.add(runner);
  runners.set(scope, set);
  return () => {
    set.delete(runner);
    if (set.size === 0 && runners.get(scope) === set) runners.delete(scope);
  };
}

/**
 * Take `scope`'s recipient digests with `digester`. Returns the undo, which
 * removes it only while it is still the one registered.
 */
export function useRecipientDigester(
  scope: string,
  digester: RecipientDigester
): () => void {
  digesters.set(scope, digester);
  return () => {
    if (digesters.get(scope) === digester) digesters.delete(scope);
  };
}

/** `scope`'s digester, or undefined for a caller with no digest key. */
export function recipientDigesterOf(
  scope: string
): RecipientDigester | undefined {
  return digesters.get(scope);
}

/** Whether anything is told of `scope`'s changes. */
export function changesObserved(scope: string): boolean {
  return (runners.get(scope)?.size ?? 0) > 0;
}

/**
 * Hand `change` to every handler of `scope`, in turn, inside `tx`. A handler
 * that throws fails the transaction, and the change with it.
 */
export async function notifyQueuedEmailChange(
  tx: TransactionContext,
  scope: string,
  change: QueuedEmailChange
): Promise<void> {
  for (const runner of [...(runners.get(scope) ?? [])]) {
    await runner(change, tx);
  }
}

/** The mailbox as it is compared and digested: bare and lower-cased. */
export function comparableMailbox(address: string): string {
  return mailboxOf(address).trim().toLowerCase();
}

/**
 * A mailbox masked for a screen: its first character, then `•••`, then its
 * domain (`j•••@example.com`). A mailbox with no `@` keeps only `•••`.
 */
function maskedMailbox(address: string): string {
  const mailbox = mailboxOf(address);
  const at = mailbox.lastIndexOf("@");
  if (at <= 0) return "•••";
  return `${mailbox.slice(0, 1)}•••${mailbox.slice(at)}`;
}

/** A final recipient as the send reports it, its address in memory only. */
export interface FinalRecipient {
  address: string;
  kind: EmailDeliveryRecipientKind;
  outcome: QueuedRecipientOutcome;
}

/**
 * The recipients a change lists, from the send's final recipients: masked,
 * and digested with `scope`'s digester. Undefined when `scope` has none.
 */
export async function changeRecipients(
  scope: string,
  finals: readonly FinalRecipient[]
): Promise<QueuedEmailRecipient[] | undefined> {
  const digester = recipientDigesterOf(scope);
  if (!digester) return undefined;
  const listed: QueuedEmailRecipient[] = [];
  for (const final of finals) {
    listed.push({
      kind: final.kind,
      outcome: final.outcome,
      hint: maskedMailbox(final.address),
      digest: await digester(comparableMailbox(final.address)),
    });
  }
  return listed;
}
