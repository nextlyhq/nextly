import { accountIdsAfter } from "../storage/accounts";

import { accountDeleted, reportAccountDeleted } from "./account-deleted";
import type { FlowDeps } from "./deps";

/** How many accounts one transaction reports at most. */
const BATCH = 500;

/**
 * On an uninstall that drops the plugin's tables, every account goes with
 * them: each is reported deleted to core, so core erases it from the audit
 * trail, a page of accounts to a transaction, and other plugins are told of
 * each, as of any account deleted. Answers how many it reported.
 */
export async function reportEveryAccountDeleted(
  deps: Pick<FlowDeps, "db" | "events" | "principals">,
  options: { batch?: number } = {}
): Promise<number> {
  let after: string | null = null;
  let reported = 0;
  for (;;) {
    const from = after;
    const ids = await deps.db.transaction(async tx => {
      const page = await accountIdsAfter(tx, from, options.batch ?? BATCH);
      for (const id of page) await reportAccountDeleted(deps, tx, id);
      return page;
    });
    for (const id of ids) accountDeleted(deps, id);
    reported += ids.length;
    const last = ids.at(-1);
    if (last === undefined) return reported;
    after = last;
  }
}
