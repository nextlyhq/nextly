/**
 * Signing in while the server is still starting, in a browser that has never
 * signed in here: the real sign-in form is drawn at once, takes typing while
 * every admin request is held, keeps its button marked unavailable and says
 * it is connecting, and sends the sign-in exactly once when the server
 * answers, ending on the dashboard.
 *
 * Only a production build can ask this: under `next dev` the playground signs
 * a visitor in by itself, so there is no signed-out first visit to watch.
 *
 * @module tests/production/sign-in-while-starting
 */
import { expect } from "@playwright/test";

import { SEEDED_USER } from "../support/session.mjs";
import { test } from "../support/visible";

/** The admin's record that this browser has signed in here before. */
const SIGNED_IN_HERE_KEY = "nextly:admin:signed-in-here";

// Signed out, with nothing stored: a browser that never signed in here.
test.use({ storageState: { cookies: [], origins: [] } });

test("a sign-in typed while the server starts is sent once, when it answers", async ({
  page,
}) => {
  test.setTimeout(120_000);

  // Every admin request held until the test lets them through.
  let release = () => {};
  const released = new Promise<void>(resolve => {
    release = resolve;
  });
  let held = 0;
  await page.route("**/admin/api/**", async route => {
    held += 1;
    try {
      await released;
      await route.continue();
    } catch {
      // The page went away while the request was held.
    }
  });
  const signIns: string[] = [];
  page.on("request", request => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/admin/api/auth/login"
    ) {
      signIns.push(request.url());
    }
  });

  await page.goto("/admin", { waitUntil: "commit" });

  // The real form, at once, with nothing answered.
  const email = page.getByRole("textbox", { name: /email/i });
  const password = page.getByRole("textbox", { name: /password/i });
  await expect(email).toBeVisible();
  await email.fill(SEEDED_USER.email);
  await password.fill(SEEDED_USER.password);

  const button = page.getByRole("button", { name: /sign in/i });
  await expect(button).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByTestId("sign-in-connecting")).toHaveText(
    "Connecting…"
  );
  // Pressed while the server is held: taken, and not sent yet.
  await button.click();
  await button.click();
  await page.waitForTimeout(500);
  expect(signIns).toHaveLength(0);
  expect(held).toBeGreaterThan(0);
  // What was typed is still there.
  await expect(email).toHaveValue(SEEDED_USER.email);

  release();

  // Signed in, on the dashboard, in a browser that now has the record.
  await expect(page.getByTestId("dashboard-container")).toBeVisible({
    timeout: 60_000,
  });
  expect(signIns).toHaveLength(1);
  expect(
    await page.evaluate(
      key => window.localStorage.getItem(key),
      SIGNED_IN_HERE_KEY
    )
  ).toBe("1");
});
