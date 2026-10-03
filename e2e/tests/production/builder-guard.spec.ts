import { expect, test } from "@playwright/test";

/**
 * A schema-builder address opened directly on a PRODUCTION build, where the
 * builder is off unless the application's configuration turns it on.
 *
 * The admin learns that from a request it makes after sign-in, and the visit
 * must end on the dashboard without the builder's page having been drawn in
 * the gap. On a fast machine the gap is a frame or two, which a test would
 * pass or fail by luck, so this holds the server's answer until the guard has
 * rendered without it, and only then lets it through.
 *
 * Only the production suite can ask this: under `next dev` the builder is on,
 * and the page is supposed to show.
 *
 * @module tests/production/builder-guard
 */

const DEV_USER = { email: "dev@nextly.local", password: "DevPassword123!" };

/**
 * The builder's collections list. Its page is imported with the route table,
 * not lazily, so a guard that lets it through draws it in the same render:
 * there is no chunk to wait for, and so no delay that is long enough on one
 * machine and too short on another. Its heading is the only `h1` that can be
 * in `main` under a builder address while the answer is held.
 */
const BUILDER_ADDRESS = "/admin/builder/collections";

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
        if (underBuilder && document.querySelector("main h1")) {
          window.reportBuilderDrawn?.();
        }
      }).observe(document, { childList: true, subtree: true });
    });

    // Held until this test lets it through, rather than for a fixed time.
    let releaseAnswer = () => {};
    const answerReleased = new Promise<void>(resolve => {
      releaseAnswer = resolve;
    });
    let answersHeld = 0;
    await page.route("**/admin/api/admin-meta/workspace", async route => {
      answersHeld += 1;
      await answerReleased;
      await route.continue();
    });

    await page.goto(BUILDER_ADDRESS);

    // The guard's own waiting state: once it is on screen the guard has
    // rendered with no answer, which is the moment a guard that showed the
    // page would have drawn it. Soft, so a run that fails here still goes on
    // to report whether the builder drew.
    await expect
      .soft(page.locator('[data-slot="builder-guard-pending"]'))
      .toBeVisible();

    releaseAnswer();
    await page.waitForURL(url => url.pathname === "/admin");
    await expect(page.locator("main")).toBeVisible();

    // The answer really was held, or the assertion after it proves nothing.
    expect(answersHeld).toBeGreaterThan(0);
    expect(builderDrawn).toBe(false);
  });
});
