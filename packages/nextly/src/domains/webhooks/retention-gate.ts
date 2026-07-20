/**
 * Webhook domain — retention pass scheduling.
 *
 * Retention has no scheduler to hang off. Nextly is a library inside someone
 * else's Next.js app: there is no daemon, and an in-process timer would run on a
 * self-hosted server and silently never fire on serverless, where the instance
 * is frozen between requests. That failure mode is environment-dependent and
 * invisible, which is worse than not having a timer at all.
 *
 * So passes are gated on a stored timestamp instead of scheduled. Any caller may
 * offer to run one; the gate lets at most one through per interval per install,
 * whatever the process or request count.
 *
 * The gate is deliberately a read-then-write rather than a compare-and-swap.
 * Two callers racing can both pass it, and the cost of that is two bounded,
 * idempotent prune passes deleting overlapping id sets — the second simply
 * removes fewer rows. Buying strictness would mean relying on an update's
 * affected-row count, which MySQL cannot report without RETURNING, so the
 * portable version of that guarantee does not exist.
 *
 * @module domains/webhooks/retention-gate
 */

/** Where the last-pass timestamp lives, in the `nextly_meta` KV table. */
export const RETENTION_GATE_KEY = "webhooks.retention.lastPassAt";

/** The slice of `MetaService` this needs, so tests can supply a double. */
export interface RetentionGateStore {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
}

/** Milliseconds since the epoch, or null when nothing readable is stored. */
function storedAt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

/**
 * Try to claim the next retention pass.
 *
 * Returns true when the caller should run one, having already recorded the
 * attempt — the marker is written BEFORE the pass, not after, so a pass that
 * throws still holds off the next one for a full interval instead of letting
 * every subsequent write retry a failing prune.
 *
 * A store failure returns false: if the gate cannot be read or written, the safe
 * answer is not to prune, since an ungated pass could run on every write.
 */
export async function claimRetentionPass(
  store: RetentionGateStore,
  intervalMs: number,
  now: Date = new Date()
): Promise<boolean> {
  try {
    const last = storedAt(await store.get(RETENTION_GATE_KEY));
    if (last !== null && now.getTime() - last < intervalMs) return false;
    await store.set(RETENTION_GATE_KEY, now.toISOString());
    return true;
  } catch {
    return false;
  }
}
