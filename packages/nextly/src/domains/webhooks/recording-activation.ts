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
 * Endpoint presence is a SYNCHRONOUSLY-read cached flag, never a database read
 * on the write path. The choke point runs inside the content write transaction,
 * where a read is unsafe: a second pooled connection deadlocks a single-
 * connection pool, a transaction-snapshot read (MySQL repeatable-read) would
 * cache a stale value, and a failed read poisons the whole transaction on
 * Postgres. So the flag is refreshed OUT OF BAND — at boot, on endpoint CRUD,
 * and by a non-awaited background reload when a read finds it stale — always on
 * a pooled connection outside any content transaction.
 *
 * The flag FAILS OPEN: until it is primed (`null`) the choke point records,
 * because a wrong "no endpoints" drops events permanently (never delivered,
 * never replayable) whereas a wrong "endpoints present" only records a row
 * retention later prunes.
 *
 * Stored on `globalThis` for the same reason as the recording policy: Next.js
 * and Turbopack can evaluate this module in more than one server module graph,
 * so a module-local value risks registration writing one instance while the
 * choke point reads another.
 *
 * @module domains/webhooks/recording-activation
 */

import {
  isWebhookRecordingEnabled,
  type WebhookRecordingScope,
} from "./recording-policy";

/**
 * How long a primed presence value is trusted before a stale read schedules a
 * background reload. Matches the endpoint registry TTL so a cross-process
 * endpoint change self-heals on the same ~30s bound.
 */
const PRESENCE_TTL_MS = 30_000;

/** Resolves enabled-endpoint presence on a POOLED connection (never a content tx). */
type EndpointPresenceRefresher = () => Promise<boolean>;

interface ActivationState {
  auditEnabled: boolean;
  /** `null` until primed → fail open. */
  endpointsPresent: boolean | null;
  presenceAtMs: number;
  refresher: EndpointPresenceRefresher | null;
  refreshing: boolean;
  /** A refresh was requested while one was in flight; run once more after it. */
  refreshPending: boolean;
  now: () => number;
}

const globalForActivation = globalThis as unknown as {
  __nextly_webhookActivation?: ActivationState;
};
if (!globalForActivation.__nextly_webhookActivation) {
  globalForActivation.__nextly_webhookActivation = {
    auditEnabled: false,
    endpointsPresent: null,
    presenceAtMs: 0,
    refresher: null,
    refreshing: false,
    refreshPending: false,
    now: () => Date.now(),
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
 * Wire the endpoint-presence refresher (at registration) to a POOLED read of the
 * enabled-endpoint set. Never pass a content transaction: the refresher runs
 * outside any write transaction.
 */
export function setEndpointPresenceRefresher(
  refresher: EndpointPresenceRefresher
): void {
  state.refresher = refresher;
}

/** Overridable clock (tests). */
export function setActivationClock(now: () => number): void {
  state.now = now;
}

async function runRefresh(): Promise<void> {
  const refresher = state.refresher;
  if (refresher === null) return;
  // Coalesce: a refresh requested while one is in flight (e.g. endpoint CRUD
  // during the boot/TTL refresh) must not be discarded, or the in-flight read
  // could commit a pre-mutation result after the change. Mark it pending so the
  // active refresh runs once more and picks up the newest state.
  if (state.refreshing) {
    state.refreshPending = true;
    return;
  }
  state.refreshing = true;
  try {
    do {
      state.refreshPending = false;
      const present = await refresher();
      state.endpointsPresent = present;
      state.presenceAtMs = state.now();
    } while (state.refreshPending);
  } catch {
    // A failed read must not pin a stale value. Keep a known-POSITIVE value (a
    // transient blip should not disable delivery), but drop a negative/unknown
    // value to `null` so the next read fails open and retries — otherwise a
    // cross-process endpoint create whose refresh failed would keep dropping
    // events irreversibly.
    if (state.endpointsPresent !== true) {
      state.endpointsPresent = null;
    }
    state.refreshPending = false;
  } finally {
    state.refreshing = false;
  }
}

/**
 * Refresh the presence flag now, awaiting the read. Called at boot and after
 * endpoint CRUD — both outside any content transaction — so same-process changes
 * take effect immediately.
 */
export async function refreshEndpointPresence(): Promise<void> {
  await runRefresh();
}

/**
 * Whether the install has an enabled endpoint, read synchronously with no
 * database access — safe to call inside the content write transaction. FAILS
 * OPEN before the flag is primed. A stale value (older than the TTL) is returned
 * as-is and triggers a NON-AWAITED background reload, so a cross-process endpoint
 * change self-heals within the TTL without ever reading on the write path.
 */
export function endpointsPresent(): boolean {
  const present = state.endpointsPresent;
  if (present === null) {
    // Never primed (e.g. webhooks registered but boot prime not yet finished):
    // fail open, and kick a background prime so later writes gate correctly.
    void runRefresh();
    return true;
  }
  if (state.now() - state.presenceAtMs > PRESENCE_TTL_MS) {
    // Serve the last known value now; refresh out of band for the next read.
    void runRefresh();
  }
  return present;
}

/**
 * Whether a write to this collection/single would be recorded — the full gate,
 * read synchronously: the per-entity opt-out AND (audit OR endpoint presence).
 * Write paths call this BEFORE assembling a webhook payload so a gated-off write
 * skips component expansion and document assembly (and cannot abort the content
 * write on a webhook-only read). The recording choke point re-checks the same
 * inputs, so a change between prep and record only costs a discarded payload.
 */
export function isOutboxRecordingActive(
  scope: WebhookRecordingScope,
  slug: string
): boolean {
  return (
    isWebhookRecordingEnabled(scope, slug) &&
    (state.auditEnabled || endpointsPresent())
  );
}

/**
 * Whether an UNSCOPED resource (media, user — no per-entity opt-out) would be
 * recorded: audit OR endpoint presence. For gating post-write webhook work
 * (e.g. a media fast-drain) on a path that cannot thread the recorder's boolean.
 */
export function isUnscopedRecordingActive(): boolean {
  return state.auditEnabled || endpointsPresent();
}

/** Clear activation state (boot/test reset). */
export function resetWebhookActivation(): void {
  state.auditEnabled = false;
  state.endpointsPresent = null;
  state.presenceAtMs = 0;
  state.refresher = null;
  state.refreshing = false;
  state.refreshPending = false;
  state.now = () => Date.now();
}
