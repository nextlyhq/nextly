/**
 * The submissions view against a real server: per-field columns when one
 * form is selected, the drawer detail with editing (stamped server-side),
 * the Spam tab with recovery, and the CSV export route. These flows cross
 * the plugin's List-view override, the admin's DataTable, and the plugin's
 * export/permission routes — the seams unit tests mock away.
 */
import { expect, test } from "@playwright/test";

import { gotoAdmin } from "./support/admin";

test.describe.configure({ mode: "serial" });

const FORM_NAME = "E2E Submissions Form";
let formId = "";

test("creates a published form and seeds submissions through the API", async ({
  page,
}) => {
  await gotoAdmin(page, "/collections/forms/create");
  await page.getByRole("textbox", { name: "Form Name" }).fill(FORM_NAME);

  for (const type of [/^Email/, /^Text Single-line/]) {
    await page.getByRole("button", { name: "Add field" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("radio", { name: type }).click();
    await dialog.getByRole("button", { name: "Add field" }).click();
  }

  await page.getByRole("combobox", { name: "Status" }).click();
  await page.getByRole("option", { name: "Published" }).click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page).toHaveURL(/\/collections\/forms$/, { timeout: 30_000 });

  // Seed one clean and one spam-flagged submission via the entries API
  // (the flag-on-submit path itself is covered by integration tests).
  formId = await page.evaluate(async name => {
    const forms = (await (
      await fetch("/admin/api/collections/forms/entries?pageSize=50", {
        credentials: "include",
      })
    ).json()) as { items: Array<{ id: string; name: string }> };
    const form = forms.items.find(item => item.name === name);
    if (!form) throw new Error("form not found");
    for (const body of [
      {
        data: { email: "ada@example.com", text: "hello there" },
        status: "new",
      },
      {
        data: { email: "bot@example.com", text: "buy things" },
        status: "spam",
        spamReason: "honeypot",
      },
    ]) {
      const res = await fetch(
        "/admin/api/collections/form-submissions/entries",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            form: form.id,
            submittedAt: new Date().toISOString(),
            ...body,
          }),
        }
      );
      if (!res.ok) throw new Error(`seed failed: ${res.status}`);
    }
    return form.id;
  }, FORM_NAME);
  expect(formId).not.toBe("");
});

test("shows per-field columns, edits in the drawer, and stamps the edit", async ({
  page,
}) => {
  await gotoAdmin(page, "/collections/form-submissions");

  // No "New Submission" button: submissions are machine-created.
  await expect(
    page.getByRole("button", { name: /New Submission/ })
  ).toHaveCount(0);

  // Select the form: columns become its field labels.
  await page.getByRole("combobox", { name: "Filter by form" }).click();
  await page.getByRole("option", { name: FORM_NAME }).click();
  await expect(page.getByRole("columnheader", { name: "Email" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Text" })).toBeVisible();
  // The table renders desktop rows and responsive cards in the same DOM;
  // filter to the visible variant for the current viewport.
  await expect(
    page.getByText("ada@example.com").filter({ visible: true }).first()
  ).toBeVisible();

  // The spam row stays out of the default view.
  await expect(page.getByText("bot@example.com")).toHaveCount(0);

  // Drawer: values, edit, save — the server stamps the edit.
  await page
    .getByText("ada@example.com")
    .filter({ visible: true })
    .first()
    .click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("hello there")).toBeVisible();
  await sheet.getByRole("button", { name: "Edit" }).click();
  await sheet
    .getByRole("textbox", { name: "Text" })
    .fill("hello there (corrected)");
  await sheet.getByRole("button", { name: "Save", exact: true }).click();

  // The sheet stays open after saving (prev/next continuity); the refetched
  // record flows back in with the server-side edit stamp.
  await expect(sheet.getByText(/Edited .* — the values above/)).toBeVisible({
    timeout: 15_000,
  });
  await page.keyboard.press("Escape");
  await expect(
    page.getByText("hello there (corrected)").filter({ visible: true }).first()
  ).toBeVisible();
});

test("reviews spam in its tab and recovers it", async ({ page }) => {
  await gotoAdmin(page, "/collections/form-submissions");
  await page.getByRole("combobox", { name: "Filter by form" }).click();
  await page.getByRole("option", { name: FORM_NAME }).click();

  await page.getByRole("tab", { name: "Spam" }).click();
  await expect(
    page.getByText("bot@example.com").filter({ visible: true }).first()
  ).toBeVisible();

  // Recover: the drawer's spam banner explains, status New brings it back.
  await page
    .getByText("bot@example.com")
    .filter({ visible: true })
    .first()
    .click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText(/Flagged as spam/)).toBeVisible();
  await sheet.getByLabel("Status").click();
  await page.getByRole("option", { name: "New", exact: true }).click();
  await sheet.getByRole("button", { name: "Save", exact: true }).click();
  await page.keyboard.press("Escape");

  await page.getByRole("tab", { name: "New", exact: true }).click();
  await expect(
    page.getByText("bot@example.com").filter({ visible: true }).first()
  ).toBeVisible({
    timeout: 15_000,
  });
});

test("exports CSV with columns from the form's fields", async ({ page }) => {
  await gotoAdmin(page, "/collections/form-submissions");

  const res = await page.request.get(
    `/admin/api/plugins/@nextlyhq/plugin-form-builder/submissions/export?format=csv&form=${formId}`
  );
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/csv");
  const csv = await res.text();
  expect(csv).toContain("Email");
  expect(csv).toContain("ada@example.com");

  // CSV without a form fails fast with a clear reason.
  const bad = await page.request.get(
    "/admin/api/plugins/@nextlyhq/plugin-form-builder/submissions/export?format=csv"
  );
  expect(bad.status()).toBe(400);
});
