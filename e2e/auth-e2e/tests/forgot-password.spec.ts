import { waitForMessageTo, extractLink } from "../lib/mailpit";
import { test, expect } from "../lib/test-base";

// NOTE: this spec rewrites the super-admin password. Keep it running
// before change-password.spec.ts and restore-ish by picking the same
// final password so login-logout.spec.ts keeps working with it.
const FINAL_PASSWORD = "NewStrongerPass!2";

test("forgot password sends reset email and sets a new password", async ({
  page,
}) => {
  const email = "admin@e2e.test";

  await page.goto("/admin/forgot-password");
  await page.getByRole("textbox", { name: /email/i }).fill(email);
  await page.getByRole("button", { name: /send reset link/i }).click();

  await expect(page.getByText(/check your (email|inbox)/i)).toBeVisible({
    timeout: 15_000,
  });

  const msg = await waitForMessageTo(email);
  expect(msg.Subject.toLowerCase()).toMatch(/reset/);
  const resetUrl = extractLink(msg, url =>
    url.includes("/admin/reset-password")
  );

  await page.goto(resetUrl);
  await page
    .getByRole("textbox", { name: /new password/i })
    .fill(FINAL_PASSWORD);
  await page
    .getByRole("textbox", { name: /confirm password/i })
    .fill(FINAL_PASSWORD);
  await page.getByRole("button", { name: /reset password/i }).click();

  await expect(
    page.getByText(/password.*(reset|updated|changed)/i)
  ).toBeVisible({
    timeout: 15_000,
  });

  // Log in with the new password to prove the update stuck.
  await page.goto("/admin/login");
  await page.getByRole("textbox", { name: /email/i }).fill(email);
  await page.getByRole("textbox", { name: /password/i }).fill(FINAL_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/admin($|\/)/, { timeout: 15_000 });
});
