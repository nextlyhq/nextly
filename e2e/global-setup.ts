import type { FullConfig } from "@playwright/test";

import { signIn } from "./tests/support/session";

export { STORAGE_STATE } from "./tests/support/session";

/**
 * Signs in once, before the first test, and stores the session every test
 * opens with; `tests/support/test` renews it as the suite runs.
 *
 * Doing it here once is Playwright's documented shape for authentication, and
 * it buys the smoke tests the right to say "no request failed" and mean it.
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
