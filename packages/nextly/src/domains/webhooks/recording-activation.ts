/**
 * Webhook domain — process-level outbox recording activation.
 *
 * Whether the outbox records at all (independent of the per-entity opt-out in
 * recording-policy.ts) turns on two process-wide signals the pure recording
 * choke point cannot see from an event `resource` alone: whether the install
 * has any enabled webhook endpoint, and whether the audit seam is on. Both are
 * published here at registration and read back at the choke point, mirroring
 * recording-policy.ts.
 *
 * Endpoint presence is resolved through a provider (wired to the shared
 * endpoint registry, which already has CRUD invalidation and a TTL) rather than
 * a second cache. The resolver FAILS OPEN: an unwired or throwing provider
 * returns `true`, because a wrong "no endpoints" would make the choke point
 * drop events permanently — never delivered, never replayable — whereas a wrong
 * "endpoints present" only records a row retention later prunes.
 *
 * Stored on `globalThis` for the same reason as the recording policy: Next.js
 * and Turbopack can evaluate this module in more than one server module graph,
 * so a module-local value risks registration writing one instance while the
 * choke point reads another.
 *
 * @module domains/webhooks/recording-activation
 */

import type { WebhookEndpointReader } from "./endpoint-registry";

/**
 * Resolves whether any enabled endpoint exists. Receives the caller's executor
 * (the open write transaction) so a cold lookup reads on that transaction's own
 * connection instead of checking out a second pooled one — which would deadlock
 * a single-connection pool while the transaction holds its connection.
 */
type EndpointPresenceProvider = (
  reader?: WebhookEndpointReader
) => Promise<boolean>;

interface ActivationState {
  auditEnabled: boolean;
  endpointPresenceProvider: EndpointPresenceProvider | null;
}

const globalForActivation = globalThis as unknown as {
  __nextly_webhookActivation?: ActivationState;
};
if (!globalForActivation.__nextly_webhookActivation) {
  globalForActivation.__nextly_webhookActivation = {
    auditEnabled: false,
    endpointPresenceProvider: null,
  };
}
const state = globalForActivation.__nextly_webhookActivation;

/**
 * The gate predicate. The per-entity opt-out is absolute; otherwise the audit
 * seam or a present endpoint un-gates recording. Pure and total for its inputs.
 */
export function shouldRecordEvent(input: {
  collectionAllows: boolean;
  auditEnabled: boolean;
  hasEndpoints: boolean;
}): boolean {
  return input.collectionAllows && (input.auditEnabled || input.hasEndpoints);
}

/** Publish whether the audit seam records events regardless of endpoints. */
export function setWebhookAuditEnabled(enabled: boolean): void {
  state.auditEnabled = enabled;
}

/** Whether the audit seam is on. Defaults to false. */
export function isWebhookAuditEnabled(): boolean {
  return state.auditEnabled;
}

/**
 * Wire the endpoint-presence resolver, at registration, to the shared registry.
 * The provider is expected to be cheap (a cached boolean) since it runs on the
 * write path.
 */
export function setEndpointPresenceProvider(
  provider: EndpointPresenceProvider
): void {
  state.endpointPresenceProvider = provider;
}

/**
 * Whether the install has an enabled endpoint. Pass the caller's transaction as
 * `reader` so a cold lookup reads on its connection (see
 * {@link EndpointPresenceProvider}). FAILS OPEN: no provider (webhooks not
 * registered, or pre-boot) or a throwing provider returns `true`, so a content
 * write is never gated off — and never aborted — on incomplete or failed
 * endpoint knowledge.
 */
export async function endpointsPresent(
  reader?: WebhookEndpointReader
): Promise<boolean> {
  const provider = state.endpointPresenceProvider;
  if (provider === null) return true;
  try {
    return await provider(reader);
  } catch {
    return true;
  }
}

/** Clear activation state (boot/test reset). */
export function resetWebhookActivation(): void {
  state.auditEnabled = false;
  state.endpointPresenceProvider = null;
}
