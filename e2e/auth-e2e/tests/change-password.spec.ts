import { test, expect } from "../lib/test-base";

// /auth/change-password has no admin UI at the moment. Exercise it directly
// through the REST endpoint while authenticated, and cover the CSRF-negative
// case in the same spec.
test("change-password requires CSRF, changes password on success", async ({
  page,
}) => {
  // Assume forgot-password.spec.ts has run first and the password is
  // NewStrongerPass!2. Log in through the UI to get cookies.
  await page.goto("/admin/login");
  await page.getByRole("textbox", { name: /email/i }).fill("admin@e2e.test");
  await page
    .getByRole("textbox", { name: /password/i })
    .fill("NewStrongerPass!2");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/admin($|\/)/, { timeout: 15_000 });

  const ctx = page.context();

  // Missing CSRF -> 403.
  const noCsrf = await ctx.request.fetch("/admin/api/auth/change-password", {
    method: "PATCH",
    data: {
      currentPassword: "NewStrongerPass!2",
      newPassword: "EvenBetter!3",
    },
  });
  expect(noCsrf.status()).toBe(403);

  // Fetch CSRF token.
  const csrfRes = await ctx.request.get("/admin/api/auth/csrf");
  const csrfBody = await csrfRes.json();
  const csrfToken = csrfBody.data?.csrfToken ?? csrfBody.csrfToken;
  expect(csrfToken).toBeTruthy();

  // Wrong current password -> failure.
  const wrong = await ctx.request.fetch("/admin/api/auth/change-password", {
    method: "PATCH",
    data: {
      csrfToken,
      currentPassword: "wrong-old-pass",
      newPassword: "EvenBetter!3",
    },
  });
  expect(wrong.status()).toBeGreaterThanOrEqual(400);

  // Correct -> success.
  const ok = await ctx.request.fetch("/admin/api/auth/change-password", {
    method: "PATCH",
    data: {
      csrfToken,
      currentPassword: "NewStrongerPass!2",
      newPassword: "EvenBetter!3",
    },
  });
  expect(ok.ok()).toBeTruthy();

  // Log back in with the new password. change-password revokes sessions
  // so the current cookie is now dead.
  await page.goto("/admin/login");
  await page.getByRole("textbox", { name: /email/i }).fill("admin@e2e.test");
  await page.getByRole("textbox", { name: /password/i }).fill("EvenBetter!3");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/admin($|\/)/, { timeout: 15_000 });
});
