/**
 * A deep link to a plugin-contributed page resolves and renders.
 *
 * Plugin page routes register after admin-meta loads, later than `useRouter`'s
 * one-time initial resolution. Before the fix, loading a plugin page URL
 * directly (deep link / hard refresh) resolved before the route registry was
 * populated and rendered the admin's 404 screen. The style-fixture plugin
 * exposes its showcase at `/admin/plugins/style-fixture/showcase`; this asserts
 * it renders rather than 404ing.
 */
import { expect, test } from "@playwright/test";

import { gotoAdmin } from "./support/admin";

test("a deep link to a plugin page resolves and renders (not 404)", async ({
  page,
}) => {
  await gotoAdmin(page, "/plugins/style-fixture/showcase");

  // The plugin's component rendered — the route resolved to it, not the 404.
  await expect(page.getByTestId("sf-card")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Page Not Found")).toHaveCount(0);
});
