/**
 * The `test` every spec in this suite is written with: Playwright's own, with
 * the stored session renewed before each test (see `./session`).
 *
 * An automatic fixture, which Playwright sets up before the fixtures a test
 * uses, so the `context` and `page` a test is handed open with the renewed
 * session, and so does a context a spec opens itself from `STORAGE_STATE`. The
 * lint config holds every spec to this `test` rather than Playwright's, which
 * would run without it.
 *
 * @module tests/support/test
 */
import { test as base } from "@playwright/test";

import { keepSessionFresh } from "./session";

export const test = base.extend<{ freshSession: void }>({
  freshSession: [
    async ({ baseURL }, use) => {
      if (baseURL) await keepSessionFresh(baseURL);
      await use();
    },
    { auto: true },
  ],
});
