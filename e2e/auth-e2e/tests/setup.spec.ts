import { test, expect } from "../lib/test-base";

// Runs first. Creates the super admin that all subsequent specs assume exists.
// If the sandbox DB already has an admin, this spec is effectively a no-op
// because the setup page redirects to /admin/login.
test("first-admin setup creates the super-admin and auto-logs-in", async ({
  page,
}) => {
  await page.goto("/admin/setup");

  // If setup is already complete, the form will not be present. That is
  // expected when re-running against an existing sandbox.
  const nameField = page.getByRole("textbox", { name: /full name/i });
  if (!(await nameField.isVisible().catch(() => false))) {
    test.skip(true, "setup already complete on this sandbox");
    return;
  }

  await nameField.fill("Test Admin");
  await page.getByRole("textbox", { name: /email/i }).fill("admin@e2e.test");
  await page
    .getByRole("textbox", { name: "Password", exact: true })
    .fill("CorrectHorseBatteryStaple!1");
  await page
    .getByRole("textbox", { name: /confirm password/i })
    .fill("CorrectHorseBatteryStaple!1");

  await page
    .getByRole("button", { name: /create admin account|get started|continue/i })
    .click();

  await expect(page).toHaveURL(/\/admin($|\/)/, { timeout: 15_000 });
});
