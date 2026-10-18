import { expect, test, type Page } from "@playwright/test";

import {
  EMPTY_INSTALL_PORT,
  EMPTY_INSTALL_SETUP_TOKEN,
} from "../../support/empty-install";

/**
 * First-administrator setup on a PRODUCTION build, through the real form.
 *
 * In production, until an install has an administrator, setup needs the
 * setup token, so whoever first reaches the setup route of a fresh deployment
 * cannot make themselves its administrator. Only a production build applies
 * that rule, which is why this is in the production suite. It runs against the
 * suite's second install, which has no account, with the operator's token set
 * in `NEXTLY_SETUP_TOKEN`.
 *
 * One test, in order, because each step is the state the next one needs: the
 * form asks for the token, a wrong one creates nobody, the right one creates
 * the administrator, and after that setup is closed.
 *
 * @module tests/production/first-admin-setup
 */

const BASE = `http://localhost:${String(EMPTY_INSTALL_PORT)}`;
const OWNER = {
  name: "Install Owner",
  email: "owner@example.com",
  password: "Owner-Passw0rd!-e2e",
};

/** Wait until the empty install answers, since it starts beside the first. */
async function waitForEmptyInstall(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          return (await page.request.get(`${BASE}/api/health`)).status();
        } catch {
          return 0;
        }
      },
      { timeout: 120_000, intervals: [1_000] }
    )
    .toBe(200);
}

async function fillSetupForm(page: Page, token: string): Promise<void> {
  await page.getByLabel("Setup token").fill(token);
  await page.getByLabel("Full Name").fill(OWNER.name);
  await page.getByLabel("Email Address").fill(OWNER.email);
  // By role and exact name, since a label match also finds the "Show
  // password" toggles.
  await page
    .getByRole("textbox", { name: "Password", exact: true })
    .fill(OWNER.password);
  await page
    .getByRole("textbox", { name: "Confirm Password", exact: true })
    .fill(OWNER.password);
}

test.describe("first-administrator setup in production", () => {
  test("needs the setup token, and closes once the administrator exists", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await waitForEmptyInstall(page);

    const status = await page.request.get(
      `${BASE}/admin/api/auth/setup-status`
    );
    expect(status.status()).toBe(200);
    expect(await status.json()).toMatchObject({
      isSetup: false,
      requiresSetupToken: true,
    });

    await page.goto(`${BASE}/admin/setup`);
    await expect(page.getByLabel("Setup token")).toBeVisible({
      timeout: 60_000,
    });

    // A wrong token is refused, and nobody is created.
    await fillSetupForm(page, "not-the-token-for-this-install");
    await page.getByRole("button", { name: /create admin account/i }).click();
    await expect(
      page.getByText(/a valid setup token is required/i).first()
    ).toBeVisible({ timeout: 30_000 });
    const stillOpen = await page.request.get(
      `${BASE}/admin/api/auth/setup-status`
    );
    expect(await stillOpen.json()).toMatchObject({ isSetup: false });

    // The operator's token creates the administrator and signs them in.
    await page.getByLabel("Setup token").fill(EMPTY_INSTALL_SETUP_TOKEN);
    await page.getByRole("button", { name: /create admin account/i }).click();
    await page.waitForURL(/\/admin(\/dashboard)?\/?$/, { timeout: 60_000 });
    await expect(page.locator("main")).toBeVisible({ timeout: 60_000 });

    // Setup is closed now, whatever token is presented.
    const closed = await page.request.get(
      `${BASE}/admin/api/auth/setup-status`
    );
    expect(await closed.json()).toMatchObject({
      isSetup: true,
      requiresSetupToken: false,
    });
  });
});
