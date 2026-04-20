import { test, expect } from "../lib/test-base";

test("admin can log in and log out", async ({ page }) => {
  await page.goto("/admin/login");
  await page.getByRole("textbox", { name: /email/i }).fill("admin@e2e.test");
  await page
    .getByRole("textbox", { name: /password/i })
    .fill("CorrectHorseBatteryStaple!1");
  await page.getByRole("button", { name: /sign in/i }).click();

  await expect(page).toHaveURL(/\/admin($|\/)/, { timeout: 15_000 });

  await page.getByRole("button", { name: /user profile menu/i }).click();
  await page.getByRole("menuitem", { name: /sign out|log out/i }).click();

  await expect(page).toHaveURL(/\/admin\/login/, { timeout: 10_000 });
});
