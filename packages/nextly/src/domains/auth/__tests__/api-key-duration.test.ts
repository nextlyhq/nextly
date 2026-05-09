import { randomUUID } from "crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "../../../__tests__/fixtures/db";
import type { Logger } from "../../../services/shared";
import { ApiKeyService, generateApiKey } from "../services/api-key-service";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * Create a minimal DrizzleAdapter mock that delegates raw Drizzle calls to
 * the provided in-memory SQLite database.
 */
function createTestAdapter(db: unknown) {
  return {
    getDrizzle: () => db,
    getCapabilities: () => ({ dialect: "sqlite" as const }),
  } as any;  
}

const DAY_MS = 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Test suite
// ─────────────────────────────────────────────────────────────────────────────

describe("ApiKeyService – Token Duration Enforcement", () => {
  let testDb: TestDb;
  let service: ApiKeyService;
  let userId: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    service = new ApiKeyService(createTestAdapter(testDb.db), noopLogger);

    userId = randomUUID();
    await testDb.db.insert(testDb.schema.users).values({
      id: userId,
      email: `duration-test-${userId}@example.com`,
      isActive: true,
    });
  });

  afterEach(async () => {
    await testDb.reset();
    testDb.close();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // authenticateApiKey() – expiry enforcement
  //
  // These tests insert rows directly into the api_keys table with controlled
  // expiresAt values to verify that authenticateApiKey() enforces expiry
  // without relying on createApiKey()'s future-date computation.
  // ─────────────────────────────────────────────────────────────────────────

  describe("authenticateApiKey() – expiry enforcement", () => {
    it("should return null for an expired key (clearly past expiresAt)", async () => {
      const { fullKey, keyHash, keyPrefix } = generateApiKey();
      await testDb.db.insert(testDb.schema.apiKeys).values({
        id: randomUUID(),
        name: "Expired Key",
        keyHash,
        keyPrefix,
        tokenType: "read-only",
        userId,
        expiresAt: new Date("2020-01-01T00:00:00.000Z"),
      });

      const result = await service.authenticateApiKey(fullKey);

      expect(result).toBeNull();
    });

    it("should return null for a key that expired 100ms ago (boundary enforcement)", async () => {
      const { fullKey, keyHash, keyPrefix } = generateApiKey();
      // Use 100ms in the past so the gap cannot close between insert and auth call
      const expiredRecently = new Date(Date.now() - 100);
      await testDb.db.insert(testDb.schema.apiKeys).values({
        id: randomUUID(),
        name: "Recently Expired Key",
        keyHash,
        keyPrefix,
        tokenType: "full-access",
        userId,
        expiresAt: expiredRecently,
      });

      const result = await service.authenticateApiKey(fullKey);

      expect(result).toBeNull();
    });

    it("should return null for a key that expired 7 days ago", async () => {
      const { fullKey, keyHash, keyPrefix } = generateApiKey();
      await testDb.db.insert(testDb.schema.apiKeys).values({
        id: randomUUID(),
        name: "Week-Old Expired Key",
        keyHash,
        keyPrefix,
        tokenType: "read-only",
        userId,
        expiresAt: new Date(Date.now() - 7 * DAY_MS),
      });

      const result = await service.authenticateApiKey(fullKey);

      expect(result).toBeNull();
    });

    it("should return auth tuple for an unlimited key (expiresAt = null)", async () => {
      const { fullKey, keyHash, keyPrefix } = generateApiKey();
      const keyId = randomUUID();
      await testDb.db.insert(testDb.schema.apiKeys).values({
        id: keyId,
        name: "Unlimited Key",
        keyHash,
        keyPrefix,
        tokenType: "read-only",
        userId,
        expiresAt: null,
      });

      const result = await service.authenticateApiKey(fullKey);

      expect(result).not.toBeNull();
      expect(result!.id).toBe(keyId);
      expect(result!.userId).toBe(userId);
      expect(result!.tokenType).toBe("read-only");
      expect(result!.roleId).toBeNull();
    });

    it("should return auth tuple for a key with expiry 30 days in the future", async () => {
      const { fullKey, keyHash, keyPrefix } = generateApiKey();
      const keyId = randomUUID();
      await testDb.db.insert(testDb.schema.apiKeys).values({
        id: keyId,
        name: "30-Day Key",
        keyHash,
        keyPrefix,
        tokenType: "full-access",
        userId,
        expiresAt: new Date(Date.now() + 30 * DAY_MS),
      });

      const result = await service.authenticateApiKey(fullKey);

      expect(result).not.toBeNull();
      expect(result!.id).toBe(keyId);
      expect(result!.userId).toBe(userId);
      expect(result!.tokenType).toBe("full-access");
    });

    it("should return auth tuple for a key expiring in 1 second (still valid)", async () => {
      const { fullKey, keyHash, keyPrefix } = generateApiKey();
      const keyId = randomUUID();
      await testDb.db.insert(testDb.schema.apiKeys).values({
        id: keyId,
        name: "Nearly-Expiring Key",
        keyHash,
        keyPrefix,
        tokenType: "read-only",
        userId,
        expiresAt: new Date(Date.now() + 1000),
      });

      const result = await service.authenticateApiKey(fullKey);

      expect(result).not.toBeNull();
      expect(result!.id).toBe(keyId);
    });

    it("should return null for a non-existent key (no matching keyHash in DB)", async () => {
      // No row inserted — the key hash simply does not exist in the table
      const { fullKey } = generateApiKey();

      const result = await service.authenticateApiKey(fullKey);

      expect(result).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // createApiKey() – expiresAt computation
  //
  // These tests call createApiKey() with each supported ExpiresIn value and
  // verify that the resolved expiresAt timestamp in the returned meta is
  // correct within a ±5-second tolerance (CI timing variance).
  //
  // The round-trip test additionally confirms that a newly-created key can
  // be authenticated immediately — verifying the full creation → auth path.
  // ─────────────────────────────────────────────────────────────────────────

  describe("createApiKey() – expiresAt computation", () => {
    it('should set expiresAt approximately 7 days from now for expiresIn: "7d"', async () => {
      const before = Date.now();
      const { meta } = await service.createApiKey(userId, {
        name: "7d Key",
        tokenType: "read-only",
        expiresIn: "7d",
      });
      const after = Date.now();

      expect(meta.expiresAt).not.toBeNull();
      const expiresAtMs = new Date(meta.expiresAt!).getTime();
      expect(expiresAtMs).toBeGreaterThanOrEqual(before + 7 * DAY_MS - 5000);
      expect(expiresAtMs).toBeLessThanOrEqual(after + 7 * DAY_MS + 5000);
    });

    it('should set expiresAt approximately 30 days from now for expiresIn: "30d"', async () => {
      const before = Date.now();
      const { meta } = await service.createApiKey(userId, {
        name: "30d Key",
        tokenType: "read-only",
        expiresIn: "30d",
      });
      const after = Date.now();

      expect(meta.expiresAt).not.toBeNull();
      const expiresAtMs = new Date(meta.expiresAt!).getTime();
      expect(expiresAtMs).toBeGreaterThanOrEqual(before + 30 * DAY_MS - 5000);
      expect(expiresAtMs).toBeLessThanOrEqual(after + 30 * DAY_MS + 5000);
    });

    it('should set expiresAt approximately 90 days from now for expiresIn: "90d"', async () => {
      const before = Date.now();
      const { meta } = await service.createApiKey(userId, {
        name: "90d Key",
        tokenType: "read-only",
        expiresIn: "90d",
      });
      const after = Date.now();

      expect(meta.expiresAt).not.toBeNull();
      const expiresAtMs = new Date(meta.expiresAt!).getTime();
      expect(expiresAtMs).toBeGreaterThanOrEqual(before + 90 * DAY_MS - 5000);
      expect(expiresAtMs).toBeLessThanOrEqual(after + 90 * DAY_MS + 5000);
    });

    it('should set expiresAt to null for expiresIn: "unlimited"', async () => {
      const { meta } = await service.createApiKey(userId, {
        name: "Unlimited Key",
        tokenType: "read-only",
        expiresIn: "unlimited",
      });

      expect(meta.expiresAt).toBeNull();
    });

    it("should create a key that authenticates successfully immediately after creation", async () => {
      // Round-trip: create → authenticate verifies the full pipeline:
      //   resolveExpiresAt() → DB insert → hash lookup → isKeyExpired() → auth tuple
      const { meta, key } = await service.createApiKey(userId, {
        name: "Round-Trip Key",
        tokenType: "read-only",
        expiresIn: "30d",
      });

      const auth = await service.authenticateApiKey(key);

      expect(auth).not.toBeNull();
      expect(auth!.id).toBe(meta.id);
      expect(auth!.userId).toBe(userId);
      expect(auth!.tokenType).toBe("read-only");
    });
  });
});
