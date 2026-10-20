/**
 * Prepare an install with no account in it: Nextly's tables, and nothing
 * else.
 *
 * Booting Nextly outside production provisions the schema of the database
 * `DATABASE_URL` names, as the seed does before it writes anything. This stops
 * there, so the install is the one an operator first deploys: no
 * administrator, and setup still open. The production browser suite serves
 * one such install, to drive the first-administrator setup form against a
 * production build.
 */
import { getNextly } from "nextly";

import { isCliEntry } from "../../../scripts/cli-entry.mjs";
import config from "../nextly.config";

if (isCliEntry(import.meta.url)) {
  // Wrapped in an async IIFE because tsx compiles this to CJS, where
  // top-level await is not allowed.
  void (async () => {
    try {
      await getNextly({ config });
      console.log("[nextly] provisioned an install with no account");
      process.exit(0);
    } catch (err) {
      console.error(
        "[nextly] provisioning crashed:",
        err instanceof Error ? err.message : String(err)
      );
      process.exit(1);
    }
  })();
}
