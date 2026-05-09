/**
 * Regression tests for auth-handler response shapes.
 *
 * One test per handler asserts the canonical respondX wire shape against
 * the spec §7.6 / 7.7 table:
 *
 *   - login            -> respondAction("Logged in.", { user, accessToken, ... })
 *   - logout           -> respondAction("Logged out.")
 *   - refresh          -> respondData({ user, accessToken, refreshToken, expiresAt })
 *   - register         -> respondAction(message, ...)  [silent vs reveal paths]
 *   - setup-status     -> respondData({ isSetup, requiresInitialUser })
 *   - setup            -> respondAction("Setup complete.", { user, ... }, status 201)
 *   - forgot-password  -> respondAction("If an account exists ...")  [no email leak]
 *   - reset-password   -> respondAction("Password reset.")
 *   - verify-email     -> respondAction("Email verified.", { email })
 *   - verify-email/resend -> respondAction("Verification email sent.")
 *   - change-password  -> respondAction("Password changed.")
 *   - session          -> respondData({ user, accessToken })
 *   - csrf             -> respondData({ token })
 *
 * Every test also asserts the body has no `data` property, guarding
 * against accidental re-introduction of a `{ data: ... }` envelope.
 */
import { describe, expect, it, vi } from "vitest";

import { hashPassword } from "../../password";
import { signAccessToken } from "../../jwt/sign";
import { setCsrfCookie } from "../../csrf/csrf-cookie";
import { setAccessTokenCookie } from "../../cookies/access-token-cookie";
import { setRefreshTokenCookie } from "../../cookies/refresh-token-cookie";
import { handleChangePassword } from "../change-password";
import { handleCsrf } from "../csrf";
import { handleForgotPassword } from "../forgot-password";
import { handleLogin } from "../login";
import { handleLogout } from "../logout";
import { handleRefresh } from "../refresh";
import { handleRegister } from "../register";
import { handleResetPassword } from "../reset-password";
import { handleSession } from "../session";
import { handleSetup, handleSetupStatus } from "../setup";
import { handleResendVerification, handleVerifyEmail } from "../verify-email";
import { hashRefreshToken } from "../../session/refresh";

const SECRET = "test-secret-that-is-at-least-32-characters-long!!";

function makeRequest(
  method: string,
  body: Record<string, unknown> | null,
  extra?: { cookie?: string; csrfToken?: string }
): Request {
  const csrfToken = extra?.csrfToken ?? "csrf-test-token";
  // Inject a matching csrf cookie so the double-submit check passes
  // unless the caller explicitly overrides the cookie header.
  const cookie =
    extra?.cookie ??
    `nextly_csrf=${csrfToken}`;
  const merged =
    body == null
      ? null
      : body.csrfToken === undefined
        ? { ...body, csrfToken }
        : body;
  return new Request("http://localhost:3000/admin/api/auth/x", {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:3000",
      cookie,
    },
    body: merged == null ? undefined : JSON.stringify(merged),
  });
}

const ALLOWED_ORIGINS = ["http://localhost:3000"];

