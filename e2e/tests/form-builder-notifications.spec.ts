/**
 * A form's notifications against a real server: the list, and one
 * notification opened directly at its own address, showing who it goes to,
 * when it sends and its message; an edit there is saved with the form and
 * reads back after a reload.
 */
import { expect } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { ok } from "./support/releases-api";
import { test } from "./support/test";

const API = "/admin/api";

test("opens a notification at its own address and saves an edit", async ({
  page,
}) => {
  const stamp = Date.now().toString(36);
  await gotoAdmin(page, "/collections/forms");
  const form = await ok<{ item: { id: string } }>(
    await page.request.post(`${API}/collections/forms/entries`, {
      data: {
        name: `Notifications ${stamp}`,
        slug: `notifications-${stamp}`,
        status: "published",
        fields: [
          { type: "text", name: "name", label: "Name" },
          { type: "email", name: "email", label: "Email" },
          {
            type: "select",
            name: "join",
            label: "Joining",
            options: [
              { label: "In person", value: "in_person" },
              { label: "Online", value: "online" },
            ],
          },
        ],
        notifications: [
          {
            id: "team",
            name: "Notify the events team",
            enabled: true,
            recipientType: "static",
            to: "events@example.com",
            recipients: ["events@example.com", "access@example.com"],
            cc: [],
            bcc: [],
            conditions: {
              match: "any",
              list: [{ field: "join", comparison: "equals", value: "online" }],
            },
            templateSlug: "forms-submission",
          },
        ],
      },
    })
  );
  const base = `/collections/forms/${form.item.id}/notifications`;

  // The list.
  await gotoAdmin(page, base);
  const row = page
    .getByRole("list", { name: "Notifications" })
    .getByRole("listitem")
    .filter({ hasText: "Notify the events team" });
  await expect(row).toContainText("events@example.com, access@example.com");
  await expect(row).toContainText("Only when Joining is Online");

  // Opened directly at its own address.
  await gotoAdmin(page, `${base}?section=team`);
  await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue(
    "Notify the events team"
  );
  const addresses = page.getByRole("list", { name: "Team addresses" });
  await expect(addresses).toContainText("events@example.com");
  await expect(addresses).toContainText("access@example.com");
  await expect(
    page.getByRole("combobox", { name: "How conditions combine" })
  ).toHaveText("Any");

  // An edit, saved with the form, reads back after a reload.
  await page
    .getByRole("textbox", { name: "Add to Team addresses" })
    .fill("hr@example.com");
  await page.keyboard.press("Enter");
  await page
    .getByRole("banner")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await expect(
    page.getByRole("banner").getByText("All changes saved")
  ).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(
    page.getByRole("list", { name: "Team addresses" })
  ).toContainText("hr@example.com", { timeout: 30_000 });

  // Moving between the list and a notification with an edit not yet saved
  // stays on the form: nothing asks to save or discard, and the edit is kept.
  await page
    .getByRole("textbox", { name: "Name" })
    .fill("Notify the whole events team");
  await page.getByRole("link", { name: "All notifications" }).click();
  await expect(page).toHaveURL(/\/notifications$/);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  const renamed = page
    .getByRole("list", { name: "Notifications" })
    .getByRole("listitem")
    .filter({ hasText: "Notify the whole events team" });
  await expect(renamed).toBeVisible();
  await renamed.getByRole("link").first().click();
  await expect(page).toHaveURL(/section=team/);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue(
    "Notify the whole events team"
  );
});
