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

import type { ResolvedWebhookEmit } from "./resolve-recording-config";

/** The entity kinds that can carry a per-entity recording opt-out. */
export type WebhookRecordingScope = "collection" | "single";

/**
 * Who set a decision. `code` decisions come from the code-first config and are
 * reconciled on every reload (a slug removed from config is pruned). `plugin`
 * decisions come from a plugin's contributed config, which is NOT re-evaluated
 * on HMR. `db` decisions come from the registry's `webhooks` column and belong
 * to Builder-authored entities, which never appear in the code-first config.
 * Only `code` decisions are pruned by a reconcile; the other two must survive
 * it or a plugin's or an operator's opt-out would lapse on the first reload.
 */
export type WebhookRecordingSource = "code" | "plugin" | "db";

interface PolicyEntry {
  record: boolean;
  source: WebhookRecordingSource;
  /**
   * A curated event this entity emits on create instead of the default
   * `entry.created` — set only for a code/plugin entity that configured one.
   */
  emit?: ResolvedWebhookEmit;
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

/**
 * How long registry-stored decisions are trusted before a stale read schedules a
 * background reload. Matches `PRESENCE_TTL_MS` in recording-activation so both
 * cross-process webhook signals self-heal on the same ~30s bound.
 */
const STORED_TTL_MS = 30_000;

/** Re-reads stored decisions on a POOLED connection (never a content tx). */
type StoredRecordingRefresher = () => Promise<void>;

interface StoredRefreshState {
  refresher: StoredRecordingRefresher | null;
  /** When the stored decisions were last read; 0 until primed. */
  readAtMs: number;
  /** A background reload is queued; do not stampede. */
  queued: boolean;
  /**
   * Bumped by every LOCAL decision change. A refresh captures this before it
   * starts reading and is discarded if it changed by the time it applies, so a
   * snapshot taken before a local toggle cannot overwrite the newer truth.
   */
  generation: number;
  now: () => number;
}

const globalForStoredRefresh = globalThis as unknown as {
  __nextly_webhookStoredRefresh?: StoredRefreshState;
};
if (!globalForStoredRefresh.__nextly_webhookStoredRefresh) {
  globalForStoredRefresh.__nextly_webhookStoredRefresh = {
    refresher: null,
    readAtMs: 0,
    queued: false,
    generation: 0,
    now: () => Date.now(),
  };
}
const storedRefresh = globalForStoredRefresh.__nextly_webhookStoredRefresh;

const keyFor = (scope: WebhookRecordingScope, slug: string): string =>
  `${scope}:${slug}`;

/**
 * Register how stored decisions are re-read. Wired at boot; without it the
 * process keeps whatever boot published, which is the single-instance case.
 */
export function setStoredRecordingRefresher(
  refresher: StoredRecordingRefresher | null
): void {
  storedRefresh.refresher = refresher;
}

/** Injected for tests; defaults to `Date.now`. */
export function setStoredRecordingClock(now: () => number): void {
  storedRefresh.now = now;
}

/**
 * Replace every `db`-sourced decision with `optOuts`, atomically.
 *
 * A plain re-publish could only ever ADD opt-outs, so a switch turned back ON
 * elsewhere would never lift here. Swapping the whole `db` set makes the refresh
 * converge in both directions. `code` and `plugin` decisions are untouched:
 * config outranks storage.
 */
export function applyStoredRecordingDecisions(
  optOuts: ReadonlyArray<{ scope: WebhookRecordingScope; slug: string }>,
  readAtGeneration?: number
): void {
  // A snapshot read before a local toggle would otherwise erase it: the local
  // update commits `{ record: false }` and publishes immediately, then this
  // older read removes that `db` entry and restores the recording default.
  // Discarding the stale snapshot keeps the newer local truth; the value is
  // already correct, so the read is still marked fresh rather than retried in a
  // loop.
  if (
    readAtGeneration !== undefined &&
    readAtGeneration !== storedRefresh.generation
  ) {
    storedRefresh.readAtMs = storedRefresh.now();
    return;
  }

  for (const [key, entry] of policy) {
    if (entry.source === "db") policy.delete(key);
  }
  for (const { scope, slug } of optOuts) {
    policy.set(keyFor(scope, slug), { record: false, source: "db" });
  }
  storedRefresh.readAtMs = storedRefresh.now();
  storedRefresh.generation += 1;
}

/**
 * Mark the stored snapshot current without changing any decision. Used when a
 * database predating the `webhooks` column is read: there is nothing to apply,
 * and leaving the snapshot unprimed would make every later write schedule
 * another failing query.
 */
export function markStoredRecordingFresh(): void {
  storedRefresh.readAtMs = storedRefresh.now();
}

/**
 * Kick a background re-read without awaiting it, coalesced so a burst of stale
 * reads does not stampede the database. Safe to call from inside a content write
 * transaction: the refresh runs on a pooled connection and is never awaited by
 * the caller, so it cannot check out a second connection while the write holds
 * one. Mirrors `scheduleBackgroundRefresh` in recording-activation.
 */
function scheduleStoredRefresh(): void {
  const refresher = storedRefresh.refresher;
  if (!refresher || storedRefresh.queued) return;
  storedRefresh.queued = true;
  void refresher()
    .catch(() => undefined)
    .finally(() => {
      storedRefresh.queued = false;
    });
}

/**
 * Publish a collection/single's resolved recording decision. `source` defaults
 * to `code`; pass `plugin` for a plugin-contributed entity so a later code-first
 * reconcile does not prune it.
 */
export function setWebhookRecording(
  scope: WebhookRecordingScope,
  slug: string,
  record: boolean,
  source: WebhookRecordingSource = "code",
  emit?: ResolvedWebhookEmit
): void {
  policy.set(
    keyFor(scope, slug),
    emit ? { record, source, emit } : { record, source }
  );
  storedRefresh.generation += 1;
}

/**
 * The current decision generation. A refresh captures this BEFORE it reads and
 * hands it back to `applyStoredRecordingDecisions`, which discards the snapshot
 * if anything changed meanwhile.
 */
export function currentRecordingGeneration(): number {
  return storedRefresh.generation;
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
  // Serve the current decision now and, when the stored set has gone stale,
  // reload it out of band. Without this a sibling process in a multi-instance
  // deployment would keep recording a collection someone opted out of on another
  // instance until it restarted. Never reads the database inline: this runs
  // inside the content write transaction.
  if (
    storedRefresh.refresher &&
    storedRefresh.now() - storedRefresh.readAtMs > STORED_TTL_MS
  ) {
    scheduleStoredRefresh();
  }
  return policy.get(keyFor(scope, slug))?.record ?? true;
}

/**
 * The curated event this collection/single emits on create instead of the
 * default `entry.created`, or undefined when none is configured. Read at the
 * create seam from the same registry as the recording gate, so a PII collection
 * ships a metadata-only event while its raw `entry.*` events stay suppressed. No
 * database read: like {@link isWebhookRecordingEnabled} this runs inside the
 * content write transaction.
 */
export function getWebhookEmitSpec(
  scope: WebhookRecordingScope,
  slug: string
): ResolvedWebhookEmit | undefined {
  return policy.get(keyFor(scope, slug))?.emit;
}

/**
 * Whether recording is disabled by a decision that CANNOT change mid-write.
 *
 * Only `code` and `plugin` decisions qualify: they come from config, are
 * republished at boot/HMR, and are never touched by the stored-policy refresh.
 * A `db` decision can be flipped by a background refresh at any moment, so it is
 * deliberately NOT reported here.
 *
 * Used by the pre-record field expansion, which skips component expansion when a
 * write will not be recorded. That skip is only safe against a decision that
 * holds for the whole write: if expansion is skipped and the decision then flips
 * to recording before the choke point re-checks, the payload ships with
 * component-nested secret/hidden values unstripped. The endpoint/audit flag was
 * already excluded there for exactly this reason.
 */
export function isRecordingDisabledByConfig(
  scope: WebhookRecordingScope,
  slug: string
): boolean {
  const entry = policy.get(keyFor(scope, slug));
  return (
    entry !== undefined &&
    !entry.record &&
    (entry.source === "code" || entry.source === "plugin")
  );
}

/**
 * Within ONE scope, drop every `code`-sourced decision whose slug is not in
 * `presentSlugs`. Scoped so a reload that republishes only the entities whose
 * metadata sync succeeded (e.g. collections but not singles) prunes only that
 * scope and never touches the other's still-valid decisions. Used on reload to
 * clear a code-first entity removed from the config: its DB table can survive
 * (the reload merges registered tables back), so a stale opt-out would otherwise
 * suppress its events until restart. `plugin` decisions are never pruned.
 */
export function pruneRemovedCodeFirstRecording(
  scope: WebhookRecordingScope,
  presentSlugs: Set<string>
): void {
  const prefix = `${scope}:`;
  for (const [key, entry] of policy) {
    if (
      entry.source === "code" &&
      key.startsWith(prefix) &&
      !presentSlugs.has(key.slice(prefix.length))
    ) {
      policy.delete(key);
    }
  }
}

/**
 * Drop one entity's decision, reverting it to the recording default. Used when
 * the Builder deletes a collection/single: the stored opt-out must not outlive
 * the row, or a later entity created under the same slug would silently inherit
 * a suppression nobody chose for it.
 */
export function clearWebhookRecording(
  scope: WebhookRecordingScope,
  slug: string
): void {
  policy.delete(keyFor(scope, slug));
  storedRefresh.generation += 1;
}

/** Clear every registered decision (boot/test reset). */
export function resetWebhookRecordingPolicy(): void {
  policy.clear();
  storedRefresh.refresher = null;
  storedRefresh.readAtMs = 0;
  storedRefresh.queued = false;
  // Advance rather than zero. A refresh that captured generation N before this
  // reset may still be in flight; zeroing would let the next boot's ordinary
  // increments climb back to N, so that stale read — taken against the previous
  // adapter and config — would pass the guard and replace every `db` decision
  // the new boot had just published, re-enabling recording for an opted-out
  // entity. A counter that only ever increases can never be matched again.
  storedRefresh.generation += 1;
  storedRefresh.now = () => Date.now();
}
