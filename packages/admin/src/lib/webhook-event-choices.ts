/**
 * The event types a webhook screen offers: every type the server lists, and
 * any type already chosen that it no longer lists, kept and marked
 * unavailable.
 *
 * A type drops out of the server's list when the plugin that declares it is
 * disabled or removed. An endpoint stored with it keeps the subscription, so a
 * screen must still show it by name. Dropping it would make the next save
 * remove it unseen, and a row naming nothing would read as broken.
 *
 * @module lib/webhook-event-choices
 */
import type {
  WebhookEventType,
  WebhookEventTypeEntry,
} from "@admin/types/webhooks";

/** One event type a screen offers. */
export interface WebhookEventChoice {
  type: WebhookEventType;
  /** What to call it: the server's label, else the type's id. */
  label: string;
  /** Chosen before, but no longer one an endpoint may subscribe to. */
  unavailable: boolean;
}

/** The listed types in the server's order, then each unlisted chosen one. */
export function webhookEventChoices(
  listed: readonly WebhookEventTypeEntry[],
  chosen: readonly WebhookEventType[]
): WebhookEventChoice[] {
  const known = new Set(listed.map(entry => entry.type));
  return [
    ...listed.map(entry => ({
      type: entry.type,
      label: entry.label ?? entry.type,
      unavailable: false,
    })),
    ...chosen
      .filter(type => !known.has(type))
      .map(type => ({ type, label: type, unavailable: true })),
  ];
}
