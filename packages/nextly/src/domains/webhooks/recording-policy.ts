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
 * A fresh boot (and each test) must `resetWebhookRecordingPolicy()` so one
 * instance's opt-outs never leak into the next.
 *
 * @module domains/webhooks/recording-policy
 */

/** The entity kinds that can carry a per-entity recording opt-out. */
export type WebhookRecordingScope = "collection" | "single";

/**
 * Who set a decision. `code` decisions come from the code-first config and are
 * reconciled on every reload (a slug removed from config is pruned). `plugin`
 * decisions come from a plugin's contributed config, which is NOT re-evaluated
 * on HMR, so they must survive a code-first reconcile.
 */
export type WebhookRecordingSource = "code" | "plugin";

interface PolicyEntry {
  record: boolean;
  source: WebhookRecordingSource;
}

// Keyed by `${scope}:${slug}`; absence means "record" (the default), so only
// explicit opt-outs (and opt-ins) are stored.
//
// Stored on `globalThis`, mirroring the event bus / hook registry: Next.js and
// Turbopack can evaluate this module in more than one server module graph (and
// HMR re-evaluates it), so a module-local Map risks `registerServices()`
// populating one instance while `recordMutationEvent()` reads another — where a
// missing entry defaults to recording and a `webhooks: false` collection would
// silently write PII. A single global map keeps the decisions visible to every
// reader.
const globalForRecording = globalThis as unknown as {
  __nextly_webhookRecordingPolicy?: Map<string, PolicyEntry>;
};
if (!globalForRecording.__nextly_webhookRecordingPolicy) {
  globalForRecording.__nextly_webhookRecordingPolicy = new Map<
    string,
    PolicyEntry
  >();
}
const policy = globalForRecording.__nextly_webhookRecordingPolicy;

const keyFor = (scope: WebhookRecordingScope, slug: string): string =>
  `${scope}:${slug}`;

/**
 * Publish a collection/single's resolved recording decision. `source` defaults
 * to `code`; pass `plugin` for a plugin-contributed entity so a later code-first
 * reconcile does not prune it.
 */
export function setWebhookRecording(
  scope: WebhookRecordingScope,
  slug: string,
  record: boolean,
  source: WebhookRecordingSource = "code"
): void {
  policy.set(keyFor(scope, slug), { record, source });
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
  return policy.get(keyFor(scope, slug))?.record ?? true;
}

/**
 * Drop every `code`-sourced decision whose `${scope}:${slug}` key is not in
 * `presentKeys`. Used on reload to clear a code-first entity removed from the
 * config: its DB table can survive (the reload merges registered tables back),
 * so a stale opt-out would otherwise suppress its events until restart. `plugin`
 * decisions are never pruned here.
 */
export function pruneRemovedCodeFirstRecording(presentKeys: Set<string>): void {
  for (const [key, entry] of policy) {
    if (entry.source === "code" && !presentKeys.has(key)) {
      policy.delete(key);
    }
  }
}

/** The `${scope}:${slug}` key for a decision, for building a present-key set. */
export function webhookRecordingKey(
  scope: WebhookRecordingScope,
  slug: string
): string {
  return keyFor(scope, slug);
}

/** Clear every registered decision (boot/test reset). */
export function resetWebhookRecordingPolicy(): void {
  policy.clear();
}
