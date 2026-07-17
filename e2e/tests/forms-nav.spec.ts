/**
 * Forms navigation: the plugin declares standalone placement, so Forms is a
 * first-class main-rail item whose sub-sidebar lists the plugin's
 * collections — and it appears exactly once (no Plugins-section duplicate,
 * no Collections-group duplicate).
 */
import { expect, test } from "@playwright/test";

import { gotoAdmin } from "./support/admin";

test("Forms lives in the main rail exactly once, with its collections inside", async ({
  page,
}) => {
  await gotoAdmin(page, "");

  // The standalone rail item resolves to the forms collection; the rail is
  // icon-only, so the assertion keys on the href. Exactly one such entry.
  const rail = page.getByRole("navigation").first();
  const railForms = rail.locator('a[href="/admin/collections/forms"]');
  await expect(railForms).toHaveCount(1);

  // The old duplicates are gone: the Collections sub-sidebar carries no
  // Forms group (the plugin's collections moved into the standalone
  // section wholesale).
  await rail.locator('a[href="/admin/collections"]').click();
  await expect(
    page
      .getByRole("link", { name: "Forms", exact: true })
      .filter({ visible: true })
  ).toHaveCount(0);

  // The rail item opens the standalone sub-sidebar with the plugin's
  // collections as links.
  await railForms.click();
  await expect(
    page
      .getByRole("link", { name: "Forms", exact: true })
      .filter({ visible: true })
  ).toBeVisible();
  const submissionsLink = page
    .getByRole("link", { name: "Submissions", exact: true })
    .filter({ visible: true });
  await expect(submissionsLink).toBeVisible();

  // The links actually navigate to the collection surfaces.
  await submissionsLink.first().click();
  await expect(page).toHaveURL(/collections\/form-submissions/);
});
