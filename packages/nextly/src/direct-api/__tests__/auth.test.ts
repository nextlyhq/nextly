/**
 * Direct API - Authentication Operations Tests
 *
 * Tests: login, logout, me, updateMe, register, changePassword,
 *        forgotPassword, resetPassword, verifyEmail
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  vi,
} from "vitest";

import { decodeJwt } from "jose";

import { SESSION_EPOCH_CLAIM } from "../../auth/jwt/claims";
import { hashPassword } from "../../auth/password";
import { NextlyError } from "../../errors/nextly-error";
import type { Nextly } from "../nextly";

import { setupTestNextly, type TestMocks } from "./helpers/test-setup";

// Must be declared before test imports so Vitest hoisting works correctly
// Mock both the barrel re-export and the actual module to cover all import paths
vi.mock("../../lib/env", () => ({
  env: {
    NEXTLY_SECRET: "test-secret-must-be-at-least-32-characters-long!!",
  },
}));
vi.mock("../../shared/lib/env", () => ({
  env: {
    NEXTLY_SECRET: "test-secret-must-be-at-least-32-characters-long!!",
  },
}));

describe("Direct API - Auth Operations", () => {
  let nextly: Nextly;
  let mocks: TestMocks;
  let cleanup: () => void;

  beforeEach(() => {
    const setup = setupTestNextly();
    nextly = setup.nextly;
    mocks = setup.mocks;
    cleanup = setup.cleanup;
  });

  afterAll(() => {
    cleanup?.();
  });

  describe("login()", () => {
    // `login` signs a day-long session, so it signs in exactly as the login
    // endpoint does: the real `verifyCredentials`, over the auth router's
    // lookup and lockout dependencies. The tests decide what the stored
    // account looks like and watch what the sign-in records.
    const PASSWORD = "password123";
    let passwordHash: string;
    beforeAll(async () => {
      passwordHash = await hashPassword(PASSWORD);
    });

    /** A stored account the sign-in admits; each case changes one fact. */
    function storedUser(change: Record<string, unknown> = {}) {
      return {
        id: "user-1",
        email: "test@example.com",
        name: "Test",
        image: null,
        passwordHash,
        emailVerified: new Date("2026-01-01T00:00:00Z"),
        isActive: true,
        mustChangePassword: false,
        failedLoginAttempts: 0,
        sessionEpoch: 0,
        lockedUntil: null,
        ...change,
      };
    }

    function refusalOf(password: string) {
      return nextly.login({ email: "test@example.com", password }).then(
        () => null,
        (err: unknown) => err
      );
    }

    it("returns the user, a token and its expiry", async () => {
      mocks.credentialDeps.findUserByEmail.mockResolvedValue(storedUser());

      const result = await nextly.login({
        email: "test@example.com",
        password: PASSWORD,
      });

      // The shape `login` has always returned.
      expect(result.user).toEqual({
        id: "user-1",
        email: "test@example.com",
        name: "Test",
        image: null,
        emailVerified: new Date("2026-01-01T00:00:00Z"),
        passwordHash: null,
      });
      expect(result.token.split(".")).toHaveLength(3);
      expect(result.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    it("counts a wrong password toward the lockout", async () => {
      mocks.credentialDeps.findUserByEmail.mockResolvedValue(storedUser());

      const refusal = await refusalOf("wrong");

      expect((refusal as NextlyError).code).toBe("AUTH_INVALID_CREDENTIALS");
      expect(mocks.credentialDeps.incrementFailedAttempts).toHaveBeenCalledWith(
        "user-1"
      );
    });

    it("locks the account on the attempt that reaches the limit", async () => {
      mocks.credentialDeps.findUserByEmail.mockResolvedValue(
        storedUser({ failedLoginAttempts: 4 })
      );

      await refusalOf("wrong");

      expect(mocks.credentialDeps.lockAccount).toHaveBeenCalledWith(
        "user-1",
        expect.any(Date)
      );
    });

    // Each is refused with the error a wrong password gets, so the Direct
    // API cannot tell a caller which of them applied.
    it.each([
      ["deactivated", { isActive: false }],
      ["locked", { lockedUntil: new Date(Date.now() + 60_000) }],
      // The endpoint answers this with the forced-change step, which a
      // server-side call cannot complete; a token would skip it.
      ["must-change-password", { mustChangePassword: true }],
    ])("refuses a %s account with a correct password", async (_, change) => {
      mocks.credentialDeps.findUserByEmail.mockResolvedValue(
        storedUser(change)
      );

      const refusal = await refusalOf(PASSWORD);

      expect(NextlyError.is(refusal)).toBe(true);
      expect((refusal as NextlyError).code).toBe("AUTH_INVALID_CREDENTIALS");
    });

    // An unverified address is the one refusal named, and only once the
    // password is proven: the caller already holds it, and the login page
    // needs the distinction to offer the verification link again.
    it("refuses an unverified account with a correct password as EMAIL_NOT_VERIFIED", async () => {
      mocks.credentialDeps.findUserByEmail.mockResolvedValue(
        storedUser({ emailVerified: null })
      );

      const refusal = await refusalOf(PASSWORD);

      expect((refusal as NextlyError).code).toBe("EMAIL_NOT_VERIFIED");
    });

    it("answers a wrong password on an unverified account generically", async () => {
      // The separating case: naming the state before the password is proven
      // would tell anyone which addresses are registered and unverified.
      mocks.credentialDeps.findUserByEmail.mockResolvedValue(
        storedUser({ emailVerified: null })
      );

      const refusal = await refusalOf("wrong");

      expect((refusal as NextlyError).code).toBe("AUTH_INVALID_CREDENTIALS");
    });

    it("reports a failed lookup as itself, not as a wrong password", async () => {
      // `login` passes a failed lookup through. That the lookup itself does
      // not turn a database error into "no such user" is pinned beside it,
      // in `auth/credentials/__tests__/credential-deps.test.ts`.
      const outage = new Error("connection refused");
      mocks.credentialDeps.findUserByEmail.mockRejectedValue(outage);

      expect(await refusalOf(PASSWORD)).toBe(outage);
    });

    it("refuses an unknown email", async () => {
      mocks.credentialDeps.findUserByEmail.mockResolvedValue(null);

      expect(await refusalOf(PASSWORD)).toMatchObject({
        code: "AUTH_INVALID_CREDENTIALS",
      });
    });

    /** The claims a signed token carries, read without verifying it. */
    function claimsOf(token: string): Record<string, unknown> {
      return decodeJwt(token);
    }

    it("signs a token valid for twenty-four hours", async () => {
      mocks.credentialDeps.findUserByEmail.mockResolvedValue(storedUser());

      const { token, exp } = await nextly.login({
        email: "test@example.com",
        password: PASSWORD,
      });

      const claims = claimsOf(token);
      // Measured from the token's own issue time, so a slow run cannot pass
      // a thirty-day token by reading the clock later.
      expect(Number(claims.exp) - Number(claims.iat)).toBe(24 * 60 * 60);
      // The expiry returned is the token's, not a second calculation.
      expect(exp).toBe(claims.exp);
    });

    it("carries the account's roles in force", async () => {
      mocks.credentialDeps.findUserByEmail.mockResolvedValue(storedUser());
      mocks.directLoginDeps.fetchSessionRoles.mockResolvedValue({
        roleIds: ["role-editor", "role-author"],
        validUntil: undefined,
      });

      const { token } = await nextly.login({
        email: "test@example.com",
        password: PASSWORD,
      });

      expect(claimsOf(token).roleIds).toEqual(["role-editor", "role-author"]);
      // Read for the account that proved its password, not some other id.
      expect(mocks.directLoginDeps.fetchSessionRoles).toHaveBeenCalledWith(
        "user-1"
      );
    });

    it("ends no later than the first of its roles lapses", async () => {
      mocks.credentialDeps.findUserByEmail.mockResolvedValue(storedUser());
      // An hour away: well inside the token's day, so only the bound can
      // bring the expiry this close.
      const lapses = Date.now() + 60 * 60 * 1000;
      mocks.directLoginDeps.fetchSessionRoles.mockResolvedValue({
        roleIds: ["role-temporary"],
        validUntil: lapses,
      });

      const { token, exp } = await nextly.login({
        email: "test@example.com",
        password: PASSWORD,
      });

      expect(Number(claimsOf(token).exp)).toBe(Math.floor(lapses / 1000));
      expect(exp).toBe(Math.floor(lapses / 1000));
    });

    it("carries the session epoch its password check read", async () => {
      // The epoch read with the proven hash is what ends the token when the
      // account's sessions are ended after that read: a token signed at any
      // other number would outlive the change or be refused at once.
      mocks.credentialDeps.findUserByEmail.mockResolvedValue(
        storedUser({ sessionEpoch: 7 })
      );

      const { token } = await nextly.login({
        email: "test@example.com",
        password: PASSWORD,
      });

      expect(claimsOf(token)[SESSION_EPOCH_CLAIM]).toBe(7);
    });

    it("records a success naming the account and how it signed in", async () => {
      mocks.credentialDeps.findUserByEmail.mockResolvedValue(storedUser());

      await nextly.login({ email: "test@example.com", password: PASSWORD });

      expect(mocks.directLoginDeps.auditLog.write).toHaveBeenCalledTimes(1);
      expect(mocks.directLoginDeps.auditLog.write).toHaveBeenCalledWith({
        kind: "login-succeeded",
        actorUserId: "user-1",
        metadata: { strategy: "password", via: "direct-api" },
      });
    });

    it("records a failure naming no account, with how it tried to sign in", async () => {
      mocks.credentialDeps.findUserByEmail.mockResolvedValue(storedUser());

      await refusalOf("wrong");

      expect(mocks.directLoginDeps.auditLog.write).toHaveBeenCalledTimes(1);
      const [event] = mocks.directLoginDeps.auditLog.write.mock.calls[0];
      expect(event).toEqual({
        kind: "login-failed",
        metadata: {
          code: "AUTH_INVALID_CREDENTIALS",
          reason: "password-mismatch",
          strategy: "password",
          via: "direct-api",
        },
      });
      // Neither key may be present at all, so the row names nobody.
      expect(event).not.toHaveProperty("actorUserId");
      expect(event).not.toHaveProperty("targetUserId");
    });

    it("records a refused account as one failure and no success", async () => {
      mocks.credentialDeps.findUserByEmail.mockResolvedValue(
        storedUser({ isActive: false })
      );

      await refusalOf(PASSWORD);

      expect(mocks.directLoginDeps.auditLog.write.mock.calls).toEqual([
        [expect.objectContaining({ kind: "login-failed" })],
      ]);
    });

    it("records a failed role read as a failure and signs no token", async () => {
      // A sign-in that cannot read the roles must not hand out a token that
      // says the account holds none.
      mocks.credentialDeps.findUserByEmail.mockResolvedValue(storedUser());
      const outage = new Error("connection refused");
      mocks.directLoginDeps.fetchSessionRoles.mockRejectedValue(outage);

      expect(await refusalOf(PASSWORD)).toBe(outage);
      expect(mocks.directLoginDeps.auditLog.write.mock.calls).toEqual([
        [
          expect.objectContaining({
            kind: "login-failed",
            metadata: expect.objectContaining({ code: "INTERNAL_ERROR" }),
          }),
        ],
      ]);
    });
  });

  describe("logout()", () => {
    it("should resolve successfully (no-op)", async () => {
      await expect(nextly.logout()).resolves.toBeUndefined();
    });
  });

  describe("me()", () => {
    it("should return user profile", async () => {
      // PR 4 (unified-error-system): getCurrentUser returns the user
      // directly and throws NextlyError(NOT_FOUND) on missing user.
      const mockUser = {
        id: "user-1",
        email: "test@example.com",
        name: "Test",
      };
      mocks.userAccountService.getCurrentUser.mockResolvedValue(mockUser);

      const result = await nextly.me({ user: { id: "user-1" } });

      expect(result.user).toEqual(mockUser);
      expect(mocks.userAccountService.getCurrentUser).toHaveBeenCalledWith(
        "user-1"
      );
    });

    it("should throw when user.id is missing", async () => {
      await expect(nextly.me({ user: {} as any })).rejects.toThrow(
        "user.id is required"
      );
    });

    it("should rewrap NextlyError(NOT_FOUND) with namespace logContext", async () => {
      // The service throws a NextlyError(NOT_FOUND); the namespace
      // re-throws NextlyError.notFound({ logContext: { userId } }) so the
      // userId becomes part of the operator-facing log payload.
      const notFound = new NextlyError({
        code: "NOT_FOUND",
        publicMessage: "User not found",
        statusCode: 404,
      });
      mocks.userAccountService.getCurrentUser.mockRejectedValue(notFound);

      await expect(
        nextly.me({ user: { id: "missing" } })
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        logContext: { userId: "missing" },
      });
    });

    it("should propagate other NextlyError failures", async () => {
      mocks.userAccountService.getCurrentUser.mockRejectedValue(
        new NextlyError({
          code: "INTERNAL_ERROR",
          publicMessage: "Database error",
          statusCode: 500,
        })
      );

      await expect(nextly.me({ user: { id: "user-1" } })).rejects.toThrow(
        NextlyError
      );
    });
  });

  describe("updateMe()", () => {
    it("should return updated profile", async () => {
      // PR 4: updateCurrentUser returns the user directly.
      const mockUser = {
        id: "user-1",
        email: "test@example.com",
        name: "Updated",
      };
      mocks.userAccountService.updateCurrentUser.mockResolvedValue(mockUser);

      const result = await nextly.updateMe({
        user: { id: "user-1" },
        data: { name: "Updated" },
      });

      expect(result.user).toEqual(mockUser);
      expect(mocks.userAccountService.updateCurrentUser).toHaveBeenCalledWith(
        "user-1",
        { name: "Updated" }
      );
    });

    it("should throw when user.id is missing", async () => {
      await expect(
        nextly.updateMe({ user: {} as any, data: { name: "Test" } })
      ).rejects.toThrow("user.id is required");
    });

    it("should rewrap NextlyError(NOT_FOUND) with namespace logContext", async () => {
      mocks.userAccountService.updateCurrentUser.mockRejectedValue(
        new NextlyError({
          code: "NOT_FOUND",
          publicMessage: "User not found",
          statusCode: 404,
        })
      );

      await expect(
        nextly.updateMe({ user: { id: "missing" }, data: { name: "X" } })
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        logContext: { userId: "missing" },
      });
    });
  });

  describe("register()", () => {
    it("should return created user", async () => {
      // PR 4: registerUser returns the user directly.
      const mockUser = {
        id: "new-1",
        email: "new@example.com",
        name: "New User",
      };
      mocks.authService.registerUser.mockResolvedValue(mockUser);

      const result = await nextly.register({
        email: "new@example.com",
        password: "securePass123!",
        name: "New User",
      });

      expect(result.user).toEqual(mockUser);
    });

    it("should propagate NextlyError(VALIDATION_ERROR) from service", async () => {
      mocks.authService.registerUser.mockRejectedValue(
        new NextlyError({
          code: "VALIDATION_ERROR",
          publicMessage: "Password too weak",
          statusCode: 400,
        })
      );

      await expect(
        nextly.register({
          email: "test@test.com",
          password: "123",
        })
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    });

    it("should propagate other NextlyError failures", async () => {
      mocks.authService.registerUser.mockRejectedValue(
        new NextlyError({
          code: "INTERNAL_ERROR",
          publicMessage: "Internal error",
          statusCode: 500,
        })
      );

      await expect(
        nextly.register({
          email: "test@test.com",
          password: "password123!",
        })
      ).rejects.toThrow(NextlyError);
    });
  });

  describe("changePassword()", () => {
    it("should return success", async () => {
      // PR 4: changePassword returns void on success and throws
      // NextlyError on failure.
      mocks.authService.changePassword.mockResolvedValue(undefined);

      const result = await nextly.changePassword({
        user: { id: "user-1" },
        currentPassword: "oldPass",
        newPassword: "newPass123!",
      });

      expect(result).toEqual({ success: true });
      expect(mocks.authService.changePassword).toHaveBeenCalledWith(
        "user-1",
        "oldPass",
        "newPass123!"
      );
    });

    it("should throw when user.id is missing", async () => {
      await expect(
        nextly.changePassword({
          user: {} as any,
          currentPassword: "old",
          newPassword: "new",
        })
      ).rejects.toThrow("user.id is required");
    });

    it("should propagate NextlyError on wrong password", async () => {
      // PR 4: AUTH_INVALID_CREDENTIALS comes from the service; the
      // namespace lets it propagate (no rewrapping to UnauthorizedError).
      mocks.authService.changePassword.mockRejectedValue(
        new NextlyError({
          code: "AUTH_INVALID_CREDENTIALS",
          publicMessage: "Current password is incorrect",
          statusCode: 401,
        })
      );

      await expect(
        nextly.changePassword({
          user: { id: "user-1" },
          currentPassword: "wrong",
          newPassword: "new123!",
        })
      ).rejects.toThrow(NextlyError);
    });
  });

  describe("forgotPassword()", () => {
    it("should return success with token", async () => {
      // PR 4: generatePasswordResetToken returns `{ token? }` and throws
      // on errors. The namespace always returns `success: true` to avoid
      // leaking which addresses exist.
      mocks.authService.generatePasswordResetToken.mockResolvedValue({
        token: "reset-token-abc123",
      });

      const result = await nextly.forgotPassword({
        email: "test@example.com",
      });

      expect(result.success).toBe(true);
      expect(result.token).toBe("reset-token-abc123");
    });

    it("should return success even when email does not exist", async () => {
      // Service silently resolves with no token for unknown emails.
      mocks.authService.generatePasswordResetToken.mockResolvedValue({});

      const result = await nextly.forgotPassword({
        email: "nonexistent@example.com",
      });

      // Always returns success for security
      expect(result.success).toBe(true);
    });
  });

  describe("resetPassword()", () => {
    it("should return success with email", async () => {
      // PR 4: resetPasswordWithToken returns `{ email }` directly.
      mocks.authService.resetPasswordWithToken.mockResolvedValue({
        email: "test@example.com",
      });

      const result = await nextly.resetPassword({
        token: "valid-token",
        password: "newSecurePass123!",
      });

      expect(result.success).toBe(true);
      expect(result.email).toBe("test@example.com");
    });

    it("should propagate NextlyError on invalid token", async () => {
      mocks.authService.resetPasswordWithToken.mockRejectedValue(
        new NextlyError({
          code: "VALIDATION_ERROR",
          publicMessage: "Invalid or expired token",
          statusCode: 400,
        })
      );

      await expect(
        nextly.resetPassword({
          token: "expired-token",
          password: "newPass123!",
        })
      ).rejects.toThrow(NextlyError);
    });
  });

  describe("verifyEmail()", () => {
    it("should return success with email", async () => {
      // PR 4: verifyEmail returns `{ email }` directly.
      mocks.authService.verifyEmail.mockResolvedValue({
        email: "test@example.com",
      });

      const result = await nextly.verifyEmail({
        token: "verify-token",
      });

      expect(result.success).toBe(true);
      expect(result.email).toBe("test@example.com");
    });

    it("should propagate NextlyError on invalid token", async () => {
      mocks.authService.verifyEmail.mockRejectedValue(
        new NextlyError({
          code: "VALIDATION_ERROR",
          publicMessage: "Invalid or expired token",
          statusCode: 400,
        })
      );

      await expect(nextly.verifyEmail({ token: "bad-token" })).rejects.toThrow(
        NextlyError
      );
    });
  });
});
