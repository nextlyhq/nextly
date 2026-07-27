/**
 * Webhook domain — status-transition event decision (pure).
 *
 * Given one status transition, returns the webhook event types it emits, in
 * delivery order. Kept pure (no I/O) so the emit rules are exhaustively unit
 * tested without a database. The recording seam (collection-mutation-service)
 * turns each returned type into an outbox event inside the write transaction.
 *
 * @module domains/webhooks/status-events
 */
import type { WebhookEventType } from "./types";

/** One status transition. `from` is null on create or when status was unset. */
export interface StatusTransition {
  from: string | null;
  to: string;
  /** True for a create; a brand-new row has no prior status to "change" from. */
  isCreate: boolean;
}

const PUBLISHED = "published";

/**
 * The event types a transition emits. Empty when nothing changed. A publish/
 * unpublish emits its specific event AND the generic `entry.status_changed`; a
 * create-as-published emits only `entry.published` (no "change" from nothing);
 * any other status change emits `entry.status_changed` alone.
 */
export function statusEventsFor(t: StatusTransition): WebhookEventType[] {
  if (t.isCreate) {
    // Only a create landing directly on published is a lifecycle event; there
    // is no prior status, so no status_changed and no unpublish.
    return t.to === PUBLISHED ? ["entry.published"] : [];
  }
  if (t.from === t.to) return [];
  if (t.to === PUBLISHED) return ["entry.published", "entry.status_changed"];
  if (t.from === PUBLISHED)
    return ["entry.unpublished", "entry.status_changed"];
  return ["entry.status_changed"];
}
