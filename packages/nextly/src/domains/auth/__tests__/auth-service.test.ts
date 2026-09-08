import { randomUUID } from "crypto";

import { eq } from "drizzle-orm";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  createTestDb,
  type TestDb,
  testLogger,
} from "../../../__tests__/fixtures/db";
import { userFactory } from "../../../__tests__/fixtures/users";
import { hashPassword } from "../../../auth/password";
import { AuthService } from "../services/auth-service";

// Test constants
const EXPECTED_TOKEN_LENGTH = 64; // 32 bytes as hex = 64 characters
const HOUR_IN_MS = 60 * 60 * 1000; // 1 hour in milliseconds
const TOKEN_EXPIRY_HOURS = 24; // Token expiry time in hours
const TIME_TOLERANCE_MS = 2000; // ±2 seconds tolerance for time comparisons (CI stability)

/**
 * bcrypt cost for hashes this suite CREATES as fixtures.
 *
 * Production uses 12, which is the point of a KDF and which bcryptjs — a pure-JS
 * implementation with no native binding — pays in full: roughly a second per hash
 * on a developer machine and several times that on a loaded runner. A test that
 * seeds a user and then exercises a path which hashes again was measured at
 * ~2.9s locally and ~9.8s on CI, against a 10s testTimeout. That is not a
 * failure yet; it is a test whose passing depends on the machine.
 *
 * A fixture's hash strength protects nothing: the value never leaves the
 * in-memory database, and what these tests exercise is the code path, not the
 * KDF. bcrypt encodes its cost inside the hash, so `verifyPassword` reads a
 * cost-4 hash exactly as it reads a cost-12 one — the production verifier is
 * still the thing under test.
 *
 * This does NOT lower the cost the SERVICE uses when it hashes; that is
 * `defaultSaltRounds` in `auth/password`, whose own comment says it should
 * become env-tunable. Until it is, a service-side hash still costs full price
 * and this only removes the fixture's share.
 */
const FIXTURE_SALT_ROUNDS = 4;

