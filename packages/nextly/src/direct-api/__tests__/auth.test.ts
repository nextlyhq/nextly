/**
 * Direct API - Authentication Operations Tests
 *
 * Tests: login, logout, me, updateMe, register, changePassword,
 *        forgotPassword, resetPassword, verifyEmail
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

import {
  NextlyError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../errors";
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
      const mockUser = {
        id: "user-1",
        email: "test@example.com",
        name: "Test",
      };
      mocks.authService.verifyCredentials.mockResolvedValue({
        success: true,
        user: mockUser,
      });

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

    it("should throw UnauthorizedError on invalid credentials", async () => {
      mocks.authService.verifyCredentials.mockResolvedValue({
        success: false,
        error: "Invalid email or password",
      });

      await expect(
        nextly.login({ email: "bad@test.com", password: "wrong" })
      ).rejects.toThrow(UnauthorizedError);
    });

    it("should throw UnauthorizedError when user is null", async () => {
      mocks.authService.verifyCredentials.mockResolvedValue({
        success: true,
        user: null,
      });

      await expect(
        nextly.login({ email: "test@test.com", password: "pass" })
      ).rejects.toThrow(UnauthorizedError);
    });
  });

  describe("logout()", () => {
    it("should resolve successfully (no-op)", async () => {
      await expect(nextly.logout()).resolves.toBeUndefined();
    });
  });

  describe("me()", () => {
    it("should return user profile", async () => {
      const mockUser = {
        id: "user-1",
        email: "test@example.com",
        name: "Test",
      };
      mocks.userAccountService.getCurrentUser.mockResolvedValue({
        success: true,
        statusCode: 200,
        message: "OK",
        data: mockUser,
      });

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

    it("should throw NotFoundError when user not found", async () => {
      mocks.userAccountService.getCurrentUser.mockResolvedValue({
        success: false,
        statusCode: 404,
        message: "User not found",
        data: null,
      });

      await expect(nextly.me({ user: { id: "missing" } })).rejects.toThrow(
        NotFoundError
      );
    });

    it("should throw NextlyError on other failure", async () => {
      mocks.userAccountService.getCurrentUser.mockResolvedValue({
        success: false,
        statusCode: 500,
        message: "Database error",
        data: null,
      });

      await expect(nextly.me({ user: { id: "user-1" } })).rejects.toThrow(
        NextlyError
      );
    });
  });

  describe("updateMe()", () => {
    it("should return updated profile", async () => {
      const mockUser = {
        id: "user-1",
        email: "test@example.com",
        name: "Updated",
      };
      mocks.userAccountService.updateCurrentUser.mockResolvedValue({
        success: true,
        statusCode: 200,
        message: "Updated",
        data: mockUser,
      });

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

    it("should throw NotFoundError when user not found", async () => {
      mocks.userAccountService.updateCurrentUser.mockResolvedValue({
        success: false,
        statusCode: 404,
        message: "User not found",
        data: null,
      });

      await expect(
        nextly.updateMe({ user: { id: "missing" }, data: { name: "X" } })
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe("register()", () => {
    it("should return created user", async () => {
      const mockUser = {
        id: "new-1",
        email: "new@example.com",
        name: "New User",
      };
      mocks.authService.registerUser.mockResolvedValue({
        success: true,
        statusCode: 201,
        message: "User created",
        data: mockUser,
      });

      const result = await nextly.register({
        email: "new@example.com",
        password: "securePass123!",
        name: "New User",
      });

      expect(result.user).toEqual(mockUser);
    });

    it("should throw ValidationError on bad input", async () => {
      mocks.authService.registerUser.mockResolvedValue({
        success: false,
        statusCode: 400,
        message: "Password too weak",
        data: null,
      });

      await expect(
        nextly.register({
          email: "test@test.com",
          password: "123",
        })
      ).rejects.toThrow(ValidationError);
    });

    it("should throw NextlyError on server failure", async () => {
      mocks.authService.registerUser.mockResolvedValue({
        success: false,
        statusCode: 500,
        message: "Internal error",
        data: null,
      });

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
      mocks.authService.changePassword.mockResolvedValue({
        success: true,
      });

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

    it("should throw UnauthorizedError on wrong password", async () => {
      mocks.authService.changePassword.mockResolvedValue({
        success: false,
        error: "Current password is incorrect",
      });

      await expect(
        nextly.changePassword({
          user: { id: "user-1" },
          currentPassword: "wrong",
          newPassword: "new123!",
        })
      ).rejects.toThrow(UnauthorizedError);
    });
  });

  describe("forgotPassword()", () => {
    it("should return success with token", async () => {
      mocks.authService.generatePasswordResetToken.mockResolvedValue({
        success: true,
        token: "reset-token-abc123",
      });

      const result = await nextly.forgotPassword({
        email: "test@example.com",
      });

      expect(result.success).toBe(true);
      expect(result.token).toBe("reset-token-abc123");
    });

    it("should return success even when email does not exist", async () => {
      mocks.authService.generatePasswordResetToken.mockResolvedValue({
        success: false,
        token: undefined,
      });

      const result = await nextly.forgotPassword({
        email: "nonexistent@example.com",
      });

      // Always returns success for security
      expect(result.success).toBe(true);
    });
  });

  describe("resetPassword()", () => {
    it("should return success with email", async () => {
      mocks.authService.resetPasswordWithToken.mockResolvedValue({
        success: true,
        email: "test@example.com",
      });

      const result = await nextly.resetPassword({
        token: "valid-token",
        password: "newSecurePass123!",
      });

      expect(result.success).toBe(true);
      expect(result.email).toBe("test@example.com");
    });

    it("should throw UnauthorizedError on invalid token", async () => {
      mocks.authService.resetPasswordWithToken.mockResolvedValue({
        success: false,
        error: "Invalid or expired token",
      });

      await expect(
        nextly.resetPassword({
          token: "expired-token",
          password: "newPass123!",
        })
      ).rejects.toThrow(UnauthorizedError);
    });
  });

  describe("verifyEmail()", () => {
    it("should return success with email", async () => {
      mocks.authService.verifyEmail.mockResolvedValue({
        success: true,
        email: "test@example.com",
      });

      const result = await nextly.verifyEmail({
        token: "verify-token",
      });

      expect(result.success).toBe(true);
      expect(result.email).toBe("test@example.com");
    });

    it("should throw UnauthorizedError on invalid token", async () => {
      mocks.authService.verifyEmail.mockResolvedValue({
        success: false,
        error: "Invalid or expired token",
      });

      await expect(nextly.verifyEmail({ token: "bad-token" })).rejects.toThrow(
        UnauthorizedError
      );
    });
  });
});