describe("login handler: respondAction shape", () => {
  it("returns { message, user, accessToken, refreshToken, expiresAt }", async () => {
    const fakeUser = {
      id: "u1",
      email: "a@example.com",
      name: "A",
      image: null,
      passwordHash: "$2a$10$abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
      emailVerified: new Date(),
      isActive: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
    };

    // verifyCredentials uses bcryptjs; supply a real hash so the compare
    // succeeds without us having to monkey-patch the credentials module.
    const passwordHash = await hashPassword("Pass1234!");

    const deps = {
      secret: SECRET,
      isProduction: false,
      accessTokenTTL: 900,
      refreshTokenTTL: 604800,
      maxLoginAttempts: 5,
      lockoutDurationSeconds: 900,
      loginStallTimeMs: 0,
      requireEmailVerification: true,
      allowedOrigins: ALLOWED_ORIGINS,
      trustProxy: false,
      trustedProxyIps: [],
      findUserByEmail: vi.fn().mockResolvedValue({ ...fakeUser, passwordHash }),
      incrementFailedAttempts: vi.fn().mockResolvedValue(undefined),
      lockAccount: vi.fn().mockResolvedValue(undefined),
      resetFailedAttempts: vi.fn().mockResolvedValue(undefined),
      fetchRoleIds: vi.fn().mockResolvedValue(["super-admin"]),
      fetchCustomFields: vi.fn().mockResolvedValue({}),
      storeRefreshToken: vi.fn().mockResolvedValue(undefined),
    };

    const req = makeRequest("POST", {
      email: "a@example.com",
      password: "Pass1234!",
    });
    const res = await handleLogin(req, deps);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    expect(body).not.toHaveProperty("data");
    expect(body.message).toBe("Logged in.");
    expect(body.user).toMatchObject({
      id: "u1",
      email: "a@example.com",
      name: "A",
      roleIds: ["super-admin"],
    });
    expect(typeof body.accessToken).toBe("string");
    expect(typeof body.refreshToken).toBe("string");
    expect(typeof body.expiresAt).toBe("string");
    // expiresAt is ISO-8601, future-dated
    expect(Number.isFinite(Date.parse(body.expiresAt as string))).toBe(true);
  });
});

describe("logout handler: respondAction shape", () => {
  it("returns just { message }", async () => {
    const deps = {
      allowedOrigins: ALLOWED_ORIGINS,
      deleteRefreshTokenByHash: vi.fn().mockResolvedValue(undefined),
    };
    const req = makeRequest("POST", {});
    const res = await handleLogout(req, deps);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ message: "Logged out." });
    expect(body).not.toHaveProperty("data");
  });
});

describe("refresh handler: respondData shape", () => {
  it("returns { user, accessToken, refreshToken, expiresAt } with no message", async () => {
    const tokenHash = hashRefreshToken("raw-refresh-token");
    const deps = {
      secret: SECRET,
      isProduction: false,
      accessTokenTTL: 900,
      refreshTokenTTL: 604800,
      trustProxy: false,
      trustedProxyIps: [],
      findRefreshTokenByHash: vi.fn().mockResolvedValue({
        id: "rt1",
        userId: "u1",
        expiresAt: new Date(Date.now() + 60_000),
      }),
      deleteRefreshToken: vi.fn().mockResolvedValue(undefined),
      deleteAllRefreshTokensForUser: vi.fn().mockResolvedValue(undefined),
      storeRefreshToken: vi.fn().mockResolvedValue(undefined),
      findUserById: vi.fn().mockResolvedValue({
        id: "u1",
        email: "a@example.com",
        name: "A",
        image: null,
        isActive: true,
      }),
      fetchRoleIds: vi.fn().mockResolvedValue(["super-admin"]),
      fetchCustomFields: vi.fn().mockResolvedValue({}),
    };

    const req = new Request("http://localhost:3000/admin/api/auth/refresh", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `nextly_refresh=raw-refresh-token`,
      },
      body: JSON.stringify({}),
    });

    const res = await handleRefresh(req, deps);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("data");
    expect(body).not.toHaveProperty("message");
    expect(body.user).toMatchObject({ id: "u1", email: "a@example.com" });
    expect(typeof body.accessToken).toBe("string");
    expect(typeof body.refreshToken).toBe("string");
    expect(typeof body.expiresAt).toBe("string");
  });
});

