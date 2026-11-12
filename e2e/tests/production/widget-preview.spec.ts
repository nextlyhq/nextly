import { expect } from "@playwright/test";

import { includingHidden, test } from "../support/visible";
import { signIn } from "../support/production-sign-in";

/**
 * The admin's old widget preview address, and the preview read, on a
 * PRODUCTION build.
 *
 * The admin has no preview page in any mode: a direct visit to its old
 * address draws the admin's not-found page, as an address nobody serves does,
 * and the dashboard offers no way in. The read the browser tests' widget check
 * draws from is served by a development server alone, so here it answers
 * exactly as a path the server does not serve, byte for byte.
 *
 * The development half, that the old address is not found there either and
 * the check's page draws from the read, is `tests/widget-preview.spec.ts`.
 *
 * @module tests/production/widget-preview
 */

/** The admin's old preview address, and one beside it that no route serves. */
const PREVIEWS = "/admin/dev/widget-previews";
const UNSERVED = "/admin/dev/no-such-page";

test.describe("the widget preview address on a production build", () => {
  test("a direct visit is not found, as an unserved address is, and the dashboard offers no way in", async ({
    page,
  }) => {
    await signIn(page);
    // Customise mode draws no link to the page.
    await page
      .getByTestId("dashboard-edit-begin")
      .filter({ visible: true })
      .click();
    await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
    await expect(
      includingHidden(page).getByText("Preview widgets")
    ).toHaveCount(0);
    await expect(
      includingHidden(page).locator('a[href*="widget-previews"]')
    ).toHaveCount(0);
    await page
      .getByTestId("dashboard-edit-cancel")
      .filter({ visible: true })
      .click();

    // The control: an address no route serves, and what the admin draws there.
    await page.goto(UNSERVED);
    const notFound = page
      .getByText("Oops! This page doesn't exist")
      .filter({ visible: true });
    await expect(notFound).toBeVisible({ timeout: 60_000 });
    const unservedTitle = await page.title();

    await page.goto(PREVIEWS);
    await expect(notFound).toBeVisible({ timeout: 60_000 });
    await expect(
      page.getByRole("heading", {
        name: "Widget previews",
        includeHidden: true,
      })
    ).toHaveCount(0);
    await expect(page.locator("[data-preview-section]")).toHaveCount(0);
    // The tab says what it says for any unserved address.
    expect(await page.title()).toBe(unservedTitle);
  });

  test("the read answers exactly as a path the server does not serve", async ({
    page,
  }) => {
    await signIn(page);
    const asked = await page.request.get("/admin/api/_dev/widget-previews");
    const unserved = await page.request.get("/admin/api/_dev/no-such-read");
    expect(asked.status()).toBe(unserved.status());
    expect(asked.status()).not.toBe(200);
    expect(asked.headers()["content-type"]).toBe(
      unserved.headers()["content-type"]
    );
    expect(await asked.text()).toBe(await unserved.text());
  });
});
