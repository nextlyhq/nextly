/**
 * Retention pass scheduling, shared by every domain that prunes.
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
 * Claiming is atomic where the database allows it. A read-then-write gate would
 * let every instance of a multi-instance deployment win the same interval, so
 * each would run its own pass and the coordination the stored marker exists for
 * would buy nothing. `UPDATE ... WHERE` with an affected-row count would be the
 * natural primitive, but the adapter cannot report one portably — `update`
 * returns an empty array on dialects without RETURNING. `delete` does return a
 * reliable count on all three, so the claim is expressed as a conditional
 * delete of the marker followed by re-inserting it.
 *
 * That leaves a window of two statements rather than one, which is not perfect
 * mutual exclusion. It is a large improvement over a whole interval, and the
 * cost of a loss is only a second bounded, idempotent pass — the overlapping
 * deletes simply remove fewer rows.
 *
 * @module domains/retention/gate
 */

import type { WhereClause } from "@nextlyhq/adapter-drizzle/types";

/**
 * Where a pass's last-run timestamp lives, in the `nextly_meta` KV table.
 *
 * One key PER PASS, never one shared key. A shared marker would let whichever
 * pass ran first consume the interval for all of them, so a domain could be
 * starved indefinitely by a busier neighbour and never prune at all.
 */
export const WEBHOOK_RETENTION_GATE_KEY = "webhooks.retention.lastPassAt";

/**
 * The audit trails are gated twice, because two triggers with different jobs
 * offer them.
 *
 * A request path offers a capped pass so a save or a sign-in is not held up. The
 * drain offers a full-budget one, and nothing waits on the drain. Sharing a
 * marker let the capped trigger consume the interval first — a write landing
 * just after the marker came due took the turn, and a scheduled drain arriving
 * moments later found nothing to claim. Under continuous writes that repeats
 * every interval, so the configured budget is never spent and the trails fall
 * behind on a setting that reads as enforced.
 *
 * Separate markers mean the two can both run in an interval. That is harmless:
 * a pass deletes rows older than a cutoff, so a second one finds less to do
 * rather than doing it twice.
 */
export const AUDIT_RETENTION_GATE_KEY = "audit.retention.lastPassAt";
export const AUDIT_RETENTION_DRAIN_GATE_KEY = "audit.retention.lastDrainPassAt";

/**
 * The delivery log is gated on its own marker, and offered by the SEND path
 * rather than by a content write.
 *
 * Rows in `email_deliveries` are created by sends, so sends are when the table
 * grows — a content write has no relationship to email volume, and an install
 * that never sends mail has nothing here to prune. Offering it from the write
 * paths instead would tie the sweep's cadence to a signal unrelated to what it
 * removes.
 */
export const EMAIL_RETENTION_GATE_KEY = "email.retention.lastPassAt";

/**
 * The atomic claim primitive. Implemented against `nextly_meta` in
 * {@link MetaRetentionGate}; tests supply their own.
 */
export interface RetentionGateStore {
  /**
   * Take the marker if it is absent or older than `dueBefore`, stamping it with
   * `now`. Returns true only for the caller that took it.
   */
  claim(key: string, dueBefore: Date, now: Date): Promise<boolean>;
  /**
   * Drop a marker this caller wrote, returning the turn. Optional: a store
   * that cannot release simply keeps the interval, which is the previous
   * behaviour rather than a new failure.
   */
  release?(key: string): Promise<void>;
}

/** The subset of the adapter the gate needs. */
export interface RetentionGateAdapter {
  delete(table: string, where: WhereClause): Promise<number>;
  insert(table: string, data: Record<string, unknown>): Promise<unknown>;
}

const META_TABLE = "nextly_meta";

/**
 * The gate backed by the `nextly_meta` key/value table, whose `key` is the
 * primary key — which is what makes the bootstrap insert a claim rather than a
 * race.
 */
export class MetaRetentionGate implements RetentionGateStore {
  constructor(private readonly adapter: RetentionGateAdapter) {}

  async release(key: string): Promise<void> {
    await this.adapter.delete(META_TABLE, {
      and: [{ column: "key", op: "=", value: key }],
    });
  }

  async claim(key: string, dueBefore: Date, now: Date): Promise<boolean> {
    // Removing the stale marker IS the claim: only one caller can delete a
    // given row, and the count says whether it was this one.
    const removed = await this.adapter.delete(META_TABLE, {
      and: [
        { column: "key", op: "=", value: key },
        { column: "updatedAt", op: "<", value: dueBefore },
      ],
    });

    if (removed > 0) {
      await this.adapter.insert(META_TABLE, {
        key,
        value: JSON.stringify(now.toISOString()),
        updated_at: now,
      });
      return true;
    }

    // Nothing stale to remove: either the marker is current, or none exists
    // yet. Inserting distinguishes the two — the primary key rejects the first
    // case, so only a genuinely first run gets through.
    try {
      await this.adapter.insert(META_TABLE, {
        key,
        value: JSON.stringify(now.toISOString()),
        updated_at: now,
      });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Give back a turn that was claimed but not used.
 *
 * Claiming writes the marker before the caller can know whether it still has
 * time to spend, so a pass that then finds none has taken a turn it did
 * nothing with — and the marker would hold the next attempt off for a full
 * interval. Removing it restores the state as if the claim had not happened.
 *
 * Safe because the work it guards is idempotent: a pass deletes rows older than
 * a cutoff, so at worst another caller runs one now instead of later. A failure
 * to release is not worth reporting — the only cost is the interval that would
 * have been lost anyway.
 */
export async function releaseRetentionPass(
  store: RetentionGateStore,
  key: string
): Promise<void> {
  try {
    await store.release?.(key);
  } catch {
    /* the turn stays taken; the next interval recovers it */
  }
}

/**
 * Try to claim the next retention pass.
 *
 * Returns true when the caller should run one, having already recorded the
 * attempt — the marker is written as part of the claim, not after the pass, so
 * a pass that throws still holds off the next one for a full interval instead
 * of letting every subsequent write retry a failing prune.
 *
 * A store failure returns false: if the gate cannot be claimed, the safe answer
 * is not to prune, since an ungated pass could run on every write.
 */
export async function claimRetentionPass(
  store: RetentionGateStore,
  key: string,
  intervalMs: number,
  now: Date = new Date()
): Promise<boolean> {
  try {
    return await store.claim(key, new Date(now.getTime() - intervalMs), now);
  } catch {
    return false;
  }
}
