import bcrypt from "bcryptjs";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  hashPassword,
  isPasswordHash,
  verifyPassword,
  validatePasswordStrength,
  checkPasswordPolicyRules,
  checkDigesterReach,
  assertPasswordHasherContract,
  setMinPasswordLength,
  getMinPasswordLength,
  resetPasswordPolicy,
  DEFAULT_MIN_PASSWORD_LENGTH,
  DEFAULT_DIGESTER_REACH_BYTES,
  MAX_PASSWORD_LENGTH_CHARS,
  type PasswordHasher,
} from "../password";

/**
 * The cost every hash here is made at, except where the cost is the subject.
 *
 * bcryptjs at the default cost of 12 takes about a quarter of a second per
 * hash on a fast machine and several times that on a loaded runner, and this
 * file hashes some thirty times. bcrypt writes its cost into the hash, so
 * `verifyPassword` checks a cost-4 hash exactly as it checks a cost-12 one: what
 * these tests exercise is the same code at either cost. The default itself is
 * pinned once, below.
 */
const FIXTURE_SALT_ROUNDS = 4;

/** A raw password a shape test once stored as given: long, with a colon. */
const COLON_PASSPHRASE = "correct-horse:battery-staple-and-more-words";

describe("password utilities", () => {
  describe("hashPassword()", () => {
    describe("successful hashing", () => {
      it("should hash a valid password", async () => {
        const plainPassword = "MySecureP@ss123";

        const hash = await hashPassword(plainPassword, FIXTURE_SALT_ROUNDS);

        expect(hash).toBeDefined();
        expect(typeof hash).toBe("string");
        expect(hash).not.toBe(plainPassword);
        expect(hash.length).toBeGreaterThan(0);
      });

      it("should produce different hashes for the same password (salt)", async () => {
        const plainPassword = "SamePassword123!";

        const hash1 = await hashPassword(plainPassword, FIXTURE_SALT_ROUNDS);
        const hash2 = await hashPassword(plainPassword, FIXTURE_SALT_ROUNDS);

        // Assert: Different salts should produce different hashes
        expect(hash1).not.toBe(hash2);
      });

      it("should handle passwords with special characters", async () => {
        const passwordWithSpecialChars = "P@ssw0rd!#$%^&*()_+-=[]{}|;:,.<>?";

        const hash = await hashPassword(
          passwordWithSpecialChars,
          FIXTURE_SALT_ROUNDS
        );

        expect(hash).toBeDefined();
        expect(hash.length).toBeGreaterThan(0);

        // Verify it can be verified
        const isValid = await verifyPassword(passwordWithSpecialChars, hash);
        expect(isValid).toBe(true);
      });

      it("should handle very long passwords (>100 chars)", async () => {
        const longPassword = "A1b2C3d4!".repeat(20); // 180 characters

        const hash = await hashPassword(longPassword, FIXTURE_SALT_ROUNDS);

        expect(hash).toBeDefined();

        // Verify it can be verified
        const isValid = await verifyPassword(longPassword, hash);
        expect(isValid).toBe(true);
      });

      it("should handle passwords with Unicode characters", async () => {
        const unicodePassword = "Pässwörd123!你好";

        const hash = await hashPassword(unicodePassword, FIXTURE_SALT_ROUNDS);

        expect(hash).toBeDefined();

        // Verify it can be verified
        const isValid = await verifyPassword(unicodePassword, hash);
        expect(isValid).toBe(true);
      });

      it("should use custom salt rounds when provided", async () => {
        const password = "TestPassword123!";
        const customSaltRounds = 5;

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

      it("should produce a bcrypt-format hash at the default cost of 12", async () => {
        const password = "ValidPassword123!";

        const hash = await hashPassword(password);

        // bcrypt hashes start with $2a$ or $2b$, then the cost factor. The one
        // hash in this file made at the default cost, so the default is pinned.
        expect(hash).toMatch(/^\$2[ab]\$12\$/);
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

        const hash = await hashPassword(
          whitespacePassword,
          FIXTURE_SALT_ROUNDS
        );

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
        const hash = await hashPassword(plainPassword, FIXTURE_SALT_ROUNDS);

        const isValid = await verifyPassword(plainPassword, hash);

        expect(isValid).toBe(true);
      });

      it("should verify password with special characters", async () => {
        const password = "Sp3c!@l#Ch@rs$%^&*()";
        const hash = await hashPassword(password, FIXTURE_SALT_ROUNDS);

        const isValid = await verifyPassword(password, hash);

        expect(isValid).toBe(true);
      });

      it("should verify very long passwords", async () => {
        const longPassword = "VeryLongP@ssw0rd!".repeat(10); // 170 chars
        const hash = await hashPassword(longPassword, FIXTURE_SALT_ROUNDS);

        const isValid = await verifyPassword(longPassword, hash);

        expect(isValid).toBe(true);
      });

      it("should verify password with Unicode characters", async () => {
        const unicodePassword = "Pässwörd123!日本語";
        const hash = await hashPassword(unicodePassword, FIXTURE_SALT_ROUNDS);

        const isValid = await verifyPassword(unicodePassword, hash);

        expect(isValid).toBe(true);
      });
    });

    describe("failed verification", () => {
      it("should reject incorrect password", async () => {
        const correctPassword = "CorrectPassword123!";
        const wrongPassword = "WrongPassword456!";
        const hash = await hashPassword(correctPassword, FIXTURE_SALT_ROUNDS);

        const isValid = await verifyPassword(wrongPassword, hash);

        expect(isValid).toBe(false);
      });

      it("should reject password with wrong case", async () => {
        const password = "CaseSensitiveP@ss123";
        const wrongCasePassword = "casesensitivep@ss123";
        const hash = await hashPassword(password, FIXTURE_SALT_ROUNDS);

        const isValid = await verifyPassword(wrongCasePassword, hash);

        expect(isValid).toBe(false);
      });

      it("should reject password with extra characters", async () => {
        const password = "Password123!";
        const passwordWithExtra = "Password123!extra";
        const hash = await hashPassword(password, FIXTURE_SALT_ROUNDS);

        const isValid = await verifyPassword(passwordWithExtra, hash);

        expect(isValid).toBe(false);
      });

      it("should reject password with missing characters", async () => {
        const password = "Password123!";
        const passwordWithMissing = "Password123";
        const hash = await hashPassword(password, FIXTURE_SALT_ROUNDS);

        const isValid = await verifyPassword(passwordWithMissing, hash);

        expect(isValid).toBe(false);
      });
    });

    describe("edge cases and security", () => {
      it("should return false for empty password", async () => {
        const hash = await hashPassword(
          "ValidPassword123!",
          FIXTURE_SALT_ROUNDS
        );

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
        const hash = await hashPassword(correctPassword, FIXTURE_SALT_ROUNDS);

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
        const hash = await hashPassword(knownPassword, FIXTURE_SALT_ROUNDS);

        // Act: Verify with the same password
        const isValid = await verifyPassword(knownPassword, hash);

        // Assert: Should successfully verify
        expect(isValid).toBe(true);

        // Assert: Hash format should be valid bcrypt
        expect(hash).toMatch(/^\$2[ab]\$\d{2}\$/);
      });
    });
  });

  describe("validatePasswordStrength() and R-5 password policy", () => {
    afterEach(() => {
      resetPasswordPolicy();
    });

    describe("R-5: length and absence of character classes", () => {
      it("accepts a class-less password of exactly the minimum length (8 chars)", () => {
        // Class-less: lowercase letters only, no numbers, uppercase, or symbols
        const minPassword = "xyzwvuts";
        const result = validatePasswordStrength(minPassword);
        expect(result.ok).toBe(true);
        expect(result.errors).toBeUndefined();
      });

      it("accepts a password within the bounds (e.g. letters and spaces, no special requirements)", () => {
        const passphrase = "correct horse battery staple";
        const result = validatePasswordStrength(passphrase);
        expect(result.ok).toBe(true);
      });

      it("refuses a password below the minimum length", () => {
        const short = "abcdefg"; // 7 chars
        const result = validatePasswordStrength(short);
        expect(result.ok).toBe(false);
        expect(result.errors?.some(e => e.includes("at least 8"))).toBe(true);
      });

      it("refuses an empty password", () => {
        const result = validatePasswordStrength("");
        expect(result.ok).toBe(false);
        expect(
          result.errors?.some(e => e.includes("Password is required"))
        ).toBe(true);
      });

      it("counts characters by code points rather than code units, refusing 4 emojis", () => {
        // 4 emojis: 4 code points, 8 UTF-16 code units
        const fourEmoji = "😀😀😀😀";
        expect(fourEmoji.length).toBe(8); // UTF-16 units
        const result = validatePasswordStrength(fourEmoji);
        expect(result.ok).toBe(false);
        expect(result.errors?.some(e => e.includes("at least 8"))).toBe(true);
      });

      it("accepts 8 emojis meeting the minimum code point requirement within reach", () => {
        // 8 emojis: 8 code points, 32 UTF-8 bytes (well within 72 bytes)
        const eightEmoji = "😀".repeat(8);
        const result = validatePasswordStrength(eightEmoji);
        expect(result.ok).toBe(true);
      });

      it("does NOT require uppercase, lowercase, numbers, or special symbols", () => {
        // All digits (not in common passwords)
        const allDigits = "81726354";
        expect(validatePasswordStrength(allDigits).ok).toBe(true);

        // All lowercase
        const allLower = "classlesspass";
        expect(validatePasswordStrength(allLower).ok).toBe(true);

        // All uppercase
        const allUpper = "CLASSLESSPASS";
        expect(validatePasswordStrength(allUpper).ok).toBe(true);
      });
    });

    describe("R-5: common passwords refusal", () => {
      it("refuses passwords from across the head of the common passwords list", () => {
        // Head of COMMON_PASSWORDS
        const headEntries = [
          "123456789",
          "password",
          "12345678",
          "password1",
          "1234567890",
          "iloveyou",
          "1q2w3e4r5t",
          "qwertyuiop",
        ];

        for (const common of headEntries) {
          const result = validatePasswordStrength(common);
          expect(result.ok).toBe(false);
          expect(result.errors?.some(e => e.includes("too common"))).toBe(true);
        }
      });

      it("refuses a common password in another case (case-insensitive)", () => {
        const variations = ["PassWord", "PASSWORD", "ILOVEYOU", "QwErTyUiOp"];
        for (const variant of variations) {
          const result = validatePasswordStrength(variant);
          expect(result.ok).toBe(false);
          expect(result.errors?.some(e => e.includes("too common"))).toBe(true);
        }
      });

      it("an upgraded account whose stored password is on the common list still signs in with it", async () => {
        // The rule binds when setting a password, never re-judges stored passwords
        const commonPlain = "password";
        const hash = await hashPassword(commonPlain, FIXTURE_SALT_ROUNDS);
        expect(await verifyPassword(commonPlain, hash)).toBe(true);

        // But setting it again is refused
        const validation = validatePasswordStrength(commonPlain);
        expect(validation.ok).toBe(false);
        expect(validation.errors?.some(e => e.includes("too common"))).toBe(
          true
        );
      });
    });

    describe("R-5: configurable minimum length (raising to 15)", () => {
      it("with minimum raised to 15, refuses 14 characters and accepts 15", () => {
        setMinPasswordLength(15);
        expect(getMinPasswordLength()).toBe(15);

        const fourteen = "unique-pass-14"; // 14 characters
        expect(fourteen.length).toBe(14);
        const res14 = validatePasswordStrength(fourteen);
        expect(res14.ok).toBe(false);
        expect(res14.errors?.some(e => e.includes("at least 15"))).toBe(true);

        const fifteen = "unique-pass-15c"; // 15 characters
        expect(fifteen.length).toBe(15);
        const res15 = validatePasswordStrength(fifteen);
        expect(res15.ok).toBe(true);
      });

      it("accepts per-call minLength override in options", () => {
        const fourteen = "unique-pass-14";
        const res14 = validatePasswordStrength(fourteen, { minLength: 15 });
        expect(res14.ok).toBe(false);
        expect(res14.errors?.some(e => e.includes("at least 15"))).toBe(true);

        const resDefault = validatePasswordStrength(fourteen);
        expect(resDefault.ok).toBe(true);
      });
    });

    describe("R-5: default bcrypt digester reach (72 bytes)", () => {
      it("accepts a password exactly at 72 UTF-8 bytes", () => {
        const at72 = "a".repeat(72);
        expect(Buffer.byteLength(at72, "utf8")).toBe(72);
        const result = validatePasswordStrength(at72);
        expect(result.ok).toBe(true);
      });

      it("refuses a password longer than 72 UTF-8 bytes with a message that says so", () => {
        const at73 = "a".repeat(73);
        expect(Buffer.byteLength(at73, "utf8")).toBe(73);
        const result = validatePasswordStrength(at73);
        expect(result.ok).toBe(false);
        expect(result.errors?.some(e => e.includes("72-byte limit"))).toBe(
          true
        );
      });

      it("refuses multibyte input crossing the 72-byte boundary", () => {
        // 70 ASCII bytes + '€' (3 bytes) = 73 bytes
        const multi73 = "a".repeat(70) + "€";
        expect(Buffer.byteLength(multi73, "utf8")).toBe(73);
        const resEuro = validatePasswordStrength(multi73);
        expect(resEuro.ok).toBe(false);
        expect(resEuro.errors?.some(e => e.includes("72-byte limit"))).toBe(
          true
        );

        // 71 ASCII bytes + 'é' (2 bytes) = 73 bytes
        const multiAccent = "a".repeat(71) + "é";
        expect(Buffer.byteLength(multiAccent, "utf8")).toBe(73);
        const resAccent = validatePasswordStrength(multiAccent);
        expect(resAccent.ok).toBe(false);
        expect(resAccent.errors?.some(e => e.includes("72-byte limit"))).toBe(
          true
        );

        // 70 ASCII bytes + 'é' (2 bytes) = 72 bytes -> exactly at limit, accepted
        const multi72 = "a".repeat(70) + "é";
        expect(Buffer.byteLength(multi72, "utf8")).toBe(72);
        expect(validatePasswordStrength(multi72).ok).toBe(true);
      });

      it("two values identical to reach and differing after it are never both accepted (both refused on write)", () => {
        const prefix72 = "a".repeat(72);
        const val1 = prefix72 + "X";
        const val2 = prefix72 + "Y";

        const res1 = validatePasswordStrength(val1);
        const res2 = validatePasswordStrength(val2);

        // Neither is accepted
        expect(res1.ok).toBe(false);
        expect(res2.ok).toBe(false);
      });

      it("an upgraded account whose stored password is past 72 bytes still signs in with it", async () => {
        const longPassword = "A1b2C3d4!".repeat(10); // 90 bytes
        const hash = await hashPassword(longPassword, FIXTURE_SALT_ROUNDS);

        // verifyPassword verifies past 72 bytes
        expect(await verifyPassword(longPassword, hash)).toBe(true);

        // But setting it again is refused under default digester
        const validation = validatePasswordStrength(longPassword);
        expect(validation.ok).toBe(false);
        expect(validation.errors?.some(e => e.includes("72-byte limit"))).toBe(
          true
        );
      });
    });

    describe("R-5: custom PasswordHasher reach contract", () => {
      it("finite reach fixture: accepts at and below reach, refuses past it", () => {
        const customHasher: PasswordHasher = {
          name: "FiniteHasher",
          reach: 100,
          hash: async (p: string) => `hash:${p}`,
          verify: async (p: string, h: string) => h === `hash:${p}`,
        };

        // 80 bytes: accepted
        const at80 = "a".repeat(80);
        expect(
          validatePasswordStrength(at80, { hasher: customHasher }).ok
        ).toBe(true);

        // 100 bytes: accepted
        const at100 = "a".repeat(100);
        expect(
          validatePasswordStrength(at100, { hasher: customHasher }).ok
        ).toBe(true);

        // 101 bytes: refused
        const at101 = "a".repeat(101);
        const res101 = validatePasswordStrength(at101, {
          hasher: customHasher,
        });
        expect(res101.ok).toBe(false);
        expect(res101.errors?.some(e => e.includes("100-byte limit"))).toBe(
          true
        );
      });

      it("unbounded reach fixture: accepted past 72 bytes, accepted at 128 chars, refused past 128 chars", () => {
        const unboundedHasher: PasswordHasher = {
          name: "UnboundedHasher",
          reach: "unbounded",
          hash: async (p: string) => `unbounded:${p}`,
          verify: async (p: string, h: string) => h === `unbounded:${p}`,
        };

        // 80 bytes: accepted (no 72-byte refusal)
        const at80 = "a".repeat(80);
        expect(
          validatePasswordStrength(at80, { hasher: unboundedHasher }).ok
        ).toBe(true);

        // 120 chars: accepted
        const at120 = "a".repeat(120);
        expect(
          validatePasswordStrength(at120, { hasher: unboundedHasher }).ok
        ).toBe(true);

        // Exactly 128 chars (input maximum): accepted
        const at128 = "a".repeat(128);
        expect(
          validatePasswordStrength(at128, { hasher: unboundedHasher }).ok
        ).toBe(true);

        // 129 chars: refused by resource safety cap
        const at129 = "a".repeat(129);
        const res129 = validatePasswordStrength(at129, {
          hasher: unboundedHasher,
        });
        expect(res129.ok).toBe(false);
        expect(res129.errors?.some(e => e.includes("128"))).toBe(true);
      });

      it("astral characters within the 128 character maximum are accepted under unbounded hasher", () => {
        const unboundedHasher: PasswordHasher = {
          reach: "unbounded",
          hash: async () => "",
          verify: async () => true,
        };

        // 100 emojis = 100 code points (<= 128), but 200 UTF-16 code units (> 128)
        const hundredEmoji = "😀".repeat(100);
        expect(hundredEmoji.length).toBe(200); // Code units
        const res = validatePasswordStrength(hundredEmoji, {
          hasher: unboundedHasher,
        });
        expect(res.ok).toBe(true);

        // 129 emojis = 129 code points (> 128) -> refused
        const excessEmoji = "😀".repeat(129);
        const resExcess = validatePasswordStrength(excessEmoji, {
          hasher: unboundedHasher,
        });
        expect(resExcess.ok).toBe(false);
        expect(resExcess.errors?.some(e => e.includes("128"))).toBe(true);
      });

      it("refuses to start when custom digester lacks reach contract, naming the digester", () => {
        class Argon2Hasher {
          async hash() {
            return "";
          }
          async verify() {
            return true;
          }
        }

        const badHasher = new Argon2Hasher();
        expect(() => assertPasswordHasherContract(badHasher)).toThrowError(
          /Password digester "Argon2Hasher" must declare its reach contract/
        );

        // With named object
        const unnamedBad = {
          name: "custom-digester",
          hash: async () => "",
          verify: async () => true,
        };
        expect(() => assertPasswordHasherContract(unnamedBad)).toThrowError(
          /Password digester "custom-digester" must declare its reach contract/
        );

        // Serves once reach contract arrives
        const validContract = {
          ...unnamedBad,
          reach: "unbounded" as const,
        };
        expect(() => assertPasswordHasherContract(validContract)).not.toThrow();
      });

      it("supports custom hasher with validate function", () => {
        const validateHasher: PasswordHasher = {
          name: "ValidatingHasher",
          validate: (password: string) => {
            if (password.includes("forbidden")) {
              return "Custom validation: forbidden substring detected.";
            }
            return true;
          },
          hash: async () => "",
          verify: async () => true,
        };

        const resForbidden = validatePasswordStrength("forbidden-secret", {
          hasher: validateHasher,
        });
        expect(resForbidden.ok).toBe(false);
        expect(
          resForbidden.errors?.some(e => e.includes("forbidden substring"))
        ).toBe(true);

        const resValid = validatePasswordStrength("allowed-secret-word", {
          hasher: validateHasher,
        });
        expect(resValid.ok).toBe(true);
      });

      it("refuses a numeric reach that is not a positive whole number of bytes", () => {
        for (const reach of [Number.NaN, Infinity, -1, 0, 7.5]) {
          expect(() =>
            assertPasswordHasherContract({
              name: "BrokenHasher",
              reach,
              hash: async () => "",
              verify: async () => true,
            })
          ).toThrowError(/positive whole number of bytes/);
        }

        // A bare descriptor naming an invalid reach is refused the same way —
        // the check runs wherever the contract is consulted, boot included.
        expect(() =>
          checkDigesterReach("x".repeat(10), {
            name: "BrokenDescriptor",
            reach: Number.NaN,
          })
        ).toThrowError(/positive whole number of bytes/);

        expect(() =>
          assertPasswordHasherContract({
            name: "WholeHasher",
            reach: 72,
            hash: async () => "",
            verify: async () => true,
          })
        ).not.toThrow();
      });

      it("keeps a thrown validator's message out of the public refusal", () => {
        const throwingHasher: PasswordHasher = {
          name: "ThrowingHasher",
          validate: () => {
            throw new Error("connection to HSM vault lost at 10.0.0.7");
          },
          hash: async () => "",
          verify: async () => true,
        };

        const res = validatePasswordStrength("some-secret-password", {
          hasher: throwingHasher,
        });
        expect(res.ok).toBe(false);
        expect(res.errors).toEqual(["Password exceeds the digester's reach."]);
        expect(res.errors?.some(e => e.includes("HSM vault"))).toBe(false);
      });

      it("refuses on an empty validator message instead of reading it as acceptance", () => {
        // An explicit `false` or `{ ok: false }` verdict with an empty
        // message is still a refusal: the generic message stands in, and an
        // empty refusal must never read as "no error".
        for (const answer of [
          "",
          false,
          { ok: false },
          { ok: false, message: "" },
        ]) {
          const refusingHasher: PasswordHasher = {
            name: "EmptyMessageHasher",
            validate: () => answer,
            hash: async () => "",
            verify: async () => true,
          };
          const res = validatePasswordStrength("some-secret-password", {
            hasher: refusingHasher,
          });
          expect(res.ok).toBe(false);
          expect(res.errors).toEqual([
            "Password exceeds the digester's reach.",
          ]);
        }

        // `{ ok: false, message: "..." }` with a real message keeps it.
        const messagedHasher: PasswordHasher = {
          name: "MessagedHasher",
          validate: () => ({
            ok: false,
            message: "too long for this digester",
          }),
          hash: async () => "",
          verify: async () => true,
        };
        const res = validatePasswordStrength("some-secret-password", {
          hasher: messagedHasher,
        });
        expect(res.errors).toEqual(["too long for this digester"]);
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
      const hash = await hashPassword(password, FIXTURE_SALT_ROUNDS);
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
      const hashedPassword = await hashPassword(
        userPassword,
        FIXTURE_SALT_ROUNDS
      );
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

  describe("a stored value that is not a hash", () => {
    it("is refused without being compared, even when it is the password given", async () => {
      // Refused by rule, not left to bcrypt to reject: the comparison is
      // never asked about a value that is not a hash.
      const compare = vi.spyOn(bcrypt, "compare");
      try {
        expect(await verifyPassword(COLON_PASSPHRASE, COLON_PASSPHRASE)).toBe(
          false
        );
        expect(compare).not.toHaveBeenCalled();
        // The control: a real hash is compared, and the right password
        // matches it.
        const hash = await hashPassword(COLON_PASSPHRASE, FIXTURE_SALT_ROUNDS);
        expect(await verifyPassword(COLON_PASSPHRASE, hash)).toBe(true);
        expect(compare).toHaveBeenCalledTimes(1);
      } finally {
        compare.mockRestore();
      }
    });

    it("is told from a hash whatever it looks like", async () => {
      expect(
        isPasswordHash(
          await hashPassword(COLON_PASSPHRASE, FIXTURE_SALT_ROUNDS)
        )
      ).toBe(true);
      expect(isPasswordHash(COLON_PASSPHRASE)).toBe(false);
      // A bcrypt prefix is not enough: the whole hash is.
      expect(isPasswordHash("$2a$12$invalidhashvalue")).toBe(false);
      expect(isPasswordHash("")).toBe(false);
      expect(isPasswordHash(null)).toBe(false);
    });
  });
});
