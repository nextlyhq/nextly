import { describe, expect, it } from "vitest";

import {
  generateApiKey,
  hashApiKey,
  isKeyExpired,
} from "../services/api-key-service";

// ─────────────────────────────────────────────────────────────────────────────
// Constants derived from the documented key format:
//   sk_live_<base64url-32-bytes>
//   prefix (8) + secret (43) = 51 chars total
// ─────────────────────────────────────────────────────────────────────────────
const KEY_PREFIX = "sk_live_";
const PREFIX_LENGTH = KEY_PREFIX.length; // 8
const SECRET_LENGTH = 43; // base64url(32 bytes) with no padding
const FULL_KEY_LENGTH = PREFIX_LENGTH + SECRET_LENGTH; // 51
const KEY_PREFIX_DISPLAY_LENGTH = 16; // first 16 chars stored for masked UI display
const HASH_LENGTH = 64; // SHA-256 hex digest
// base64url alphabet (RFC 4648 §5) — no +, /, or = — all safe in HTTP headers
const BASE64URL_SAFE_PATTERN = /^[A-Za-z0-9_-]+$/;

describe("generateApiKey()", () => {
  describe("key format", () => {
    it("should return an object with fullKey, keyHash, and keyPrefix", () => {
      // Act
      const result = generateApiKey();

      // Assert
      expect(result).toHaveProperty("fullKey");
      expect(result).toHaveProperty("keyHash");
      expect(result).toHaveProperty("keyPrefix");
      expect(typeof result.fullKey).toBe("string");
      expect(typeof result.keyHash).toBe("string");
      expect(typeof result.keyPrefix).toBe("string");
    });

    it(`should start fullKey with the '${KEY_PREFIX}' prefix`, () => {
      // Act
      const { fullKey } = generateApiKey();

      // Assert
      expect(fullKey.startsWith(KEY_PREFIX)).toBe(true);
    });

    it(`should produce a fullKey of exactly ${FULL_KEY_LENGTH} characters`, () => {
      // Act
      const { fullKey } = generateApiKey();

      // Assert
      expect(fullKey).toHaveLength(FULL_KEY_LENGTH);
    });

    it(`should produce a secret part (after prefix) of exactly ${SECRET_LENGTH} characters`, () => {
      // Act
      const { fullKey } = generateApiKey();
      const secret = fullKey.slice(PREFIX_LENGTH);

      // Assert — base64url(32 bytes) without padding = ceil(32 * 4/3) = 43 chars
      expect(secret).toHaveLength(SECRET_LENGTH);
    });

    it(`should set keyPrefix to the first ${KEY_PREFIX_DISPLAY_LENGTH} characters of fullKey`, () => {
      // Act
      const { fullKey, keyPrefix } = generateApiKey();

      // Assert
      expect(keyPrefix).toBe(fullKey.slice(0, KEY_PREFIX_DISPLAY_LENGTH));
      expect(keyPrefix).toHaveLength(KEY_PREFIX_DISPLAY_LENGTH);
    });

    it("should set keyHash to the SHA-256 hex digest of fullKey", () => {
      // Act
      const { fullKey, keyHash } = generateApiKey();

      // Assert — keyHash must equal hashApiKey(fullKey) for DB lookup to work
      expect(keyHash).toBe(hashApiKey(fullKey));
    });
  });

  describe("HTTP header safety (base64url encoding)", () => {
    it("should contain only characters valid in HTTP Authorization headers", () => {
      // HTTP header values may not contain +, /, or = (base64 standard chars).
      // base64url replaces + → - and / → _ and omits padding =.
      // The sk_live_ prefix uses only alphanumeric + underscore — also safe.
      const { fullKey } = generateApiKey();

      expect(fullKey).toMatch(BASE64URL_SAFE_PATTERN);
    });

    it("should not contain '+' (standard base64 char invalid in header tokens)", () => {
      const { fullKey } = generateApiKey();
      expect(fullKey).not.toContain("+");
    });

    it("should not contain '/' (standard base64 char invalid in header tokens)", () => {
      const { fullKey } = generateApiKey();
      expect(fullKey).not.toContain("/");
    });

    it("should not contain '=' (base64 padding char invalid in header tokens)", () => {
      const { fullKey } = generateApiKey();
      expect(fullKey).not.toContain("=");
    });

    it("should produce valid keys across 50 independent calls (base64url encoding is consistent)", () => {
      // Run multiple times to confirm base64url encoding is always applied
      for (let i = 0; i < 50; i++) {
        const { fullKey } = generateApiKey();
        expect(fullKey).toMatch(BASE64URL_SAFE_PATTERN);
        expect(fullKey).toHaveLength(FULL_KEY_LENGTH);
        expect(fullKey.startsWith(KEY_PREFIX)).toBe(true);
      }
    });
  });

  describe("uniqueness / randomness", () => {
    it("should produce different fullKey values on successive calls", () => {
      // Act
      const { fullKey: key1 } = generateApiKey();
      const { fullKey: key2 } = generateApiKey();

      // Assert — cryptographically random; collision is astronomically unlikely
      expect(key1).not.toBe(key2);
    });

    it("should produce different keyHash values on successive calls", () => {
      // Act
      const { keyHash: hash1 } = generateApiKey();
      const { keyHash: hash2 } = generateApiKey();

      // Assert
      expect(hash1).not.toBe(hash2);
    });

    it("should produce different keyPrefix values on successive calls", () => {
      // The display prefix is the first 16 chars of the key.
      // The first 8 chars ('sk_live_') are always the same, but chars 9–16
      // come from the random secret, so they should differ between calls.
      const { keyPrefix: p1 } = generateApiKey();
      const { keyPrefix: p2 } = generateApiKey();

      expect(p1).not.toBe(p2);
    });
  });
});

