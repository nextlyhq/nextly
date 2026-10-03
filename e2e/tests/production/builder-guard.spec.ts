import { expect, test } from "@playwright/test";

/**
 * A schema-builder address opened directly on a PRODUCTION build, where the
 * builder is off unless the application's configuration turns it on.
 *
 * The admin learns that from a request it makes after sign-in, and the visit
 * must end on the dashboard without the builder's page having been drawn in
 * the gap. On a fast machine the gap is a frame or two, which a test would
 * pass or fail by luck, so this holds the server's answer back long enough for
 * the page to load and draw if anything let it.
 *
 * Only the production suite can ask this: under `next dev` the builder is on,
 * and the page is supposed to show.
 *
 * @module tests/production/builder-guard
 */

const DEV_USER = { email: "dev@nextly.local", password: "DevPassword123!" };

/** The page this opens is a dialog, so one attached under a builder address is the builder. */
const BUILDER_ADDRESS = "/admin/builder/collections/new";

/** Long enough for the builder's lazy page to load and open its dialog. */
const ANSWER_HELD_MS = 3_000;

declare global {
  interface Window {
    reportBuilderDrawn?: () => void;
  }
}

test.describe("a builder address where the builder is off", () => {
  test("ends on the dashboard without the builder having been drawn", async ({
    page,
  }) => {
    await page.goto("/admin");
    await page.getByRole("textbox", { name: /email/i }).fill(DEV_USER.email);
    // By role, since a label match also finds the "Show password" toggle.
    await page
      .getByRole("textbox", { name: /password/i })
      .fill(DEV_USER.password);
    await page.getByRole("button", { name: /sign in|log in/i }).click();
    await expect(page.locator("main")).toBeVisible({ timeout: 60_000 });

    // Reported to this process rather than kept on `window`: the redirect may
    // load a new document, and a flag on the old one would go with it.
    let builderDrawn = false;
    await page.exposeFunction("reportBuilderDrawn", () => {
      builderDrawn = true;
    });
    await page.addInitScript(() => {
      new MutationObserver(() => {
        const underBuilder =
          window.location.pathname.startsWith("/admin/builder");
        if (underBuilder && document.querySelector('[role="dialog"]')) {
          window.reportBuilderDrawn?.();
        }
      }).observe(document, { childList: true, subtree: true });
    });

    let answersHeld = 0;
    await page.route("**/admin/api/admin-meta/workspace", async route => {
      answersHeld += 1;
      await new Promise(resolve => setTimeout(resolve, ANSWER_HELD_MS));
      await route.continue();
    });

    await page.goto(BUILDER_ADDRESS);

    // The guard's own waiting state, so the gap below is known to have been
    // spent waiting on the answer rather than on a page that never loaded.
    // Soft, so a run that fails here still reports whether the builder drew.
    await expect
      .soft(page.locator('[data-slot="builder-guard-pending"]'))
      .toBeVisible();

    await page.waitForURL(url => url.pathname === "/admin");
    await expect(page.locator("main")).toBeVisible();

    // The answer really was held, or the assertion after it proves nothing.
    expect(answersHeld).toBeGreaterThan(0);
    expect(builderDrawn).toBe(false);
  });
});
