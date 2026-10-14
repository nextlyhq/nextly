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
 * @module plugins/security/one-time-secrets-prune
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { ONE_TIME_SECRETS_TABLE } from "../../schemas/one-time-secrets";

/** How long after its expiry a secret is kept. */
export const ONE_TIME_SECRETS_GRACE_MS = 24 * 60 * 60 * 1000;

/** How often the sweep is offered. */
export const ONE_TIME_SECRETS_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/** Rows removed per batch, each batch in a transaction of its own. */
const BATCH = 500;

/**
 * What the sweep needs from the database adapter. `transaction` is optional
 * only so a test double of the retention adapter need not supply one; every
 * real adapter has it, and the sweep uses it whenever it is there.
 */
export type OneTimeSecretsPruneAdapter = Pick<
  DrizzleAdapter,
  "select" | "delete"
> &
  Partial<Pick<DrizzleAdapter, "transaction">>;

/**
 * Remove every secret more than a day past its expiry, in batches, at most
 * `maxBatches` of them when a capped pass asks for that. Returns how many
 * rows went.
 */
export async function pruneOneTimeSecrets(
  adapter: OneTimeSecretsPruneAdapter,
  now: Date,
  maxBatches = Number.POSITIVE_INFINITY
): Promise<number> {
  const cutoff = new Date(now.getTime() - ONE_TIME_SECRETS_GRACE_MS);
  let removed = 0;
  for (let batch = 0; batch < maxBatches; batch++) {
    const rows = await adapter.select<{ id: string }>(ONE_TIME_SECRETS_TABLE, {
      columns: ["id"],
      where: { and: [{ column: "expiresAt", op: "<", value: cutoff }] },
      limit: BATCH,
    });
    if (rows.length === 0) break;
    const where = {
      and: [
        { column: "id", op: "IN" as const, value: rows.map(row => row.id) },
        { column: "expiresAt", op: "<" as const, value: cutoff },
      ],
    };
    // In a transaction, never as a lone statement: on SQLite a lone statement
    // joins whatever transaction another flow has open and rolls back with it.
    removed += adapter.transaction
      ? await adapter.transaction(tx =>
          tx.delete(ONE_TIME_SECRETS_TABLE, where)
        )
      : await adapter.delete(ONE_TIME_SECRETS_TABLE, where);
    if (rows.length < BATCH) break;
  }
  return removed;
}
