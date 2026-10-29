import { expect, test, type Page } from "@playwright/test";

/**
 * The widget preview page's address, and its read, on a PRODUCTION build.
 *
 * The page exists only while the server runs in development, and a production
 * server must neither serve it nor say it exists: a direct visit draws the
 * admin's not-found page, as an address nobody serves does; the dashboard
 * offers no way in; and the read the page draws from answers exactly as a
 * path the server does not serve, byte for byte.
 *
 * Only the production suite can ask this: under `next dev` the page is
 * supposed to show (`tests/widget-preview.spec.ts`).
 *
 * @module tests/production/widget-preview
 */

const DEV_USER = { email: "dev@nextly.local", password: "DevPassword123!" };

/** The preview page's address, and one beside it that no route serves. */
const PREVIEWS = "/admin/dev/widget-previews";
const UNSERVED = "/admin/dev/no-such-page";

async function signIn(page: Page): Promise<void> {
  await page.goto("/admin");
  await page.getByRole("textbox", { name: /email/i }).fill(DEV_USER.email);
  // By role, since a label match also finds the "Show password" toggle.
  await page
    .getByRole("textbox", { name: /password/i })
    .fill(DEV_USER.password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await expect(page.locator("main")).toBeVisible({ timeout: 60_000 });
}

test.describe("the widget preview page on a production build", () => {
  test("a direct visit is not found, as an unserved address is, and the dashboard offers no way in", async ({
    page,
  }) => {
    await signIn(page);
    // Customise mode, where a development server draws the link beside its
    // other actions, draws none.
    await page.getByTestId("dashboard-edit-begin").click();
    await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
    await expect(page.getByTestId("widget-previews-link")).toHaveCount(0);
    await page.getByTestId("dashboard-edit-cancel").click();

    // The control: an address no route serves, and what the admin draws there.
    await page.goto(UNSERVED);
    const notFound = page.getByText("Oops! This page doesn't exist");
    await expect(notFound).toBeVisible({ timeout: 60_000 });
    const unservedTitle = await page.title();

    await page.goto(PREVIEWS);
    await expect(notFound).toBeVisible({ timeout: 60_000 });
    await expect(
      page.getByRole("heading", { name: "Widget previews" })
    ).toHaveCount(0);
    await expect(page.locator("[data-preview-section]")).toHaveCount(0);
    // The tab says what it says for any unserved address.
    expect(await page.title()).toBe(unservedTitle);
  });

  test("the read answers exactly as a path the server does not serve", async ({
    page,
  }) => {
    await signIn(page);
    const asked = await page.request.get(
      "/admin/api/dashboard/widget-previews"
    );
    const unserved = await page.request.get(
      "/admin/api/dashboard/no-such-read"
    );
    expect(asked.status()).toBe(unserved.status());
    expect(asked.status()).not.toBe(200);
    expect(asked.headers()["content-type"]).toBe(
      unserved.headers()["content-type"]
    );
    expect(await asked.text()).toBe(await unserved.text());
  });
});
