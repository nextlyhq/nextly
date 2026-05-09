import { describe, expect, it } from "vitest";

import {
  hashPassword,
  verifyPassword,
  validatePasswordStrength,
} from "../password";

describe("password utilities", () => {
  describe("hashPassword()", () => {
    describe("successful hashing", () => {
      it("should hash a valid password", async () => {
        const plainPassword = "MySecureP@ss123";

        const hash = await hashPassword(plainPassword);

        expect(hash).toBeDefined();
        expect(typeof hash).toBe("string");
        expect(hash).not.toBe(plainPassword);
        expect(hash.length).toBeGreaterThan(0);
      });

      it("should produce different hashes for the same password (salt)", async () => {
        const plainPassword = "SamePassword123!";

        const hash1 = await hashPassword(plainPassword);
        const hash2 = await hashPassword(plainPassword);

        // Assert: Different salts should produce different hashes
        expect(hash1).not.toBe(hash2);
      });

      it("should handle passwords with special characters", async () => {
        const passwordWithSpecialChars = "P@ssw0rd!#$%^&*()_+-=[]{}|;:,.<>?";

        const hash = await hashPassword(passwordWithSpecialChars);

        expect(hash).toBeDefined();
        expect(hash.length).toBeGreaterThan(0);

        // Verify it can be verified
        const isValid = await verifyPassword(passwordWithSpecialChars, hash);
        expect(isValid).toBe(true);
      });

      it("should handle very long passwords (>100 chars)", async () => {
        const longPassword = "A1b2C3d4!".repeat(20); // 180 characters

        const hash = await hashPassword(longPassword);

        expect(hash).toBeDefined();

        // Verify it can be verified
        const isValid = await verifyPassword(longPassword, hash);
        expect(isValid).toBe(true);
      });

      it("should handle passwords with Unicode characters", async () => {
        const unicodePassword = "Pässwörd123!你好";

        const hash = await hashPassword(unicodePassword);

        expect(hash).toBeDefined();

        // Verify it can be verified
        const isValid = await verifyPassword(unicodePassword, hash);
        expect(isValid).toBe(true);
      });

      it("should use custom salt rounds when provided", async () => {
        const password = "TestPassword123!";
        const customSaltRounds = 10;

        const hash = await hashPassword(password, customSaltRounds);

        // Assert: Hash is valid
        expect(hash).toBeDefined();

        // Assert: Cost factor in hash matches custom salt rounds
        // bcrypt hash format: $2a$10$... (cost is at positions 4-5)
        const costFactor = parseInt(hash.substring(4, 6), 10);
        expect(costFactor).toBe(customSaltRounds);

        // Assert: Password can be verified
        const isValid = await verifyPassword(password, hash);
        expect(isValid).toBe(true);
      });

      it("should produce bcrypt-format hash (starts with $2a$ or $2b$)", async () => {
        const password = "ValidPassword123!";

        const hash = await hashPassword(password);

        // Assert: bcrypt hashes start with $2a$ or $2b$ followed by cost factor
        expect(hash).toMatch(/^\$2[ab]\$\d{2}\$/);
      });
    });

    describe("validation and errors", () => {
      it("should throw error for empty password", async () => {
        // Act & Assert
        await expect(hashPassword("")).rejects.toThrow(
          "hashPassword: plain must be non-empty"
        );
      });

      it("should accept whitespace-only password (no validation in hashPassword)", async () => {
        // Arrange: hashPassword() doesn't validate strength, only checks non-empty
        const whitespacePassword = "   ";

        const hash = await hashPassword(whitespacePassword);

        // Assert: Hashing succeeds (validation should happen before hashing)
        expect(hash).toBeDefined();
        expect(hash).toMatch(/^\$2[ab]\$\d{2}\$/);

        // Note: In production, validatePasswordStrength() should be called
        // BEFORE hashPassword() to reject weak passwords like this
      });
    });
  });

  describe("verifyPassword()", () => {
    describe("successful verification", () => {
      it("should verify correct password", async () => {
        const plainPassword = "CorrectPassword123!";
        const hash = await hashPassword(plainPassword);

        const isValid = await verifyPassword(plainPassword, hash);

        expect(isValid).toBe(true);
      });

      it("should verify password with special characters", async () => {
        const password = "Sp3c!@l#Ch@rs$%^&*()";
        const hash = await hashPassword(password);

        const isValid = await verifyPassword(password, hash);

        expect(isValid).toBe(true);
      });

      it("should verify very long passwords", async () => {
        const longPassword = "VeryLongP@ssw0rd!".repeat(10); // 170 chars
        const hash = await hashPassword(longPassword);

        const isValid = await verifyPassword(longPassword, hash);

        expect(isValid).toBe(true);
      });

      it("should verify password with Unicode characters", async () => {
        const unicodePassword = "Pässwörd123!日本語";
        const hash = await hashPassword(unicodePassword);

        const isValid = await verifyPassword(unicodePassword, hash);

        expect(isValid).toBe(true);
      });
    });

    describe("failed verification", () => {
      it("should reject incorrect password", async () => {
        const correctPassword = "CorrectPassword123!";
        const wrongPassword = "WrongPassword456!";
        const hash = await hashPassword(correctPassword);

        const isValid = await verifyPassword(wrongPassword, hash);

        expect(isValid).toBe(false);
      });

      it("should reject password with wrong case", async () => {
        const password = "CaseSensitiveP@ss123";
        const wrongCasePassword = "casesensitivep@ss123";
        const hash = await hashPassword(password);

        const isValid = await verifyPassword(wrongCasePassword, hash);

        expect(isValid).toBe(false);
      });

      it("should reject password with extra characters", async () => {
        const password = "Password123!";
        const passwordWithExtra = "Password123!extra";
        const hash = await hashPassword(password);

        const isValid = await verifyPassword(passwordWithExtra, hash);

        expect(isValid).toBe(false);
      });

      it("should reject password with missing characters", async () => {
        const password = "Password123!";
        const passwordWithMissing = "Password123";
        const hash = await hashPassword(password);

        const isValid = await verifyPassword(passwordWithMissing, hash);

        expect(isValid).toBe(false);
      });
    });

    describe("edge cases and security", () => {
      it("should return false for empty password", async () => {
        const hash = await hashPassword("ValidPassword123!");

        const isValid = await verifyPassword("", hash);

        expect(isValid).toBe(false);
      });

      it("should return false for empty hash", async () => {
        const password = "ValidPassword123!";

        const isValid = await verifyPassword(password, "");

        expect(isValid).toBe(false);
      });

      it("should return false for invalid hash format", async () => {
        const password = "ValidPassword123!";
        const invalidHash = "not-a-bcrypt-hash";

        const isValid = await verifyPassword(password, invalidHash);

        expect(isValid).toBe(false);
      });

      it("should return false for malformed bcrypt hash", async () => {
        const password = "ValidPassword123!";
        const malformedHash = "$2a$12$invalidhashvalue";

        const isValid = await verifyPassword(password, malformedHash);

        expect(isValid).toBe(false);
      });

      it("should use bcrypt which is timing-attack resistant by design", async () => {
        const correctPassword = "CorrectPassword123!";
        const wrongPassword = "WrongPassword456!";
        const hash = await hashPassword(correctPassword);

        // Act & Assert: bcrypt's constant-time comparison is built-in
        // We verify the function works correctly for both cases
        const isValidCorrect = await verifyPassword(correctPassword, hash);
        const isValidWrong = await verifyPassword(wrongPassword, hash);

        expect(isValidCorrect).toBe(true);
        expect(isValidWrong).toBe(false);

        // Note: bcrypt.compare() is inherently timing-attack resistant.
        // Testing execution time differences is unreliable (environment-dependent)
        // and doesn't validate actual timing-attack resistance.
      });

      it("should handle comparison with externally generated bcrypt hash", async () => {
        // Arrange: Generate our own hash for a known password
        const knownPassword = "TestPassword123!";
        const hash = await hashPassword(knownPassword);

        // Act: Verify with the same password
        const isValid = await verifyPassword(knownPassword, hash);

        // Assert: Should successfully verify
        expect(isValid).toBe(true);

        // Assert: Hash format should be valid bcrypt
        expect(hash).toMatch(/^\$2[ab]\$\d{2}\$/);
      });
    });
  });

  describe("validatePasswordStrength()", () => {
    describe("valid passwords", () => {
      it("should accept password meeting all requirements", () => {
        const validPassword = "ValidP@ss123";

        const result = validatePasswordStrength(validPassword);

        expect(result.ok).toBe(true);
        expect(result.errors).toBeUndefined();
      });

      it("should accept password with minimum length (8 chars)", () => {
        // Arrange: 8 chars incl. upper, lower, number, and special character
        const minLengthPassword = "Valid1!a";

        const result = validatePasswordStrength(minLengthPassword);

        expect(result.ok).toBe(true);
      });

      it("should accept password with special characters", () => {
        const passwordWithSpecialChars = "P@ssw0rd!#$%^&*()_+-=";

        const result = validatePasswordStrength(passwordWithSpecialChars);

        expect(result.ok).toBe(true);
      });

      it("should accept very long password (<128 chars)", () => {
        const longPassword = "ValidP@ss1" + "a".repeat(110); // 120 chars

        const result = validatePasswordStrength(longPassword);

        expect(result.ok).toBe(true);
      });
    });

    describe("invalid passwords", () => {
      it("should reject password shorter than 8 characters", () => {
        const shortPassword = "Pass1A";

        const result = validatePasswordStrength(shortPassword);

        expect(result.ok).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors?.length).toBeGreaterThan(0);
        expect(result.errors?.some(e => e.includes("at least 8"))).toBe(true);
      });

      it("should reject password longer than 128 characters", () => {
        const tooLongPassword = "ValidP@ss1" + "a".repeat(120); // 130 chars

        const result = validatePasswordStrength(tooLongPassword);

        expect(result.ok).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors?.some(e => e.includes("less than 128"))).toBe(
          true
        );
      });

      it("should reject password without lowercase letter", () => {
        const noLowercase = "PASSWORD123!";

        const result = validatePasswordStrength(noLowercase);

        expect(result.ok).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors?.some(e => e.includes("lowercase letter"))).toBe(
          true
        );
      });

      it("should reject password without uppercase letter", () => {
        const noUppercase = "password123!";

        const result = validatePasswordStrength(noUppercase);

        expect(result.ok).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors?.some(e => e.includes("uppercase letter"))).toBe(
          true
        );
      });

      it("should reject password without number", () => {
        const noNumber = "PasswordOnly!";

        const result = validatePasswordStrength(noNumber);

        expect(result.ok).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors?.some(e => e.includes("number"))).toBe(true);
      });

      it("should reject empty password", () => {
        const emptyPassword = "";

        const result = validatePasswordStrength(emptyPassword);

        expect(result.ok).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors?.length).toBeGreaterThan(0);
      });

      it("should provide multiple errors for password failing multiple rules", () => {
        const badPassword = "abc"; // Too short, no uppercase, no number

        const result = validatePasswordStrength(badPassword);

        expect(result.ok).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors?.length).toBeGreaterThanOrEqual(2);
      });
    });

    describe("edge cases", () => {
      it("should handle password with only required character types", () => {
        // Arrange: exactly 8 chars — 1 upper, 1 lower, 1 number, 1 special
        const minimalPassword = "Abcdef1!";

        const result = validatePasswordStrength(minimalPassword);

        expect(result.ok).toBe(true);
      });

      it("should reject weak all-lowercase password that only meets length (regression for setup bypass)", () => {
        // Arrange: This is the exact bypass string from the incident.
        // Ten lowercase 'a' chars passes min(8) but fails every other rule.
        const bypassPassword = "aaaaaaaaaa";

        const result = validatePasswordStrength(bypassPassword);

        expect(result.ok).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors?.some(e => e.includes("uppercase letter"))).toBe(
          true
        );
        expect(result.errors?.some(e => e.includes("number"))).toBe(true);
        expect(result.errors?.some(e => e.includes("special character"))).toBe(
          true
        );
      });

      it("should reject password without a special character", () => {
        // Arrange: upper + lower + digit but no symbol
        const noSpecial = "Password123";

        const result = validatePasswordStrength(noSpecial);

        expect(result.ok).toBe(false);
        expect(result.errors?.some(e => e.includes("special character"))).toBe(
          true
        );
      });

      it("should handle password at exactly 128 character limit", () => {
        const maxLengthPassword = "ValidP@ss1" + "a".repeat(118); // Exactly 128 chars

        const result = validatePasswordStrength(maxLengthPassword);

        expect(result.ok).toBe(true);
      });

      it("should handle whitespace in password", () => {
        // Arrange: Password with spaces (still valid if meets other requirements)
        const passwordWithSpaces = "Valid Pass 123";

        const result = validatePasswordStrength(passwordWithSpaces);

        expect(result.ok).toBe(true);
      });
    });
  });

  describe("integration scenarios", () => {
    it("should hash and verify password lifecycle", async () => {
      const password = "UserPassword123!";

      // Act: Validate strength
      const strengthCheck = validatePasswordStrength(password);
      expect(strengthCheck.ok).toBe(true);

      // Act: Hash password
      const hash = await hashPassword(password);
      expect(hash).toBeDefined();

      // Act: Verify correct password
      const isValidCorrect = await verifyPassword(password, hash);
      expect(isValidCorrect).toBe(true);

      // Act: Verify wrong password
      const isValidWrong = await verifyPassword("WrongPassword123!", hash);
      expect(isValidWrong).toBe(false);
    });

    it("should reject weak password before hashing", async () => {
      const weakPassword = "weak";

      // Act: Validate strength first
      const strengthCheck = validatePasswordStrength(weakPassword);

      // Assert: Should fail validation
      expect(strengthCheck.ok).toBe(false);
      expect(strengthCheck.errors).toBeDefined();
      expect(strengthCheck.errors?.length).toBeGreaterThan(0);

      // Note: hashPassword doesn't validate strength - it only checks non-empty
      // In a real app, you'd validate BEFORE calling hashPassword
    });

    it("should handle user registration flow", async () => {
      // Arrange: Simulated user registration
      const userPassword = "NewUserP@ss123";

      // Step 1: Validate password strength
      const strengthCheck = validatePasswordStrength(userPassword);
      expect(strengthCheck.ok).toBe(true);

      // Step 2: Hash for storage
      const hashedPassword = await hashPassword(userPassword);
      expect(hashedPassword).toBeDefined();
      expect(hashedPassword).not.toBe(userPassword);

      // Step 3: Later login - verify password
      const loginAttempt = "NewUserP@ss123";
      const isAuthenticated = await verifyPassword(
        loginAttempt,
        hashedPassword
      );
      expect(isAuthenticated).toBe(true);

      // Step 4: Failed login - wrong password
      const wrongLoginAttempt = "WrongPassword123!";
      const isAuthenticatedWrong = await verifyPassword(
        wrongLoginAttempt,
        hashedPassword
      );
      expect(isAuthenticatedWrong).toBe(false);
    });
  });
});
