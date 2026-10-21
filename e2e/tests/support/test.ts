/**
 * The `test` every spec in this suite is written with: Playwright's own, with
 * the stored session renewed before each test (see `./session`).
 *
 * `storageState`, which the `context` and `page` a test is handed open with,
 * waits for the renewal, so they carry the renewed session; being automatic
 * alone does not order a fixture before `context`. The renewal is automatic as
 * well, so a spec that opens its own context from `STORAGE_STATE` in its body
 * reads the renewed file too. A spec that sets `storageState` itself with
 * `test.use` replaces the wait; the automatic renewal still keeps the stored
 * session within one test of its limit, and so minutes clear of its expiry.
 * The suite holds every spec to this `test` rather than Playwright's, which
 * would run without any of it (`session-stays-signed-in.spec.ts`).
 *
 * @module tests/support/test
 */
import { test as base } from "@playwright/test";

import { keepSessionFresh, STORAGE_STATE } from "./session";

export const test = base.extend<{ freshSession: string }>({
  freshSession: [
    async ({ baseURL }, use) => {
      if (baseURL) await keepSessionFresh(baseURL);
      await use(STORAGE_STATE);
    },
    { auto: true },
  ],
  storageState: async ({ freshSession }, use) => {
    await use(freshSession);
  },
});
