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
    },
    limits
  );
}
