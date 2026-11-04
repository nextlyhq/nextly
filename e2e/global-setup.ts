import type { FullConfig } from "@playwright/test";

import { e2eDatabase } from "./support/e2e-database.mjs";
import { startFontCatalogue } from "./support/font-catalogue-server.mjs";
import { dropServerDatabase } from "./support/server-database.mjs";
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
 *
 * Also starts the stand-in Google Fonts catalogue, which nothing reaches until
 * a spec adds a font. The run's teardown stops it and, on PostgreSQL and
 * MySQL, drops the database `scripts/reset-e2e-db.mjs` created for the run.
 */
async function globalSetup(config: FullConfig): Promise<() => Promise<void>> {
  const baseURL = config.projects[0]?.use?.baseURL;
  if (!baseURL) throw new Error("[e2e] No baseURL configured.");
  // The run's database, by the port the server was started on, as the
  // config named it.
  const database = e2eDatabase({ port: Number(new URL(baseURL).port) });
  const stopCatalogue = await startFontCatalogue();
  await signIn(baseURL);
  return async () => {
    try {
      await stopCatalogue();
    } finally {
      if (database.dialect !== "sqlite") await dropServerDatabase(database);
    }
  };
}

export default globalSetup;
