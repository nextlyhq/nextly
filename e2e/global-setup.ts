import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, type FullConfig } from "@playwright/test";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const STORAGE_STATE = path.join(HERE, ".playwright", "session.json");

/**
 * Signs in once and hands the session to every test.
 *
 * The playground's `admin.devAutoLogin` issues a real session for
 * `dev@nextly.local` on the first `/admin` visit — but only on the first, and
 * the requests the admin fires before it lands come back 401. Letting each test
 * discover that for itself means every one of them starts with a burst of
 * failed requests and a retry, which is both slow and indistinguishable from
 * the thing a test would want to catch.
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

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ baseURL });
    await page.goto("/admin");

    // The admin is client-rendered: the shell is served empty and filled after
    // hydration, so the session is only real once a screen has drawn.
    await page.locator("main").waitFor({ state: "visible", timeout: 60_000 });

    const cookies = await page.context().cookies();
    const session = cookies.find(c => c.name === "nextly_session");
    if (!session) {
      throw new Error(
        "[e2e] The admin rendered but issued no session cookie. " +
          "Dev auto-login does not fire for 127.0.0.1 — check baseURL is localhost."
      );
    }

    await page.context().storageState({ path: STORAGE_STATE });
  } finally {
    await browser.close();
  }
}

export default globalSetup;
