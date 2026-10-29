/**
 * The suite's one signed-in session, kept younger than the access token it holds.
 *
 * The session is made once, before the first test, and every test's browser
 * context opens with it. Its access token lives 15 minutes, and nothing in a
 * test renews it: a context opened from the stored file carries the token the
 * file holds. A suite that runs past 15 minutes would otherwise have every
 * later test signed out -- each refused with `TOKEN_EXPIRED` -- whatever it was
 * testing.
 *
 * So the stored session is replaced, by signing in again, once it is older
 * than `SESSION_MAX_AGE_MS`. Checked before each test (see `./test`), that
 * leaves every test at least five minutes of token, longer than any one test
 * runs. Signing in again rather than refreshing: a refresh rotates the refresh
 * token that contexts still open were handed, and a new session leaves theirs
 * alone.
 *
 * Plain JavaScript, so the visual check (`scripts/visual-check`) can load it
 * on every Node version `engines` allows, with no type stripping.
 *
 * @module tests/support/session
 */
import { renameSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const E2E_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);

/** Where the session every test opens with is stored. */
export const STORAGE_STATE = path.join(E2E_ROOT, ".playwright", "session.json");

/**
 * The user the playground's seed creates (`apps/playground/scripts/seed.ts`).
 * A production server has no dev auto-login, so the suite signs in as it,
 * through the form, as the production suite does.
 */
const SEEDED_USER = { email: "dev@nextly.local", password: "DevPassword123!" };

/** How old the stored session may be before a test is handed a new one. */
export const SESSION_MAX_AGE_MS = 10 * 60_000;

/**
 * Signs in and stores the session at `file`.
 *
 * The playground's `admin.devAutoLogin` issues a real session for
 * `dev@nextly.local` on a first `/admin` visit, and the requests the admin
 * fires before it lands come back 401; signing in here, once, spares every test
 * that burst of failed requests.
 *
 * Written beside the file and moved into place, so a test opening its context
 * meanwhile reads the old session or the new one, never half of either.
 *
 * @param {string} baseURL
 * @param {string} [file]
 * @returns {Promise<void>}
 */
export async function signIn(baseURL, file = STORAGE_STATE) {
  const browser = await chromium.launch();
  try {
    // An empty jar, said explicitly: inside a test, Playwright gives every new
    // context the test's own `storageState` unless told otherwise, and a page
    // already signed in as the test's account never shows the sign-in form.
    const page = await browser.newPage({
      baseURL,
      storageState: { cookies: [], origins: [] },
    });
    // The admin route compiles lazily, so on a cold dev server the first sign
    // in spends the whole compile inside this navigation; the default 30s is
    // not enough on a slow CI runner, where `webServer` already allows 240s for
    // boot for the same reason.
    await page.goto("/admin", { timeout: 180_000 });
    if (process.env.E2E_SERVER === "production") {
      await page
        .getByRole("textbox", { name: /email/i })
        .fill(SEEDED_USER.email);
      // By role, since a label match also finds the "Show password" toggle.
      await page
        .getByRole("textbox", { name: /password/i })
        .fill(SEEDED_USER.password);
      await page.getByRole("button", { name: /sign in|log in/i }).click();
    }

    // The admin is client-rendered: the shell is served empty and filled after
    // hydration, so the session is only real once a screen has drawn.
    await page.locator("main").waitFor({ state: "visible", timeout: 60_000 });

    const cookies = await page.context().cookies();
    if (!cookies.some(cookie => cookie.name === "nextly_session")) {
      throw new Error(
        "[e2e] The admin rendered but issued no session cookie. " +
          "Dev auto-login does not fire for 127.0.0.1 — check baseURL is localhost."
      );
    }

    const writing = `${file}.${process.pid}.tmp`;
    await page.context().storageState({ path: writing });
    renameSync(writing, file);
  } finally {
    await browser.close();
  }
}

/**
 * How long ago the session at `file` was stored; never stored is infinitely long.
 *
 * @param {string} file
 * @param {number} now
 * @returns {number}
 */
function ageOf(file, now) {
  try {
    return now - statSync(file).mtimeMs;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * Signs in again when the session at `file` is older than `maxAgeMs`, and says
 * whether it did.
 *
 * @param {string} baseURL
 * @param {string} [file]
 * @param {number} [maxAgeMs]
 * @returns {Promise<boolean>}
 */
export async function keepSessionFresh(
  baseURL,
  file = STORAGE_STATE,
  maxAgeMs = SESSION_MAX_AGE_MS
) {
  if (ageOf(file, Date.now()) <= maxAgeMs) return false;
  await signIn(baseURL, file);
  return true;
}