describe("register handler: respondAction shape", () => {
  it("silent-success path returns generic message (no email echo, no user)", async () => {
    const deps = {
      allowedOrigins: ALLOWED_ORIGINS,
      revealRegistrationConflict: false,
      loginStallTimeMs: 0,
      registerUser: vi.fn().mockResolvedValue({
        id: "u1",
        email: "a@example.com",
        name: "A",
      }),
    };
    const req = makeRequest("POST", {
      email: "a@example.com",
      password: "Pass1234!",
      name: "A",
    });
    const res = await handleRegister(req, deps);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("data");
    expect(body).not.toHaveProperty("user");
    expect(body.message).toMatch(/^If this email is available/);
    // §13.8: never echo the email back
    expect(JSON.stringify(body)).not.toContain("a@example.com");
  });

  it("reveal-on success path returns 201 with user", async () => {
    const deps = {
      allowedOrigins: ALLOWED_ORIGINS,
      revealRegistrationConflict: true,
      loginStallTimeMs: 0,
      registerUser: vi.fn().mockResolvedValue({
        id: "u1",
        email: "a@example.com",
        name: "A",
      }),
    };
    const req = makeRequest("POST", {
      email: "a@example.com",
      password: "Pass1234!",
      name: "A",
    });
    const res = await handleRegister(req, deps);
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("data");
    expect(body.message).toBe("Account created.");
    expect(body.user).toMatchObject({ id: "u1", email: "a@example.com" });
  });
});

describe("setup-status handler: respondData shape", () => {
  it("when no users exist, returns { isSetup: false, requiresInitialUser: true }", async () => {
    const deps = { getUserCount: vi.fn().mockResolvedValue(0) };
    const req = new Request(
      "http://localhost:3000/admin/api/auth/setup-status"
    );
    const res = await handleSetupStatus(req, deps);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ isSetup: false, requiresInitialUser: true });
    expect(body).not.toHaveProperty("data");
    expect(body).not.toHaveProperty("isSetupComplete");
  });

  it("when at least one user exists, returns { isSetup: true, requiresInitialUser: false }", async () => {
    const deps = { getUserCount: vi.fn().mockResolvedValue(1) };
    const req = new Request(
      "http://localhost:3000/admin/api/auth/setup-status"
    );
    const res = await handleSetupStatus(req, deps);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ isSetup: true, requiresInitialUser: false });
  });
});

describe("setup handler: respondAction shape", () => {
  it("returns 201 with message + user + tokens", async () => {
    const deps = {
      secret: SECRET,
      isProduction: false,
      accessTokenTTL: 900,
      refreshTokenTTL: 604800,
      allowedOrigins: ALLOWED_ORIGINS,
      trustProxy: false,
      trustedProxyIps: [],
      getUserCount: vi.fn().mockResolvedValue(0),
      createSuperAdmin: vi.fn().mockResolvedValue({
        id: "u1",
        email: "a@example.com",
        name: "A",
      }),
      fetchRoleIds: vi.fn().mockResolvedValue(["super-admin"]),
      seedPermissions: vi.fn().mockResolvedValue(undefined),
      storeRefreshToken: vi.fn().mockResolvedValue(undefined),
    };
    const req = makeRequest("POST", {
      email: "a@example.com",
      password: "Pass1234!",
      name: "A",
    });
    const res = await handleSetup(req, deps);
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("data");
    expect(body.message).toBe("Setup complete.");
    expect(body.user).toMatchObject({ id: "u1", email: "a@example.com" });
    expect(typeof body.accessToken).toBe("string");
    expect(typeof body.refreshToken).toBe("string");
    expect(typeof body.expiresAt).toBe("string");
  });
});

describe("forgot-password handler: respondAction shape", () => {
  it("returns generic message; never echoes the email", async () => {
    const deps = {
      allowedOrigins: ALLOWED_ORIGINS,
      loginStallTimeMs: 0,
      generatePasswordResetToken: vi.fn().mockResolvedValue({}),
    };
    const req = makeRequest("POST", { email: "leaked@example.com" });
    const res = await handleForgotPassword(req, deps);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("data");
    expect(body.message).toBe(
      "If an account exists for this email, a password reset link has been sent."
    );
    // §13.8: never echo user-supplied data
    expect(JSON.stringify(body)).not.toContain("leaked@example.com");
  });
});

describe("reset-password handler: respondAction shape", () => {
  it("returns just { message: 'Password reset.' }", async () => {
    const deps = {
      allowedOrigins: ALLOWED_ORIGINS,
      resetPasswordWithToken: vi
        .fn()
        .mockResolvedValue({ email: "a@example.com" }),
      deleteAllRefreshTokensForUser: vi.fn().mockResolvedValue(undefined),
      findUserByEmail: vi.fn().mockResolvedValue({ id: "u1" }),
    };
    const req = makeRequest("POST", {
      token: "t",
      newPassword: "Pass1234!",
    });
    const res = await handleResetPassword(req, deps);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("data");
    expect(body).toEqual({ message: "Password reset." });
  });
});

