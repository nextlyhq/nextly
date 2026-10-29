import type { FullConfig } from "@playwright/test";

import { signIn } from "./tests/support/session.mjs";

export { STORAGE_STATE } from "./tests/support/session.mjs";

/**
 * Signs the seeded dev user in once, before the first test, and stores the
 * session that `tests/support/test` makes each spec file's own account with,
 * and renews as the suite runs.
 *
 * Doing it here once is Playwright's documented shape for authentication.
 *
 * Runs after `webServer` is up, which is Playwright's order and the order this
 * needs: the database is empty until the server boots, applies the schema and
 * seeds the user this depends on.
 */
async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use?.baseURL;
  if (!baseURL) throw new Error("[e2e] No baseURL configured.");
  await signIn(baseURL);
}

export default globalSetup;
