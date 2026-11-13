/**
 * Removing one-purpose secrets once they can no longer be used.
 *
 * A secret is removed at the first retention sweep more than a day after its
 * expiry, whether it was spent, voided or never used: past its expiry no
 * answer it could give depends on it, and the day's margin keeps a just-expired
 * secret's "expired" answer available a while instead of turning at once into
 * "invalid". Sweeps run on the retention runner, offered by the write paths
 * and by the scheduled drain.
 *
 * A code goes with every older code of its subject and purpose. A new code voids the ones before
 * it, and a refused code is answered from the newest one held, so removing a short-lived newer code
 * alone would leave an older one answering for it, with another reason ("spent" for "none").
 *
 * @module plugins/security/one-time-secrets-prune
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { ONE_TIME_SECRETS_TABLE } from "../../schemas/one-time-secrets";

import {
  pruneInBatches,
  type PruneInBatchesAdapter,
  type PruneInBatchesLimits,
} from "./prune-in-batches";

/** How long after its expiry a secret is kept. */
export const ONE_TIME_SECRETS_GRACE_MS = 24 * 60 * 60 * 1000;

/** How often the sweep is offered. */
export const ONE_TIME_SECRETS_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/** What the sweep needs from the database adapter. */
export type OneTimeSecretsPruneAdapter = PruneInBatchesAdapter;

/** Bounds on one sweep. */
export type OneTimeSecretsPruneLimits = PruneInBatchesLimits;

/**
 * Remove every secret more than a day past its expiry, in batches, within the
 * limits given. Returns how many rows went, and whether any batch was
 * attempted: a sweep stopped by its deadline before the first batch did no
 * work, which the drain needs to tell apart from a sweep of an empty table.
 */
export function pruneOneTimeSecrets(
  adapter: OneTimeSecretsPruneAdapter,
  now: Date,
  limits: OneTimeSecretsPruneLimits = {}
): Promise<{ removed: number; started: boolean }> {
  return pruneInBatches(
    adapter,
    {
      table: ONE_TIME_SECRETS_TABLE,
      key: "id",
      at: "expiresAt",
      cutoff: new Date(now.getTime() - ONE_TIME_SECRETS_GRACE_MS),
      beforeRemove: removeOlderCodes,
    },
    limits
  );
}

/** A removed code's subject, purpose and place in their order. */
type CodeRow = {
  id: string;
  subjectKey: string;
  purpose: string;
  issueSeq: number | null;
};

/**
 * Every code issued before one of `ids` for the same subject and purpose, removed with it: each
 * was voided when a newer one was minted, so none is spendable, and none may outlive the newer one
 * to answer for it. Returns how many went.
 */
async function removeOlderCodes(
  db: Pick<DrizzleAdapter, "select" | "delete">,
  ids: readonly string[]
): Promise<number> {
  const removing = await db.select<CodeRow>(ONE_TIME_SECRETS_TABLE, {
    columns: ["id", "subjectKey", "purpose", "issueSeq"],
    where: {
      and: [
        { column: "id", op: "IN", value: [...ids] },
        { column: "kind", op: "=", value: "code" },
      ],
    },
  });
  // The newest code removed of each subject and purpose: every older one goes with it.
  const newest = new Map<string, CodeRow>();
  for (const row of removing) {
    if (row.issueSeq === null) continue;
    const group = `${row.subjectKey}\u0000${row.purpose}`;
    const held = newest.get(group);
    if (!held || (held.issueSeq ?? 0) < row.issueSeq) newest.set(group, row);
  }
  let removed = 0;
  for (const row of newest.values()) {
    removed += await db.delete(ONE_TIME_SECRETS_TABLE, {
      and: [
        { column: "subjectKey", op: "=", value: row.subjectKey },
        { column: "purpose", op: "=", value: row.purpose },
        { column: "kind", op: "=", value: "code" },
        { column: "issueSeq", op: "<", value: row.issueSeq ?? 0 },
        // The batch's own rows are deleted by the batch, and counted there.
        { column: "id", op: "NOT IN", value: [...ids] },
      ],
    });
  }
  return removed;
}
