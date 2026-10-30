/**
 * Seed the dev user and its permissions, and nothing else.
 *
 * Development signs in `admin.devAutoLogin`'s user only when that user exists,
 * so a server booted on an empty database opens on first-run setup. A browser
 * spec that runs its own development server on a database of its own needs
 * that account and none of the demo content: no posts, and no media, whose
 * uploads would outlive the database the spec removes.
 */
import { getNextly } from "nextly";

import { isCliEntry } from "../../../scripts/cli-entry.mjs";
import config from "../nextly.config";

import { ensureSuperAdmin } from "./seed";

if (isCliEntry(import.meta.url)) {
  // Wrapped in an async IIFE because tsx compiles this to CJS, where
  // top-level await is not allowed.
  void (async () => {
    try {
      const { created } = await ensureSuperAdmin(await getNextly({ config }));
      console.log(`[nextly] dev user seeded (${created} created)`);
      process.exit(0);
    } catch (err) {
      console.error(
        "[nextly] seeding the dev user crashed:",
        err instanceof Error ? err.message : String(err)
      );
      process.exit(1);
    }
  })();
}
