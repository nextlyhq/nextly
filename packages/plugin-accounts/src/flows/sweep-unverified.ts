import { deleteStaleUnverified } from "../storage/accounts";

import { accountDeleted, reportAccountDeleted } from "./account-deleted";
import { DAY, type FlowDeps } from "./deps";

/** How many accounts one run of the sweep deletes at most. */
const BATCH = 500;

/**
 * Deletes the accounts nobody verified within the site's
 * `unverifiedKeptDays`, oldest first, at most a batch per run; the job runs
 * again for the rest. Their links and codes have expired by then, and core
 * sweeps them. Each is reported to core in the transaction that deletes
 * the batch, and other plugins are told of each, as of any account
 * deleted. Answers how many it deleted.
 */
export async function sweepUnverifiedAccounts(
  deps: Pick<FlowDeps, "db" | "settings" | "now" | "events" | "principals">,
  options: { batch?: number } = {}
): Promise<number> {
  const madeBy = new Date(
    deps.now().getTime() - deps.settings.unverifiedKeptDays * DAY
  );

  const deleted = await deps.db.transaction(async tx => {
    const ids = await deleteStaleUnverified(tx, madeBy, options.batch ?? BATCH);
    for (const accountId of ids)
      await reportAccountDeleted(deps, tx, accountId);
    return ids;
  });
  for (const accountId of deleted) accountDeleted(deps, accountId);

  return deleted.length;
}
