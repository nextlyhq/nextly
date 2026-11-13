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

/** A code's subject, purpose, place in their order and when it was issued. */
type CodeRow = {
  id: string;
  subjectKey: string;
  purpose: string;
  issueSeq: number | null;
  createdAt: Date;
};

/** The columns `CodeRow` reads. */
const CODE_COLUMNS = ["id", "subjectKey", "purpose", "issueSeq", "createdAt"];

/** The group a code belongs to: its subject and purpose. */
function groupOf(row: CodeRow): string {
  return `${row.subjectKey}\u0000${row.purpose}`;
}

/**
 * Every code issued before one of `ids` for the same subject and purpose, removed with it: each
 * was voided when a newer one was minted, so none is spendable, and none may outlive the newer one
 * to answer for it. Returns how many went.
 *
 * A code is taken as older only when it is both lower in the issue order AND was issued no later
 * than the removed code. The issue order starts again at 1 once a subject's codes are all gone, so
 * an overlapping sweep that already removed the history could let a code minted since then sit
 * below the threshold; such a code is issued more than a day after the removed one expired, so its
 * issue time sets it apart. The older codes are found in one read and removed by their ids in one
 * delete, so a code minted between the two is never touched and no query is sent per subject.
 */
async function removeOlderCodes(
  db: Pick<DrizzleAdapter, "select" | "delete">,
  ids: readonly string[]
): Promise<number> {
  const removing = await db.select<CodeRow>(ONE_TIME_SECRETS_TABLE, {
    columns: CODE_COLUMNS,
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
    const held = newest.get(groupOf(row));
    if (!held || (held.issueSeq ?? 0) < row.issueSeq) {
      newest.set(groupOf(row), row);
    }
  }
  if (newest.size === 0) return 0;
  const anchors = [...newest.values()];
  const candidates = await db.select<CodeRow>(ONE_TIME_SECRETS_TABLE, {
    columns: CODE_COLUMNS,
    where: {
      and: [
        {
          column: "subjectKey",
          op: "IN",
          value: [...new Set(anchors.map(row => row.subjectKey))],
        },
        { column: "kind", op: "=", value: "code" },
        // The batch's own rows are deleted by the batch, and counted there.
        { column: "id", op: "NOT IN", value: [...ids] },
      ],
    },
  });
  const older = candidates.filter(row => {
    const anchor = newest.get(groupOf(row));
    return (
      anchor !== undefined &&
      row.issueSeq !== null &&
      row.issueSeq < (anchor.issueSeq ?? 0) &&
      row.createdAt.getTime() <= anchor.createdAt.getTime()
    );
  });
  if (older.length === 0) return 0;
  return db.delete(ONE_TIME_SECRETS_TABLE, {
    and: [{ column: "id", op: "IN", value: older.map(row => row.id) }],
  });
}
