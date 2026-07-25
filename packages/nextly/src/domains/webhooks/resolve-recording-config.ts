/**
 * Webhook domain — recording-policy normalizer.
 *
 * Normalizes a collection/single's `webhooks` option into one resolved shape so
 * every consumer reads `{ record }` and never branches on the raw
 * `boolean | { record?: boolean }` union. Mirrors
 * `domains/versions/resolve-config.ts`: the raw option is author-facing sugar;
 * the resolved shape is what the runtime reads.
 *
 * @module domains/webhooks/resolve-recording-config
 */

/** The resolved webhook recording policy for one collection/single. */
export interface ResolvedWebhookRecording {
  /** Whether writes to this entity are recorded to the webhook outbox. */
  record: boolean;
}

/**
 * Resolve the `webhooks` option to its canonical shape. The default is to
 * RECORD: an entity that never sets the option keeps emitting outbox events, so
 * this is a purely additive opt-out. `false` (or `{ record: false }`) suppresses
 * all outbox recording for the entity — used to keep PII-bearing content (e.g.
 * form submissions) out of the delivery path.
 */
export function resolveWebhookRecording(
  webhooks: boolean | { record?: boolean } | undefined
): ResolvedWebhookRecording {
  // Only an explicit boolean `false`, or an object whose `record` is exactly
  // `false`, opts out. Every other value falls back to recording — the safe
  // default. This tolerates untyped JS configs: a malformed `null` never throws
  // (as `null.record` would), and a non-boolean `record` (e.g. the string
  // "false") is ignored rather than escaping the boolean return as a truthy
  // value. The result is always a real boolean.
  if (webhooks === false) return { record: false };
  if (
    typeof webhooks === "object" &&
    webhooks !== null &&
    webhooks.record === false
  ) {
    return { record: false };
  }
  return { record: true };
}