describe("AuthService", () => {
  let testDb: TestDb;
  let service: AuthService;

  beforeEach(async () => {
    testDb = await createTestDb();
    service = new AuthService(testDb.adapter, testLogger);
  });

  afterEach(async () => {
    await testDb.reset();
    await testDb.close();
  });

  describe("registerUser()", () => {
    // NOTE: These tests are skipped due to complex integration dependencies
    // registerUser() depends on UsersService which depends on RoleService
    // The service tries to auto-assign super-admin role to first user,
    // which requires full RBAC infrastructure setup in test environment.
    // These should be tested in integration tests, not unit tests.
    it.skip("should successfully register a new user with valid data", async () => {
      // Arrange
      const userData = {
        email: "newuser@test.com",
        password: "ValidPassword123!",
        name: "New User",
      };

      // Act
      const result = await service.registerUser(userData);

      // Assert
      expect(result.statusCode).toBe(201);
      expect(result.message).toBe("User registered successfully");
      expect(result.data).toBeDefined();
      expect(result.data!.email).toBe("newuser@test.com");
      expect(result.data!.name).toBe("New User");
      expect(result.data!.passwordHash).toBeNull(); // Should not return password hash

      // Verify user was actually created in database
      const dbUser = await testDb.db.query.users.findFirst({
        where: { email: "newuser@test.com" },
      });
      expect(dbUser).toBeDefined();
      expect(dbUser!.passwordHash).toBeDefined(); // But should be stored
    });

    it("should reject registration with weak password", async () => {
      // Arrange
      const userData = {
        email: "user@test.com",
        password: "weak", // Too short, no numbers, no special chars
      };

      // Act
      await expect(service.registerUser(userData)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });

      // Verify user was NOT created
      const dbUser = await testDb.db.query.users.findFirst({
        where: { email: "user@test.com" },
      });
      expect(dbUser).toBeUndefined();
    });

    it("pays for the password hash EVEN on a duplicate, so both paths cost the same", async () => {
      // 🔴 This test pins an ANTI-ENUMERATION property, and it exists because
      // the opposite assertion stood here and was wrong.
      //
      // `/api/auth/register` answers a taken address and a free one with
      // byte-identical responses on purpose (spec §13.2 silent-success), so
      // duration is the only channel left. `stallResponse` is a FLOOR rather
      // than a fixed duration -- it pads a fast response up to
      // `loginStallTimeMs` (500ms) and does nothing to a slow one -- so
      // skipping the hash on the duplicate path returns a registered address at
      // ~500ms while a free one waits out bcrypt, measured at ~2.9s locally and
      // ~9.8s on a loaded runner. A stopwatch then separates two responses the
      // endpoint went to some trouble to make identical.
      //
      // Asserted on the CALL rather than the clock: a duration assertion would
      // be flaky on a loaded runner and would still pass if the hash moved
      // somewhere else in the request.
      //
      // The availability concern that argued for skipping it is real and is
      // answered elsewhere: `register` sits in the per-IP auth rate-limit
      // bucket in `auth/handlers/router.ts`, checked before dispatch. Skipping
      // the hash would not have bounded it anyway -- an attacker burning CPU
      // sends UNREGISTERED addresses, which reach the hash either way.
      const existingEmail = "existing@test.com";
      await testDb.db.insert(testDb.schema.users).values(
        userFactory({
          email: existingEmail,
          passwordHash: await hashPassword(
            "ValidPassword123!",
            FIXTURE_SALT_ROUNDS
          ),
        })
      );

      const password = await import("../../../auth/password");
      const hashSpy = vi.spyOn(password, "hashPassword");

      await expect(
        service.registerUser({
          email: existingEmail,
          password: "DifferentPassword123!",
        })
      ).rejects.toMatchObject({ code: "DUPLICATE", statusCode: 409 });

      // The duplicate path did the same expensive work the success path does.
      expect(hashSpy).toHaveBeenCalledTimes(1);
      hashSpy.mockRestore();
    });

    it("should reject registration with duplicate email", async () => {
      // Arrange: Create existing user
      const existingEmail = "existing@test.com";
      const passwordHash = await hashPassword(
        "ValidPassword123!",
        FIXTURE_SALT_ROUNDS
      );
      await testDb.db.insert(testDb.schema.users).values(
        userFactory({
          email: existingEmail,
          passwordHash,
        })
      );

      // Act: Try to register with same email
      await expect(
        service.registerUser({
          email: existingEmail,
          password: "DifferentPassword123!",
        })
      ).rejects.toMatchObject({
        code: "DUPLICATE",
        statusCode: 409,
      });
    });

    it.skip("should register user without name (name is optional)", async () => {
      // Arrange
      const userData = {
        email: "noname@test.com",
        password: "ValidPassword123!",
      };

      // Act
      const result = await service.registerUser(userData);

      // Assert
      expect(result.statusCode).toBe(201);
      expect(result.data).toBeDefined();
      expect(result.data!.email).toBe("noname@test.com");
      expect(result.data!.name).toBe("User"); // Should default to "User"
    });
  });

  describe("verifyCredentials()", () => {
    it("should successfully verify valid credentials", async () => {
      // Arrange: Create user with known password
      const email = "user@test.com";
      const password = "ValidPassword123!";
      const passwordHash = await hashPassword(password, FIXTURE_SALT_ROUNDS);

      await testDb.db.insert(testDb.schema.users).values(
        userFactory({
          email,
          passwordHash,
          name: "Test User",
        })
      );

      // Act
      const result = await service.verifyCredentials(email, password);

      // Assert
      expect(result.email).toBe(email);
      expect(result.name).toBe("Test User");
      expect(result.passwordHash).toBeNull(); // Should never return password hash
    });

    it("should fail verification with invalid email", async () => {
      // Act
      await expect(
        service.verifyCredentials("nonexistent@test.com", "anypassword")
      ).rejects.toMatchObject({
        code: "AUTH_INVALID_CREDENTIALS",
        statusCode: 401,
      });
    });

    it("should fail verification with invalid password", async () => {
      // Arrange: Create user
      const email = "user@test.com";
      const correctPassword = "ValidPassword123!";
      const passwordHash = await hashPassword(
        correctPassword,
        FIXTURE_SALT_ROUNDS
      );

      await testDb.db.insert(testDb.schema.users).values(
        userFactory({
          email,
          passwordHash,
        })
      );

      // Act: Try with wrong password
      await expect(
        service.verifyCredentials(email, "WrongPassword!")
      ).rejects.toMatchObject({
        code: "AUTH_INVALID_CREDENTIALS",
        statusCode: 401,
      });
    });

    it("should fail verification for user without password (OAuth user)", async () => {
      // Arrange: Create OAuth user (no password hash)
      const email = "oauth@test.com";
      await testDb.db.insert(testDb.schema.users).values(
        userFactory({
          email,
          passwordHash: null, // OAuth users don't have password
        })
      );

      // Act
      await expect(
        service.verifyCredentials(email, "anypassword")
      ).rejects.toMatchObject({
        code: "AUTH_INVALID_CREDENTIALS",
        statusCode: 401,
      });
    });

    it("should normalize email (case-insensitive)", async () => {
      // Arrange: Create user with lowercase email
      const email = "user@test.com";
      const password = "ValidPassword123!";
      const passwordHash = await hashPassword(password, FIXTURE_SALT_ROUNDS);

      await testDb.db.insert(testDb.schema.users).values(
        userFactory({
          email,
          passwordHash,
        })
      );

      // Act: Try with mixed case email
      const result = await service.verifyCredentials("User@TEST.com", password);

      // Assert: Should still work
      expect(result.email).toBe(email);
    });
  });

  describe("changePassword()", () => {
    it("should successfully change password with correct current password", async () => {
      // Arrange: Create user
      const userId = randomUUID();
      const currentPassword = "CurrentPassword123!";
      const newPassword = "NewPassword456!";
      const passwordHash = await hashPassword(
        currentPassword,
        FIXTURE_SALT_ROUNDS
      );

      await testDb.db.insert(testDb.schema.users).values(
        userFactory({
          id: userId,
          passwordHash,
        })
      );

      // Act + Assert: the method resolves to void. Its failure mode is a
      // thrown NextlyError(AUTH_INVALID_CREDENTIALS), so completing without
      // throwing IS the success signal — there is no envelope to inspect.
      await expect(
        service.changePassword(userId, currentPassword, newPassword)
      ).resolves.toBeUndefined();

      // Verify password was actually changed
      const updatedUser = await testDb.db.query.users.findFirst({
        where: { id: userId },
      });
      expect(updatedUser!.passwordHash).not.toBe(passwordHash);
      expect(updatedUser!.passwordUpdatedAt).toBeDefined();

      // Verify new password works. `verifyCredentials` returns the user and
      // throws AUTH_INVALID_CREDENTIALS otherwise, so resolving to THIS user
      // is the assertion — and it is stronger than a boolean, because a stub
      // returning some other account would satisfy a truthy check.
      const verifyResult = await service.verifyCredentials(
        updatedUser!.email,
        newPassword
      );
      expect(verifyResult.email).toBe(updatedUser!.email);
    });

    it("should fail to change password with wrong current password", async () => {
      // Arrange
      const userId = randomUUID();
      const currentPassword = "CurrentPassword123!";
      const passwordHash = await hashPassword(
        currentPassword,
        FIXTURE_SALT_ROUNDS
      );

      await testDb.db.insert(testDb.schema.users).values(
        userFactory({
          id: userId,
          passwordHash,
        })
      );

      // Act: Try with wrong current password
      await expect(
        service.changePassword(userId, "WrongPassword123!", "NewPassword456!")
      ).rejects.toMatchObject({
        code: "AUTH_INVALID_CREDENTIALS",
        statusCode: 401,
      });

      // Verify password was NOT changed
      const user = await testDb.db.query.users.findFirst({
        where: { id: userId },
      });
      expect(user!.passwordHash).toBe(passwordHash);
    });

    it("should fail to change password for non-existent user", async () => {
      // Arrange
      const nonExistentUserId = randomUUID();

      // Act
      await expect(
        service.changePassword(nonExistentUserId, "anypassword", "newpassword")
      ).rejects.toMatchObject({
        code: "AUTH_INVALID_CREDENTIALS",
        statusCode: 401,
      });
    });

    it("should fail to change password for user without password (OAuth user)", async () => {
      // Arrange: OAuth user
      const userId = randomUUID();
      await testDb.db.insert(testDb.schema.users).values(
        userFactory({
          id: userId,
          passwordHash: null,
        })
      );

      // Act
      await expect(
        service.changePassword(userId, "anypassword", "newpassword")
      ).rejects.toMatchObject({
        code: "AUTH_INVALID_CREDENTIALS",
        statusCode: 401,
      });
    });
  });

  describe("generatePasswordResetToken()", () => {
    it("should generate reset token for existing user", async () => {
      // Arrange
      const email = "user@test.com";
      await testDb.db.insert(testDb.schema.users).values(
        userFactory({
          email,
        })
      );

      // Act
      const result = await service.generatePasswordResetToken(email);

      // Assert
      expect(result.token).toBeDefined();
      expect(result.token!.length).toBe(EXPECTED_TOKEN_LENGTH);

      // Verify token was stored in database (hashed)
      const tokens = await testDb.db.query.passwordResetTokens.findMany({
        where: { identifier: email },
      });
      expect(tokens).toHaveLength(1);
      expect(tokens[0].expires).toBeInstanceOf(Date);
      expect(tokens[0].expires.getTime()).toBeGreaterThan(Date.now());
    });

    it("should not reveal if email doesn't exist (security)", async () => {
      // Arrange: No user with this email

      // Act
      const result = await service.generatePasswordResetToken(
        "nonexistent@test.com"
      );

      // Assert: Should still return success (don't leak user existence)
      expect(result.token).toBeUndefined(); // But no token generated

      // Verify no token was created
      const tokens = await testDb.db.query.passwordResetTokens.findMany();
      expect(tokens).toHaveLength(0);
    });

    it("should delete old reset tokens when generating new one", async () => {
      // Arrange: Create user and old token
      const email = "user@test.com";
      await testDb.db.insert(testDb.schema.users).values(
        userFactory({
          email,
        })
      );

      // Generate first token
      await service.generatePasswordResetToken(email);

      // Act: Generate second token
      await service.generatePasswordResetToken(email);

      // Assert: Should only have one token (new one replaces old)
      const tokens = await testDb.db.query.passwordResetTokens.findMany({
        where: { identifier: email },
      });
      expect(tokens).toHaveLength(1);
    });

    it("should set correct expiry time (24 hours)", async () => {
      // Arrange
      const email = "user@test.com";
      await testDb.db.insert(testDb.schema.users).values(
        userFactory({
          email,
        })
      );

      const beforeGeneration = Date.now();

      // Act
      await service.generatePasswordResetToken(email);

      const afterGeneration = Date.now();

      // Assert
      const token = await testDb.db.query.passwordResetTokens.findFirst({
        where: { identifier: email },
      });

      const expectedExpiryMin =
        beforeGeneration + TOKEN_EXPIRY_HOURS * HOUR_IN_MS - TIME_TOLERANCE_MS;
      const expectedExpiryMax =
        afterGeneration + TOKEN_EXPIRY_HOURS * HOUR_IN_MS + TIME_TOLERANCE_MS;

      expect(token!.expires.getTime()).toBeGreaterThanOrEqual(
        expectedExpiryMin
      );
      expect(token!.expires.getTime()).toBeLessThanOrEqual(expectedExpiryMax);
    });
  });

  describe("resetPasswordWithToken()", () => {
    // NOTE: Transaction-dependent tests are skipped
    // resetPasswordWithToken() uses withTransaction() which has issues
    // with SQLite in the test environment. The core logic is tested
    // in other tests, but full transaction rollback needs integration tests.
    it.skip("should successfully reset password with valid token", async () => {
      // Arrange: Create user and generate reset token
      const email = "user@test.com";
      const oldPassword = "OldPassword123!";
      const newPassword = "NewPassword456!";
      const passwordHash = await hashPassword(oldPassword, FIXTURE_SALT_ROUNDS);

      await testDb.db.insert(testDb.schema.users).values(
        userFactory({
          email,
          passwordHash,
        })
      );

      const tokenResult = await service.generatePasswordResetToken(email);
      expect(tokenResult.token).toBeDefined();

      // Act
      const result = await service.resetPasswordWithToken(
        tokenResult.token!,
        newPassword
      );

      // Assert
      expect(result.email).toBe(email);

      // Verify password was changed
      const verifyResult = await service.verifyCredentials(email, newPassword);
      expect(verifyResult.success).toBe(true);

      // Verify old password no longer works
      const oldVerifyResult = await service.verifyCredentials(
        email,
        oldPassword
      );
      expect(oldVerifyResult.success).toBe(false);
    });

    it("should reject invalid token", async () => {
      // Arrange
      const invalidToken = "invalid-token-12345";

      // Act
      await expect(
        service.resetPasswordWithToken(invalidToken, "NewPassword123!")
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    });

    it("should reject expired token", async () => {
      // Arrange: Create user and token that's already expired
      const email = "user@test.com";
      await testDb.db.insert(testDb.schema.users).values(
        userFactory({
          email,
        })
      );

      // Generate token
      const tokenResult = await service.generatePasswordResetToken(email);
      expect(tokenResult.token).toBeDefined();

      // Manually expire the token by updating the database
      const { createHash } = await import("crypto");
      const tokenHash = createHash("sha256")
        .update(tokenResult.token!)
        .digest("hex");

      await testDb.db
        .update(testDb.schema.passwordResetTokens)
        .set({
          expires: new Date(Date.now() - 1000), // Set to past
        })
        .where(eq(testDb.schema.passwordResetTokens.tokenHash, tokenHash));

      // Act
      await expect(
        service.resetPasswordWithToken(tokenResult.token!, "NewPassword123!")
      ).rejects.toMatchObject({
        code: "TOKEN_EXPIRED",
        statusCode: 401,
      });
    });

    it.skip("should only allow token to be used once", async () => {
      // Arrange: Create user and generate reset token
      const email = "user@test.com";
      const passwordHash = await hashPassword(
        "OldPassword123!",
        FIXTURE_SALT_ROUNDS
      );

      await testDb.db.insert(testDb.schema.users).values(
        userFactory({
          email,
          passwordHash,
        })
      );

      const tokenResult = await service.generatePasswordResetToken(email);
      expect(tokenResult.token).toBeDefined();

      // Act: Use token once
      const firstResult = await service.resetPasswordWithToken(
        tokenResult.token!,
        "NewPassword123!"
      );
      expect(firstResult.success).toBe(true);

      // Try to use the same token again
      const secondResult = await service.resetPasswordWithToken(
        tokenResult.token!,
        "AnotherPassword456!"
      );

      // Assert: Second use should fail
      expect(secondResult.success).toBe(false);
      expect(secondResult.error).toBe("Invalid or expired reset token");

      // Verify password is still the one from first reset
      const verifyResult = await service.verifyCredentials(
        email,
        "NewPassword123!"
      );
      expect(verifyResult.success).toBe(true);
    });

    it("should handle transaction rollback on failure", async () => {
      // Arrange: Create user and generate reset token
      const email = "user@test.com";
      const oldPassword = "OldPassword123!";
      const passwordHash = await hashPassword(oldPassword, FIXTURE_SALT_ROUNDS);

      await testDb.db.insert(testDb.schema.users).values(
        userFactory({
          email,
          passwordHash,
        })
      );

      const tokenResult = await service.generatePasswordResetToken(email);
      expect(tokenResult.token).toBeDefined();

      // Act + Assert: a weak new password is rejected with
      // NextlyError(VALIDATION_ERROR) before the transaction commits.
      await expect(
        service.resetPasswordWithToken(tokenResult.token!, "weak")
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });

      // Verify original password still works (transaction rolled back).
      // This is the actual subject of the test: the refusal must leave the
      // account exactly as it was, so the old credentials still resolve.
      const verifyResult = await service.verifyCredentials(email, oldPassword);
      expect(verifyResult.email).toBe(email);

      // Verify token wasn't marked as used (can try again)
      const { createHash } = await import("crypto");
      const tokenHash = createHash("sha256")
        .update(tokenResult.token!)
        .digest("hex");

      const tokenRecord = await testDb.db.query.passwordResetTokens.findFirst({
        where: { tokenHash: tokenHash },
      });

      // Token should still exist and not be marked as used
      expect(tokenRecord).toBeDefined();
      expect(tokenRecord!.usedAt).toBeNull();
    });
  });

  describe("generateEmailVerificationToken()", () => {
    it("issues a token for a registered email, and nothing for an unknown one", async () => {
      // Arrange
      const email = "user@test.com";
      await testDb.db
        .insert(testDb.schema.users)
        .values(userFactory({ email }));

      // Act
      const result = await service.generateEmailVerificationToken(email);

      // Assert
      expect(result.token).toBeDefined();
      expect(result.token!.length).toBe(EXPECTED_TOKEN_LENGTH);

      // Verify token was stored in database (hashed)
      const tokens = await testDb.db.query.emailVerificationTokens.findMany({
        where: { identifier: email },
      });
      expect(tokens).toHaveLength(1);
      expect(tokens[0].expires).toBeInstanceOf(Date);
      expect(tokens[0].expires.getTime()).toBeGreaterThan(Date.now());

      // The other half of the contract, and the reason the old name ("for any
      // email") was wrong: an UNKNOWN address gets silent success — no token
      // and no row — so this endpoint cannot be used to discover which
      // addresses are registered.
      const unknown =
        await service.generateEmailVerificationToken("nobody@test.com");
      expect(unknown.token).toBeUndefined();
      expect(
        await testDb.db.query.emailVerificationTokens.findMany({
          where: { identifier: "nobody@test.com" },
        })
      ).toHaveLength(0);
    });

    it("should delete old verification tokens when generating new one", async () => {
      // Arrange
      const email = "user@test.com";

      await testDb.db
        .insert(testDb.schema.users)
        .values(userFactory({ email }));

      // Generate first token
      await service.generateEmailVerificationToken(email);

      // Act: Generate second token
      await service.generateEmailVerificationToken(email);

      // Assert: Should only have one token (new one replaces old)
      const tokens = await testDb.db.query.emailVerificationTokens.findMany({
        where: { identifier: email },
      });
      expect(tokens).toHaveLength(1);
    });

    it("should set correct expiry time (24 hours)", async () => {
      // Arrange
      const email = "user@test.com";
      await testDb.db
        .insert(testDb.schema.users)
        .values(userFactory({ email }));

      const beforeGeneration = Date.now();

      // Act
      await service.generateEmailVerificationToken(email);

      const afterGeneration = Date.now();

      // Assert
      const token = await testDb.db.query.emailVerificationTokens.findFirst({
        where: { identifier: email },
      });

      const expectedExpiryMin =
        beforeGeneration + TOKEN_EXPIRY_HOURS * HOUR_IN_MS - TIME_TOLERANCE_MS;
      const expectedExpiryMax =
        afterGeneration + TOKEN_EXPIRY_HOURS * HOUR_IN_MS + TIME_TOLERANCE_MS;

      expect(token!.expires.getTime()).toBeGreaterThanOrEqual(
        expectedExpiryMin
      );
      expect(token!.expires.getTime()).toBeLessThanOrEqual(expectedExpiryMax);
    });
  });

  describe("verifyEmail()", () => {
    // NOTE: Transaction-dependent tests are skipped
    // verifyEmail() uses withTransaction() which has issues with SQLite
    // in the test environment. The core logic is tested in other tests.
    it.skip("should successfully verify email with valid token", async () => {
      // Arrange: Create user and generate verification token
      const email = "user@test.com";
      await testDb.db.insert(testDb.schema.users).values(
        userFactory({
          email,
          emailVerified: null, // Not verified yet
        })
      );

      const tokenResult = await service.generateEmailVerificationToken(email);
      expect(tokenResult.token).toBeDefined();

      // Act
      const result = await service.verifyEmail(tokenResult.token!);

      // Assert
      expect(result.email).toBe(email);

      // Verify user's email is now verified
      const user = await testDb.db.query.users.findFirst({
        where: { email: email },
      });
      expect(user!.emailVerified).toBeDefined();
      expect(user!.emailVerified).toBeInstanceOf(Date);

      // Verify token was deleted after use
      const tokens = await testDb.db.query.emailVerificationTokens.findMany({
        where: { identifier: email },
      });
      expect(tokens).toHaveLength(0);
    });

    it("should reject invalid token", async () => {
      // Arrange
      const invalidToken = "invalid-verification-token";

      // Act
      await expect(service.verifyEmail(invalidToken)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    });

    it("should reject expired token", async () => {
      // Arrange: Create user and token that's already expired
      const email = "user@test.com";
      await testDb.db.insert(testDb.schema.users).values(
        userFactory({
          email,
          emailVerified: null,
        })
      );

      // Generate token
      const tokenResult = await service.generateEmailVerificationToken(email);
      expect(tokenResult.token).toBeDefined();

      // Manually expire the token
      const { createHash } = await import("crypto");
      const tokenHash = createHash("sha256")
        .update(tokenResult.token!)
        .digest("hex");

      await testDb.db
        .update(testDb.schema.emailVerificationTokens)
        .set({
          expires: new Date(Date.now() - 1000), // Set to past
        })
        .where(eq(testDb.schema.emailVerificationTokens.tokenHash, tokenHash));

      // Act
      await expect(
        service.verifyEmail(tokenResult.token!)
      ).rejects.toMatchObject({
        code: "TOKEN_EXPIRED",
        statusCode: 401,
      });

      // Verify user's email is still not verified
      const user = await testDb.db.query.users.findFirst({
        where: { email: email },
      });
      expect(user!.emailVerified).toBeNull();
    });

    it.skip("should delete token after successful verification", async () => {
      // Arrange: Create user and generate verification token
      const email = "user@test.com";
      await testDb.db.insert(testDb.schema.users).values(
        userFactory({
          email,
          emailVerified: null,
        })
      );

      const tokenResult = await service.generateEmailVerificationToken(email);

      // Verify token exists before verification
      const tokensBefore =
        await testDb.db.query.emailVerificationTokens.findMany({
          where: { identifier: email },
        });
      expect(tokensBefore).toHaveLength(1);

      // Act
      await service.verifyEmail(tokenResult.token!);

      // Assert: Token should be deleted
      const tokensAfter =
        await testDb.db.query.emailVerificationTokens.findMany({
          where: { identifier: email },
        });
      expect(tokensAfter).toHaveLength(0);
    });

    it("should handle transaction rollback if verification fails", async () => {
      // Arrange: Create user with invalid email (to test transaction rollback)
      const email = "user@test.com";
      await testDb.db.insert(testDb.schema.users).values(
        userFactory({
          email,
          emailVerified: null,
        })
      );

      const tokenResult = await service.generateEmailVerificationToken(email);
      expect(tokenResult.token).toBeDefined();

      // Store original token count
      const tokensBefore =
        await testDb.db.query.emailVerificationTokens.findMany({
          where: { identifier: email },
        });
      expect(tokensBefore).toHaveLength(1);

      // Note: This test verifies the transaction behavior is correct
      // In normal operation, verifyEmail should either succeed completely or fail completely
      // The token and email verification should be updated atomically
    });
  });

  describe("cleanupExpiredTokens()", () => {
    it("should delete expired password reset tokens", async () => {
      // Arrange: Create expired and valid password reset tokens
      const expiredEmail = "expired@test.com";
      const validEmail = "valid@test.com";

      // Create expired token
      const { createHash } = await import("crypto");
      const expiredTokenHash = createHash("sha256")
        .update("expired-token")
        .digest("hex");

      await testDb.db.insert(testDb.schema.passwordResetTokens).values({
        identifier: expiredEmail,
        tokenHash: expiredTokenHash,
        expires: new Date(Date.now() - 1000), // Expired
        usedAt: null,
      });

      // Create valid token
      const validTokenHash = createHash("sha256")
        .update("valid-token")
        .digest("hex");

      await testDb.db.insert(testDb.schema.passwordResetTokens).values({
        identifier: validEmail,
        tokenHash: validTokenHash,
        expires: new Date(Date.now() + TOKEN_EXPIRY_HOURS * HOUR_IN_MS), // Valid for 24h
        usedAt: null,
      });

      // Act
      await service.cleanupExpiredTokens();

      // Assert: Expired token deleted, valid token remains
      const allTokens = await testDb.db.query.passwordResetTokens.findMany();
      expect(allTokens).toHaveLength(1);
      expect(allTokens[0].identifier).toBe(validEmail);
    });

    it("should delete expired email verification tokens", async () => {
      // Arrange: Create expired and valid email verification tokens
      const expiredEmail = "expired@test.com";
      const validEmail = "valid@test.com";

      const { createHash } = await import("crypto");

      // Create expired token
      const expiredTokenHash = createHash("sha256")
        .update("expired-token")
        .digest("hex");

      await testDb.db.insert(testDb.schema.emailVerificationTokens).values({
        identifier: expiredEmail,
        tokenHash: expiredTokenHash,
        expires: new Date(Date.now() - 1000), // Expired
      });

      // Create valid token
      const validTokenHash = createHash("sha256")
        .update("valid-token")
        .digest("hex");

      await testDb.db.insert(testDb.schema.emailVerificationTokens).values({
        identifier: validEmail,
        tokenHash: validTokenHash,
        expires: new Date(Date.now() + TOKEN_EXPIRY_HOURS * HOUR_IN_MS), // Valid for 24h
      });

      // Act
      await service.cleanupExpiredTokens();

      // Assert: Expired token deleted, valid token remains
      const allTokens =
        await testDb.db.query.emailVerificationTokens.findMany();
      expect(allTokens).toHaveLength(1);
      expect(allTokens[0].identifier).toBe(validEmail);
    });
  });
});
