import { expect } from "@playwright/test";

import { gotoAdmin } from "../support/admin";
import { test } from "../support/visible";
import { signIn } from "../support/production-sign-in";

/**
 * The schema builder on a PRODUCTION build: the admin offers none, the server
 * refuses its writes, and entries are created as ever.
 *
 * Schema reaches production through migrations, so a production server turns
 * the builder off whatever the configuration says. Its address opened
 * directly is `builder-guard.spec.ts`; this covers what a signed-in admin is
 * offered and what still works: the rail draws the content an editor works on
 * and no Builders entry, a builder write sent anyway is refused, and an entry
 * made through the admin is saved and listed.
 *
 * @module tests/production/builder-off-in-production
 */

const API = "/admin/api";

/** Distinctive per run, so finding the entry cannot be a coincidence. */
const TITLE = `Made in production ${Date.now().toString(36)}`;

test.describe("the schema builder on a production build", () => {
  test("offers no builder, refuses its writes, and creates an entry", async ({
    page,
  }) => {
    await signIn(page);

    // 1. The rail draws Content, the way to the entries, and no Builders entry.
    // Content first: the rail draws its entries once every answer is in, so an
    // absence read before that would hold by the rail not having drawn yet.
    await gotoAdmin(page, "/");
    const rail = page.locator("aside nav");
    await expect(rail.locator('[aria-label="Content"]')).toBeVisible({
      timeout: 30_000,
    });
    await expect(rail.locator('[aria-label="Builders"]')).toHaveCount(0);

    // 2. The server refuses a builder write from a super-admin's session.
    const refused = await page.request.post(`${API}/collections`, {
      data: {
        name: `refused_${Date.now().toString(36)}`,
        label: "Refused",
        fields: [{ name: "body", type: "text" }],
      },
    });
    expect(refused.status()).toBe(403);
    const body = (await refused.json()) as {
      error?: { code?: string; message?: string };
    };
    expect(body.error?.code).toBe("BUILDER_DISABLED");
    expect(body.error?.message).toContain("off in production");

    // 3. An entry made through the admin is saved and listed.
    await gotoAdmin(page, "/collections/posts/create");
    await page.getByRole("textbox", { name: "Title", exact: true }).fill(TITLE);
    await page.getByRole("button", { name: /save draft/i }).click();
    // Saving a NEW entry returns to the list.
    await page.waitForURL(/\/collections\/posts$/, { timeout: 30_000 });
    await expect(page.getByRole("link", { name: TITLE })).toBeVisible({
      timeout: 30_000,
    });
  });
});
