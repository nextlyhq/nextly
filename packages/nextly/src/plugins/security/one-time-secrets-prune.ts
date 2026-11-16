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
  type BeforeRemoveResult,
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

/** A removed code's subject, purpose, place in their order, and expiry. */
type CodeRow = {
  id: string;
  subjectKey: string;
  purpose: string;
  issueSeq: number | null;
  expiresAt: Date;
};

/**
 * At most this many older codes go with one batch. More, and the batch's own rows wait for a
 * later batch, so a subject with a long history costs several bounded batches rather than one
 * unbounded one, and no code goes before the older codes it takes with it.
 */
const OLDER_CODES_PER_BATCH = 500;

/** The group a code belongs to: its subject and purpose. */
function groupOf(row: CodeRow): string {
  return `${row.subjectKey}\u0000${row.purpose}`;
}

/**
 * Every code issued before one of `ids` for the same subject and purpose, removed with it: each
 * was voided when a newer one was minted, so none is spendable, and none may outlive the newer one
 * to answer for it.
 *
 * A code is taken as older when it is lower in the issue order and was issued before the removed
 * code's day of grace was half over. The issue order starts again at 1 once a subject's codes are
 * all gone, and they are gone only after a sweep removed the newest, at least a full day of grace
 * past its expiry, so a code minted since then is issued at least half a day after that line; an
 * older code was issued before the removed one was, or moments after where two mints overlapped,
 * so it is well inside it. Issue times are compared only against that wide line, never with each
 * other, since a mint takes its time before it reads its place in the order.
 *
 * The older codes are found by the database in one read, at most a batch's worth, and removed by
 * their ids in one delete, so a code minted between the two is never touched.
 */
async function removeOlderCodes(
  db: Pick<DrizzleAdapter, "select" | "delete">,
  ids: readonly string[]
): Promise<BeforeRemoveResult> {
  const removing = await db.select<CodeRow>(ONE_TIME_SECRETS_TABLE, {
    columns: ["id", "subjectKey", "purpose", "issueSeq", "expiresAt"],
    where: {
      and: [
        { column: "id", op: "IN", value: [...ids] },
        { column: "kind", op: "=", value: "code" },
      ],
    },
  });
  // The newest code removed of each subject and purpose: every older one goes with it.
  const newest = new Map<string, CodeRow & { issueSeq: number }>();
  for (const row of removing) {
    if (row.issueSeq === null) continue;
    const held = newest.get(groupOf(row));
    if (!held || held.issueSeq < row.issueSeq) {
      newest.set(groupOf(row), { ...row, issueSeq: row.issueSeq });
    }
  }
  if (newest.size === 0) return { removed: 0 };
  const older = await db.select<{ id: string }>(ONE_TIME_SECRETS_TABLE, {
    columns: ["id"],
    where: {
      and: [
        { column: "kind", op: "=", value: "code" },
        // The batch's own rows are deleted by the batch, and counted there.
        { column: "id", op: "NOT IN", value: [...ids] },
        {
          or: [...newest.values()].map(anchor => ({
            and: [
              {
                column: "subjectKey",
                op: "=" as const,
                value: anchor.subjectKey,
              },
              { column: "purpose", op: "=" as const, value: anchor.purpose },
              { column: "issueSeq", op: "<" as const, value: anchor.issueSeq },
              {
                column: "createdAt",
                op: "<" as const,
                value: new Date(
                  anchor.expiresAt.getTime() + ONE_TIME_SECRETS_GRACE_MS / 2
                ),
              },
            ],
          })),
        },
      ],
    },
    limit: OLDER_CODES_PER_BATCH,
  });
  if (older.length === 0) return { removed: 0 };
  const removed = await db.delete(ONE_TIME_SECRETS_TABLE, {
    and: [{ column: "id", op: "IN", value: older.map(row => row.id) }],
  });
  return { removed, holdBack: older.length === OLDER_CODES_PER_BATCH };
}
