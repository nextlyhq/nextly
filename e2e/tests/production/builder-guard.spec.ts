import { expect } from "@playwright/test";

import { test } from "../support/visible";
import { signIn } from "../support/production-sign-in";

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

/**
 * The builder's collections list. Its page is imported with the route table,
 * not lazily, so a guard that lets it through draws it in the same render:
 * there is no chunk to wait for, and so no delay that is long enough on one
 * machine and too short on another. Its heading is the only `h1` a reader can
 * meet in `main` under a builder address while the answer is held. A screen's
 * loading outline draws an `h1` too, an empty one, and is hidden from readers
 * (`aria-hidden`), so a heading inside it is not the builder drawn.
 */
const BUILDER_ADDRESS = "/admin/builder/collections";

/** The workspace's path, as the startup request names it. */
const WORKSPACE_PATH = "/admin-meta/workspace";

declare global {
  interface Window {
    reportBuilderDrawn?: () => void;
  }
}

test.describe("a builder address where the builder is off", () => {
  test("ends on the dashboard without the builder having been drawn", async ({
    page,
  }) => {
    await signIn(page);

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
        const drawn = [...document.querySelectorAll("main h1")].some(
          heading => heading.closest('[aria-hidden="true"]') === null
        );
        if (underBuilder && drawn) {
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
    // A fresh tab asks for what every screen needs first, the workspace among
    // it, in one startup request (`/admin/api/startup?path=…`) answered part by
    // part. Its workspace part is answered as failed, which the admin does not
    // use: it asks for the workspace on its own, and that request is the one
    // held above. Everything else in the startup answer is passed on as it
    // came, so the session settles and the guard renders.
    await page.route("**/admin/api/startup?**", async route => {
      // A thrown handler prints the request, headers and all; abort instead.
      try {
        const response = await route.fetch();
        const answer = (await response.json()) as {
          parts?: Array<{ path: string; status: number; body: unknown }>;
        };
        for (const part of answer.parts ?? []) {
          if (part.path === WORKSPACE_PATH) {
            part.status = 503;
            part.body = null;
          }
        }
        await route.fulfill({ response, json: answer });
      } catch {
        await route.abort().catch(() => undefined);
      }
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
