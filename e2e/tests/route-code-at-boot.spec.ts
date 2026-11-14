/**
 * A direct visit fetches its screen's code while the session check is still
 * out, not after its answer.
 *
 * A private screen is drawn only once the server confirms the session, and its
 * page is a chunk loaded on demand. Fetched when the screen first renders, that
 * chunk would wait for the session's answer before its download began: one
 * more round trip on every direct visit. The router starts it as soon as it
 * resolves the address instead.
 *
 * Every admin request is held on a promise the test releases, so "the session
 * has not answered" is a state the test holds rather than a race. While it is
 * held, the browser must already have downloaded the chunk holding the visited
 * page, recognised by a string only that page's code carries (chunk names are
 * the bundler's, and change with every build).
 *
 * @module tests/route-code-at-boot.spec
 */
import { expect, type Page } from "@playwright/test";

import { ADMIN } from "./support/admin";
import { test } from "./support/test";

/** The admin's record that this browser has signed in here before. */
const SIGNED_IN_HERE_KEY = "nextly:admin:signed-in-here";

/** The screen visited, and a string only its page's code carries. */
const SCREEN = "/settings/webhooks";
const SCREEN_CODE_MARK =
  "Send signed events to your services when content changes";

/** The admin's requests: everything under its API, save the dev reload stream. */
const isAdminRequest = (url: URL): boolean =>
  url.pathname.startsWith("/admin/api/") &&
  url.pathname !== "/admin/api/dev-reload";

/** Holds every admin request until `release` is called, counting them. */
async function holdAdminRequests(page: Page) {
  let release = () => {};
  const released = new Promise<void>(resolve => {
    release = resolve;
  });
  let held = 0;
  let answered = 0;
  await page.route(isAdminRequest, async route => {
    held += 1;
    try {
      await released;
      await route.continue();
      answered += 1;
    } catch {
      // The page went away while the request was held.
    }
  });
  return { release, held: () => held, answered: () => answered };
}

/**
 * Records each script the page downloads whose code carries `mark`, read from
 * the response itself, so it is the visited page's code and not a chunk that
 * merely loads near it.
 */
function watchForScreenCode(page: Page, mark: string) {
  let seen = false;
  page.on("response", response => {
    if (response.request().resourceType() !== "script") return;
    response
      .text()
      .then(code => {
        if (code.includes(mark)) seen = true;
      })
      .catch(() => {
        // A body the browser no longer holds: a script of a page left behind.
      });
  });
  return () => seen;
}

test.beforeEach(async ({ page }) => {
  // A dev server compiles each route on its first request; one visit first,
  // so what the test watches is the admin's loading, not the compiler's.
  await page.goto(`${ADMIN}${SCREEN}`);
  await expect(page.locator("main")).toBeVisible({ timeout: 60_000 });
});

test("downloads the screen's code with the session check still held", async ({
  page,
}) => {
  // A fresh page, so nothing of the warming visit is in its module map.
  const visit = await page.context().newPage();
  await visit.addInitScript(key => {
    window.localStorage.setItem(key, "1");
  }, SIGNED_IN_HERE_KEY);
  const held = await holdAdminRequests(visit);
  const screenCodeSeen = watchForScreenCode(visit, SCREEN_CODE_MARK);

  await visit.goto(`${ADMIN}${SCREEN}`, { waitUntil: "commit" });

  // The frame is up: the admin's code has run and the router has resolved
  // the address.
  await expect(visit.locator("aside[data-shell-answers]")).toBeVisible({
    timeout: 60_000,
  });
  await expect
    .poll(screenCodeSeen, {
      message: "the screen's code was not fetched while the session was held",
      timeout: 20_000,
    })
    .toBe(true);
  // The session really was held the whole time: nothing answered, and the
  // screen itself is not drawn.
  expect(held.held()).toBeGreaterThan(0);
  expect(held.answered()).toBe(0);
  await expect(visit.getByText(SCREEN_CODE_MARK)).toHaveCount(0);

  held.release();
  await expect(visit.getByText(SCREEN_CODE_MARK)).toBeVisible({
    timeout: 60_000,
  });
  await visit.close();
});
