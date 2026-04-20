import { test, expect } from "../lib/test-base";

// Hit each state-changing auth endpoint directly without a CSRF token
// and assert 403. Mirrors the unit-level coverage test in the nextly
// package but runs against the real dev server.
const PROTECTED = [
  {
    method: "POST",
    path: "/admin/api/auth/login",
    body: { email: "a@b.c", password: "pw" },
  },
  {
    method: "POST",
    path: "/admin/api/auth/register",
    body: {
      email: "a@b.c",
      password: "CorrectHorseBatteryStaple!1",
      name: "x",
    },
  },
  {
    method: "POST",
    path: "/admin/api/auth/forgot-password",
    body: { email: "a@b.c" },
  },
  {
    method: "POST",
    path: "/admin/api/auth/reset-password",
    body: { token: "t", newPassword: "CorrectHorseBatteryStaple!1" },
  },
  {
    method: "POST",
    path: "/admin/api/auth/verify-email/resend",
    body: { email: "a@b.c" },
  },
] as const;

for (const route of PROTECTED) {
  test(`${route.method} ${route.path} rejects requests with no CSRF token`, async ({
    request,
  }) => {
    const res = await request.fetch(route.path, {
      method: route.method,
      data: route.body,
    });
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.error?.code).toBe("CSRF_FAILED");
  });
}
