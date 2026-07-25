/**
 * Webhook domain — process-level recording policy.
 *
 * A collection/single can opt OUT of webhook recording (`webhooks: false`).
 * Because the outbox choke point (`recordMutationEvent`) is a pure function with
 * only the event `resource` in hand — not the entity's config — the resolved
 * policy is published to this process-level registry at registration time and
 * read back by slug at the choke point. Every write path therefore inherits the
 * gate without threading a flag through each call site.
 *
 * A module singleton like the event bus and hook registry: a fresh boot (and
 * each test) must `resetWebhookRecordingPolicy()` so one instance's opt-outs
 * never leak into the next.
 *
 * @module domains/webhooks/recording-policy
 */

/** The entity kinds that can carry a per-entity recording opt-out. */
export type WebhookRecordingScope = "collection" | "single";

// Keyed by `${scope}:${slug}`; absence means "record" (the default), so only
// explicit opt-outs (and opt-ins) are stored.
const policy = new Map<string, boolean>();

const keyFor = (scope: WebhookRecordingScope, slug: string): string =>
  `${scope}:${slug}`;

/** Publish a collection/single's resolved recording decision. */
export function setWebhookRecording(
  scope: WebhookRecordingScope,
  slug: string,
  record: boolean
): void {
  policy.set(keyFor(scope, slug), record);
}

/**
 * Whether writes to this collection/single are recorded to the outbox. Defaults
 * to true for any slug never registered, so normal collections and un-scoped
 * resources (media, etc.) always record.
 */
export function isWebhookRecordingEnabled(
  scope: WebhookRecordingScope,
  slug: string
): boolean {
  return policy.get(keyFor(scope, slug)) ?? true;
}

/** Clear every registered decision (boot/test reset). */
export function resetWebhookRecordingPolicy(): void {
  policy.clear();
}
