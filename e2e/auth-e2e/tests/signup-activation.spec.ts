import { waitForMessageTo, extractLink } from "../lib/mailpit";
import { test, expect } from "../lib/test-base";

test("signup sends activation email and the link verifies + activates the account", async ({
  page,
}) => {
  const email = `new-user-${Date.now()}@e2e.test`;
  const password = "CorrectHorseBatteryStaple!1";

  await page.goto("/admin/register");
  await page.getByRole("textbox", { name: /full name/i }).fill("New User");
  await page.getByRole("textbox", { name: /email/i }).fill(email);
  await page
    .getByRole("textbox", { name: "Password", exact: true })
    .fill(password);
  await page.getByRole("textbox", { name: /confirm password/i }).fill(password);
  await page.getByRole("button", { name: /create account|sign up/i }).click();

  // Registration redirects to /admin/login.
  await expect(page).toHaveURL(/\/admin\/login/, { timeout: 15_000 });

  // Pull the verification link from Mailpit and open it.
  const msg = await waitForMessageTo(email);
  expect(msg.Subject.toLowerCase()).toMatch(/verify|activat/);
  const verifyUrl = extractLink(msg, url =>
    url.includes("/admin/verify-email")
  );

  await page.goto(verifyUrl);
  await expect(
    page.getByText(/email verified|verified successfully/i)
  ).toBeVisible({
    timeout: 15_000,
  });

  // Log in with the new user. If the email was not verified AND the
  // account was not activated, this would fail with a toast.
  await page.goto("/admin/login");
  await page.getByRole("textbox", { name: /email/i }).fill(email);
  await page.getByRole("textbox", { name: /password/i }).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();

  await expect(page).toHaveURL(/\/admin($|\/)/, { timeout: 15_000 });
});
