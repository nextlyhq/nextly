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
 * @module domains/webhooks/retention-gate
 */

import type { WhereClause } from "@nextlyhq/adapter-drizzle/types";

/** Where the last-pass timestamp lives, in the `nextly_meta` KV table. */
export const RETENTION_GATE_KEY = "webhooks.retention.lastPassAt";

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
  intervalMs: number,
  now: Date = new Date()
): Promise<boolean> {
  try {
    return await store.claim(
      RETENTION_GATE_KEY,
      new Date(now.getTime() - intervalMs),
      now
    );
  } catch {
    return false;
  }
}
