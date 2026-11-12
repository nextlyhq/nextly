/**
 * What a notification's send records as it is queued, beside its queued
 * email and key: which form and notification sent it, the notification's
 * name as it was then, and who it was configured for.
 *
 * Each configured recipient is kept by the plugin's keyed digest of its
 * mailbox (`ctx.services.email.recipientDigest`, the digest core's changes
 * carry and `excludeRecipients` takes) and a masked hint, never the address,
 * with the line it was on and where it came from: the team's addresses, the
 * visitor's answer, or a copy. A recipient a send filter adds is not here;
 * it arrives with the send's first change and reads as added.
 *
 * @module handlers/send-record
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";

import type { FormEmailNotification, FormNotification } from "../types";
import type { RecipientSource, StoredRecipient } from "../utils/send-status";

import type { RecordedSend } from "./forget-sends";

/**
 * A mailbox masked for a screen: its first character, then `•••`, then its
 * domain (`j•••@example.com`), as core masks the recipients it reports.
 */
export function maskedAddress(address: string): string {
  const angled = /<([^<>]*)>\s*$/.exec(address.trim());
  const mailbox = (angled?.[1] ?? address).trim();
  const at = mailbox.lastIndexOf("@");
  if (at <= 0) return "•••";
  return `${mailbox.slice(0, 1)}•••${mailbox.slice(at)}`;
}

/** Every address on a line of an outgoing email. */
function addressesOf(value: string | readonly string[] | undefined): string[] {
  if (value === undefined) return [];
  return (typeof value === "string" ? [value] : [...value]).filter(
    address => address.trim() !== ""
  );
}

/** The configured recipients of `email`, digested and masked. */
export async function configuredRecipients(
  email: Pick<FormEmailNotification, "to" | "cc" | "bcc">,
  toSource: RecipientSource,
  digest: (address: string) => Promise<string>
): Promise<StoredRecipient[]> {
  const lines: Array<{
    kind: StoredRecipient["kind"];
    source: RecipientSource;
    addresses: string[];
  }> = [
    { kind: "to", source: toSource, addresses: addressesOf(email.to) },
    { kind: "cc", source: "cc", addresses: addressesOf(email.cc) },
    { kind: "bcc", source: "bcc", addresses: addressesOf(email.bcc) },
  ];
  const listed: StoredRecipient[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    for (const address of line.addresses) {
      const recipient = await digest(address);
      if (seen.has(recipient)) continue;
      seen.add(recipient);
      listed.push({
        digest: recipient,
        hint: maskedAddress(address),
        kind: line.kind,
        source: line.source,
      });
    }
  }
  return listed;
}

/**
 * What a notification's queued send records beside its queued email: the
 * form and notification, the notification's name then, and its configured
 * recipients, waiting for their first attempt.
 */
export async function notificationSendDetails(
  ctx: Pick<PluginContext, "services">,
  input: {
    formId: string;
    notifications: readonly FormNotification[];
    email: FormEmailNotification;
  }
): Promise<Omit<RecordedSend, "queuedId" | "sendKey">> {
  const notification = input.notifications.find(
    candidate => candidate.id === input.email.notificationId
  );
  return {
    form: input.formId,
    ...(input.email.notificationId
      ? { notification: input.email.notificationId }
      : {}),
    ...(notification?.name ? { notificationName: notification.name } : {}),
    state: "waiting",
    configured: await configuredRecipients(
      input.email,
      notification?.recipientType === "field" ? "visitor" : "team",
      address => ctx.services.email.recipientDigest(address)
    ),
  };
}