describe("verify-email handler: respondAction shape", () => {
  it("verify-email returns { message: 'Email verified.', email }", async () => {
    const deps = {
      allowedOrigins: ALLOWED_ORIGINS,
      verifyEmail: vi
        .fn()
        .mockResolvedValue({ success: true, email: "a@example.com" }),
      resendVerificationEmail: vi.fn().mockResolvedValue({ success: true }),
    };
    const req = makeRequest("POST", { token: "t" });
    const res = await handleVerifyEmail(req, deps);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("data");
    expect(body.message).toBe("Email verified.");
    expect(body.email).toBe("a@example.com");
  });

  it("resend returns { message: 'Verification email sent.' } and does NOT echo email", async () => {
    const deps = {
      allowedOrigins: ALLOWED_ORIGINS,
      verifyEmail: vi.fn(),
      resendVerificationEmail: vi.fn().mockResolvedValue({ success: true }),
    };
    const req = makeRequest("POST", { email: "leaked@example.com" });
    const res = await handleResendVerification(req, deps);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("data");
    expect(body).toEqual({ message: "Verification email sent." });
    expect(JSON.stringify(body)).not.toContain("leaked@example.com");
  });
});

describe("change-password handler: respondAction shape", () => {
  it("returns just { message: 'Password changed.' } on success", async () => {
    // Build a real signed access token so getSession() succeeds.
    const accessToken = await signAccessToken(
      {
        sub: "u1",
        email: "a@example.com",
        name: "A",
        image: null,
        roleIds: ["super-admin"],
      },
      SECRET,
      900
    );
    const deps = {
      secret: SECRET,
      allowedOrigins: ALLOWED_ORIGINS,
      changePassword: vi.fn().mockResolvedValue({ success: true }),
      deleteAllRefreshTokensForUser: vi.fn().mockResolvedValue(undefined),
    };
    const req = new Request("http://localhost:3000/admin/api/auth/cp", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
        cookie: `nextly_csrf=ct;nextly_session=${accessToken}`,
      },
      body: JSON.stringify({
        currentPassword: "old",
        newPassword: "new-Pass1234!",
        csrfToken: "ct",
      }),
    });
    const res = await handleChangePassword(req, deps);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("data");
    expect(body).toEqual({ message: "Password changed." });
  });
});

describe("session handler: respondData shape", () => {
  it("authenticated returns { user, accessToken } with no message wrapper", async () => {
    const accessToken = await signAccessToken(
      {
        sub: "u1",
        email: "a@example.com",
        name: "A",
        image: null,
        roleIds: ["super-admin"],
      },
      SECRET,
      900
    );
    const deps = { secret: SECRET };
    const req = new Request(
      "http://localhost:3000/admin/api/auth/session",
      {
        method: "GET",
        headers: { cookie: `nextly_session=${accessToken}` },
      }
    );
    const res = await handleSession(req, deps);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("data");
    expect(body).not.toHaveProperty("message");
    expect(body.user).toMatchObject({ id: "u1", email: "a@example.com" });
    expect(body.accessToken).toBe(accessToken);
  });
});

describe("csrf handler: respondData shape", () => {
  it("returns { token } and sets the matching cookie", async () => {
    const deps = { isProduction: false };
    const req = new Request("http://localhost:3000/admin/api/auth/csrf");
    const res = await handleCsrf(req, deps);
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/csrf=/i);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("data");
    expect(body).not.toHaveProperty("csrfToken");
    expect(typeof body.token).toBe("string");
    expect((body.token as string).length).toBeGreaterThan(0);
  });
});

// Unused references retained to keep eslint happy if the imports get
// pruned automatically. These helpers are intentionally available for
// future expansion of the suite.
void setCsrfCookie;
void setAccessTokenCookie;
void setRefreshTokenCookie;
