/**
 * Direct API - Authentication Operations Tests
 *
 * Tests: login, logout, me, updateMe, register, changePassword,
 *        forgotPassword, resetPassword, verifyEmail
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

import { NextlyError } from "../../errors/nextly-error";
import type { Nextly } from "../nextly";

import { setupTestNextly, type TestMocks } from "./helpers/test-setup";

// Must be declared before test imports so Vitest hoisting works correctly
// Mock both the barrel re-export and the actual module to cover all import paths
vi.mock("../../lib/env", () => ({
  env: {
    NEXTLY_SECRET_RESOLVED: "test-secret-must-be-at-least-32-characters-long!!",
  },
}));
vi.mock("../../shared/lib/env", () => ({
  env: {
    NEXTLY_SECRET_RESOLVED: "test-secret-must-be-at-least-32-characters-long!!",
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
    it("should return user, token, and exp on valid credentials", async () => {
      // PR 4 (unified-error-system): verifyCredentials returns the user
      // directly and throws NextlyError on failure.
      const mockUser = {
        id: "user-1",
        email: "test@example.com",
        name: "Test",
      };
      mocks.authService.verifyCredentials.mockResolvedValue(mockUser);

      const result = await nextly.login({
        email: "test@example.com",
        password: "password123",
      });

      expect(result.user).toEqual(mockUser);
      // Token is a real JWT signed with jose (3 dot-separated parts)
      expect(result.token).toBeDefined();
      expect(result.token.split(".")).toHaveLength(3);
      expect(result.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
      expect(mocks.authService.verifyCredentials).toHaveBeenCalledWith(
        "test@example.com",
        "password123"
      );
    });

    it("should propagate NextlyError on invalid credentials", async () => {
      // PR 4: invalid creds throw NextlyError(AUTH_INVALID_CREDENTIALS)
      // from the service. The login() namespace lets it propagate.
      mocks.authService.verifyCredentials.mockRejectedValue(
        new NextlyError({
          code: "AUTH_REQUIRED",
          publicMessage: "Invalid email or password",
          statusCode: 401,
        })
      );

      await expect(
        nextly.login({ email: "bad@test.com", password: "wrong" })
      ).rejects.toThrow(NextlyError);
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

      await expect(nextly.me({ user: { id: "missing" } })).rejects.toMatchObject(
        { code: "NOT_FOUND" }
      );
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
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
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
