import { deleteStaleUnverified } from "../storage/accounts";

import { DAY, type FlowDeps } from "./deps";

/** How many accounts one run of the sweep deletes at most. */
const BATCH = 500;

/**
 * Deletes the accounts nobody verified within the site's
 * `unverifiedKeptDays`, oldest first, at most a batch per run; the job runs
 * again for the rest. Their links and codes have expired by then, and core
 * sweeps them. Answers how many it deleted.
 */
export async function sweepUnverifiedAccounts(
  deps: Pick<FlowDeps, "db" | "settings" | "now">,
  options: { batch?: number } = {}
): Promise<number> {
  const madeBy = new Date(
    deps.now().getTime() - deps.settings.unverifiedKeptDays * DAY
  );

  return (await deleteStaleUnverified(deps.db, madeBy, options.batch ?? BATCH))
    .length;
}