describe("hashApiKey()", () => {
  describe("determinism", () => {
    it("should return the same hash when called twice with the same key", () => {
      // Arrange
      const rawKey = "sk_live_testkey1234567890abcdefghijklmnop";

      // Act
      const hash1 = hashApiKey(rawKey);
      const hash2 = hashApiKey(rawKey);

      // Assert — determinism is required for DB lookup-by-hash to work
      expect(hash1).toBe(hash2);
    });

    it("should return consistent hashes for a real generated key", () => {
      // Arrange — use an actual generated key to verify the full pipeline
      const { fullKey } = generateApiKey();

      // Act
      const hash1 = hashApiKey(fullKey);
      const hash2 = hashApiKey(fullKey);

      // Assert
      expect(hash1).toBe(hash2);
    });
  });

  describe("output format", () => {
    it(`should return a ${HASH_LENGTH}-character string (SHA-256 hex digest)`, () => {
      // Arrange
      const rawKey = "sk_live_somekey";

      // Act
      const hash = hashApiKey(rawKey);

      // Assert
      expect(hash).toHaveLength(HASH_LENGTH);
    });

    it("should return a lowercase hexadecimal string", () => {
      // Arrange
      const rawKey = "sk_live_somekey";

      // Act
      const hash = hashApiKey(rawKey);

      // Assert
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe("non-reversibility and collision resistance", () => {
    it("should not return the original key as the hash (non-reversible)", () => {
      // Arrange
      const rawKey = "sk_live_abc123";

      // Act
      const hash = hashApiKey(rawKey);

      // Assert
      expect(hash).not.toBe(rawKey);
    });

    it("should produce different hashes for different keys", () => {
      // Arrange
      const key1 = "sk_live_keyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
      const key2 = "sk_live_keyBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

      // Act
      const hash1 = hashApiKey(key1);
      const hash2 = hashApiKey(key2);

      // Assert — even a 1-char difference produces a completely different hash (avalanche)
      expect(hash1).not.toBe(hash2);
    });

    it("should produce different hashes for keys differing by a single character", () => {
      // Demonstrate SHA-256 avalanche effect
      const key1 = "sk_live_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
      const key2 = "sk_live_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB";

      const hash1 = hashApiKey(key1);
      const hash2 = hashApiKey(key2);

      expect(hash1).not.toBe(hash2);
    });
  });
});

describe("isKeyExpired()", () => {
  describe("unlimited keys (expiresAt = null)", () => {
    it("should return false for null (unlimited key never expires)", () => {
      expect(isKeyExpired(null)).toBe(false);
    });
  });

  describe("expired keys", () => {
    it("should return true for a date in the past", () => {
      // Arrange — use a clearly past date
      const pastDate = new Date("2020-01-01T00:00:00.000Z");

      // Act & Assert
      expect(isKeyExpired(pastDate)).toBe(true);
    });

    it("should return true for a date 1 millisecond in the past", () => {
      // Arrange — right at the edge: expired by the minimum possible amount
      const justExpired = new Date(Date.now() - 1);

      // Act & Assert
      expect(isKeyExpired(justExpired)).toBe(true);
    });

    it("should return true for a date 7 days in the past", () => {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      expect(isKeyExpired(sevenDaysAgo)).toBe(true);
    });
  });

  describe("valid (non-expired) keys", () => {
    it("should return false for a date in the future", () => {
      // Arrange
      const futureDate = new Date("2099-12-31T23:59:59.999Z");

      // Act & Assert
      expect(isKeyExpired(futureDate)).toBe(false);
    });

    it("should return false for a date 1 hour in the future", () => {
      const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);
      expect(isKeyExpired(oneHourFromNow)).toBe(false);
    });

    it("should return false for a date 30 days in the future", () => {
      const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      expect(isKeyExpired(thirtyDaysFromNow)).toBe(false);
    });
  });
});
