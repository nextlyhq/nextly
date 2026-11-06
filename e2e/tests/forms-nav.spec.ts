/**
 * Forms navigation: the plugin declares standalone placement, so Forms is a
 * first-class main-rail item whose sub-sidebar lists the plugin's
 * collections — and it appears exactly once (no Plugins-section duplicate,
 * no Collections-group duplicate).
 */
import { expect } from "@playwright/test";

import { test } from "./support/test";
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
  // section wholesale). The rail's one Content item opens the panel, named
  // by its label since it is a link or a button by surface, and the panel's
  // Collections part is chosen in its "Content type" switch.
  await rail.getByLabel("Content", { exact: true }).click();
  await page
    .getByRole("navigation", { name: "Content type" })
    .getByRole("link", { name: "Collections" })
    .click();
  // The rail's own Forms item is named "Forms" for assistive technology, so
  // it is the one visible link of that name: the Collections panel adds none.
  const formsLinks = page
    .getByRole("link", { name: "Forms", exact: true })
    .filter({ visible: true });
  await expect(formsLinks).toHaveCount(1);
  await expect(
    rail.getByRole("link", { name: "Forms", exact: true })
  ).toHaveCount(1);

  // The rail item opens the standalone sub-sidebar with the plugin's
  // collections as links.
  await railForms.click();
  // The standalone panel's Forms link joins the rail's.
  await expect(formsLinks).toHaveCount(2);
  const submissionsLink = page
    .getByRole("link", { name: "Submissions", exact: true })
    .filter({ visible: true });
  await expect(submissionsLink).toBeVisible();

  // The links actually navigate to the collection surfaces.
  await submissionsLink.first().click();
  await expect(page).toHaveURL(/collections\/form-submissions/);
});
